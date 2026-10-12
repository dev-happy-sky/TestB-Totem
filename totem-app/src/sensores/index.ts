import { crearSensoresSimulados } from './simulador';
import type { Sensores } from './tipos';

export * from './tipos';
export * from './rangos';
export { SensorSimulado, crearSensoresSimulados, type FallaSimulada, type OpcionesSimulador } from './simulador';

/**
 * Sensores que usa la app. Hoy solo existe el simulador (EXPO_PUBLIC_SENSORES=simulado, el valor por defecto).
 * Cuando haya un adaptador Bluetooth para el ESP32, se agrega aquí un modo "bluetooth" que devuelva sensores
 * reales con la misma interfaz `Sensor`.
 */
export function crearSensores(): Sensores {
  const modo = process.env.EXPO_PUBLIC_SENSORES ?? 'simulado';
  if (modo !== 'simulado') {
    throw new Error(`Modo de sensores no soportado: "${modo}". Por ahora solo existe "simulado".`);
  }
  const probabilidad = Number(process.env.EXPO_PUBLIC_SIMULAR_FALLAS ?? 0);
  return crearSensoresSimulados({ latenciaMs: 700, probabilidadFalla: Number.isFinite(probabilidad) ? probabilidad : 0 });
}
