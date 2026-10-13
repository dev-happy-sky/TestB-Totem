import { crearSensores, ErrorSensor, SensorOximetroPuente, SensorSimulado } from '../sensores';

const CONFIG = { url: 'http://puente:8765' };

const MEDICION = {
  spo2: 97, fc: 72, indice_perfusion: 4.1, muestras: 5, capturado_en: '2026-10-01T10:00:00+00:00',
  dispositivo: { id: 'AA:BB:CC:DD:EE:FF', calibracion: 'desconocida' },
};

const responder = (status: number, cuerpo: unknown) =>
  jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => cuerpo });

const llamada = (n = 0) => (global.fetch as jest.Mock).mock.calls[n] as [string, { method: string; headers: Record<string, string>; signal: AbortSignal }];

describe('SensorOximetroPuente.disponible', () => {
  test('consulta /estado y devuelve si el oxímetro está conectado', async () => {
    // Arrange
    global.fetch = responder(200, { conectado: true, dispositivo: 'AA:BB', ultimo_paquete_hace_s: 0.4 }) as unknown as typeof fetch;

    // Act
    const disponible = await new SensorOximetroPuente('oximetro', CONFIG).disponible();

    // Assert
    expect(disponible).toBe(true);
    expect(llamada()[0]).toBe('http://puente:8765/estado');
    expect(llamada()[1].method).toBe('GET');
  });

  test('si el puente informa que no hay conexión devuelve false', async () => {
    // Arrange
    global.fetch = responder(200, { conectado: false }) as unknown as typeof fetch;

    // Act / Assert
    expect(await new SensorOximetroPuente('oximetro', CONFIG).disponible()).toBe(false);
  });

  test.each([
    ['una respuesta de error', () => responder(401, { detail: 'No autorizado' })],
    ['un fallo de red', () => jest.fn().mockRejectedValue(new TypeError('Network request failed'))],
    ['una respuesta que no es JSON', () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })],
    ['un JSON sin el campo conectado', () => responder(200, {})],
  ])('con %s devuelve false', async (_nombre, fabricar) => {
    // Arrange
    global.fetch = fabricar() as unknown as typeof fetch;

    // Act / Assert
    expect(await new SensorOximetroPuente('oximetro', CONFIG).disponible()).toBe(false);
  });

  test('envía la clave del puente cuando está configurada y no la envía si no', async () => {
    // Arrange
    global.fetch = responder(200, { conectado: true }) as unknown as typeof fetch;

    // Act
    await new SensorOximetroPuente('oximetro', { ...CONFIG, clave: 'secreto' }).disponible();
    await new SensorOximetroPuente('oximetro', CONFIG).disponible();

    // Assert
    expect(llamada(0)[1].headers['X-Puente-Key']).toBe('secreto');
    expect(llamada(1)[1].headers).not.toHaveProperty('X-Puente-Key');
  });

  test('ignora la barra final de la URL', async () => {
    // Arrange
    global.fetch = responder(200, { conectado: true }) as unknown as typeof fetch;

    // Act
    await new SensorOximetroPuente('oximetro', { url: 'http://puente:8765/' }).disponible();

    // Assert
    expect(llamada()[0]).toBe('http://puente:8765/estado');
  });
});

