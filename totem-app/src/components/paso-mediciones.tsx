import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
  ErrorSensor, ETIQUETA_SENSOR, INSTRUCCIONES, TIPOS_SENSOR, validarLectura,
  type CodigoError, type ErrorMedicion, type Lectura, type Sensores, type TipoSensor, type ValoresMedidos,
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

export default function PasoMediciones({ sensores, lecturas, onLectura, onError }: Props) {
  const [estados, setEstados] = useState<Partial<Record<TipoSensor, Estado>>>({});

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
});
