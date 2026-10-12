import { actualizarSocio, enviarEvaluacion, identificarSocio, registrarSocio } from '../services/api';

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
    await actualizarSocio(' 2023-1234a ', { edad: 22 });

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
    const coincidencias = [{ nombre: 'Ana Pérez', carrera: 'Civil', matricula: '******34A' }];
    global.fetch = responder(409, {
      detail: { code: 'posible_duplicado', message: 'Ya existe un socio', coincidencias },
    }) as unknown as typeof fetch;

    // Act
    const resultado = await registrarSocio({ matricula: '20231234A', nombre: 'Ana', carrera: 'Civil', edad: 21 });

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
