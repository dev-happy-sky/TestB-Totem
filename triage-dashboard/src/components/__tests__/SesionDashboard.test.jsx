import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SesionDashboard from '../SesionDashboard';

// El dashboard real se prueba aparte; aquí solo importa que reciba la sesión.
jest.mock('../DashboardAptitud', () => ({
  __esModule: true,
  default: ({ sesion, onLogout, onSesionInvalida }) => (
    <div>
      <span>Dashboard de {sesion.usuario} ({sesion.rol})</span>
      <button onClick={onLogout}>Cerrar sesión</button>
      <button onClick={onSesionInvalida}>Sesión expirada</button>
    </div>
  ),
}));

const respuestaLogin = { ok: true, json: async () => ({ token: 'tok123', rol: 'encargado', usuario: 'ana' }) };

beforeEach(() => {
  sessionStorage.clear();
  global.fetch = jest.fn();
});

async function iniciarSesion(user = userEvent.setup()) {
  await user.type(screen.getByPlaceholderText('Usuario'), 'ana');
  await user.type(screen.getByPlaceholderText('Contraseña'), 'clave');
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
}

test('sin sesión muestra el formulario de login y no el dashboard', () => {
  render(<SesionDashboard />);
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
  expect(screen.queryByText(/Dashboard de/)).not.toBeInTheDocument();
});

test('login exitoso entra al dashboard y guarda el token solo en sessionStorage', async () => {
  global.fetch.mockResolvedValue(respuestaLogin);
  render(<SesionDashboard />);
  await iniciarSesion();

  expect(await screen.findByText('Dashboard de ana (encargado)')).toBeInTheDocument();
  const [url, opciones] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/api\/auth\/login$/);
  expect(JSON.parse(opciones.body)).toEqual({ username: 'ana', password: 'clave' });
  expect(JSON.parse(sessionStorage.getItem('totem_sesion')).token).toBe('tok123');
  expect(localStorage.length).toBe(0);
});

test('credenciales inválidas muestran el error del servidor', async () => {
  global.fetch.mockResolvedValue({ ok: false, json: async () => ({ detail: 'Credenciales inválidas' }) });
  render(<SesionDashboard />);
  await iniciarSesion();

  expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas');
  expect(screen.queryByText(/Dashboard de/)).not.toBeInTheDocument();
});

test('error de red muestra un mensaje y no rompe el formulario', async () => {
  global.fetch.mockRejectedValue(new Error('network'));
  render(<SesionDashboard />);
  await iniciarSesion();

  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo comunicar con el servidor.');
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
