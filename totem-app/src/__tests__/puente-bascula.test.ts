import { crearSensores, ErrorSensor, SensorBasculaPuente, SensorOximetroPuente, SensorSimulado } from '../sensores';

const CONFIG = { url: 'http://bascula:8766' };

const MEDICION = {
  peso_kg: 53.4, muestras: 2, capturado_en: '2026-10-17T23:40:43+00:00',
  dispositivo: { id: 'E0:D3:8E:62:51:3D', calibracion: 'desconocida' },
};

const responder = (status: number, cuerpo: unknown) =>
  jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => cuerpo });

const llamada = (n = 0) => (global.fetch as jest.Mock).mock.calls[n] as [string, { method: string; headers: Record<string, string>; signal: AbortSignal }];

describe('SensorBasculaPuente.disponible', () => {
  test('el puente escuchando basta: la báscula duerme hasta que alguien se sube', async () => {
    // Arrange
    global.fetch = responder(200, { escuchando: true, dispositivo: 'E0:D3', ultimo_anuncio_hace_s: null }) as unknown as typeof fetch;

    // Act
    const disponible = await new SensorBasculaPuente(CONFIG).disponible();

    // Assert
    expect(disponible).toBe(true);
    expect(llamada()[0]).toBe('http://bascula:8766/estado');
  });

  test.each([
    ['el puente no escucha', responder(200, { escuchando: false })],
    ['el puente responde error', responder(500, {})],
    ['no se llega al puente', jest.fn().mockRejectedValue(new Error('network'))],
  ])('es false cuando %s', async (_caso, simulado) => {
    // Arrange
    global.fetch = simulado as unknown as typeof fetch;

    // Act / Assert
    expect(await new SensorBasculaPuente(CONFIG).disponible()).toBe(false);
  });
});

describe('SensorBasculaPuente.medir', () => {
  test('devuelve el peso con un decimal, el dispositivo y la hora', async () => {
    // Arrange
    global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

    // Act
    const lectura = await new SensorBasculaPuente(CONFIG).medir();

    // Assert
    expect(lectura).toEqual({
      sensor: 'balanza', valores: { peso: '53.4' }, dispositivo: MEDICION.dispositivo, capturadoEn: MEDICION.capturado_en,
    });
    expect(llamada()[0]).toBe('http://bascula:8766/medir');
    expect(llamada()[1].method).toBe('POST');
  });

  test('no inventa IMC, grasa ni masa muscular', async () => {
    // Arrange
    global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

    // Act
    const { valores } = await new SensorBasculaPuente(CONFIG).medir();

    // Assert
    expect(Object.keys(valores)).toEqual(['peso']);
  });

  test.each([
    [504, 'timeout'], [503, 'desconectado'], [422, 'lectura_invalida'], [422, 'movimiento'],
  ])('traduce el error %s (%s) del puente a un ErrorSensor', async (estado, codigo) => {
    // Arrange
    global.fetch = responder(estado, { codigo, mensaje: 'Súbete a la báscula' }) as unknown as typeof fetch;

    // Act
    const error = await new SensorBasculaPuente(CONFIG).medir().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.codigo).toBe(codigo);
    expect(error.message).toBe('Súbete a la báscula');
  });

  test('si no se llega al puente figura como desconectado', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;

    // Act
    const error = await new SensorBasculaPuente(CONFIG).medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('desconectado');
    expect(error.message).toContain('puente de la báscula');
  });

  test('espera más que el puente (40 s) antes de dar timeout', async () => {
    // Arrange
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, opciones: { signal: AbortSignal }) => new Promise((_resolver, rechazar) => {
      opciones.signal.addEventListener('abort', () => rechazar(Object.assign(new Error('abortado'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;

    // Act
    const pendiente = new SensorBasculaPuente(CONFIG).medir().catch((e) => e);
    await jest.advanceTimersByTimeAsync(39000);
    const antes = (global.fetch as jest.Mock).mock.calls[0][1].signal.aborted;
    await jest.advanceTimersByTimeAsync(1500);
    const error = await pendiente;
    jest.useRealTimers();

    // Assert
    expect(antes).toBe(false);
    expect(error.codigo).toBe('timeout');
  });

  test('envía la clave del puente cuando está configurada', async () => {
    // Arrange
    global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

    // Act
    await new SensorBasculaPuente({ ...CONFIG, clave: 'secreto' }).medir();

    // Assert
    expect(llamada()[1].headers['X-Puente-Key']).toBe('secreto');
  });
});

describe('SensorBasculaPuente.enVivo', () => {
  test('devuelve el peso que emite la báscula', async () => {
    // Arrange
    global.fetch = responder(200, { escuchando: true, valida: true, peso_kg: 53.4, motivo: null }) as unknown as typeof fetch;

    // Act
    const vivo = await new SensorBasculaPuente(CONFIG).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: true, peso: 53.4 });
    expect(llamada()[0]).toBe('http://bascula:8766/lectura');
  });

  test.each(['sin_carga', 'sin_senal', 'desconectado'])('sin peso informa el motivo (%s)', async (motivo) => {
    // Arrange
    global.fetch = responder(200, { escuchando: true, valida: false, peso_kg: null, motivo }) as unknown as typeof fetch;

    // Act / Assert
    expect(await new SensorBasculaPuente(CONFIG).enVivo()).toEqual({ valida: false, motivo });
  });

  test('si el puente falla no lanza: informa desconectado', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;

    // Act / Assert
    expect(await new SensorBasculaPuente(CONFIG).enVivo()).toEqual({ valida: false, motivo: 'desconectado' });
  });
});

