import {
  crearSensores, crearSensoresSimulados, ErrorSensor, ETIQUETA_SENSOR, INSTRUCCIONES, RANGOS_POSIBLES, SensorSimulado,
  TIPOS_SENSOR, validarLectura, type Lectura, type TipoSensor, type ValoresMedidos,
} from '../sensores';

const lectura = (valores: ValoresMedidos, sensor: TipoSensor = 'tensiometro'): Lectura => ({
  sensor, valores, dispositivo: { id: 'X', calibracion: 'vigente' }, capturadoEn: new Date().toISOString(),
});

describe('validarLectura (R.53, R.62)', () => {
  test('acepta una lectura con valores plausibles', () => {
    // Arrange / Act / Assert
    expect(validarLectura(lectura({ presionSys: 120, presionDia: 80 }))).toBeNull();
    expect(validarLectura(lectura({ peso: '70.5', imc: '24.1', grasa: '20.2', masaMuscular: '30.5' }, 'balanza'))).toBeNull();
  });

  test.each([
    ['presionSys', 49], ['presionSys', 301], ['presionDia', 29], ['presionDia', 201],
    ['fcReposo', 19], ['fcReposo', 251], ['fcRecup', 19], ['peso', '19.9'], ['peso', '401'], ['imc', '9.9'], ['imc', '80.1'],
    ['grasa', '1'], ['grasa', '71'], ['masaMuscular', '4'], ['vo2Max', '4'], ['vo2Max', '101'],
  ] as [keyof ValoresMedidos, number | string][])('rechaza %s = %p por estar fuera de lo posible', (clave, valor) => {
    // Arrange
    const l = lectura({ [clave]: valor } as ValoresMedidos);

    // Act
    const motivo = validarLectura(l);

    // Assert
    expect(motivo).toContain(RANGOS_POSIBLES[clave].etiqueta);
    expect(motivo).toContain('fuera de lo posible');
  });

  test.each([
    ['presionSys', 50], ['presionSys', 300], ['fcReposo', 20], ['fcReposo', 250], ['imc', '10'], ['imc', '80'],
  ] as [keyof ValoresMedidos, number | string][])('acepta el límite %s = %p', (clave, valor) => {
    // Arrange / Act / Assert
    expect(validarLectura(lectura({ [clave]: valor } as ValoresMedidos))).toBeNull();
  });

  test('rechaza una sistólica menor o igual que la diastólica', () => {
    // Arrange / Act / Assert
    expect(validarLectura(lectura({ presionSys: 80, presionDia: 80 }))).toBe('La presión sistólica debe ser mayor que la diastólica');
    expect(validarLectura(lectura({ presionSys: 70, presionDia: 90 }))).toBe('La presión sistólica debe ser mayor que la diastólica');
  });

  test('rechaza un valor que no es un número y una lectura sin valores', () => {
    // Arrange / Act / Assert
    expect(validarLectura(lectura({ peso: 'abc' }, 'balanza'))).toBe('Peso: la lectura no es un número');
    expect(validarLectura(lectura({}))).toBe('El sensor no entregó ningún valor');
  });
});

describe('textos de ayuda (R.63)', () => {
  test('cada sensor tiene nombre e instrucciones', () => {
    // Arrange / Act / Assert
    for (const tipo of TIPOS_SENSOR) {
      expect(ETIQUETA_SENSOR[tipo]).toBeTruthy();
      expect(INSTRUCCIONES[tipo].length).toBeGreaterThan(30);
    }
  });
});

