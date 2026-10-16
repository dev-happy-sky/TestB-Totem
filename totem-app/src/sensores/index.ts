import { SensorOximetroPuente } from './puente';
import { crearSensoresSimulados } from './simulador';
import type { Sensores } from './tipos';
import { ConexionOximetroWeb, SensorOximetroWeb } from './web-bluetooth';

export * from './tipos';
export * from './rangos';
export { SensorOximetroPuente, type ConfiguracionPuente } from './puente';
export {
  ConexionOximetroWeb, SensorOximetroWeb, consolidar, explicarFallo, parsearPaquete,
  type ConfiguracionWebBluetooth, type Medicion, type Muestra,
} from './web-bluetooth';
export { SensorSimulado, crearSensoresSimulados, type FallaSimulada, type OpcionesSimulador } from './simulador';

/**
 * Sensores que usa la app, según EXPO_PUBLIC_SENSORES:
 *  - "simulado" (por defecto): todos simulados.
 *  - "oximetro_puente": el oxímetro real a través del puente Bluetooth (puente-oximetro/); los demás sensores siguen
 *    simulados hasta que tengan su propio adaptador. URL y clave: EXPO_PUBLIC_PUENTE_OXIMETRO_URL / _KEY.
 *  - "oximetro_web": el oxímetro leído por Bluetooth directo desde el navegador (Web Bluetooth), sin puente. Solo
 *    funciona corriendo la app como web (Chrome en Android, Bluefy en iPhone). Servicio/característica configurables
 *    con EXPO_PUBLIC_OXIMETRO_BLE_SERVICIO / _NOTIFY; nombre del dispositivo con _NOMBRE.
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
  if (modo === 'oximetro_web') {
    const conexion = new ConexionOximetroWeb({
      servicioUuid: process.env.EXPO_PUBLIC_OXIMETRO_BLE_SERVICIO || undefined,
      notifyUuid: process.env.EXPO_PUBLIC_OXIMETRO_BLE_NOTIFY || undefined,
      nombrePrefijo: process.env.EXPO_PUBLIC_OXIMETRO_BLE_NOMBRE || undefined,
    });
    return {
      ...simulados,
      oximetro: new SensorOximetroWeb('oximetro', conexion),
      oximetro_recuperacion: new SensorOximetroWeb('oximetro_recuperacion', conexion),
    };
  }
  throw new Error(`Modo de sensores no soportado: "${modo}". Usa "simulado", "oximetro_puente" u "oximetro_web".`);
}
