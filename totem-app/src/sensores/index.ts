import { SensorOximetroPuente } from './puente';
import { crearSensoresSimulados } from './simulador';
import type { Sensores } from './tipos';

export * from './tipos';
export * from './rangos';
export { SensorOximetroPuente, type ConfiguracionPuente } from './puente';
export { SensorSimulado, crearSensoresSimulados, type FallaSimulada, type OpcionesSimulador } from './simulador';

/**
 * Sensores que usa la app, según EXPO_PUBLIC_SENSORES:
 *  - "simulado" (por defecto): todos simulados.
 *  - "oximetro_puente": el oxímetro real a través del puente Bluetooth (puente-oximetro/); los demás sensores siguen
 *    simulados hasta que tengan su propio adaptador. URL y clave: EXPO_PUBLIC_PUENTE_OXIMETRO_URL / _KEY.
 */
export function crearSensores(): Sensores {
  const modo = process.env.EXPO_PUBLIC_SENSORES ?? 'simulado';
  const probabilidad = Number(process.env.EXPO_PUBLIC_SIMULAR_FALLAS ?? 0);
  const simulados = crearSensoresSimulados({ latenciaMs: 700, probabilidadFalla: Number.isFinite(probabilidad) ? probabilidad : 0 });
  if (modo === 'simulado') return simulados;
  if (modo === 'oximetro_puente') {
    const config = {
      url: process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_URL ?? 'http://localhost:8765',
      clave: process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_KEY || undefined,
    };
    return {
      ...simulados,
      oximetro: new SensorOximetroPuente('oximetro', config),
      oximetro_recuperacion: new SensorOximetroPuente('oximetro_recuperacion', config),
    };
  }
  throw new Error(`Modo de sensores no soportado: "${modo}". Usa "simulado" u "oximetro_puente".`);
}
