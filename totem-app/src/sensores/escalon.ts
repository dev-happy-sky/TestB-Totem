import { RANGOS_POSIBLES } from './rangos';
import {
  ErrorSensor, type GuiaPrueba, type Lectura, type ProgresoPrueba, type Sensor, type Sexo,
} from './tipos';

/**
 * Prueba del escalón (Queen's College Step Test): se sube y baja un escalón de ~40 cm durante 3 minutos al ritmo de un metrónomo y,
 * al terminar, se mide el pulso de recuperación. El VO₂ máx se ESTIMA a partir de ese pulso; no es una medición directa.
 *
 *   hombres: VO₂ máx = 111,33 − 0,42 × FC        mujeres: VO₂ máx = 65,81 − 0,1847 × FC      (FC en lpm; resultado en ml/kg·min)
 *
 * La prueba original cuenta el pulso 15 s empezando 5 s después de terminar (×4); aquí se dejan 10 s para sentarse y colocar el dedo en el oxímetro, y luego lo mide.
 * El sexo solo se usa en la fórmula: no se guarda en ninguna parte.
 */
export const DURACION_PRUEBA_S = 180;
export const ESPERA_SENTARSE_S = 10;
/** El oxímetro se apaga solo si no tiene el dedo: tras la prueba se le da este margen para encenderse y reconectarse. */
export const ESPERA_CONEXION_S = 90;
/** Ciclos completos (sube-sube-baja-baja) por minuto. */
export const CICLOS_POR_MINUTO: Record<Sexo, number> = { hombre: 24, mujer: 22 };
/** El metrónomo marca 4 tiempos por ciclo. */
export const TIEMPOS_POR_MINUTO: Record<Sexo, number> = { hombre: 96, mujer: 88 };
export const TIEMPOS_DEL_CICLO = ['SUBE', 'SUBE', 'BAJA', 'BAJA'] as const;
export const ID_DISPOSITIVO_ESCALON = 'prueba-escalon';

const FC_MINIMA = 40;
const FC_MAXIMA = 250;

/** VO₂ máx estimado (ml/kg·min) con un decimal, o null si el pulso o el resultado no son plausibles. */
export function estimarVO2Max(sexo: Sexo, fcRecuperacion: number): number | null {
  if (!Number.isFinite(fcRecuperacion) || fcRecuperacion < FC_MINIMA || fcRecuperacion > FC_MAXIMA) return null;
  const vo2 = sexo === 'hombre' ? 111.33 - 0.42 * fcRecuperacion : 65.81 - 0.1847 * fcRecuperacion;
  const redondeado = Math.round(vo2 * 10) / 10;
  const { min, max } = RANGOS_POSIBLES.vo2Max;
  return redondeado < min || redondeado > max ? null : redondeado;
}

export const GUIA_ESCALON: GuiaPrueba = {
  nombre: 'Prueba del escalón',
  duracionS: DURACION_PRUEBA_S,
  instrucciones: [
    'Usa un escalón o banco de unos 40 cm, firme y estable.',
    'Sube y baja durante 3 minutos al ritmo que marca la pantalla (arriba, arriba, abajo, abajo).',
    'Al terminar, siéntate y coloca el dedo en el oxímetro: medimos tu pulso de recuperación.',
  ],
  requiereSexo: true,
};

type Opciones = {
  duracionS?: number;
  esperaS?: number;
  esperaConexionS?: number;
  /** Reloj en milisegundos (para pruebas). */
  reloj?: () => number;
  /** Espera en milisegundos (para pruebas). */
  dormir?: (ms: number) => Promise<void>;
  /** Cada cuánto se actualiza el progreso. */
  pasoMs?: number;
};

/**
 * Prueba de esfuerzo automática: guía la prueba del escalón y mide el pulso de recuperación con el oxímetro (el mismo sensor de
 * «FC de recuperación»). Entrega el VO₂ máx estimado y, como dato adicional, la lectura de la FC de recuperación.
 */
export class SensorEscalon implements Sensor {
  readonly tipo = 'prueba_esfuerzo' as const;
  readonly guia = GUIA_ESCALON;

