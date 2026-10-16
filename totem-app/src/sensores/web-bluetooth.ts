import {
  ErrorSensor, type CodigoError, type Lectura, type LecturaEnVivo, type Sensor, type TipoSensor,
} from './tipos';

/**
 * Adaptador del oxímetro que lee Bluetooth LE **directo desde el navegador** (Web Bluetooth), sin el puente Python.
 * Pensado para correr como web (Expo web / Chrome en Android / Bluefy en iPhone), donde existe `navigator.bluetooth`.
 * En un build nativo de Expo `navigator.bluetooth` no existe: `disponible()` devuelve false y la app cae al ingreso
 * manual, igual que un sensor desconectado.
 *
 * El protocolo y los umbrales de estabilidad se portan de `puente-oximetro/puente/{protocolo,captura}.py`, que ya
 * están validados con el hardware. Si el oxímetro cambia de formato, se ajusta en un solo lugar (aquí).
 *
 * Un mismo oxímetro cubre dos mediciones (reposo y recuperación): ambos sensores comparten UNA sola conexión
 * (`ConexionOximetroWeb`), igual que en el puente un `LectorOximetro` alimenta una `Captura`.
 */

// --- Protocolo (portado de protocolo.py) ---------------------------------------------------------------------------

/** Característica de notificación que emite las muestras (deducida con nRF Connect). */
const NOTIFY_UUID_POR_DEFECTO = '0000ffe2-0000-1000-8000-00805f9b34fb';
/**
 * Servicio BLE que contiene la característica `ffe2`. Web Bluetooth exige declararlo (no deja enumerar servicios sin
 * listarlos). PROVISIONAL: confirmar en nRF Connect el UUID del servicio que está justo encima de `ffe2`. Se puede
 * sobrescribir sin tocar código con EXPO_PUBLIC_OXIMETRO_BLE_SERVICIO.
 */
const SERVICIO_UUID_POR_DEFECTO = '0000ffe0-0000-1000-8000-00805f9b34fb';

const CABECERA = 0xa7;
const LARGO_MINIMO = 9;
const SPO2_MAXIMA = 100;
const FC_SIN_DEDO = [0, 255];

export type Muestra = {
  spo2: number;
  fc: number;
  indicePerfusion: number;
  valida: boolean;
  motivo?: string;
};

/** Convierte un paquete en una muestra. Devuelve null si no es un paquete de mediciones (otra cabecera o muy corto). */
export function parsearPaquete(datos: DataView): Muestra | null {
  if (datos.byteLength < LARGO_MINIMO || datos.getUint8(0) !== CABECERA) return null;
  const spo2 = datos.getUint8(6);
  const fc = datos.getUint8(7);
  const indicePerfusion = datos.getUint8(8) / 10;
  if (spo2 === 0 || spo2 > SPO2_MAXIMA) {
    return { spo2, fc, indicePerfusion, valida: false, motivo: 'SpO₂ fuera de rango (¿sin dedo?)' };
  }
  if (FC_SIN_DEDO.includes(fc)) {
    return { spo2, fc, indicePerfusion, valida: false, motivo: 'Frecuencia cardíaca no detectada (¿sin dedo?)' };
  }
  return { spo2, fc, indicePerfusion, valida: true };
}

// --- Estabilidad (portado de captura.py) ---------------------------------------------------------------------------

const MUESTRAS_ESTABLES = 5;   // muestras válidas consecutivas que se necesitan
const TOLERANCIA_SPO2 = 2;     // variación máxima (puntos de %) entre esas muestras
const TOLERANCIA_FC = 5;       // variación máxima (lpm) entre esas muestras
const MAXIMO_RETENIDO = 200;   // muestras en memoria
const TIMEOUT_POR_DEFECTO_MS = 20000;
const PASO_MS = 250;

export type Medicion = {
  spo2: number;
  fc: number;
  indicePerfusion: number;
  muestras: number;
};

type MuestraConInstante = { instante: number; muestra: Muestra };

function mediana(valores: number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[medio] : (ordenados[medio - 1] + ordenados[medio]) / 2;
}

function promedio(valores: number[]): number {
  return valores.reduce((suma, v) => suma + v, 0) / valores.length;
}

function estables(muestras: Muestra[]): boolean {
  const spo2 = muestras.map((m) => m.spo2);
  const fc = muestras.map((m) => m.fc);
  return Math.max(...spo2) - Math.min(...spo2) <= TOLERANCIA_SPO2 && Math.max(...fc) - Math.min(...fc) <= TOLERANCIA_FC;
}

/** Mediana de las últimas MUESTRAS_ESTABLES válidas si son estables; null si aún no hay suficientes. */
export function consolidar(muestras: Muestra[]): Medicion | null {
  const validas = muestras.filter((m) => m.valida);
  const ultimas = validas.slice(-MUESTRAS_ESTABLES);
  if (ultimas.length < MUESTRAS_ESTABLES || !estables(ultimas)) return null;
  return {
    spo2: Math.round(mediana(ultimas.map((m) => m.spo2))),
    fc: Math.round(mediana(ultimas.map((m) => m.fc))),
    indicePerfusion: Math.round(promedio(ultimas.map((m) => m.indicePerfusion)) * 10) / 10,
    muestras: ultimas.length,
  };
}

