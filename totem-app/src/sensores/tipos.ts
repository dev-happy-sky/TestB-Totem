// Contrato entre la app y los sensores. Hoy hay un simulador; el adaptador Bluetooth real (ESP32 y sensores
// biomédicos) deberá implementar `Sensor` y se enchufa en `crearSensores()` sin tocar el flujo de la pantalla.

export type TipoSensor = 'tensiometro' | 'banda_pecho' | 'balanza' | 'prueba_esfuerzo';

export const TIPOS_SENSOR: readonly TipoSensor[] = ['tensiometro', 'banda_pecho', 'balanza', 'prueba_esfuerzo'];

export type Calibracion = 'vigente' | 'vencida' | 'desconocida';

/** Mismos códigos que acepta el backend en `errores_medicion`. */
export type CodigoError = 'desconectado' | 'timeout' | 'movimiento' | 'lectura_invalida' | 'error';

/** Valores que entrega cada sensor. Los nombres coinciden con el campo `mediciones` de la evaluación. */
export type ValoresMedidos = Partial<{
  presionSys: number; presionDia: number; fcReposo: number; fcRecup: number;
  peso: string; imc: string; grasa: string; masaMuscular: string; vo2Max: string;
}>;

export type Lectura = {
  sensor: TipoSensor;
  valores: ValoresMedidos;
  dispositivo: { id: string; calibracion: Calibracion };
  /** Instante ISO en que se tomó la medición (R.58). */
  capturadoEn: string;
};

export type ErrorMedicion = {
  sensor: TipoSensor;
  codigo: CodigoError;
  mensaje: string;
  ocurrido_en: string;
};

export class ErrorSensor extends Error {
  constructor(public readonly codigo: CodigoError, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSensor';
  }
}

export interface Sensor {
  readonly tipo: TipoSensor;
  /** ¿El sensor está conectado y listo? (R.52). */
  disponible(): Promise<boolean>;
  /** Toma una medición. Lanza `ErrorSensor` si falla. */
  medir(): Promise<Lectura>;
}

export type Sensores = Record<TipoSensor, Sensor>;
