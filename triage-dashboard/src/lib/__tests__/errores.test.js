import { MENSAJE_SIN_RESPUESTA, describirServidor, mensajeErrorLogin } from '../errores';

describe('mensajeErrorLogin', () => {
  test('un 404 indica que el backend publicado no tiene el login (está desactualizado)', () => {
    // Arrange / Act
    const mensaje = mensajeErrorLogin(404, { detail: 'Not Found' });

    // Assert
    expect(mensaje).toContain('backend publicado está desactualizado');
    expect(mensaje).not.toContain('Not Found');
  });

  test.each([
    [401, { detail: 'Credenciales inválidas' }, 'Credenciales inválidas'],
    [401, {}, 'Credenciales inválidas.'],
    [401, { detail: '   ' }, 'Credenciales inválidas.'],
    [403, { detail: 'Permisos insuficientes' }, 'Permisos insuficientes'],
    [403, {}, 'No tienes permiso para entrar.'],
    [429, { detail: 'Demasiados intentos. Intenta más tarde.' }, 'Demasiados intentos. Intenta más tarde.'],
    [429, {}, 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.'],
  ])('un %i con %j muestra "%s"', (estado, datos, esperado) => {
    // Arrange / Act / Assert
    expect(mensajeErrorLogin(estado, datos)).toBe(esperado);
  });

  test('un 422 (el detalle de FastAPI es una lista) no muestra la lista cruda', () => {
    // Arrange / Act
    const mensaje = mensajeErrorLogin(422, { detail: [{ msg: 'Field required', loc: ['body', 'password'] }] });

    // Assert
    expect(mensaje).toBe('Revisa el usuario y la contraseña: el formato no es válido.');
  });

  test.each([500, 502, 503, 504])('un %i indica un error del servidor con su código', (estado) => {
    // Arrange / Act / Assert
    expect(mensajeErrorLogin(estado, {})).toBe(`El servidor tuvo un error (código ${estado}). Revisa los registros del backend.`);
  });

  test.each([
    [400, { detail: 'Solicitud inválida' }, 'Solicitud inválida'],
    [418, {}, 'No se pudo iniciar sesión (código 418).'],
  ])('otros códigos usan el detalle o el código (%i)', (estado, datos, esperado) => {
    // Arrange / Act / Assert
    expect(mensajeErrorLogin(estado, datos)).toBe(esperado);
  });

  test('sin cuerpo (undefined o null) no falla', () => {
    // Arrange / Act / Assert
    expect(mensajeErrorLogin(401)).toBe('Credenciales inválidas.');
    expect(mensajeErrorLogin(401, null)).toBe('Credenciales inválidas.');
  });
});

test('el mensaje sin respuesta menciona el backend y CORS', () => {
  // Arrange / Act / Assert
  expect(MENSAJE_SIN_RESPUESTA).toContain('backend esté activo');
  expect(MENSAJE_SIN_RESPUESTA).toContain('CORS');
});

describe('describirServidor', () => {
  test.each([
    ['https://totem-backend-g6yh.onrender.com', 'totem-backend-g6yh.onrender.com'],
    ['http://localhost:8000', 'localhost:8000'],
    ['https://ejemplo.com/ruta/larga?x=1', 'ejemplo.com'],
    ['https://usuario:clave@ejemplo.com/api', 'ejemplo.com'],   // nunca muestra credenciales
  ])('%s → %s', (url, esperado) => {
    // Arrange / Act / Assert
    expect(describirServidor(url)).toBe(esperado);
  });

  test.each([['no es una url', 'no es una url'], ['', ''], [undefined, ''], [null, '']])('un valor no válido (%p) no rompe', (url, esperado) => {
    // Arrange / Act / Assert
    expect(describirServidor(url)).toBe(esperado);
  });
});