  private sexo: Sexo | null = null;
  private progresoActual: ProgresoPrueba | null = null;
  private numero = 0;
  private readonly duracionS: number;
  private readonly esperaS: number;
  private readonly esperaConexionS: number;
  private readonly reloj: () => number;
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly pasoMs: number;

  constructor(private readonly recuperacion: Sensor, opciones: Opciones = {}) {
    this.duracionS = opciones.duracionS ?? DURACION_PRUEBA_S;
    this.esperaS = opciones.esperaS ?? ESPERA_SENTARSE_S;
    this.esperaConexionS = opciones.esperaConexionS ?? ESPERA_CONEXION_S;
    this.reloj = opciones.reloj ?? Date.now;
    this.dormir = opciones.dormir ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms)));
    this.pasoMs = opciones.pasoMs ?? 250;
  }

  /** Sin el oxímetro no hay forma de medir el pulso de recuperación. */
  disponible(): Promise<boolean> {
    return this.recuperacion.disponible();
  }

  configurar(opciones: { sexo: Sexo }): void {
    this.sexo = opciones.sexo;
  }

  progreso(): ProgresoPrueba | null {
    return this.progresoActual;
  }

  /** Detiene la prueba en curso: su `medir()` termina con un error y no entrega resultado. */
  cancelar(): void {
    this.numero += 1;
    this.progresoActual = null;
  }

  async medir(): Promise<Lectura> {
    const sexo = this.sexo;
    if (!sexo) throw new ErrorSensor('error', 'Indica si eres hombre o mujer: se usa para calcular el resultado de la prueba.');
    this.numero += 1;
    const mia = this.numero;
    const revisar = () => {
      if (this.numero !== mia) throw new ErrorSensor('error', 'Prueba cancelada.');
    };
    const tiempos = TIEMPOS_POR_MINUTO[sexo];

    try {
      // 1) La prueba: cuenta regresiva con el ritmo del metrónomo.
      const inicio = this.reloj();
      const finPrueba = inicio + this.duracionS * 1000;
      for (;;) {
        const ahora = this.reloj();
        if (ahora >= finPrueba) break;
        this.progresoActual = { fase: 'prueba', restanteS: Math.ceil((finPrueba - ahora) / 1000), transcurridoS: (ahora - inicio) / 1000, tiemposPorMinuto: tiempos };
        await this.dormir(this.pasoMs);
        revisar();
      }

      // 2) Sentarse y colocar el dedo (la prueba original espera 5 s; aquí 10 s para colocar el dedo).
      const finEspera = this.reloj() + this.esperaS * 1000;
      for (;;) {
        const ahora = this.reloj();
        if (ahora >= finEspera) break;
        this.progresoActual = { fase: 'espera', restanteS: Math.ceil((finEspera - ahora) / 1000), transcurridoS: this.duracionS, tiemposPorMinuto: tiempos };
        await this.dormir(this.pasoMs);
        revisar();
      }

      // 3) El pulso de recuperación, con el oxímetro.
      this.progresoActual = { fase: 'midiendo', restanteS: 0, transcurridoS: this.duracionS, tiemposPorMinuto: tiempos };
      // El oxímetro suele haberse apagado durante la prueba: se espera a que vuelva a conectarse antes de pedirle la lectura.
      const finConexion = this.reloj() + this.esperaConexionS * 1000;
      while (!(await this.recuperacion.disponible()) && this.reloj() < finConexion) {
        revisar();
        await this.dormir(this.pasoMs);
      }
      revisar();
      const lectura = await this.recuperacion.medir();
      revisar();
      const fc = lectura.valores.fcRecup;
      const vo2 = estimarVO2Max(sexo, fc ?? Number.NaN);
      if (vo2 === null) {
        throw new ErrorSensor('lectura_invalida', `No se pudo calcular el resultado con un pulso de ${fc ?? 'sin dato'} lpm. Repite la prueba.`);
      }
      return {
        sensor: 'prueba_esfuerzo',
        valores: { vo2Max: vo2.toFixed(1) },
        dispositivo: { id: ID_DISPOSITIVO_ESCALON, calibracion: 'desconocida' },
        capturadoEn: lectura.capturadoEn,
        adicionales: [lectura],
      };
    } finally {
      if (this.numero === mia) this.progresoActual = null;
    }
  }
}