/** Por qué no se pudo medir, según lo que llegó durante la espera. Mismos códigos que entiende la app. */
export function explicarFallo(muestras: Muestra[]): ErrorSensor {
  if (muestras.length === 0) {
    return new ErrorSensor('timeout', 'El oxímetro no está enviando datos. Revisa que esté encendido.');
  }
  const validas = muestras.filter((m) => m.valida);
  if (validas.length === 0) {
    return new ErrorSensor('lectura_invalida', 'No se detecta el dedo. Colócalo bien en el oxímetro.');
  }
  if (validas.length < MUESTRAS_ESTABLES) {
    return new ErrorSensor('lectura_invalida', 'Lectura incompleta. Mantén el dedo quieto en el oxímetro.');
  }
  return new ErrorSensor('movimiento', 'La lectura no se estabilizó. Mantén la mano quieta durante la medición.');
}

// --- Tipos mínimos de Web Bluetooth (evitan depender de @types/web-bluetooth o de la lib DOM) ----------------------

interface CaracteristicaBLE extends EventTarget {
  startNotifications(): Promise<CaracteristicaBLE>;
  stopNotifications(): Promise<CaracteristicaBLE>;
  readonly value?: DataView;
}
interface ServicioBLE {
  getCharacteristic(uuid: string): Promise<CaracteristicaBLE>;
}
interface ServidorGATT {
  readonly connected: boolean;
  connect(): Promise<ServidorGATT>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<ServicioBLE>;
}
interface DispositivoBLE extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: ServidorGATT;
}
interface OpcionesRequest {
  filters?: { services?: string[]; namePrefix?: string }[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}
interface BluetoothLE {
  requestDevice(opciones: OpcionesRequest): Promise<DispositivoBLE>;
}

function apiBluetooth(): BluetoothLE | undefined {
  return (globalThis as { navigator?: { bluetooth?: BluetoothLE } }).navigator?.bluetooth;
}

// --- Conexión compartida -------------------------------------------------------------------------------------------

export type ConfiguracionWebBluetooth = {
  /** UUID del servicio que contiene la característica de notificación. */
  servicioUuid?: string;
  /** UUID de la característica de notificación. */
  notifyUuid?: string;
  /** Prefijo del nombre del dispositivo para filtrar el selector; si no, se aceptan todos. */
  nombrePrefijo?: string;
  /** Tiempo máximo (ms) que se espera una medición estable. */
  timeoutMedicionMs?: number;
  /** Inyectables para pruebas. */
  reloj?: () => number;
  dormir?: (ms: number) => Promise<void>;
};

/**
 * Mantiene la conexión BLE con el oxímetro y acumula las muestras recientes en memoria (nada se escribe en disco:
 * son datos de salud). La comparten los dos sensores del oxímetro.
 */
export class ConexionOximetroWeb {
  private readonly servicioUuid: string;
  private readonly notifyUuid: string;
  private readonly nombrePrefijo?: string;
  private readonly timeoutMedicionMs: number;
  private readonly reloj: () => number;
  private readonly dormir: (ms: number) => Promise<void>;

  private dispositivo?: DispositivoBLE;
  private caracteristica?: CaracteristicaBLE;
  private readonly muestras: MuestraConInstante[] = [];
  private midiendo = false;

