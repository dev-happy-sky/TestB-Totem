import { RANGOS_POSIBLES } from './rangos';

/** Límites de lo plausible para una persona adulta. Un valor fuera de ellos casi siempre es un error de tipeo. */
export const ESTATURA_MIN_CM = 100;
export const ESTATURA_MAX_CM = 250;

export type ResultadoEstatura = { cm: number } | { error: string };

/** Interpreta la estatura escrita a mano, siempre en centímetros (acepta coma o punto decimal). */
export function parsearEstatura(texto: string): ResultadoEstatura {
  const limpio = texto.trim().replace(',', '.');
  const numero = Number(limpio);
  if (!limpio || !Number.isFinite(numero)) return { error: 'Ingresa la estatura en centímetros (por ejemplo 172).' };
  if (numero > 0 && numero < 3) return { error: 'Ingresa la estatura en centímetros, no en metros (por ejemplo 172).' };
  if (numero < ESTATURA_MIN_CM || numero > ESTATURA_MAX_CM) {
    return { error: `La estatura debe estar entre ${ESTATURA_MIN_CM} y ${ESTATURA_MAX_CM} cm.` };
  }
  return { cm: Math.round(numero * 10) / 10 };
}

export type ResultadoIMC = { imc: string } | { error: string };

/** IMC = peso (kg) / estatura (m)². Devuelve el valor con un decimal, como lo envía el resto de las mediciones. */
export function calcularIMC(peso: string | number, estaturaCm: number): ResultadoIMC {
  const kilos = Number(peso);
  if (!Number.isFinite(kilos) || kilos <= 0 || !Number.isFinite(estaturaCm) || estaturaCm <= 0) {
    return { error: 'No hay peso o estatura válidos para calcular el IMC.' };
  }
  const metros = estaturaCm / 100;
  const imc = Math.round((kilos / (metros * metros)) * 10) / 10;
  const { min, max } = RANGOS_POSIBLES.imc;
  if (imc < min || imc > max) return { error: `IMC ${imc} fuera de lo posible: revisa el peso y la estatura.` };
  return { imc: imc.toFixed(1) };
}
