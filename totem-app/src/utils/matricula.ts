// Mismo criterio que backend-totem/identidad.py: se quitan espacios, puntos y guiones, y se pasa a mayúsculas.
export const MENSAJE_MATRICULA = 'Matrícula inválida: usa entre 6 y 15 letras o números';

export function normalizarMatricula(valor: string | null | undefined): string {
  return (valor ?? '').replace(/[\s.\-]/g, '').toUpperCase();
}

export function matriculaValida(valor: string | null | undefined): boolean {
  return /^[A-Z0-9]{6,15}$/.test(normalizarMatricula(valor));
}
