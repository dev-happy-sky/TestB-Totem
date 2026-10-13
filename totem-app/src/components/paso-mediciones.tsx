import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import {
  ErrorSensor, ETIQUETA_SENSOR, INSTRUCCIONES, TIPOS_SENSOR, validarLectura,
  type CodigoError, type ErrorMedicion, type Lectura, type LecturaEnVivo, type Sensores, type TipoSensor, type ValoresMedidos,
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

type Campo = { clave: keyof ValoresMedidos; etiqueta: string; unidad: string };

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

// Sensores cuyos valores también pueden registrarse a mano (el oxímetro se lee de la pantalla del dispositivo).
const MANUALES: readonly TipoSensor[] = ['oximetro', 'oximetro_recuperacion'];
export const ID_DISPOSITIVO_MANUAL = 'manual';

type Manual = { valores: Record<string, string>; error: string };

const MENSAJE_EN_VIVO: Record<NonNullable<LecturaEnVivo['motivo']>, string> = {
  desconectado: 'Oxímetro no conectado',
  sin_senal: 'Sin señal del oxímetro',
  sin_dedo: 'Coloca el dedo en el oxímetro',
};

export default function PasoMediciones({ sensores, lecturas, onLectura, onError, intervaloEnVivoMs = 1000 }: Props) {
  const [estados, setEstados] = useState<Partial<Record<TipoSensor, Estado>>>({});
  const [enVivo, setEnVivo] = useState<Partial<Record<TipoSensor, LecturaEnVivo>>>({});
  const [manuales, setManuales] = useState<Partial<Record<TipoSensor, Manual>>>({});

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

  const registrarError = (tipo: TipoSensor, codigo: CodigoError, mensaje: string) => {
    onError({ sensor: tipo, codigo, mensaje: mensaje.slice(0, 200), ocurrido_en: new Date().toISOString() });
    poner(tipo, codigo === 'desconectado' ? { tipo: 'desconectado' } : { tipo: 'error', mensaje });
  };

  const medir = async (tipo: TipoSensor) => {
    poner(tipo, { tipo: 'midiendo' });
    try {
      const lectura = await sensores[tipo].medir();
      const problema = validarLectura(lectura);   // R.53, R.62
      if (problema) {
        registrarError(tipo, 'lectura_invalida', problema);
        return;
      }
      onLectura(lectura);
      poner(tipo, { tipo: 'pendiente' });
    } catch (error) {
      if (error instanceof ErrorSensor) registrarError(tipo, error.codigo, error.message);
      else registrarError(tipo, 'error', error instanceof Error && error.message ? error.message : 'Error inesperado del sensor');
    }
  };

  const abrirManual = (tipo: TipoSensor) => setManuales((previo) => ({ ...previo, [tipo]: { valores: {}, error: '' } }));
  const cerrarManual = (tipo: TipoSensor) => setManuales((previo) => ({ ...previo, [tipo]: undefined }));
  const escribirManual = (tipo: TipoSensor, clave: string, texto: string) =>
    setManuales((previo) => ({ ...previo, [tipo]: { valores: { ...previo[tipo]?.valores, [clave]: texto }, error: '' } }));

  // Registro manual: el valor se lee de la pantalla del oxímetro. Pasa por las mismas validaciones que una lectura
  // automática y queda marcado con el dispositivo "manual" para que el encargado sepa que no vino del sensor.
  const registrarManual = (tipo: TipoSensor) => {
    const valores: ValoresMedidos = {};
    for (const campo of CAMPOS[tipo]) {
      const texto = (manuales[tipo]?.valores[campo.clave] ?? '').trim().replace(',', '.');
      const numero = Number(texto);
      if (!texto || !Number.isInteger(numero)) {
        setManuales((previo) => ({ ...previo, [tipo]: { valores: previo[tipo]?.valores ?? {}, error: `${campo.etiqueta}: ingresa un número entero` } }));
        return;
      }
      (valores as Record<string, number>)[campo.clave] = numero;
    }
    const lectura: Lectura = {
      sensor: tipo, valores, dispositivo: { id: ID_DISPOSITIVO_MANUAL, calibracion: 'desconocida' }, capturadoEn: new Date().toISOString(),
    };
    const problema = validarLectura(lectura);
    if (problema) {
      setManuales((previo) => ({ ...previo, [tipo]: { valores: previo[tipo]?.valores ?? {}, error: problema } }));
      return;
    }
    onLectura(lectura);
    poner(tipo, { tipo: 'pendiente' });
    cerrarManual(tipo);
  };

  return (
    <View style={estilos.grid}>
      {TIPOS_SENSOR.map((tipo) => {
        const lectura = lecturas[tipo];
        const estado = estados[tipo] ?? { tipo: 'pendiente' };
        const etiqueta = ETIQUETA_SENSOR[tipo];
        return (
          <View key={tipo} style={estilos.tarjeta} accessibilityLabel={`Sensor ${etiqueta}`}>
            <Text style={estilos.titulo}>{etiqueta}</Text>
            <Text style={estilos.instruccion}>{INSTRUCCIONES[tipo]}</Text>

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

            {sensores[tipo].enVivo && enVivo[tipo] && (
              <View style={estilos.enVivo} accessibilityLabel={`En vivo ${etiqueta}`}>
                <Text style={estilos.enVivoTitulo}>EN VIVO</Text>
                {enVivo[tipo]!.valida ? (
                  <Text style={estilos.enVivoValor}>
                    {tipo === 'oximetro' ? `SpO₂ ${enVivo[tipo]!.spo2} %  ·  ` : ''}FC {enVivo[tipo]!.fc} lpm
                  </Text>
                ) : (
                  <Text style={estilos.enVivoSinDato}>{MENSAJE_EN_VIVO[enVivo[tipo]!.motivo ?? 'sin_senal']}</Text>
                )}
              </View>
            )}

            {estado.tipo === 'desconectado' && (
              <Text style={estilos.error} accessibilityRole="alert">
                Sensor desconectado. Revisa que esté encendido y cerca del tótem.
              </Text>
            )}
            {estado.tipo === 'error' && (
              <Text style={estilos.error} accessibilityRole="alert">No se pudo medir: {estado.mensaje}. Intenta nuevamente.</Text>
            )}
            {estado.tipo === 'pendiente' && lectura && (
              <Text style={estilos.exito}>✓ Medición terminada correctamente</Text>
            )}

            {MANUALES.includes(tipo) && estado.tipo !== 'midiendo' && (manuales[tipo] ? (
              <View style={estilos.manual}>
                <View style={estilos.fila}>
                  {CAMPOS[tipo].map((campo) => (
                    <View key={campo.clave} style={estilos.campo}>
                      <Text style={estilos.etiqueta}>{campo.etiqueta} ({campo.unidad})</Text>
                      <TextInput
                        style={estilos.entrada} keyboardType="number-pad" maxLength={3}
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

            {estado.tipo === 'midiendo' ? (
              <Text style={estilos.midiendo}>Midiendo…</Text>
            ) : estado.tipo === 'desconectado' ? (
              <TouchableOpacity style={estilos.boton} onPress={() => revisarConexion([tipo])} accessibilityRole="button">
                <Text style={estilos.botonTexto}>Reintentar conexión</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={estilos.boton} onPress={() => medir(tipo)} accessibilityRole="button" accessibilityLabel={`${estado.tipo === 'error' ? 'Reintentar' : lectura ? 'Volver a medir' : 'Medir'} ${etiqueta}`}>
                <Text style={estilos.botonTexto}>{estado.tipo === 'error' ? 'Reintentar' : lectura ? 'Volver a medir' : 'Medir'}</Text>
              </TouchableOpacity>
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
  midiendo: { color: '#ea580c', fontWeight: 'bold', marginTop: 8 },
  boton: { backgroundColor: '#ea580c', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 24, alignSelf: 'flex-start', marginTop: 8 },
  botonTexto: { color: '#fff', fontWeight: 'bold' },
  botonSecundario: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', marginLeft: 8 },
  botonSecundarioTexto: { color: '#475569', fontWeight: 'bold' },
  enVivo: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, padding: 8, borderRadius: 8, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  enVivoTitulo: { fontSize: 10, fontWeight: 'bold', color: '#16a34a', letterSpacing: 1, marginRight: 10 },
  enVivoValor: { fontSize: 16, fontWeight: 'bold', color: '#0f172a' },
  enVivoSinDato: { fontSize: 13, color: '#64748b' },
  enlace: { color: '#475569', fontSize: 13, textDecorationLine: 'underline', marginTop: 4 },
  manual: { marginTop: 4, padding: 10, borderRadius: 8, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  entrada: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 18, minWidth: 80, color: '#0f172a', backgroundColor: '#fff' },
});
