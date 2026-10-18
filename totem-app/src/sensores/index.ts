import { SensorOximetroPuente } from './puente';
import { SensorBasculaPuente } from './puente-bascula';
import { SensorTensiometroPuente } from './puente-tensiometro';
import { crearSensoresSimulados } from './simulador';
import type { Sensores } from './tipos';

export * from './tipos';
export * from './rangos';
export { SensorOximetroPuente, type ConfiguracionPuente } from './puente';
export { SensorBasculaPuente } from './puente-bascula';
export { SensorTensiometroPuente } from './puente-tensiometro';
export { SensorSimulado, crearSensoresSimulados, type FallaSimulada, type OpcionesSimulador } from './simulador';

/**
 * Sensores que usa la app, según EXPO_PUBLIC_SENSORES:
 *  - "simulado" (por defecto): todos simulados.
 *  - "oximetro_puente": el oxímetro real a través del puente Bluetooth (puente-oximetro/). URL y clave:
 *    EXPO_PUBLIC_PUENTE_OXIMETRO_URL / _KEY.
 *  - "bascula_puente": la báscula real a través de puente-bascula/. URL y clave: EXPO_PUBLIC_PUENTE_BASCULA_URL / _KEY.
 *  - "tensiometro_puente": el tensiómetro Beurer BM 54 a través de puente-tensiometro/. URL y clave:
 *    EXPO_PUBLIC_PUENTE_TENSIOMETRO_URL / _KEY.
 *  Se pueden combinar separados por coma ("oximetro_puente,bascula_puente"). Los sensores sin adaptador siguen simulados.
 */
export function crearSensores(): Sensores {
  const modo = process.env.EXPO_PUBLIC_SENSORES ?? 'simulado';
  const probabilidad = Number(process.env.EXPO_PUBLIC_SIMULAR_FALLAS ?? 0);
  const simulados = crearSensoresSimulados({ latenciaMs: 700, probabilidadFalla: Number.isFinite(probabilidad) ? probabilidad : 0 });
  const modos = modo.split(',').map((m) => m.trim()).filter(Boolean);
  const desconocido = modos.find((m) => !['simulado', 'oximetro_puente', 'bascula_puente', 'tensiometro_puente'].includes(m));
  if (desconocido || modos.length === 0) {
    throw new Error(`Modo de sensores no soportado: "${desconocido ?? modo}". Usa "simulado", "oximetro_puente", "bascula_puente" o "tensiometro_puente".`);
  }
  const sensores: Sensores = { ...simulados };
  if (modos.includes('oximetro_puente')) {
    const config = {
      url: process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_URL ?? 'http://localhost:8765',
      clave: process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_KEY || undefined,
    };
    sensores.oximetro = new SensorOximetroPuente('oximetro', config);
    sensores.oximetro_recuperacion = new SensorOximetroPuente('oximetro_recuperacion', config);
  }
  if (modos.includes('bascula_puente')) {
    sensores.balanza = new SensorBasculaPuente({
      url: process.env.EXPO_PUBLIC_PUENTE_BASCULA_URL ?? 'http://localhost:8766',
      clave: process.env.EXPO_PUBLIC_PUENTE_BASCULA_KEY || undefined,
    });
  }
  if (modos.includes('tensiometro_puente')) {
    sensores.tensiometro = new SensorTensiometroPuente({
      url: process.env.EXPO_PUBLIC_PUENTE_TENSIOMETRO_URL ?? 'http://localhost:8767',
      clave: process.env.EXPO_PUBLIC_PUENTE_TENSIOMETRO_KEY || undefined,
    });
  }
  return sensores;
}
