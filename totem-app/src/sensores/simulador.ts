import {
  ErrorSensor, type Calibracion, type CodigoError, type Lectura, type Sensor, type Sensores, type TipoSensor,
  type ValoresMedidos,
} from './tipos';

/** Falla que el simulador puede provocar en una medición. `valor_invalido` entrega una lectura imposible. */
export type FallaSimulada = CodigoError | 'valor_invalido' | null;

export type OpcionesSimulador = {
  azar?: () => number;
  /** Milisegundos que tarda cada medición (0 en pruebas). */
  latenciaMs?: number;
  /** Probabilidad (0–1) de que una medición falle al azar. Sirve para probar el flujo de errores en desarrollo. */
  probabilidadFalla?: number;
  /** Resultados guionados por sensor, uno por cada llamada a `medir()`: `null` = éxito. Tienen prioridad sobre el azar. */
  guion?: Partial<Record<TipoSensor, FallaSimulada[]>>;
  /** Sensores que parten desconectados. */
  desconectados?: TipoSensor[];
  calibracion?: Partial<Record<TipoSensor, Calibracion>>;
};

const MENSAJES: Record<CodigoError, string> = {
  desconectado: 'El sensor perdió la conexión',
  timeout: 'El sensor no respondió a tiempo',
  movimiento: 'Se detectó movimiento durante la medición',
  lectura_invalida: 'La lectura no es válida',
  error: 'Error inesperado del sensor',
};

export class SensorSimulado implements Sensor {
  private conectado: boolean;
  private llamadas = 0;

  constructor(public readonly tipo: TipoSensor, private readonly opciones: OpcionesSimulador = {}) {
    this.conectado = !(opciones.desconectados ?? []).includes(tipo);
  }

  conectar() { this.conectado = true; }
  desconectar() { this.conectado = false; }

  async disponible() { return this.conectado; }

  async medir(): Promise<Lectura> {
    const { latenciaMs = 0, azar = Math.random, probabilidadFalla = 0, guion = {} } = this.opciones;
    if (latenciaMs > 0) await new Promise((resolver) => setTimeout(resolver, latenciaMs));
    if (!this.conectado) throw new ErrorSensor('desconectado', MENSAJES.desconectado);

    const prevista = guion[this.tipo]?.[this.llamadas];
    this.llamadas += 1;
    const falla: FallaSimulada = prevista !== undefined ? prevista : (azar() < probabilidadFalla ? 'error' : null);
    if (falla && falla !== 'valor_invalido') throw new ErrorSensor(falla, MENSAJES[falla]);

    const valores = this.valores(azar);
    if (falla === 'valor_invalido') this.corromper(valores);
    return {
      sensor: this.tipo, valores, capturadoEn: new Date().toISOString(),
      dispositivo: { id: `SIM-${this.tipo.toUpperCase()}`, calibracion: this.opciones.calibracion?.[this.tipo] ?? 'vigente' },
    };
  }

  private valores(azar: () => number): ValoresMedidos {
    const entre = (min: number, max: number) => min + azar() * (max - min);
    switch (this.tipo) {
      case 'tensiometro': {
        const presionDia = Math.round(entre(60, 90));
        return { presionSys: Math.max(Math.round(entre(90, 140)), presionDia + 20), presionDia };
      }
      case 'banda_pecho': {
        const fcReposo = Math.round(entre(60, 100));
        return { fcReposo, fcRecup: Math.round(entre(fcReposo + 15, 150)) };
      }
      case 'balanza':
        return {
          peso: entre(60, 110).toFixed(1), imc: entre(18.5, 32).toFixed(1), grasa: entre(10, 25).toFixed(1),
          masaMuscular: entre(25, 45).toFixed(1),
        };
      case 'prueba_esfuerzo':
        return { vo2Max: entre(30, 60).toFixed(1) };
    }
  }

  private corromper(valores: ValoresMedidos) {
    const [primera] = Object.keys(valores) as (keyof ValoresMedidos)[];
    (valores as Record<string, number | string>)[primera] = typeof valores[primera] === 'number' ? 999 : '9999';
  }
}

export function crearSensoresSimulados(opciones: OpcionesSimulador = {}): Sensores {
  return {
    tensiometro: new SensorSimulado('tensiometro', opciones),
    banda_pecho: new SensorSimulado('banda_pecho', opciones),
    balanza: new SensorSimulado('balanza', opciones),
    prueba_esfuerzo: new SensorSimulado('prueba_esfuerzo', opciones),
  };
}
