import {
  actualizarSocio, enviarEvaluacion, identificarSocio, MENSAJE_TIEMPO_AGOTADO, registrarSocio, TIEMPO_MAXIMO_MS,
} from '../services/api';

const responder = (status: number, cuerpo: unknown) =>
  jest.fn().mockResolvedValue({
    ok: status < 400, status, text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
  });

beforeEach(() => {
  process.env.EXPO_PUBLIC_TOTEM_KEY = 'clave-test';
});

describe('llamadas al backend', () => {
  test('identificarSocio envía la clave del tótem y la matrícula', async () => {
    // Arrange
    global.fetch = responder(200, { registrado: false, matricula: '20231234A' }) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('20231234A');

    // Assert
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/api\/socios\/identificar$/);
    expect(init.method).toBe('POST');
    expect(init.headers['X-Totem-Key']).toBe('clave-test');
    expect(JSON.parse(init.body)).toEqual({ matricula: '20231234A' });
    expect(resultado).toEqual({ ok: true, data: { registrado: false, matricula: '20231234A' } });
  });

  test('actualizarSocio normaliza la matrícula en la ruta', async () => {
    // Arrange
    global.fetch = responder(200, { status: 'success', cambios: [] }) as unknown as typeof fetch;

    // Act
    await actualizarSocio(' 2023-1234a ', { plan_membresia: 'Plan Premium' });

    // Assert
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/api\/socios\/20231234A$/);
    expect(init.method).toBe('PUT');
  });

  test('una petición sin cuerpo no envía body', async () => {
    // Arrange
    global.fetch = responder(200, {}) as unknown as typeof fetch;

    // Act
    await enviarEvaluacion(undefined);

    // Assert
    expect((global.fetch as jest.Mock).mock.calls[0][1]).not.toHaveProperty('body');
  });
});

describe('interpretación de errores', () => {
  test('un detail de texto pasa tal cual', async () => {
    // Arrange
    global.fetch = responder(429, { detail: 'Demasiadas consultas' }) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('20231234A');

    // Assert
    expect(resultado).toEqual({ ok: false, status: 429, mensaje: 'Demasiadas consultas' });
  });

  test('un detail con código de negocio expone code, mensaje y coincidencias', async () => {
    // Arrange
    const coincidencias = [{ nombre: 'Ana Pérez', plan_membresia: 'Plan Estudiante', matricula: '******34A' }];
    global.fetch = responder(409, {
      detail: { code: 'posible_duplicado', message: 'Ya existe un socio', coincidencias },
    }) as unknown as typeof fetch;

    // Act
    const resultado = await registrarSocio({
      matricula: '20231234A', nombre: 'Ana', apellido: 'Pérez', fecha_nacimiento: '2002-03-15', plan_membresia: 'Plan Estudiante',
    });

    // Assert
    expect(resultado).toEqual({ ok: false, status: 409, code: 'posible_duplicado', mensaje: 'Ya existe un socio', coincidencias });
  });

  test('un 422 de validación muestra el primer mensaje sin el prefijo técnico', async () => {
    // Arrange
    global.fetch = responder(422, { detail: [{ msg: 'Value error, Matrícula inválida' }, { msg: 'otro' }] }) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('12');

    // Assert
    expect(resultado).toMatchObject({ ok: false, status: 422, mensaje: 'Matrícula inválida' });
  });

  test('un 422 sin mensajes usa un texto genérico', async () => {
    // Arrange
    global.fetch = responder(422, { detail: [] }) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('12');

    // Assert
    expect(resultado).toMatchObject({ ok: false, mensaje: 'Revisa los datos ingresados.' });
  });

  test('una respuesta que no es JSON se trata como falta de conexión (status 0)', async () => {
    // Arrange
    global.fetch = responder(502, '<html>Bad Gateway</html>') as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('20231234A');

    // Assert
    expect(resultado).toMatchObject({ ok: false, status: 0 });
    expect((resultado as { mensaje: string }).mensaje).toContain('502');
  });

  test('un fallo de red devuelve status 0 con el mensaje del error', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('sin red')) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('20231234A');

    // Assert
    expect(resultado).toEqual({ ok: false, status: 0, mensaje: 'sin red' });
  });

  test('un fallo sin mensaje usa el texto por defecto', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('')) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('20231234A');

    // Assert
    expect(resultado).toMatchObject({ ok: false, status: 0, mensaje: 'No se pudo comunicar con el servidor central.' });
  });
});

describe('tiempo máximo de espera', () => {
  afterEach(() => jest.useRealTimers());

  // fetch que nunca responde, pero respeta la cancelación como el real
  const fetchColgado = () => jest.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolver, rechazar) => {
    init.signal.addEventListener('abort', () => rechazar(Object.assign(new Error('abortado'), { name: 'AbortError' })));
  }));

  test('si el servidor no responde, la llamada termina con un error claro en vez de quedarse esperando', async () => {
    // Arrange
    jest.useFakeTimers();
    global.fetch = fetchColgado() as unknown as typeof fetch;

    // Act
    const pendiente = registrarSocio({
      matricula: '20231234A', nombre: 'Ana', apellido: 'Pérez', fecha_nacimiento: '2002-03-15', plan_membresia: 'Plan',
    });
    await jest.advanceTimersByTimeAsync(TIEMPO_MAXIMO_MS);
    const resultado = await pendiente;

    // Assert
    expect(resultado).toEqual({ ok: false, status: 0, mensaje: MENSAJE_TIEMPO_AGOTADO });
  });

  test('no se rinde antes del tiempo máximo (el servidor gratuito tarda en despertar)', async () => {
    // Arrange
    jest.useFakeTimers();
    global.fetch = fetchColgado() as unknown as typeof fetch;
    let terminado = false;

    // Act
    const pendiente = identificarSocio('20231234A').then((r) => { terminado = true; return r; });
    await jest.advanceTimersByTimeAsync(TIEMPO_MAXIMO_MS - 1000);

    // Assert
    expect(terminado).toBe(false);
    await jest.advanceTimersByTimeAsync(1000);
    expect((await pendiente).ok).toBe(false);
  });

  test('el tiempo máximo es de al menos 40 s', () => {
    // Arrange / Act / Assert
    expect(TIEMPO_MAXIMO_MS).toBeGreaterThanOrEqual(40000);
  });

  test('una respuesta a tiempo se entrega normal y no deja temporizadores pendientes', async () => {
    // Arrange
    jest.useFakeTimers();
    global.fetch = responder(200, { registrado: false, matricula: '20231234A' }) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('20231234A');

    // Assert
    expect(resultado.ok).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('cada llamada envía una señal de cancelación', async () => {
    // Arrange
    global.fetch = responder(200, { status: 'success' }) as unknown as typeof fetch;

    // Act
    await enviarEvaluacion({});

    // Assert
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test('un error de red distinto sigue mostrando su mensaje', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request failed')) as unknown as typeof fetch;

    // Act
    const resultado = await identificarSocio('20231234A');

    // Assert
    expect(resultado).toEqual({ ok: false, status: 0, mensaje: 'Network request failed' });
  });
});
