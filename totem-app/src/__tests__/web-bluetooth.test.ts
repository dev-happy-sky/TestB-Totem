import {
  ConexionOximetroWeb, consolidar, crearSensores, ErrorSensor, explicarFallo, parsearPaquete,
  SensorOximetroWeb, SensorSimulado, type Medicion, type Muestra,
} from '../sensores';

/** Arma un paquete BLE de 9 bytes: cabecera 0xA7, SpO₂ en el byte 6, FC en el 7, perfusión (×10) en el 8. */
const paquete = (spo2: number, fc: number, perfusionX10 = 41, cabecera = 0xa7): DataView => {
  const bytes = new Uint8Array(9);
  bytes[0] = cabecera;
  bytes[6] = spo2;
  bytes[7] = fc;
  bytes[8] = perfusionX10;
  return new DataView(bytes.buffer);
};

const valida = (spo2: number, fc: number): Muestra => parsearPaquete(paquete(spo2, fc))!;

describe('parsearPaquete', () => {
  test('un paquete válido entrega SpO₂, FC y perfusión', () => {
    // Act
    const muestra = parsearPaquete(paquete(97, 72, 41));

    // Assert
    expect(muestra).toEqual({ spo2: 97, fc: 72, indicePerfusion: 4.1, valida: true });
  });

  test('otra cabecera o un paquete corto se ignoran (null)', () => {
    // Assert
    expect(parsearPaquete(paquete(97, 72, 41, 0x55))).toBeNull();
    expect(parsearPaquete(new DataView(new Uint8Array(8).buffer))).toBeNull();
  });

  test.each([0, 101, 127])('SpO₂ fuera de rango (%s) marca la muestra como inválida', (spo2) => {
    // Act
    const muestra = parsearPaquete(paquete(spo2, 72));

    // Assert
    expect(muestra?.valida).toBe(false);
    expect(muestra?.motivo).toContain('SpO₂');
  });

  test.each([0, 255])('FC de "sin dedo" (%s) marca la muestra como inválida', (fc) => {
    // Act
    const muestra = parsearPaquete(paquete(97, fc));

    // Assert
    expect(muestra?.valida).toBe(false);
    expect(muestra?.motivo).toContain('Frecuencia');
  });
});

describe('consolidar', () => {
  test('con 5 muestras válidas estables entrega la mediana', () => {
    // Arrange
    const muestras = [valida(96, 70), valida(97, 71), valida(97, 72), valida(98, 73), valida(97, 74)];

    // Act
    const medicion = consolidar(muestras);

    // Assert
    expect(medicion).toEqual<Medicion>({ spo2: 97, fc: 72, indicePerfusion: 4.1, muestras: 5 });
  });

  test('con menos de 5 muestras válidas aún no hay medición (null)', () => {
    // Assert
    expect(consolidar([valida(97, 72), valida(97, 72), valida(97, 72), valida(97, 72)])).toBeNull();
  });

  test('ignora las muestras inválidas y usa solo las 5 válidas más recientes', () => {
    // Arrange: una inválida al medio y una vieja fuera de ventana no deben romper la estabilidad
    const muestras = [
      valida(80, 50), valida(96, 70), parsearPaquete(paquete(0, 72))!, valida(97, 71),
      valida(97, 72), valida(98, 73), valida(97, 74),
    ];

    // Act
    const medicion = consolidar(muestras);

    // Assert
    expect(medicion?.spo2).toBe(97);
    expect(medicion?.muestras).toBe(5);
  });

  test('con 5 válidas pero inestables no consolida (null)', () => {
    // Arrange: SpO₂ varía más que la tolerancia (±2)
    const muestras = [valida(90, 70), valida(95, 71), valida(99, 72), valida(97, 73), valida(100, 74)];

    // Assert
    expect(consolidar(muestras)).toBeNull();
  });
});

describe('explicarFallo', () => {
  test('sin ninguna muestra: timeout (el oxímetro no envía datos)', () => {
    expect(explicarFallo([]).codigo).toBe('timeout');
  });

  test('con muestras pero ninguna válida: lectura_invalida (sin dedo)', () => {
    const muestras = [parsearPaquete(paquete(0, 72))!, parsearPaquete(paquete(97, 255))!];
    expect(explicarFallo(muestras).codigo).toBe('lectura_invalida');
  });

  test('con menos de 5 válidas: lectura_invalida (incompleta)', () => {
    expect(explicarFallo([valida(97, 72), valida(97, 72)]).codigo).toBe('lectura_invalida');
  });

  test('con 5+ válidas pero inestables: movimiento', () => {
    const muestras = [valida(90, 70), valida(95, 71), valida(99, 72), valida(97, 73), valida(100, 74)];
    expect(explicarFallo(muestras).codigo).toBe('movimiento');
  });
});

