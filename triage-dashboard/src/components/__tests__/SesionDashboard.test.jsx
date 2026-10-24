import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SesionDashboard from '../SesionDashboard';

// El dashboard real se prueba aparte; aquí solo importa que reciba la sesión.
const mockPropsDashboard = [];
jest.mock('../DashboardAptitud', () => ({
  __esModule: true,
  default: ({ sesion, onLogout, onSesionInvalida, sinSeguridad }) => {
    mockPropsDashboard.push({ sesion, sinSeguridad });
    return (
    <div>
      <span>Dashboard de {sesion.usuario} ({sesion.rol})</span>
      <button onClick={onLogout}>Cerrar sesión</button>
      <button onClick={onSesionInvalida}>Sesión expirada</button>
    </div>
    );
  },
}));

const respuestaLogin = { ok: true, json: async () => ({ token: 'tok123', rol: 'encargado', usuario: 'ana' }) };

// El backend informa en /api/configuracion si exige login; el resto de las rutas responde lo que defina cada prueba.
const CONFIG_CON_SEGURIDAD = { ok: true, status: 200, json: async () => ({ seguridad: true }) };
const llamadasLogin = () => global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/login'));

// `respuesta` se usa para el login; con `{ falla: true }` el login falla como una caída de red.
function responderLogin(respuesta, { falla = false, configuracion = CONFIG_CON_SEGURIDAD } = {}) {
  global.fetch.mockImplementation(async (url) => {
    if (String(url).endsWith('/api/configuracion')) return configuracion;
    if (falla) throw new Error('network');
    return respuesta;
  });
}

beforeEach(() => {
  mockPropsDashboard.length = 0;
  sessionStorage.clear();
  global.fetch = jest.fn();
  responderLogin(undefined);
});

async function iniciarSesion(user = userEvent.setup()) {
  await user.type(await screen.findByLabelText('Usuario'), 'ana');
  await user.type(screen.getByLabelText('Contraseña'), 'clave');
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
}

test('sin sesión muestra el formulario de login y no el dashboard', async () => {
  render(<SesionDashboard />);
  expect(await screen.findByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
  expect(screen.queryByText(/Dashboard de/)).not.toBeInTheDocument();
});

test('login exitoso entra al dashboard y guarda el token solo en sessionStorage', async () => {
  responderLogin(respuestaLogin);
  render(<SesionDashboard />);
  await iniciarSesion();

  expect(await screen.findByText('Dashboard de ana (encargado)')).toBeInTheDocument();
  const [url, opciones] = llamadasLogin()[0];
  expect(url).toMatch(/\/api\/auth\/login$/);
  expect(JSON.parse(opciones.body)).toEqual({ username: 'ana', password: 'clave' });
  expect(JSON.parse(sessionStorage.getItem('totem_sesion')).token).toBe('tok123');
  expect(localStorage.length).toBe(0);
});

test('credenciales inválidas muestran el error del servidor', async () => {
  responderLogin({ ok: false, json: async () => ({ detail: 'Credenciales inválidas' }) });
  render(<SesionDashboard />);
  await iniciarSesion();

  expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
  expect(screen.queryByText(/Dashboard de/)).not.toBeInTheDocument();
});

test.each([
  [404, {}, /backend publicado está desactualizado/],
  [401, { detail: 'Credenciales inválidas' }, /Credenciales inválidas/],
  [429, { detail: 'Demasiados intentos. Intenta más tarde.' }, /Demasiados intentos/],
  [500, {}, /El servidor tuvo un error \(código 500\)/],
  [422, { detail: [{ msg: 'Field required' }] }, /el formato no es válido/],
])('un %i del servidor muestra un mensaje que explica la causa', async (estado, cuerpo, esperado) => {
  // Arrange
  responderLogin({ ok: false, status: estado, json: async () => cuerpo });
  render(<SesionDashboard />);

  // Act
  await iniciarSesion();

  // Assert
  expect(await screen.findByRole('alert')).toHaveTextContent(esperado);
});

test('una respuesta que no es JSON (por ejemplo una página de error) no rompe el login', async () => {
  // Arrange
  responderLogin({ ok: false, status: 502, json: async () => { throw new SyntaxError('no es JSON'); } });
  render(<SesionDashboard />);

  // Act
  await iniciarSesion();

  // Assert
  expect(await screen.findByRole('alert')).toHaveTextContent('código 502');
});

test('el login muestra a qué servidor apunta el dashboard, sin credenciales', async () => {
  // Arrange / Act
  render(<SesionDashboard />);

  // Assert
  expect(await screen.findByText(/^Servidor: /)).toHaveTextContent(/Servidor: [\w.-]+(:\d+)?$/);
});

test('error de red muestra un mensaje y no rompe el formulario', async () => {
  responderLogin(undefined, { falla: true });
  render(<SesionDashboard />);
  await iniciarSesion();

  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo comunicar con el servidor. Revisa que el backend esté activo y que permita este dominio (CORS).');
});

test('restaura la sesión guardada al recargar la página', async () => {
  sessionStorage.setItem('totem_sesion', JSON.stringify({ token: 't', rol: 'admin', usuario: 'root' }));
  render(<SesionDashboard />);
  expect(await screen.findByText('Dashboard de root (admin)')).toBeInTheDocument();
});

test('cerrar sesión borra el token y vuelve al login', async () => {
  sessionStorage.setItem('totem_sesion', JSON.stringify({ token: 't', rol: 'admin', usuario: 'root' }));
  render(<SesionDashboard />);
  await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));

  expect(sessionStorage.getItem('totem_sesion')).toBeNull();
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
});

