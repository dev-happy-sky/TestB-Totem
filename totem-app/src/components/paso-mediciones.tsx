import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import TarjetaEstatura from './tarjeta-estatura';
import {
  ErrorSensor, ETIQUETA_SENSOR, INSTRUCCIONES, TIEMPOS_DEL_CICLO, TIPOS_SENSOR, validarLectura,
  type CodigoError, type ErrorMedicion, type Lectura, type LecturaEnVivo, type ProgresoPrueba, type Sensores, type Sexo, type TipoSensor,
  type ValoresMedidos,
} from '../sensores';

type Estado =
  | { tipo: 'pendiente' }
  | { tipo: 'midiendo' }
  | { tipo: 'desconectado' }
  | { tipo: 'error'; mensaje: string };

type Props = {
  sensores: Sensores;
  lecturas: Partial<Record<TipoSensor, Lectura>>;
  onLectura: (lectura: Lectura) => void;
  onError: (error: ErrorMedicion) => void;
  /** Cada cuánto se consulta la lectura en vivo de los sensores que la ofrecen. */
  intervaloEnVivoMs?: number;
  /** Si se pasa `onEstatura`, se muestra la tarjeta para escribir la estatura a mano y calcular el IMC. */
  estaturaCm?: number | null;
  onEstatura?: (cm: number | null) => void;
};

const COLOR_NORMAL = '#0f172a';
const COLOR_ALERTA = '#ef4444';

const anormal = (clave: keyof ValoresMedidos, valores: ValoresMedidos): boolean => {
  const v = Number(valores[clave]);
  switch (clave) {
    case 'presionSys': case 'presionDia': {
      const { presionSys: sys = 0, presionDia: dia = 0 } = valores;
      return sys >= 130 || sys < 90 || dia >= 85 || dia < 60;
    }
    case 'fcReposo': return v > 100 || v < 60;
    case 'spo2': return v < 95;
    case 'imc': return v >= 25 || v < 18.5;
    default: return false;
  }
};

type Campo = { clave: keyof ValoresMedidos; etiqueta: string; unidad: string; decimal?: boolean };

const CAMPOS: Record<TipoSensor, Campo[]> = {
  tensiometro: [
    { clave: 'presionSys', etiqueta: 'SISTÓLICA', unidad: 'mmHg' },
    { clave: 'presionDia', etiqueta: 'DIASTÓLICA', unidad: 'mmHg' },
  ],
  oximetro: [
    { clave: 'spo2', etiqueta: 'SpO₂', unidad: '%' },
    { clave: 'fcReposo', etiqueta: 'FC REPOSO', unidad: 'lpm' },
  ],
  oximetro_recuperacion: [{ clave: 'fcRecup', etiqueta: 'FC RECUP.', unidad: 'lpm' }],
  balanza: [
    { clave: 'peso', etiqueta: 'PESO', unidad: 'kg' },
    { clave: 'imc', etiqueta: 'IMC', unidad: 'kg/m²' },
    { clave: 'grasa', etiqueta: 'GRASA', unidad: '%' },
    { clave: 'masaMuscular', etiqueta: 'MASA MUSCULAR', unidad: 'kg' },
  ],
  prueba_esfuerzo: [{ clave: 'vo2Max', etiqueta: 'VO₂ MÁX', unidad: 'ml/kg·min' }],
};

// Sensores cuyos valores también pueden registrarse a mano (se leen de la pantalla del dispositivo). De la balanza solo el peso:
// IMC, grasa y masa muscular necesitan otros instrumentos.
const MANUALES: readonly TipoSensor[] = ['tensiometro', 'oximetro', 'oximetro_recuperacion', 'balanza', 'prueba_esfuerzo'];
const camposManuales = (tipo: TipoSensor): Campo[] => {
  if (tipo === 'balanza') return [{ clave: 'peso', etiqueta: 'PESO', unidad: 'kg', decimal: true }];
  if (tipo === 'prueba_esfuerzo') return [{ clave: 'vo2Max', etiqueta: 'VO₂ MÁX', unidad: 'ml/kg·min', decimal: true }];
  return CAMPOS[tipo];
};
export const ID_DISPOSITIVO_MANUAL = 'manual';

