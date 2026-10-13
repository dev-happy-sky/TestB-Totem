import type { Lectura, TipoSensor, ValoresMedidos } from './tipos';

export const ETIQUETA_SENSOR: Record<TipoSensor, string> = {
  tensiometro: 'Tensiómetro',
  oximetro: 'Oxímetro',
  balanza: 'Balanza',
  prueba_esfuerzo: 'Prueba de esfuerzo',
  oximetro_recuperacion: 'Oxímetro (FC de recuperación)',
};

/** Qué hacer antes de medir (R.63). */
export const INSTRUCCIONES: Record<TipoSensor, string> = {
  tensiometro: 'Siéntate con la espalda apoyada, coloca el brazalete a la altura del corazón y no hables durante la medición.',
  oximetro: 'Coloca el dedo índice limpio y seco en el oxímetro, con la mano quieta y apoyada a la altura del corazón, hasta que termine.',
  balanza: 'Súbete descalzo y quieto, con los pies sobre los electrodos y los brazos a los lados.',
  prueba_esfuerzo: 'Realiza el ejercicio indicado en la pantalla.',
  oximetro_recuperacion: 'Apenas termines el ejercicio, vuelve a colocar el dedo en el oxímetro y mantén la mano quieta.',
};

type Rango = { min: number; max: number; etiqueta: string; unidad: string };

/**
 * Límites de lo físicamente posible (R.53, R.62). No son rangos clínicos: un valor fuera de ellos es una lectura
 * defectuosa (sensor mal puesto, movimiento) y se pide repetir. Presión, FC e IMC coinciden con `validos` de
 * backend-totem/reglas_aptitud.json.
 */
export const RANGOS_POSIBLES: Record<keyof ValoresMedidos, Rango> = {
  presionSys: { min: 50, max: 300, etiqueta: 'Presión sistólica', unidad: 'mmHg' },
  presionDia: { min: 30, max: 200, etiqueta: 'Presión diastólica', unidad: 'mmHg' },
  fcReposo: { min: 20, max: 250, etiqueta: 'Frecuencia cardíaca en reposo', unidad: 'lpm' },
  fcRecup: { min: 20, max: 250, etiqueta: 'Frecuencia cardíaca de recuperación', unidad: 'lpm' },
  spo2: { min: 50, max: 100, etiqueta: 'Saturación de oxígeno', unidad: '%' },
  peso: { min: 20, max: 400, etiqueta: 'Peso', unidad: 'kg' },
  imc: { min: 10, max: 80, etiqueta: 'IMC', unidad: 'kg/m²' },
  grasa: { min: 2, max: 70, etiqueta: 'Grasa corporal', unidad: '%' },
  masaMuscular: { min: 5, max: 150, etiqueta: 'Masa muscular', unidad: 'kg' },
  vo2Max: { min: 5, max: 100, etiqueta: 'VO₂ máx', unidad: 'ml/kg·min' },
};

/** Devuelve el motivo por el que la lectura no es válida, o null si lo es. */
export function validarLectura(lectura: Lectura): string | null {
  const { valores } = lectura;
  for (const clave of Object.keys(valores) as (keyof ValoresMedidos)[]) {
    const rango = RANGOS_POSIBLES[clave];
    const valor = Number(valores[clave]);
    if (!rango) continue;
    if (!Number.isFinite(valor)) return `${rango.etiqueta}: la lectura no es un número`;
    if (valor < rango.min || valor > rango.max) return `${rango.etiqueta} ${valor} ${rango.unidad} está fuera de lo posible`;
  }
  const { presionSys, presionDia } = valores;
  if (presionSys !== undefined && presionDia !== undefined && presionSys <= presionDia) {
    return 'La presión sistólica debe ser mayor que la diastólica';
  }
  if (Object.keys(valores).length === 0) return 'El sensor no entregó ningún valor';
  return null;
}