test('una sesión rechazada por el servidor vuelve al login con aviso', async () => {
  sessionStorage.setItem('totem_sesion', JSON.stringify({ token: 't', rol: 'admin', usuario: 'root' }));
  render(<SesionDashboard />);
  await userEvent.click(await screen.findByRole('button', { name: 'Sesión expirada' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión expiró');
});

describe('cierre por inactividad (R.174)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const sembrar = () =>
    sessionStorage.setItem('totem_sesion', JSON.stringify({ token: 't', rol: 'admin', usuario: 'root' }));

  test('cierra la sesión tras 15 minutos sin actividad', async () => {
    sembrar();
    render(<SesionDashboard />);
    expect(await screen.findByText(/Dashboard de root/)).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(15 * 60 * 1000 + 100); });

    expect(await screen.findByRole('alert')).toHaveTextContent('inactividad');
    expect(sessionStorage.getItem('totem_sesion')).toBeNull();
  });

  test('la actividad del usuario reinicia el contador', async () => {
    sembrar();
    render(<SesionDashboard />);
    await screen.findByText(/Dashboard de root/);

    act(() => { jest.advanceTimersByTime(14 * 60 * 1000); });
    act(() => { window.dispatchEvent(new Event('mousemove')); });
    act(() => { jest.advanceTimersByTime(14 * 60 * 1000); });

    expect(screen.getByText(/Dashboard de root/)).toBeInTheDocument();
  });
});

describe('backend sin seguridad (SEGURIDAD_ACTIVA=false)', () => {
  const SIN_SEGURIDAD = { ok: true, status: 200, json: async () => ({ seguridad: false }) };

  test('entra directo al panel, sin pedir login, y avisa que la seguridad está desactivada', async () => {
    // Arrange
    responderLogin(undefined, { configuracion: SIN_SEGURIDAD });

    // Act
    render(<SesionDashboard />);

    // Assert
    expect(await screen.findByText(/Dashboard de Sin seguridad \(admin\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ingresar' })).not.toBeInTheDocument();
    expect(llamadasLogin()).toHaveLength(0);
  });

  test('le entrega al panel una sesión sin token y con el aviso activado', async () => {
    // Arrange
    responderLogin(undefined, { configuracion: SIN_SEGURIDAD });

    // Act
    render(<SesionDashboard />);
    await screen.findByText(/Dashboard de/);

    // Assert
    expect(mockPropsDashboard.at(-1)).toMatchObject({ sinSeguridad: true, sesion: { token: null, rol: 'admin' } });
  });

  test.each([
    ['responde con seguridad activa', { ok: true, status: 200, json: async () => ({ seguridad: true }) }],
    ['no tiene el endpoint (backend antiguo, 404)', { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }],
    ['responde un error del servidor', { ok: false, status: 500, json: async () => ({}) }],
    ['responde algo que no trae el campo', { ok: true, status: 200, json: async () => ({}) }],
    ['responde null', { ok: true, status: 200, json: async () => null }],
  ])('si el backend %s, pide login (nunca abre sin estar seguro)', async (_caso, configuracion) => {
    // Arrange
    responderLogin(undefined, { configuracion });

    // Act
    render(<SesionDashboard />);

    // Assert
    expect(await screen.findByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
    expect(screen.queryByText(/Dashboard de/)).not.toBeInTheDocument();
  });

  test('si no se puede consultar la configuración (red caída) pide login', async () => {
    // Arrange
    global.fetch.mockImplementation(async () => { throw new Error('network'); });

    // Act
    render(<SesionDashboard />);

    // Assert
    expect(await screen.findByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
  });

  test('mientras consulta la configuración no muestra ni el login ni el panel', () => {
    // Arrange
    global.fetch.mockImplementation(() => new Promise(() => {}));

    // Act
    render(<SesionDashboard />);

    // Assert
    expect(screen.queryByRole('button', { name: 'Ingresar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Dashboard de/)).not.toBeInTheDocument();
  });
});
