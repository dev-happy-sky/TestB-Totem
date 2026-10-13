import {
  ErrorSensor, type CodigoError, type Lectura, type LecturaEnVivo, type Sensor, type TipoSensor,
} from './tipos';

/**
 * Adaptador del oxímetro Bluetooth. La app no habla Bluetooth: lo hace el "puente" (puente-oximetro/, un servicio
 * Python con bleak que corre junto al oxímetro) y expone la lectura por HTTP.
 * Un mismo oxímetro cubre dos mediciones: en reposo (SpO₂ y FC) y de recuperación (solo FC, tras el ejercicio).
 */
export type ConfiguracionPuente = {
  url: string;
  clave?: string;
  /** Debe superar el tiempo máximo de espera del puente (20 s por defecto). */
  timeoutMedicionMs?: number;
  timeoutEstadoMs?: number;
};

const CODIGOS: readonly CodigoError[] = ['desconectado', 'timeout', 'movimiento', 'lectura_invalida', 'error'];

type RespuestaMedicion = {
  spo2: number; fc: number; indice_perfusion?: number; capturado_en: string;
  dispositivo: { id: string; calibracion: 'vigente' | 'vencida' | 'desconocida' };
};

export class SensorOximetroPuente implements Sensor {
  constructor(public readonly tipo: Extract<TipoSensor, 'oximetro' | 'oximetro_recuperacion'>, private readonly config: ConfiguracionPuente) {}

  private encabezados(): Record<string, string> {
    return { Accept: 'application/json', ...(this.config.clave ? { 'X-Puente-Key': this.config.clave } : {}) };
  }

  private async pedir(ruta: string, metodo: 'GET' | 'POST', timeoutMs: number): Promise<Response> {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), timeoutMs);
    try {
      return await fetch(`${this.config.url.replace(/\/$/, '')}${ruta}`, { method: metodo, headers: this.encabezados(), signal: control.signal });
    } finally {
      clearTimeout(temporizador);
    }
  }

  async disponible(): Promise<boolean> {
    try {
      const respuesta = await this.pedir('/estado', 'GET', this.config.timeoutEstadoMs ?? 3000);
      if (!respuesta.ok) return false;
      return Boolean(((await respuesta.json()) as { conectado?: boolean }).conectado);
    } catch {
      return false;
    }
  }

  /** Último valor que envía el oxímetro (GET /lectura), para mostrarlo en vivo. */
  async enVivo(): Promise<LecturaEnVivo> {
    try {
      const respuesta = await this.pedir('/lectura', 'GET', this.config.timeoutEstadoMs ?? 3000);
      if (!respuesta.ok) return { valida: false, motivo: 'desconectado' };
      const cuerpo = (await respuesta.json()) as { valida?: boolean; spo2?: number | null; fc?: number | null; motivo?: LecturaEnVivo['motivo'] | null };
      if (cuerpo.valida && typeof cuerpo.spo2 === 'number' && typeof cuerpo.fc === 'number') {
        return { valida: true, spo2: cuerpo.spo2, fc: cuerpo.fc };
      }
      return { valida: false, motivo: cuerpo.motivo ?? 'sin_senal' };
    } catch {
      return { valida: false, motivo: 'desconectado' };
    }
  }

  async medir(): Promise<Lectura> {
    let respuesta: Response;
    try {
      respuesta = await this.pedir('/medir', 'POST', this.config.timeoutMedicionMs ?? 30000);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ErrorSensor('timeout', 'El oxímetro tardó demasiado en responder');
      }
      throw new ErrorSensor('desconectado', 'No se pudo comunicar con el puente del oxímetro');
    }

    let cuerpo: unknown;
    try {
      cuerpo = await respuesta.json();
    } catch {
      throw new ErrorSensor('error', `Respuesta inesperada del puente del oxímetro (${respuesta.status})`);
    }
    if (!respuesta.ok) {
      const { codigo, mensaje } = (cuerpo ?? {}) as { codigo?: string; mensaje?: string };
      const conocido = CODIGOS.find((c) => c === codigo) ?? 'error';
      throw new ErrorSensor(conocido, mensaje || `El puente del oxímetro respondió ${respuesta.status}`);
    }

    const medicion = cuerpo as RespuestaMedicion;
    const valores = this.tipo === 'oximetro' ? { spo2: medicion.spo2, fcReposo: medicion.fc } : { fcRecup: medicion.fc };
    return { sensor: this.tipo, valores, dispositivo: medicion.dispositivo, capturadoEn: medicion.capturado_en };
  }
}