describe('SensorOximetroPuente.medir', () => {
  test('la medición en reposo entrega SpO₂ y FC en reposo con el dispositivo y la hora del puente', async () => {
    // Arrange
    global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

    // Act
    const lectura = await new SensorOximetroPuente('oximetro', CONFIG).medir();

    // Assert
    expect(lectura).toEqual({
      sensor: 'oximetro', valores: { spo2: 97, fcReposo: 72 },
      dispositivo: { id: 'AA:BB:CC:DD:EE:FF', calibracion: 'desconocida' }, capturadoEn: '2026-10-01T10:00:00+00:00',
    });
    expect(llamada()[0]).toBe('http://puente:8765/medir');
    expect(llamada()[1].method).toBe('POST');
  });

  test('la medición de recuperación entrega solo la FC de recuperación', async () => {
    // Arrange
    global.fetch = responder(200, { ...MEDICION, fc: 118 }) as unknown as typeof fetch;

    // Act
    const lectura = await new SensorOximetroPuente('oximetro_recuperacion', CONFIG).medir();

    // Assert
    expect(lectura.sensor).toBe('oximetro_recuperacion');
    expect(lectura.valores).toEqual({ fcRecup: 118 });
  });

  test('envía la clave configurada', async () => {
    // Arrange
    global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

    // Act
    await new SensorOximetroPuente('oximetro', { ...CONFIG, clave: 'secreto' }).medir();

    // Assert
    expect(llamada()[1].headers['X-Puente-Key']).toBe('secreto');
  });

  test.each([
    [503, 'desconectado'], [504, 'timeout'], [422, 'lectura_invalida'], [422, 'movimiento'], [500, 'error'],
  ])('un %s con código "%s" se convierte en el ErrorSensor correspondiente', async (estado, codigo) => {
    // Arrange
    global.fetch = responder(estado, { codigo, mensaje: `Mensaje de ${codigo}` }) as unknown as typeof fetch;

    // Act
    const error = await new SensorOximetroPuente('oximetro', CONFIG).medir().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.codigo).toBe(codigo);
    expect(error.message).toBe(`Mensaje de ${codigo}`);
  });

  test('un código desconocido o ausente se trata como error genérico', async () => {
    // Arrange
    global.fetch = responder(500, { codigo: 'explotó' }) as unknown as typeof fetch;

    // Act
    const error = await new SensorOximetroPuente('oximetro', CONFIG).medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('error');
    expect(error.message).toBe('El puente del oxímetro respondió 500');
  });

  test('una medición ya en curso (409) se informa como error', async () => {
    // Arrange
    global.fetch = responder(409, { codigo: 'error', mensaje: 'Ya hay una medición en curso.' }) as unknown as typeof fetch;

    // Act
    const error = await new SensorOximetroPuente('oximetro', CONFIG).medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('error');
    expect(error.message).toBe('Ya hay una medición en curso.');
  });

  test('una respuesta que no es JSON se informa sin romper', async () => {
    // Arrange
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } }) as unknown as typeof fetch;

    // Act
    const error = await new SensorOximetroPuente('oximetro', CONFIG).medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('error');
    expect(error.message).toContain('502');
  });

  test('si no se puede llegar al puente el sensor figura como desconectado', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;

    // Act
    const error = await new SensorOximetroPuente('oximetro', CONFIG).medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('desconectado');
    expect(error.message).toContain('puente del oxímetro');
  });

  describe('con temporizador', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('si el puente no responde en el tiempo máximo aborta y devuelve timeout', async () => {
      // Arrange
      global.fetch = jest.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolver, rechazar) => {
        init.signal.addEventListener('abort', () => rechazar(Object.assign(new Error('abortado'), { name: 'AbortError' })));
      })) as unknown as typeof fetch;
      const promesa = new SensorOximetroPuente('oximetro', { ...CONFIG, timeoutMedicionMs: 30000 }).medir().catch((e) => e);

      // Act
      await jest.advanceTimersByTimeAsync(30000);
      const error = await promesa;

      // Assert
      expect(error.codigo).toBe('timeout');
    });

    test('una respuesta a tiempo cancela el temporizador', async () => {
      // Arrange
      global.fetch = responder(200, MEDICION) as unknown as typeof fetch;

      // Act
      await new SensorOximetroPuente('oximetro', CONFIG).medir();

      // Assert
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});

