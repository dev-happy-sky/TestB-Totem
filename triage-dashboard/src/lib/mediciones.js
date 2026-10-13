// Dispositivos, calibración y errores de las mediciones del tótem (sin React, fácil de probar).
import { horaLocal } from './formato';

// En el orden en que se miden en el tótem. `banda_pecho` solo existe en evaluaciones antiguas (hoy la FC la mide el oxímetro).
export const ETIQUETA_SENSOR = {
  tensiometro: 'Tensiómetro',
  oximetro: 'Oxímetro',
  balanza: 'Balanza',
  prueba_esfuerzo: 'Prueba de esfuerzo',
  oximetro_recuperacion: 'Oxímetro (FC de recuperación)',
  banda_pecho: 'Banda de pecho',
};

export const ETIQUETA_CALIBRACION = {
  vigente: 'calibración vigente',
  vencida: 'calibración vencida',
  desconocida: 'calibración sin informar',
};

export const ETIQUETA_ERROR = {
  desconectado: 'Sensor desconectado',
  timeout: 'Sin respuesta del sensor',
  movimiento: 'Movimiento durante la medición',
  lectura_invalida: 'Lectura inválida',
  error: 'Error del sensor',
};

const ORDEN = Object.keys(ETIQUETA_SENSOR);
const posicion = (sensor) => (ORDEN.includes(sensor) ? ORDEN.indexOf(sensor) : ORDEN.length);

// R.59 y R.60: qué dispositivo tomó cada medición, su calibración y a qué hora. En el orden de los sensores del tótem.
export function resumirDispositivos(dispositivos) {
  return Object.entries(dispositivos || {})
    .map(([sensor, d]) => ({
      sensor,
      etiqueta: ETIQUETA_SENSOR[sensor] || sensor,
      id: d?.id || 'sin identificar',
      calibracion: d?.calibracion || 'desconocida',
      calibracionTexto: ETIQUETA_CALIBRACION[d?.calibracion] || ETIQUETA_CALIBRACION.desconocida,
      vencida: d?.calibracion === 'vencida',
      hora: horaLocal(d?.capturado_en),
    }))
    .sort((a, b) => posicion(a.sensor) - posicion(b.sensor));
}

export const hayCalibracionVencida = (dispositivos) => resumirDispositivos(dispositivos).some((d) => d.vencida);

// R.65: errores ocurridos al medir, en el orden en que pasaron.
export function resumirErrores(errores) {
  return (errores || []).map((e) => ({
    sensor: ETIQUETA_SENSOR[e?.sensor] || e?.sensor || 'Sensor',
    tipo: ETIQUETA_ERROR[e?.codigo] || ETIQUETA_ERROR.error,
    mensaje: e?.mensaje || '',
    hora: horaLocal(e?.ocurrido_en),
  }));
}