type Manual = { valores: Record<string, string>; error: string };

const mensajeEnVivo = (tipo: TipoSensor, motivo: LecturaEnVivo['motivo']): string => {
  if (tipo === 'balanza') {
    return motivo === 'desconectado' ? 'Báscula no disponible' : 'Súbete a la báscula';
  }
  if (motivo === 'desconectado') return 'Oxímetro no conectado';
  return motivo === 'sin_dedo' ? 'Coloca el dedo en el oxímetro' : 'Sin señal del oxímetro';
};

const formatearTiempo = (segundos: number): string => {
  const total = Math.max(0, Math.round(segundos));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const textoEnVivo = (tipo: TipoSensor, vivo: LecturaEnVivo): string => {
  if (tipo === 'balanza') return `Peso ${vivo.peso?.toFixed(1)} kg`;
  return `${tipo === 'oximetro' ? `SpO₂ ${vivo.spo2} %  ·  ` : ''}FC ${vivo.fc} lpm`;
};

export default function PasoMediciones({ sensores, lecturas, onLectura, onError, intervaloEnVivoMs = 1000, estaturaCm = null, onEstatura }: Props) {
  const [estados, setEstados] = useState<Partial<Record<TipoSensor, Estado>>>({});
  const [enVivo, setEnVivo] = useState<Partial<Record<TipoSensor, LecturaEnVivo>>>({});
  const [manuales, setManuales] = useState<Partial<Record<TipoSensor, Manual>>>({});
  // Prueba del escalón: el sexo solo se usa en la fórmula del resultado y no se guarda.
  const [sexos, setSexos] = useState<Partial<Record<TipoSensor, Sexo>>>({});
  const [progresos, setProgresos] = useState<Partial<Record<TipoSensor, ProgresoPrueba | null>>>({});

  // La estatura es el primer dato: mientras no se guarde, el resto de las mediciones queda bloqueado.
  const bloqueado = !!onEstatura && estaturaCm === null;

  // Cada medición automática lleva un número: si la persona decide escribir los valores a mano mientras el sensor sigue
  // esperando (el tensiómetro tarda hasta 2 minutos), el número cambia y el resultado tardío se descarta.
  const medicionVigente = useRef<Partial<Record<TipoSensor, number>>>({});
  const cancelarMedicion = (tipo: TipoSensor) => {
    medicionVigente.current[tipo] = (medicionVigente.current[tipo] ?? 0) + 1;
    sensores[tipo].cancelar?.();   // una prueba guiada detiene su cronómetro
  };

  const poner = (tipo: TipoSensor, estado: Estado) => setEstados((previo) => ({ ...previo, [tipo]: estado }));

  // R.52: al entrar se revisa qué sensores están conectados.
  const revisarConexion = async (tipos: readonly TipoSensor[]) => {
    const disponibles = await Promise.all(tipos.map((tipo) => sensores[tipo].disponible().catch(() => false)));
    tipos.forEach((tipo, i) => poner(tipo, disponibles[i] ? { tipo: 'pendiente' } : { tipo: 'desconectado' }));
  };

  useEffect(() => {
    let activo = true;
    Promise.all(TIPOS_SENSOR.map((tipo) => sensores[tipo].disponible().catch(() => false))).then((disponibles) => {
      if (!activo) return;
      setEstados(Object.fromEntries(TIPOS_SENSOR.map((tipo, i) => [tipo, { tipo: disponibles[i] ? 'pendiente' : 'desconectado' }])));
    });
    return () => { activo = false; };
  }, [sensores]);

  // Lectura en vivo: mientras la pantalla está abierta se consulta lo último que envía el oxímetro, sin que el usuario
  // tenga que pulsar nada. No se registra: lo que cuenta es la medición que se confirma con "Medir".
  useEffect(() => {
    const conVivo = TIPOS_SENSOR.filter((tipo) => sensores[tipo].enVivo);
    if (conVivo.length === 0) return undefined;
    let activo = true;
    let ocupado = false;
    const consultar = async () => {
      if (ocupado) return;   // no se acumulan peticiones si el puente tarda
      ocupado = true;
      const recibidas = await Promise.all(conVivo.map((tipo) => sensores[tipo].enVivo!().catch((): LecturaEnVivo => ({ valida: false, motivo: 'desconectado' }))));
      ocupado = false;
      if (activo) setEnVivo(Object.fromEntries(conVivo.map((tipo, i) => [tipo, recibidas[i]])));
    };
    consultar();
    const temporizador = setInterval(consultar, intervaloEnVivoMs);
    return () => { activo = false; clearInterval(temporizador); };
  }, [sensores, intervaloEnVivoMs]);

  // Al salir de la pantalla no debe quedar una prueba corriendo en segundo plano.
  useEffect(() => () => { TIPOS_SENSOR.forEach((tipo) => sensores[tipo].cancelar?.()); }, [sensores]);

  // Progreso de las pruebas guiadas (cuenta regresiva y ritmo) mientras están en curso.
  const guiadasEnCurso = TIPOS_SENSOR.filter((tipo) => estados[tipo]?.tipo === 'midiendo' && sensores[tipo].progreso);
  const claveGuiadas = guiadasEnCurso.join(',');
  useEffect(() => {
    if (!claveGuiadas) return undefined;
    const leer = () => setProgresos(Object.fromEntries(claveGuiadas.split(',').map((tipo) => [tipo, sensores[tipo as TipoSensor].progreso!()])));
    leer();
    const temporizador = setInterval(leer, 300);
    return () => clearInterval(temporizador);
  }, [claveGuiadas, sensores]);

  const registrarError = (tipo: TipoSensor, codigo: CodigoError, mensaje: string) => {
    onError({ sensor: tipo, codigo, mensaje: mensaje.slice(0, 200), ocurrido_en: new Date().toISOString() });
    poner(tipo, codigo === 'desconectado' ? { tipo: 'desconectado' } : { tipo: 'error', mensaje });
  };

  const medir = async (tipo: TipoSensor) => {
    if (bloqueado) return;
    cancelarMedicion(tipo);
    const numero = medicionVigente.current[tipo];
    poner(tipo, { tipo: 'midiendo' });
    try {
      const lectura = await sensores[tipo].medir();
      if (medicionVigente.current[tipo] !== numero) return;   // se canceló: la persona escribió los valores a mano
      const problema = validarLectura(lectura);   // R.53, R.62
      if (problema) {
        registrarError(tipo, 'lectura_invalida', problema);
        return;
      }
      onLectura(lectura);
      // La prueba del escalón también midió la FC de recuperación: se registra para no pedirla otra vez.
      lectura.adicionales?.filter((adicional) => validarLectura(adicional) === null).forEach(onLectura);
      poner(tipo, { tipo: 'pendiente' });
    } catch (error) {
      if (medicionVigente.current[tipo] !== numero) return;
      if (error instanceof ErrorSensor) registrarError(tipo, error.codigo, error.message);
      else registrarError(tipo, 'error', error instanceof Error && error.message ? error.message : 'Error inesperado del sensor');
    }
  };

  const elegirSexo = (tipo: TipoSensor, sexo: Sexo) => {
    setSexos((previo) => ({ ...previo, [tipo]: sexo }));
    sensores[tipo].configurar?.({ sexo });
  };

  const cancelarPrueba = (tipo: TipoSensor) => {
    cancelarMedicion(tipo);
    poner(tipo, { tipo: 'pendiente' });
  };

  // Panel de la prueba guiada: cuenta regresiva y el ritmo del metrónomo (sube, sube, baja, baja).
  const panelProgreso = (progreso: ProgresoPrueba | null | undefined) => {
    if (!progreso) return <Text style={estilos.progresoTexto}>Preparando la prueba…</Text>;
    if (progreso.fase === 'espera') {
      return (
        <>
          <Text style={estilos.progresoTitulo}>Siéntate y coloca el dedo en el oxímetro</Text>
          <Text style={estilos.progresoTiempo}>{progreso.restanteS} s</Text>
        </>
      );
    }
    if (progreso.fase === 'midiendo') {
      return <Text style={estilos.progresoTitulo}>Midiendo tu pulso… mantén la mano quieta</Text>;
    }
    const activo = Math.floor((progreso.transcurridoS * progreso.tiemposPorMinuto) / 60) % TIEMPOS_DEL_CICLO.length;
    return (
      <>
        <Text style={estilos.progresoTitulo}>Sube y baja al ritmo</Text>
        <Text style={estilos.progresoTiempo} accessibilityLabel="Tiempo restante">{formatearTiempo(progreso.restanteS)}</Text>
        <View style={estilos.ritmo}>
          {TIEMPOS_DEL_CICLO.map((palabra, i) => (
            <View key={i} style={[estilos.tiempo, i === activo && estilos.tiempoActivo]} accessibilityState={{ selected: i === activo }}>
              <Text style={[estilos.tiempoTexto, i === activo && estilos.tiempoTextoActivo]}>{palabra}</Text>
            </View>
          ))}
        </View>
      </>
    );
  };

  // Escribir a mano cancela la medición automática que siga esperando (por ejemplo el tensiómetro, que espera hasta 2 minutos).
  const abrirManual = (tipo: TipoSensor) => {
    cancelarMedicion(tipo);
    setEstados((previo) => (previo[tipo]?.tipo === 'midiendo' ? { ...previo, [tipo]: { tipo: 'pendiente' } } : previo));
    setManuales((previo) => ({ ...previo, [tipo]: { valores: {}, error: '' } }));
  };
  const cerrarManual = (tipo: TipoSensor) => setManuales((previo) => ({ ...previo, [tipo]: undefined }));
  const escribirManual = (tipo: TipoSensor, clave: string, texto: string) =>
    setManuales((previo) => ({ ...previo, [tipo]: { valores: { ...previo[tipo]?.valores, [clave]: texto }, error: '' } }));

  // Registro manual: el valor se lee de la pantalla del oxímetro. Pasa por las mismas validaciones que una lectura
  // automática y queda marcado con el dispositivo "manual" para que el encargado sepa que no vino del sensor.
  const registrarManual = (tipo: TipoSensor) => {
    const valores: ValoresMedidos = {};
    for (const campo of camposManuales(tipo)) {
      const texto = (manuales[tipo]?.valores[campo.clave] ?? '').trim().replace(',', '.');
      const numero = Number(texto);
      if (!texto || !(campo.decimal ? Number.isFinite(numero) : Number.isInteger(numero))) {
        const que = campo.decimal ? 'un número' : 'un número entero';
        setManuales((previo) => ({ ...previo, [tipo]: { valores: previo[tipo]?.valores ?? {}, error: `${campo.etiqueta}: ingresa ${que}` } }));
        return;
      }
      // El peso viaja como texto con un decimal (igual que el de la balanza simulada); el resto, como número.
      (valores as Record<string, number | string>)[campo.clave] = campo.decimal ? numero.toFixed(1) : numero;
    }
    const lectura: Lectura = {
      sensor: tipo, valores, dispositivo: { id: ID_DISPOSITIVO_MANUAL, calibracion: 'desconocida' }, capturadoEn: new Date().toISOString(),
    };
    const problema = validarLectura(lectura);
    if (problema) {
      setManuales((previo) => ({ ...previo, [tipo]: { valores: previo[tipo]?.valores ?? {}, error: problema } }));
      return;
    }
    cancelarMedicion(tipo);
    onLectura(lectura);
    poner(tipo, { tipo: 'pendiente' });
    cerrarManual(tipo);
  };

  return (
    <View style={estilos.grid}>
      {onEstatura && <TarjetaEstatura estaturaCm={estaturaCm} peso={lecturas.balanza?.valores.peso} onEstatura={onEstatura} />}
      {TIPOS_SENSOR.map((tipo) => {
        const lectura = lecturas[tipo];
        const estado = estados[tipo] ?? { tipo: 'pendiente' };
        const etiqueta = ETIQUETA_SENSOR[tipo];
        return (
          <View key={tipo} style={[estilos.tarjeta, bloqueado && estilos.bloqueada]} accessibilityLabel={`Sensor ${etiqueta}`}
                accessibilityState={{ disabled: bloqueado }}>
            <Text style={estilos.titulo}>{etiqueta}</Text>
            {bloqueado && <Text style={estilos.candado} accessibilityRole="text">🔒 Primero ingresa tu estatura</Text>}
            <Text style={estilos.instruccion}>{INSTRUCCIONES[tipo]}</Text>
            {sensores[tipo].guia && (
              <View style={estilos.guia}>
                <Text style={estilos.guiaTitulo}>{sensores[tipo].guia!.nombre.toUpperCase()}</Text>
                {sensores[tipo].guia!.instrucciones.map((linea) => <Text key={linea} style={estilos.guiaLinea}>• {linea}</Text>)}
              </View>
            )}

            <View style={estilos.fila}>
              {CAMPOS[tipo].map((campo) => {
                const valor = lectura?.valores[campo.clave];
                const color = lectura && anormal(campo.clave, lectura.valores) ? COLOR_ALERTA : COLOR_NORMAL;
                return (
                  <View key={campo.clave} style={estilos.campo}>
                    <Text style={estilos.etiqueta}>{campo.etiqueta}</Text>
                    <Text style={[estilos.metrica, { color }]}>
                      {valor === undefined ? '--' : valor} <Text style={estilos.unidad}>{campo.unidad}</Text>
                    </Text>
                  </View>
                );
              })}
            </View>

            {!bloqueado && sensores[tipo].guia?.requiereSexo && estado.tipo !== 'midiendo' && (
              <View style={estilos.sexo} accessibilityRole="radiogroup" accessibilityLabel="Sexo para la prueba">
                <Text style={estilos.etiqueta}>SEXO (PARA CALCULAR EL RESULTADO)</Text>
                <View style={estilos.fila}>
                  {(['hombre', 'mujer'] as const).map((opcion) => (
                    <TouchableOpacity
                      key={opcion} style={[estilos.opcion, sexos[tipo] === opcion && estilos.opcionActiva]} onPress={() => elegirSexo(tipo, opcion)}
                      accessibilityRole="radio" accessibilityState={{ selected: sexos[tipo] === opcion }}
                      accessibilityLabel={`Sexo para la prueba: ${opcion === 'hombre' ? 'Hombre' : 'Mujer'}`}>
                      <Text style={[estilos.opcionTexto, sexos[tipo] === opcion && estilos.opcionTextoActiva]}>{opcion === 'hombre' ? 'Hombre' : 'Mujer'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {estado.tipo === 'midiendo' && sensores[tipo].progreso && (
              <View style={estilos.progreso} accessibilityLabel={`Progreso ${etiqueta}`}>{panelProgreso(progresos[tipo])}</View>
            )}

            {!bloqueado && sensores[tipo].enVivo && enVivo[tipo] && (
              <View style={estilos.enVivo} accessibilityLabel={`En vivo ${etiqueta}`}>
                <Text style={estilos.enVivoTitulo}>EN VIVO</Text>
                {enVivo[tipo]!.valida ? (
                  <Text style={estilos.enVivoValor}>{textoEnVivo(tipo, enVivo[tipo]!)}</Text>
                ) : (
                  <Text style={estilos.enVivoSinDato}>{mensajeEnVivo(tipo, enVivo[tipo]!.motivo)}</Text>
                )}
              </View>
            )}

            {!bloqueado && estado.tipo === 'desconectado' && (
              <Text style={estilos.error} accessibilityRole="alert">
                Sensor desconectado. Revisa que esté encendido y cerca del tótem.
              </Text>
            )}
            {!bloqueado && estado.tipo === 'error' && (
              <Text style={estilos.error} accessibilityRole="alert">No se pudo medir: {estado.mensaje}. Intenta nuevamente.</Text>
            )}
            {estado.tipo === 'pendiente' && lectura && (
              <Text style={estilos.exito}>✓ Medición terminada correctamente</Text>
            )}

            {!bloqueado && MANUALES.includes(tipo) && (manuales[tipo] ? (
              <View style={estilos.manual}>
                <View style={estilos.fila}>
                  {camposManuales(tipo).map((campo) => (
                    <View key={campo.clave} style={estilos.campo}>
                      <Text style={estilos.etiqueta}>{campo.etiqueta} ({campo.unidad})</Text>
                      <TextInput
                        style={estilos.entrada} keyboardType={campo.decimal ? 'decimal-pad' : 'number-pad'} maxLength={campo.decimal ? 5 : 3}
                        value={manuales[tipo]?.valores[campo.clave] ?? ''}
                        onChangeText={(texto) => escribirManual(tipo, campo.clave, texto)}
                        accessibilityLabel={`${campo.etiqueta} manual`}
                      />
                    </View>
                  ))}
                </View>
                {!!manuales[tipo]?.error && <Text style={estilos.error} accessibilityRole="alert">{manuales[tipo]?.error}</Text>}
                <View style={estilos.fila}>
                  <TouchableOpacity style={estilos.boton} onPress={() => registrarManual(tipo)} accessibilityRole="button"
                                    accessibilityLabel={`Registrar valores de ${etiqueta}`}>
                    <Text style={estilos.botonTexto}>Registrar valores</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[estilos.boton, estilos.botonSecundario]} onPress={() => cerrarManual(tipo)} accessibilityRole="button"
                                    accessibilityLabel={`Cancelar ingreso manual de ${etiqueta}`}>
                    <Text style={estilos.botonSecundarioTexto}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => abrirManual(tipo)} accessibilityRole="button" accessibilityLabel={`Ingresar manualmente ${etiqueta}`}>
                <Text style={estilos.enlace}>Ingresar valores manualmente</Text>
              </TouchableOpacity>
            ))}

            {estado.tipo === 'midiendo' && sensores[tipo].guia ? (
              <TouchableOpacity style={[estilos.boton, estilos.botonSecundario, { marginLeft: 0 }]} onPress={() => cancelarPrueba(tipo)}
                                accessibilityRole="button" accessibilityLabel="Cancelar la prueba del escalón">
                <Text style={estilos.botonSecundarioTexto}>Cancelar prueba</Text>
              </TouchableOpacity>
            ) : estado.tipo === 'midiendo' ? (
              <Text style={estilos.midiendo}>
                {tipo === 'tensiometro' ? 'Esperando la medición: pulsa Start en el tensiómetro…' : 'Midiendo…'}
              </Text>
            ) : estado.tipo === 'desconectado' ? (
              <TouchableOpacity style={[estilos.boton, bloqueado && estilos.botonBloqueado]} disabled={bloqueado} onPress={() => revisarConexion([tipo])}
                                accessibilityRole="button" accessibilityState={{ disabled: bloqueado }}>
                <Text style={estilos.botonTexto}>Reintentar conexión</Text>
              </TouchableOpacity>
            ) : (
              (() => {
                const guiada = !!sensores[tipo].guia;
                const sinSexo = !!sensores[tipo].guia?.requiereSexo && !sexos[tipo];
                const sinPulsar = bloqueado || sinSexo;
                const texto = estado.tipo === 'error' ? 'Reintentar' : lectura ? (guiada ? 'Repetir la prueba' : 'Volver a medir') : (guiada ? 'Iniciar la prueba' : 'Medir');
                const accion = guiada ? `${texto.split(' ')[0]} prueba del escalón` : `${texto} ${etiqueta}`;
                return (
                  <TouchableOpacity style={[estilos.boton, sinPulsar && estilos.botonBloqueado]} disabled={sinPulsar} onPress={() => medir(tipo)}
                                    accessibilityRole="button" accessibilityState={{ disabled: sinPulsar }} accessibilityLabel={accion}>
                    <Text style={estilos.botonTexto}>{texto}</Text>
                  </TouchableOpacity>
                );
              })()
            )}
          </View>
        );
      })}
    </View>
  );
}

const estilos = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tarjeta: { width: '48%', backgroundColor: '#fff', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 15 },
  titulo: { fontSize: 14, fontWeight: 'bold', color: '#1e293b', marginBottom: 8 },
  instruccion: { fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 17 },
  fila: { flexDirection: 'row', flexWrap: 'wrap' },
  campo: { marginRight: 16, marginBottom: 8 },
  etiqueta: { fontSize: 10, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1 },
  metrica: { fontSize: 22, fontWeight: 'bold' },
  unidad: { fontSize: 12, color: '#94a3b8', fontWeight: 'normal' },
  error: { color: '#dc2626', fontSize: 13, fontWeight: '600', marginVertical: 6 },
  exito: { color: '#16a34a', fontSize: 13, fontWeight: '600', marginVertical: 6 },
  midiendo: { color: '#002c5f', fontWeight: 'bold', marginTop: 8 },
  boton: { backgroundColor: '#002c5f', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 24, alignSelf: 'flex-start', marginTop: 8 },
  botonTexto: { color: '#fff', fontWeight: 'bold' },
  botonSecundario: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', marginLeft: 8 },
  botonSecundarioTexto: { color: '#475569', fontWeight: 'bold' },
  enVivo: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, padding: 8, borderRadius: 8, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  enVivoTitulo: { fontSize: 10, fontWeight: 'bold', color: '#16a34a', letterSpacing: 1, marginRight: 10 },
  enVivoValor: { fontSize: 16, fontWeight: 'bold', color: '#0f172a' },
  enVivoSinDato: { fontSize: 13, color: '#64748b' },
  bloqueada: { opacity: 0.55, backgroundColor: '#f8fafc' },
  candado: { fontSize: 12, fontWeight: 'bold', color: '#06386d', marginBottom: 8 },
  botonBloqueado: { backgroundColor: '#cbd5e1' },
  guia: { marginBottom: 10, padding: 10, borderRadius: 8, backgroundColor: '#eef3fb', borderWidth: 1, borderColor: '#aec6e6' },
  guiaTitulo: { fontSize: 10, fontWeight: 'bold', color: '#06386d', letterSpacing: 1, marginBottom: 4 },
  guiaLinea: { fontSize: 12, color: '#475569', lineHeight: 17, marginBottom: 2 },
  sexo: { marginBottom: 8 },
  opcion: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', marginRight: 8, marginTop: 6 },
  opcionActiva: { backgroundColor: '#002c5f', borderColor: '#002c5f' },
  opcionTexto: { fontSize: 14, fontWeight: '600', color: '#475569' },
  opcionTextoActiva: { color: '#fff' },
  progreso: { marginVertical: 8, padding: 12, borderRadius: 10, backgroundColor: '#eef3fb', borderWidth: 1, borderColor: '#7ba2d2', alignItems: 'center' },
  progresoTitulo: { fontSize: 13, fontWeight: 'bold', color: '#002c5f', textAlign: 'center' },
  progresoTexto: { fontSize: 13, color: '#64748b' },
  progresoTiempo: { fontSize: 38, fontWeight: 'bold', color: '#0f172a', marginVertical: 4 },
  ritmo: { flexDirection: 'row', marginTop: 4 },
  tiempo: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#aec6e6', marginHorizontal: 3 },
  tiempoActivo: { backgroundColor: '#002c5f', borderColor: '#002c5f' },
  tiempoTexto: { fontSize: 12, fontWeight: 'bold', color: '#002c5f' },
  tiempoTextoActivo: { color: '#fff' },
  enlace: { color: '#475569', fontSize: 13, textDecorationLine: 'underline', marginTop: 4 },
  manual: { marginTop: 4, padding: 10, borderRadius: 8, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  entrada: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 18, minWidth: 80, color: '#0f172a', backgroundColor: '#fff' },
});
