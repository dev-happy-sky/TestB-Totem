import { type Lectura, type LecturaEnVivo, type Sensor } from './tipos';
import { medirPorPuente, pedirAlPuente, type ConfiguracionPuente } from './puente';

/**
 * Adaptador de la báscula Bluetooth. La app no habla Bluetooth: lo hace el "puente" (puente-bascula/), que escucha los
 * anuncios de la báscula (no se conecta a ella) y expone el peso por HTTP. Solo entrega el peso: IMC, grasa y masa
 * muscular no se miden con esta báscula y quedan como dato faltante.
 */
type RespuestaMedicion = {
  peso_kg: number; capturado_en: string;
  dispositivo: { id: string; calibracion: 'vigente' | 'vencida' | 'desconocida' };
};

export class SensorBasculaPuente implements Sensor {
  readonly tipo = 'balanza' as const;

  constructor(private readonly config: ConfiguracionPuente) {}

  /** La báscula duerme hasta que alguien se sube: que el puente esté escuchando basta; el peso se espera al medir. */
  async disponible(): Promise<boolean> {
    try {
      const respuesta = await pedirAlPuente(this.config, '/estado', 'GET', this.config.timeoutEstadoMs ?? 3000);
      if (!respuesta.ok) return false;
      return Boolean(((await respuesta.json()) as { escuchando?: boolean }).escuchando);
    } catch {
      return false;
    }
  }

  /** Último peso que emitió la báscula (GET /lectura), para mostrarlo mientras la persona se sube. */
  async enVivo(): Promise<LecturaEnVivo> {
    try {
      const respuesta = await pedirAlPuente(this.config, '/lectura', 'GET', this.config.timeoutEstadoMs ?? 3000);
      if (!respuesta.ok) return { valida: false, motivo: 'desconectado' };
      const cuerpo = (await respuesta.json()) as { valida?: boolean; peso_kg?: number | null; motivo?: LecturaEnVivo['motivo'] | null };
      if (cuerpo.valida && typeof cuerpo.peso_kg === 'number') return { valida: true, peso: cuerpo.peso_kg };
      return { valida: false, motivo: cuerpo.motivo ?? 'sin_senal' };
    } catch {
      return { valida: false, motivo: 'desconectado' };
    }
  }

  async medir(): Promise<Lectura> {
    // Debe superar el tiempo máximo de espera del puente (30 s por defecto).
    const medicion = await medirPorPuente<RespuestaMedicion>(this.config, 40000, { sensor: 'La báscula', puente: 'el puente de la báscula' });
    return {
      sensor: 'balanza', valores: { peso: medicion.peso_kg.toFixed(1) }, dispositivo: medicion.dispositivo, capturadoEn: medicion.capturado_en,
    };
  }
}