describe('crearSensores con la báscula real', () => {
  const claves = ['EXPO_PUBLIC_SENSORES', 'EXPO_PUBLIC_PUENTE_BASCULA_URL', 'EXPO_PUBLIC_PUENTE_BASCULA_KEY'];
  const guardado = Object.fromEntries(claves.map((c) => [c, process.env[c]]));
  afterEach(() => {
    for (const c of claves) { if (guardado[c] === undefined) delete process.env[c]; else process.env[c] = guardado[c]; }
  });

  test('en modo bascula_puente solo la balanza es real', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'bascula_puente';

    // Act
    const sensores = crearSensores();

    // Assert
    expect(sensores.balanza).toBeInstanceOf(SensorBasculaPuente);
    expect(sensores.oximetro).toBeInstanceOf(SensorSimulado);
    expect(sensores.tensiometro).toBeInstanceOf(SensorSimulado);
  });

  test('se pueden combinar oxímetro y báscula reales', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'oximetro_puente, bascula_puente';

    // Act
    const sensores = crearSensores();

    // Assert
    expect(sensores.oximetro).toBeInstanceOf(SensorOximetroPuente);
    expect(sensores.oximetro_recuperacion).toBeInstanceOf(SensorOximetroPuente);
    expect(sensores.balanza).toBeInstanceOf(SensorBasculaPuente);
    expect(sensores.prueba_esfuerzo).toBeInstanceOf(SensorSimulado);
  });

  test('usa la URL y la clave configuradas, o localhost:8766 por defecto', async () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'bascula_puente';
    global.fetch = responder(200, { escuchando: true }) as unknown as typeof fetch;

    // Act
    await crearSensores().balanza.disponible();
    process.env.EXPO_PUBLIC_PUENTE_BASCULA_URL = 'http://192.168.1.84:8766';
    process.env.EXPO_PUBLIC_PUENTE_BASCULA_KEY = 'clave';
    await crearSensores().balanza.disponible();

    // Assert
    expect(llamada(0)[0]).toBe('http://localhost:8766/estado');
    expect(llamada(1)[0]).toBe('http://192.168.1.84:8766/estado');
    expect(llamada(1)[1].headers['X-Puente-Key']).toBe('clave');
  });

  test('un modo desconocido dentro de una lista se rechaza', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'bascula_puente,bluetooth';

    // Act / Assert
    expect(() => crearSensores()).toThrow('"bluetooth"');
  });
});