describe('ConexionOximetroWeb.esperarMedicion', () => {
  // Reloj controlado: cada "dormir" avanza el tiempo, sin temporizadores reales.
  const relojControlado = () => {
    let t = 0;
    return { reloj: () => t, dormir: async () => { t += 300; } };
  };

  test('entrega la medición en cuanto hay 5 válidas estables', async () => {
    // Arrange
    const { reloj, dormir } = relojControlado();
    const conexion = new ConexionOximetroWeb({ reloj, dormir, timeoutMedicionMs: 5000 });
    for (const [spo2, fc] of [[96, 70], [97, 71], [97, 72], [98, 73], [97, 74]]) conexion.agregarPaquete(paquete(spo2, fc));

    // Act
    const medicion = await conexion.esperarMedicion();

    // Assert
    expect(medicion).toEqual<Medicion>({ spo2: 97, fc: 72, indicePerfusion: 4.1, muestras: 5 });
  });

  test('si no llega nada en el tiempo máximo lanza timeout', async () => {
    // Arrange
    const { reloj, dormir } = relojControlado();
    const conexion = new ConexionOximetroWeb({ reloj, dormir, timeoutMedicionMs: 1000 });

    // Act
    const error = await conexion.esperarMedicion().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.codigo).toBe('timeout');
  });

  test('con el dedo moviéndose (válidas pero inestables) lanza movimiento', async () => {
    // Arrange
    const { reloj, dormir } = relojControlado();
    const conexion = new ConexionOximetroWeb({ reloj, dormir, timeoutMedicionMs: 1000 });
    for (const [spo2, fc] of [[90, 70], [95, 71], [99, 72], [97, 73], [100, 74]]) conexion.agregarPaquete(paquete(spo2, fc));

    // Act
    const error = await conexion.esperarMedicion().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('movimiento');
  });

  test('una segunda medición en paralelo se rechaza', async () => {
    // Arrange
    const { reloj, dormir } = relojControlado();
    const conexion = new ConexionOximetroWeb({ reloj, dormir, timeoutMedicionMs: 1000 });
    const primera = conexion.esperarMedicion().catch((e) => e);

    // Act
    const error = await conexion.esperarMedicion().catch((e) => e);
    await primera;

    // Assert
    expect(error.codigo).toBe('error');
    expect(error.message).toContain('en curso');
  });
});

describe('SensorOximetroWeb.medir', () => {
  const MEDICION: Medicion = { spo2: 97, fc: 72, indicePerfusion: 4.1, muestras: 5 };

  const conexionStub = () => {
    const conexion = new ConexionOximetroWeb();
    jest.spyOn(conexion, 'conectar').mockResolvedValue();
    jest.spyOn(conexion, 'esperarMedicion').mockResolvedValue(MEDICION);
    jest.spyOn(conexion, 'dispositivoInfo').mockReturnValue({ id: 'Oximetro BLE', calibracion: 'desconocida' });
    return conexion;
  };

  test('en reposo entrega SpO₂ y FC en reposo', async () => {
    // Act
    const lectura = await new SensorOximetroWeb('oximetro', conexionStub()).medir();

    // Assert
    expect(lectura.sensor).toBe('oximetro');
    expect(lectura.valores).toEqual({ spo2: 97, fcReposo: 72 });
    expect(lectura.dispositivo).toEqual({ id: 'Oximetro BLE', calibracion: 'desconocida' });
    expect(typeof lectura.capturadoEn).toBe('string');
  });

  test('en recuperación entrega solo la FC de recuperación', async () => {
    // Act
    const lectura = await new SensorOximetroWeb('oximetro_recuperacion', conexionStub()).medir();

    // Assert
    expect(lectura.sensor).toBe('oximetro_recuperacion');
    expect(lectura.valores).toEqual({ fcRecup: 72 });
  });

  test('conecta antes de esperar la medición (el gesto abre el selector)', async () => {
    // Arrange
    const conexion = conexionStub();

    // Act
    await new SensorOximetroWeb('oximetro', conexion).medir();

    // Assert
    expect(conexion.conectar).toHaveBeenCalledTimes(1);
    expect(conexion.esperarMedicion).toHaveBeenCalledTimes(1);
  });
});

