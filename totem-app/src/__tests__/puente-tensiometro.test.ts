import { crearSensores, ErrorSensor, SensorBasculaPuente, SensorSimulado, SensorTensiometroPuente } from '../sensores';

const CONFIG = { url: 'http://tensiometro:8767' };

const MEDICION = {
  sistolica: 118, diastolica: 78, pulso: 72, capturado_en: '2026-10-17T22:30:00+00:00',
  dispositivo: { id: '0C:7F:ED:74:07:54', calibracion: 'desconocida' },
};

const responder = (status: number, cuerpo: unknown) =>
  jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => cuerpo });

const llamada = (n = 0) => (global.fetch as jest.Mock).mock.calls[n] as [string, { method: string; headers: Record<string, string>; signal: AbortSignal }];

describe('SensorTensiometroPuente.disponible', () => {
  test('basta con que el puente esté activo: el tensiómetro duerme entre mediciones', async () => {
    // Arrange
    global.fetch = responder(200, { activo: true, conectado: false, dispositivo: '0C:7F', ultima_medicion_hace_s: null }) as unknown as typeof fetch;

    // Act
    const disponible = await new SensorTensiometroPuente(CONFIG).disponible();

    // Assert
    expect(disponible).toBe(true);
    expect(llamada()[0]).toBe('http://tensiometro:8767/estado');
  });

  test.each([
    ['el puente no está activo', responder(200, { activo: false })],
    ['el puente responde error', responder(500, {})],
    ['no se llega al puente', jest.fn().mockRejectedValue(new Error('network'))],
  ])('es false cuando %s', async (_caso, simulado) => {
    // Arrange
    global.fetch = simulado as unknown as typeof fetch;

    // Act / Assert
    expect(await new SensorTensiometroPuente(CONFIG).disponible()).toBe(false);
  });
});

describe('SensorTensiometroPuente.medir', () => {
  test('devuelve sistólica y diastólica como números, con el dispositivo y la hora', async () => {
    // Arrange
    global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

    // Act
    const lectura = await new SensorTensiometroPuente(CONFIG).medir();

    // Assert
    expect(lectura).toEqual({
      sensor: 'tensiometro', valores: { presionSys: 118, presionDia: 78 }, dispositivo: MEDICION.dispositivo, capturadoEn: MEDICION.capturado_en,
    });
    expect(llamada()[0]).toBe('http://tensiometro:8767/medir');
    expect(llamada()[1].method).toBe('POST');
  });

  test('el pulso del tensiómetro no reemplaza la FC en reposo del oxímetro', async () => {
    // Arrange
    global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

    // Act
    const { valores } = await new SensorTensiometroPuente(CONFIG).medir();

    // Assert
    expect(Object.keys(valores).sort()).toEqual(['presionDia', 'presionSys']);
  });

  test.each([
    [504, 'timeout'], [503, 'desconectado'], [422, 'lectura_invalida'], [422, 'movimiento'],
  ])('traduce el error %s (%s) del puente a un ErrorSensor', async (estado, codigo) => {
    // Arrange
    global.fetch = responder(estado, { codigo, mensaje: 'Pulsa Start en el tensiómetro' }) as unknown as typeof fetch;

    // Act
    const error = await new SensorTensiometroPuente(CONFIG).medir().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.codigo).toBe(codigo);
    expect(error.message).toBe('Pulsa Start en el tensiómetro');
  });

  test('si no se llega al puente figura como desconectado', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;

    // Act
    const error = await new SensorTensiometroPuente(CONFIG).medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('desconectado');
    expect(error.message).toContain('puente del tensiómetro');
  });

  test('espera más que el puente (140 s) antes de dar timeout', async () => {
    // Arrange
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, opciones: { signal: AbortSignal }) => new Promise((_resolver, rechazar) => {
      opciones.signal.addEventListener('abort', () => rechazar(Object.assign(new Error('abortado'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;

    // Act
    const pendiente = new SensorTensiometroPuente(CONFIG).medir().catch((e) => e);
    await jest.advanceTimersByTimeAsync(139000);
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
    await new SensorTensiometroPuente({ ...CONFIG, clave: 'secreto' }).medir();

    // Assert
    expect(llamada()[1].headers['X-Puente-Key']).toBe('secreto');
  });
});

describe('crearSensores con el tensiómetro real', () => {
  const claves = ['EXPO_PUBLIC_SENSORES', 'EXPO_PUBLIC_PUENTE_TENSIOMETRO_URL', 'EXPO_PUBLIC_PUENTE_TENSIOMETRO_KEY'];
  const guardado = Object.fromEntries(claves.map((c) => [c, process.env[c]]));
  afterEach(() => {
    for (const c of claves) { if (guardado[c] === undefined) delete process.env[c]; else process.env[c] = guardado[c]; }
  });

  test('en modo tensiometro_puente solo el tensiómetro es real', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'tensiometro_puente';

    // Act
    const sensores = crearSensores();

    // Assert
    expect(sensores.tensiometro).toBeInstanceOf(SensorTensiometroPuente);
    expect(sensores.balanza).toBeInstanceOf(SensorSimulado);
    expect(sensores.oximetro).toBeInstanceOf(SensorSimulado);
  });

  test('se combina con la báscula', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'bascula_puente,tensiometro_puente';

    // Act
    const sensores = crearSensores();

    // Assert
    expect(sensores.tensiometro).toBeInstanceOf(SensorTensiometroPuente);
    expect(sensores.balanza).toBeInstanceOf(SensorBasculaPuente);
  });

  test('usa la URL y la clave configuradas, o localhost:8767 por defecto', async () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'tensiometro_puente';
    global.fetch = responder(200, { activo: true }) as unknown as typeof fetch;

    // Act
    await crearSensores().tensiometro.disponible();
    process.env.EXPO_PUBLIC_PUENTE_TENSIOMETRO_URL = 'http://192.168.1.84:8767';
    process.env.EXPO_PUBLIC_PUENTE_TENSIOMETRO_KEY = 'clave';
    await crearSensores().tensiometro.disponible();

    // Assert
    expect(llamada(0)[0]).toBe('http://localhost:8767/estado');
    expect(llamada(1)[0]).toBe('http://192.168.1.84:8767/estado');
    expect(llamada(1)[1].headers['X-Puente-Key']).toBe('clave');
  });
});

describe('SensorTensiometroPuente.enVivo', () => {
  test.each([
    [{ activo: true, conectado: false }, 'Listo: pulsa Start en el brazalete'],
    [{ activo: true, conectado: true }, 'Tensiómetro conectado: pulsa Start en el brazalete'],
  ])('con el puente activo indica que está listo para medir (%j)', async (estado, texto) => {
    // Arrange
    global.fetch = responder(200, estado) as unknown as typeof fetch;

    // Act
    const vivo = await new SensorTensiometroPuente(CONFIG).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: true, estado: texto });
  });

  test.each([
    ['el puente no está activo', responder(200, { activo: false })],
    ['el puente responde error', responder(500, {})],
    ['no se llega al puente', jest.fn().mockRejectedValue(new Error('network'))],
  ])('sin puente (%s) lo marca desconectado', async (_caso, simulado) => {
    // Arrange
    global.fetch = simulado as unknown as typeof fetch;

    // Act / Assert
    expect(await new SensorTensiometroPuente(CONFIG).enVivo()).toEqual({ valida: false, motivo: 'desconectado' });
  });
});