describe('SensorSimulado', () => {
  const azarFijo = (valor: number) => () => valor;

  test.each(TIPOS_SENSOR.map((t) => [t]))('%s entrega valores plausibles con cualquier azar', async (tipo) => {
    // Arrange
    const sensor = new SensorSimulado(tipo as TipoSensor, { azar: azarFijo(0) });
    const otro = new SensorSimulado(tipo as TipoSensor, { azar: azarFijo(0.999) });

    // Act
    const minima = await sensor.medir();
    const maxima = await otro.medir();

    // Assert
    expect(validarLectura(minima)).toBeNull();
    expect(validarLectura(maxima)).toBeNull();
    expect(minima.sensor).toBe(tipo);
  });

  test('la sistólica simulada siempre supera a la diastólica y la FC de recuperación a la de reposo', async () => {
    // Arrange
    let semilla = 1;
    const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
    const tensiometro = new SensorSimulado('tensiometro', { azar });
    const banda = new SensorSimulado('banda_pecho', { azar });

    // Act / Assert
    for (let i = 0; i < 200; i++) {
      const { presionSys, presionDia } = (await tensiometro.medir()).valores;
      const { fcReposo, fcRecup } = (await banda.medir()).valores;
      expect(presionSys!).toBeGreaterThan(presionDia!);
      expect(fcRecup!).toBeGreaterThan(fcReposo!);
    }
  });

  test('la lectura incluye dispositivo, calibración y hora de captura', async () => {
    // Arrange
    const sensor = new SensorSimulado('balanza', { calibracion: { balanza: 'vencida' } });

    // Act
    const l = await sensor.medir();

    // Assert
    expect(l.dispositivo).toEqual({ id: 'SIM-BALANZA', calibracion: 'vencida' });
    expect(Number.isNaN(Date.parse(l.capturadoEn))).toBe(false);
  });

  test('un guion provoca fallos concretos y luego éxito', async () => {
    // Arrange
    const sensor = new SensorSimulado('tensiometro', { guion: { tensiometro: ['timeout', 'valor_invalido', null] } });

    // Act / Assert
    await expect(sensor.medir()).rejects.toMatchObject({ codigo: 'timeout' });
    expect(validarLectura(await sensor.medir())).toContain('fuera de lo posible');
    expect(validarLectura(await sensor.medir())).toBeNull();
    expect(validarLectura(await sensor.medir())).toBeNull();   // pasado el guion, funciona normal
  });

  test('un fallo de cada código lanza ErrorSensor con ese código', async () => {
    // Arrange
    const codigos = ['desconectado', 'timeout', 'movimiento', 'lectura_invalida', 'error'] as const;

    // Act / Assert
    for (const codigo of codigos) {
      const sensor = new SensorSimulado('banda_pecho', { guion: { banda_pecho: [codigo] } });
      const error = await sensor.medir().catch((e) => e);
      expect(error).toBeInstanceOf(ErrorSensor);
      expect(error.codigo).toBe(codigo);
      expect(error.message.length).toBeGreaterThan(5);
    }
  });

  test('un sensor desconectado no está disponible y falla al medir hasta que se reconecta', async () => {
    // Arrange
    const sensor = new SensorSimulado('balanza', { desconectados: ['balanza'] });

    // Act / Assert
    expect(await sensor.disponible()).toBe(false);
    await expect(sensor.medir()).rejects.toMatchObject({ codigo: 'desconectado' });
    sensor.conectar();
    expect(await sensor.disponible()).toBe(true);
    expect(validarLectura(await sensor.medir())).toBeNull();
    sensor.desconectar();
    expect(await sensor.disponible()).toBe(false);
  });

  test('la probabilidad de falla controla los errores al azar', async () => {
    // Arrange
    const siempre = new SensorSimulado('tensiometro', { probabilidadFalla: 1, azar: azarFijo(0.5) });
    const nunca = new SensorSimulado('tensiometro', { probabilidadFalla: 0, azar: azarFijo(0.5) });

    // Act / Assert
    await expect(siempre.medir()).rejects.toMatchObject({ codigo: 'error' });
    expect(validarLectura(await nunca.medir())).toBeNull();
  });

  test('crearSensoresSimulados entrega un sensor por tipo', () => {
    // Arrange / Act
    const sensores = crearSensoresSimulados();

    // Assert
    expect(Object.keys(sensores).sort()).toEqual([...TIPOS_SENSOR].sort());
    for (const tipo of TIPOS_SENSOR) expect(sensores[tipo].tipo).toBe(tipo);
  });
});

describe('crearSensores', () => {
  const original = process.env.EXPO_PUBLIC_SENSORES;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_SENSORES;
    else process.env.EXPO_PUBLIC_SENSORES = original;
  });

  test('por defecto usa el simulador', () => {
    // Arrange
    delete process.env.EXPO_PUBLIC_SENSORES;

    // Act
    const sensores = crearSensores();

    // Assert
    expect(Object.keys(sensores)).toHaveLength(4);
  });

  test('un modo que aún no existe se informa con claridad', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'bluetooth';

    // Act / Assert
    expect(() => crearSensores()).toThrow('Modo de sensores no soportado: "bluetooth"');
  });
});