  constructor(config: ConfiguracionWebBluetooth = {}) {
    this.servicioUuid = config.servicioUuid ?? SERVICIO_UUID_POR_DEFECTO;
    this.notifyUuid = config.notifyUuid ?? NOTIFY_UUID_POR_DEFECTO;
    this.nombrePrefijo = config.nombrePrefijo;
    this.timeoutMedicionMs = config.timeoutMedicionMs ?? TIMEOUT_POR_DEFECTO_MS;
    this.reloj = config.reloj ?? Date.now;
    this.dormir = config.dormir ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms)));
  }

  /** ¿El navegador puede hablar Bluetooth? (En un build nativo de Expo, no.) */
  soportado(): boolean {
    return apiBluetooth() !== undefined;
  }

  get conectado(): boolean {
    return Boolean(this.caracteristica && this.dispositivo?.gatt?.connected);
  }

  private nombreDispositivo(): string {
    return this.dispositivo?.name || this.dispositivo?.id || 'oximetro-web';
  }

  /** Recibe un paquete BLE y, si es una muestra, la guarda con su instante. Expuesto para pruebas. */
  agregarPaquete(datos: DataView): void {
    const muestra = parsearPaquete(datos);
    if (!muestra) return;
    this.muestras.push({ instante: this.reloj(), muestra });
    if (this.muestras.length > MAXIMO_RETENIDO) this.muestras.shift();
  }

  private alRecibir = (evento: Event): void => {
    const valor = (evento.target as CaracteristicaBLE | null)?.value;
    if (valor) this.agregarPaquete(valor);
  };

  private alDesconectar = (): void => {
    this.caracteristica = undefined;
    this.muestras.length = 0;
  };

  /**
   * Asegura que hay conexión. Debe llamarse desde un gesto del usuario (un click): Web Bluetooth exige activación
   * para abrir el selector de dispositivos. Lanza ErrorSensor('desconectado') si no se puede conectar.
   */
  async conectar(): Promise<void> {
    if (this.conectado) return;
    const bluetooth = apiBluetooth();
    if (!bluetooth) {
      throw new ErrorSensor('desconectado', 'Este dispositivo no permite Bluetooth en el navegador.');
    }
    try {
      if (!this.dispositivo) {
        this.dispositivo = await bluetooth.requestDevice(this.nombrePrefijo
          ? { filters: [{ namePrefix: this.nombrePrefijo }], optionalServices: [this.servicioUuid] }
          : { acceptAllDevices: true, optionalServices: [this.servicioUuid] });
        this.dispositivo.addEventListener('gattserverdisconnected', this.alDesconectar);
      }
      const gatt = this.dispositivo.gatt;
      if (!gatt) throw new ErrorSensor('desconectado', 'El dispositivo no expone GATT.');
      const servidor = gatt.connected ? gatt : await gatt.connect();
      const servicio = await servidor.getPrimaryService(this.servicioUuid);
      this.caracteristica = await servicio.getCharacteristic(this.notifyUuid);
      await this.caracteristica.startNotifications();
      this.caracteristica.addEventListener('characteristicvaluechanged', this.alRecibir);
      this.muestras.length = 0;
    } catch (error) {
      if (error instanceof ErrorSensor) throw error;
      this.caracteristica = undefined;
      throw new ErrorSensor('desconectado', 'No se pudo conectar con el oxímetro por Bluetooth.');
    }
  }

  /** Última muestra recibida (válida o no); undefined si aún no llegó nada. Para la lectura en vivo. */
  ultima(): Muestra | undefined {
    return this.muestras.length ? this.muestras[this.muestras.length - 1].muestra : undefined;
  }

  /** Espera hasta el timeout una medición estable, usando solo muestras posteriores al inicio de la espera. */
  async esperarMedicion(): Promise<Medicion> {
    if (this.midiendo) throw new ErrorSensor('error', 'Ya hay una medición en curso.');
    this.midiendo = true;
    const inicio = this.reloj();
    try {
      while (true) {
        const muestras = this.muestras.filter((m) => m.instante >= inicio).map((m) => m.muestra);
        const medicion = consolidar(muestras);
        if (medicion) return medicion;
        if (this.reloj() - inicio >= this.timeoutMedicionMs) throw explicarFallo(muestras);
        await this.dormir(PASO_MS);
      }
    } finally {
      this.midiendo = false;
    }
  }

  async desconectar(): Promise<void> {
    if (this.caracteristica) {
      this.caracteristica.removeEventListener('characteristicvaluechanged', this.alRecibir);
      try {
        await this.caracteristica.stopNotifications();
      } catch {
        // el dispositivo puede estar fuera de alcance; no importa
      }
      this.caracteristica = undefined;
    }
    this.dispositivo?.gatt?.disconnect();
    this.muestras.length = 0;
  }

  dispositivoInfo(): Lectura['dispositivo'] {
    return { id: this.nombreDispositivo(), calibracion: 'desconocida' };
  }
}

// --- Sensor --------------------------------------------------------------------------------------------------------

export class SensorOximetroWeb implements Sensor {
  constructor(
    public readonly tipo: Extract<TipoSensor, 'oximetro' | 'oximetro_recuperacion'>,
    private readonly conexion: ConexionOximetroWeb,
  ) {}

  /** No conecta (eso exige un gesto): solo informa si el navegador puede hablar Bluetooth, para habilitar "Medir". */
  async disponible(): Promise<boolean> {
    return this.conexion.soportado();
  }

  /** Último valor que envía el oxímetro, para mostrarlo en vivo. Nunca lanza. */
  async enVivo(): Promise<LecturaEnVivo> {
    if (!this.conexion.conectado) return { valida: false, motivo: 'desconectado' };
    const ultima = this.conexion.ultima();
    if (!ultima) return { valida: false, motivo: 'sin_senal' };
    if (!ultima.valida) return { valida: false, motivo: 'sin_dedo' };
    return { valida: true, spo2: ultima.spo2, fc: ultima.fc };
  }

  async medir(): Promise<Lectura> {
    await this.conexion.conectar();   // primero: conserva la activación del gesto para abrir el selector
    const medicion = await this.conexion.esperarMedicion();
    const valores = this.tipo === 'oximetro'
      ? { spo2: medicion.spo2, fcReposo: medicion.fc }
      : { fcRecup: medicion.fc };
    return {
      sensor: this.tipo, valores, dispositivo: this.conexion.dispositivoInfo(), capturadoEn: new Date().toISOString(),
    };
  }
}
