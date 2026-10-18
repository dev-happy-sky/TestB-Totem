import { type Lectura, type Sensor } from './tipos';
import { medirPorPuente, pedirAlPuente, type ConfiguracionPuente } from './puente';

/**
 * Adaptador del tensiómetro de brazo (Beurer BM 54). La app no habla Bluetooth: lo hace el "puente" (puente-tensiometro/).
 * Al pedir la medición, el puente espera a que la persona pulse Start en el brazalete y el aparato entregue el resultado.
 * Solo se usan la sistólica y la diastólica: el pulso del tensiómetro no reemplaza la FC en reposo del oxímetro.
 */
type RespuestaMedicion = {
  sistolica: number; diastolica: number; pulso: number | null; capturado_en: string;
  dispositivo: { id: string; calibracion: 'vigente' | 'vencida' | 'desconocida' };
};

export class SensorTensiometroPuente implements Sensor {
  readonly tipo = 'tensiometro' as const;

  constructor(private readonly config: ConfiguracionPuente) {}

  /** El tensiómetro duerme entre mediciones: basta con que el puente esté activo. */
  async disponible(): Promise<boolean> {
    try {
      const respuesta = await pedirAlPuente(this.config, '/estado', 'GET', this.config.timeoutEstadoMs ?? 3000);
      if (!respuesta.ok) return false;
      return Boolean(((await respuesta.json()) as { activo?: boolean }).activo);
    } catch {
      return false;
    }
  }

  async medir(): Promise<Lectura> {
    // Debe superar el tiempo máximo de espera del puente (120 s por defecto).
    const medicion = await medirPorPuente<RespuestaMedicion>(this.config, 140000, { sensor: 'El tensiómetro', puente: 'el puente del tensiómetro' });
    return {
      sensor: 'tensiometro', valores: { presionSys: medicion.sistolica, presionDia: medicion.diastolica },
      dispositivo: medicion.dispositivo, capturadoEn: medicion.capturado_en,
    };
  }
}