describe('crearSensores con el oxímetro real', () => {
  const guardado = {
    modo: process.env.EXPO_PUBLIC_SENSORES, url: process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_URL, clave: process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_KEY,
  };
  const restaurar = (clave: string, valor: string | undefined) => {
    if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor;
  };
  afterEach(() => {
    restaurar('EXPO_PUBLIC_SENSORES', guardado.modo);
    restaurar('EXPO_PUBLIC_PUENTE_OXIMETRO_URL', guardado.url);
    restaurar('EXPO_PUBLIC_PUENTE_OXIMETRO_KEY', guardado.clave);
  });

  test('en modo oximetro_puente usa el puente para el oxímetro y simula el resto', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'oximetro_puente';

    // Act
    const sensores = crearSensores();

    // Assert
    expect(sensores.oximetro).toBeInstanceOf(SensorOximetroPuente);
    expect(sensores.oximetro_recuperacion).toBeInstanceOf(SensorOximetroPuente);
    expect(sensores.tensiometro).toBeInstanceOf(SensorSimulado);
    expect(sensores.balanza).toBeInstanceOf(SensorSimulado);
    expect(sensores.prueba_esfuerzo).toBeInstanceOf(SensorSimulado);
  });

  test('usa la URL y la clave configuradas, o localhost:8765 por defecto', async () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'oximetro_puente';
    global.fetch = responder(200, { conectado: true }) as unknown as typeof fetch;

    // Act
    delete process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_URL;
    await crearSensores().oximetro.disponible();
    process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_URL = 'http://192.168.1.50:8765';
    process.env.EXPO_PUBLIC_PUENTE_OXIMETRO_KEY = 'clave-lan';
    await crearSensores().oximetro.disponible();

    // Assert
    expect(llamada(0)[0]).toBe('http://localhost:8765/estado');
    expect(llamada(1)[0]).toBe('http://192.168.1.50:8765/estado');
    expect(llamada(1)[1].headers['X-Puente-Key']).toBe('clave-lan');
  });

  test('un modo desconocido informa las opciones válidas', () => {
    // Arrange
    process.env.EXPO_PUBLIC_SENSORES = 'bluetooth';

    // Act / Assert
    expect(() => crearSensores()).toThrow('Usa "simulado" u "oximetro_puente"');
  });
});

describe('SensorOximetroPuente.enVivo', () => {
  const LECTURA = { conectado: true, valida: true, spo2: 97, fc: 72, indice_perfusion: 4.1, motivo: null };

  test('consulta /lectura y devuelve SpO₂ y FC', async () => {
    // Arrange
    global.fetch = responder(200, LECTURA) as unknown as typeof fetch;

    // Act
    const vivo = await new SensorOximetroPuente('oximetro', CONFIG).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: true, spo2: 97, fc: 72 });
    expect(llamada()[0]).toBe('http://puente:8765/lectura');
    expect(llamada()[1].method).toBe('GET');
  });

  test.each(['sin_dedo', 'sin_senal', 'desconectado'])('sin valor válido informa el motivo (%s)', async (motivo) => {
    // Arrange
    global.fetch = responder(200, { conectado: true, valida: false, spo2: null, fc: null, indice_perfusion: null, motivo }) as unknown as typeof fetch;

    // Act
    const vivo = await new SensorOximetroPuente('oximetro', CONFIG).enVivo();

    // Assert
    expect(vivo).toEqual({ valida: false, motivo });
  });

  test('si el puente no responde o falla no lanza: informa desconectado', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const sensor = new SensorOximetroPuente('oximetro', CONFIG);

    // Act
    const caido = await sensor.enVivo();
    global.fetch = responder(500, {}) as unknown as typeof fetch;
    const conError = await sensor.enVivo();

    // Assert
    expect(caido).toEqual({ valida: false, motivo: 'desconectado' });
    expect(conError).toEqual({ valida: false, motivo: 'desconectado' });
  });

  test('envía la clave del puente', async () => {
    // Arrange
    global.fetch = responder(200, LECTURA) as unknown as typeof fetch;

    // Act
    await new SensorOximetroPuente('oximetro', { ...CONFIG, clave: 'secreto' }).enVivo();

    // Assert
    expect(llamada()[1].headers['X-Puente-Key']).toBe('secreto');
  });

  test('un valor que no es número se descarta', async () => {
    // Arrange
    global.fetch = responder(200, { ...LECTURA, spo2: '97' }) as unknown as typeof fetch;

    // Act
    const vivo = await new SensorOximetroPuente('oximetro', CONFIG).enVivo();

    // Assert
    expect(vivo.valida).toBe(false);
  });
});