describe('SensorOximetroWeb.enVivo', () => {
  const conectada = (ultima?: Muestra) => {
    const conexion = new ConexionOximetroWeb();
    jest.spyOn(conexion, 'conectado', 'get').mockReturnValue(true);
    jest.spyOn(conexion, 'ultima').mockReturnValue(ultima);
    return conexion;
  };

  test('conectado y con una muestra válida: entrega SpO₂ y FC', async () => {
    // Act
    const vivo = await new SensorOximetroWeb('oximetro', conectada(valida(97, 72))).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: true, spo2: 97, fc: 72 });
  });

  test('conectado pero sin dedo informa sin_dedo', async () => {
    // Act
    const vivo = await new SensorOximetroWeb('oximetro', conectada(parsearPaquete(paquete(0, 72))!)).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: false, motivo: 'sin_dedo' });
  });

  test('conectado pero sin muestras todavía informa sin_senal', async () => {
    // Act
    const vivo = await new SensorOximetroWeb('oximetro', conectada(undefined)).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: false, motivo: 'sin_senal' });
  });

  test('sin conexión informa desconectado y nunca lanza', async () => {
    // Arrange
    const conexion = new ConexionOximetroWeb();   // soportado() false en jest: no hay navigator.bluetooth

    // Act
    const vivo = await new SensorOximetroWeb('oximetro', conexion).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: false, motivo: 'desconectado' });
  });
});

describe('ConexionOximetroWeb con un Bluetooth falso', () => {
  // Característica BLE mínima: un EventTarget con un `value` mutable.
  class CaracteristicaFalsa extends EventTarget {
    value?: DataView;
    async startNotifications() { return this; }
    async stopNotifications() { return this; }
    emitir(datos: DataView) {
      this.value = datos;
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    }
  }

  const bluetoothFalso = (caracteristica: CaracteristicaFalsa, { rechazar = false } = {}) => {
    const gatt = {
      connected: true,
      async connect() { return gatt; },
      disconnect() { gatt.connected = false; },
      async getPrimaryService() { return { async getCharacteristic() { return caracteristica; } }; },
    };
    const dispositivo = Object.assign(new EventTarget(), { id: 'AA:BB', name: 'Oximetro BLE', gatt });
    return { requestDevice: rechazar ? async () => { throw new Error('cancelado'); } : async () => dispositivo };
  };

  const ponerNavigator = (bluetooth: unknown) => {
    const g = globalThis as unknown as { navigator?: Record<string, unknown> };
    g.navigator = g.navigator ?? {};
    g.navigator.bluetooth = bluetooth;
  };
  const quitarNavigator = () => {
    const g = globalThis as unknown as { navigator?: Record<string, unknown> };
    if (g.navigator) delete g.navigator.bluetooth;
  };

  afterEach(quitarNavigator);

  test('soportado() refleja si el navegador expone navigator.bluetooth', () => {
    // Arrange / Assert
    const conexion = new ConexionOximetroWeb();
    expect(conexion.soportado()).toBe(false);
    ponerNavigator({});
    expect(conexion.soportado()).toBe(true);
  });

  test('conecta, recibe notificaciones y las deja disponibles para la lectura en vivo', async () => {
    // Arrange
    const caracteristica = new CaracteristicaFalsa();
    ponerNavigator(bluetoothFalso(caracteristica));
    const conexion = new ConexionOximetroWeb();

    // Act
    await conexion.conectar();
    caracteristica.emitir(paquete(97, 72));

    // Assert
    expect(conexion.conectado).toBe(true);
    expect(conexion.ultima()).toEqual({ spo2: 97, fc: 72, indicePerfusion: 4.1, valida: true });
  });

  test('si el usuario cancela el selector, medir falla como desconectado', async () => {
    // Arrange
    ponerNavigator(bluetoothFalso(new CaracteristicaFalsa(), { rechazar: true }));
    const conexion = new ConexionOximetroWeb();

    // Act
    const error = await new SensorOximetroWeb('oximetro', conexion).medir().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.codigo).toBe('desconectado');
  });
});

describe('crearSensores en modo oximetro_web', () => {
  const guardado = process.env.EXPO_PUBLIC_SENSORES;
  afterEach(() => {
    if (guardado === undefined) delete process.env.EXPO_PUBLIC_SENSORES; else process.env.EXPO_PUBLIC_SENSORES = guardado;
  });

  test('usa el oxímetro Web Bluetooth para reposo y recuperación, y simula el resto', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'oximetro_web';

    // Act
    const sensores = crearSensores();

    // Assert
    expect(sensores.oximetro).toBeInstanceOf(SensorOximetroWeb);
    expect(sensores.oximetro_recuperacion).toBeInstanceOf(SensorOximetroWeb);
    expect(sensores.balanza).toBeInstanceOf(SensorSimulado);
  });

  test('ambos sensores del oxímetro comparten la misma conexión', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'oximetro_web';

    // Act
    const sensores = crearSensores();
    const conexionReposo = (sensores.oximetro as unknown as { conexion: ConexionOximetroWeb }).conexion;
    const conexionRecup = (sensores.oximetro_recuperacion as unknown as { conexion: ConexionOximetroWeb }).conexion;

    // Assert
    expect(conexionReposo).toBe(conexionRecup);
  });
});
