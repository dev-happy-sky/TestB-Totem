/** Planes que se pueden elegir al registrarse. El backend guarda el texto tal cual y no impone esta lista. */
export const PLANES = ['Estudiante', 'Encargado', 'Profesor'] as const;

/**
 * Opciones a mostrar: las predefinidas y, si el socio ya tiene un plan que no está en la lista (registros anteriores, como
 * "Plan Estudiante"), ese plan también, para no perderlo ni obligar a cambiarlo.
 */
export function opcionesPlan(actual: string | null | undefined): string[] {
  const plan = (actual ?? '').trim();
  return plan && !(PLANES as readonly string[]).includes(plan) ? [...PLANES, plan] : [...PLANES];
}
