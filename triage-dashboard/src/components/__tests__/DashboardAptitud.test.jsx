import { render, screen, waitFor, act } from '@testing-library/react';
import DashboardAptitud from '../DashboardAptitud';

const sesion = { token: 'tok123', rol: 'encargado', usuario: 'ana' };

const evaluacion = (n, extra = {}) => ({
  idBaseDatos: `uuid-${n}`, idUnico: `db_${n}`, id: `rut-${n}`, nombre: `Socio ${n}`, carrera: 'Plan', edad: '30',
  objetivo: 'Fuerza', iaSugerida: 'A3', alerta: null, estado: 'pendiente', nivelFinal: null, tiempoEspera: 'Registrado',
  mediciones: { presionSys: 118, presionDia: 78, fcReposo: 70, fcRecup: 100, peso: '70.0', imc: '24.0', grasa: '20.0', vo2Max: '40.0' },
  salud: { sintomas: [], condiciones: [] },
  ...extra,
});

class FakeWebSocket {
  static instancias = [];
  constructor(url) { this.url = url; this.enviados = []; FakeWebSocket.instancias.push(this); }
  send(m) { this.enviados.push(m); }
  close() {}
}

let props;
beforeEach(() => {
  FakeWebSocket.instancias = [];
  global.WebSocket = FakeWebSocket;
  props = { sesion, onSesionInvalida: jest.fn(), onLogout: jest.fn() };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const mockHistorial = (datos, status = 200) => {
  global.fetch = jest.fn().mockResolvedValue({ ok: status === 200, status, json: async () => datos });
};
const nombresEnCola = () =>
  [...document.querySelectorAll('.cursor-pointer span.text-sm.font-bold')].map((el) => el.textContent);

test('pide el historial con el token de la sesión', async () => {
  mockHistorial([evaluacion(1)]);
  render(<DashboardAptitud {...props} />);

  await screen.findAllByText('Socio 1');
  const [url, opciones] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/api\/evaluaciones$/);
  expect(url).not.toContain('/ws/');
  expect(opciones.headers.Authorization).toBe('Bearer tok123');
});

test('si el servidor responde 401 avisa que la sesión es inválida', async () => {
  mockHistorial({ detail: 'Sesión inválida o expirada' }, 401);
  render(<DashboardAptitud {...props} />);
  await waitFor(() => expect(props.onSesionInvalida).toHaveBeenCalled());
});

test('el WebSocket envía el token en el primer mensaje, no en la URL', async () => {
  mockHistorial([]);
  render(<DashboardAptitud {...props} />);

  const ws = FakeWebSocket.instancias[0];
  expect(ws.url).toMatch(/^wss?:\/\/.+\/ws\/dashboard$/);
  expect(ws.url).not.toContain('tok123');
  act(() => ws.onopen());
  expect(JSON.parse(ws.enviados[0])).toEqual({ token: 'tok123' });
});

test('si el WebSocket se cierra con 4401 avisa que la sesión es inválida', async () => {
  mockHistorial([]);
  render(<DashboardAptitud {...props} />);
  act(() => FakeWebSocket.instancias[0].onclose({ code: 4401 }));
  expect(props.onSesionInvalida).toHaveBeenCalled();
});

test('una evaluación nueva por WebSocket aparece en la cola', async () => {
  mockHistorial([]);
  render(<DashboardAptitud {...props} />);
  await screen.findByText(/Esperando evaluaciones/);

  act(() => FakeWebSocket.instancias[0].onmessage({ data: JSON.stringify(evaluacion(9)) }));
  expect(await screen.findAllByText('Socio 9')).not.toHaveLength(0);
});

test('ordena por gravedad (A1 primero) y deja las validadas al final', async () => {
  mockHistorial([
    evaluacion(1, { iaSugerida: 'A3' }),
    evaluacion(2, { iaSugerida: 'A2', alerta: 'DERIVAR' }),
    evaluacion(3, { iaSugerida: 'A3', estado: 'validado', nivelFinal: 'A1' }),
    evaluacion(4, { iaSugerida: 'A3', nivelFinal: null }),
  ]);
  render(<DashboardAptitud {...props} />);
  await screen.findAllByText('Socio 2');

  expect(nombresEnCola()).toEqual(['Socio 2', 'Socio 1', 'Socio 4', 'Socio 3']);
});

test('los KPI cuentan pendientes, validados, riesgo alto y alertas', async () => {
  mockHistorial([
    evaluacion(1, { iaSugerida: 'A2', alerta: 'DERIVAR' }),
    evaluacion(2),
    evaluacion(3, { estado: 'validado', nivelFinal: 'A1' }),
  ]);
  render(<DashboardAptitud {...props} />);
  await screen.findAllByText('Socio 1');

  const kpi = (etiqueta) => screen.getByText(etiqueta).nextSibling.textContent;
  expect(kpi('POR VALIDAR')).toBe('2');
  expect(kpi('VALIDADOS')).toBe('1');
  expect(kpi('RIESGO ALTO (A1)')).toBe('1');
  expect(kpi('ALERTAS PENDIENTES')).toBe('1');
});

test('cerrar sesión llama a onLogout y muestra el usuario', async () => {
  mockHistorial([]);
  render(<DashboardAptitud {...props} />);
  expect(screen.getByText('ana · encargado')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Cerrar sesión' }).click();
  expect(props.onLogout).toHaveBeenCalled();
});

describe('cierre del WebSocket al desmontar', () => {
  test('un error del socket que se cerró a propósito no se registra como error', async () => {
    // Arrange
    mockHistorial([]);
    const { unmount } = render(<DashboardAptitud {...props} />);
    const ws = FakeWebSocket.instancias[0];
    ws.close = jest.fn();

    // Act
    unmount();
    console.error.mockClear();
    ws.onerror({ type: 'error' });

    // Assert
    expect(ws.close).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  test('un código 4401 recibido después de desmontar no cierra la sesión', async () => {
    // Arrange
    mockHistorial([]);
    const { unmount } = render(<DashboardAptitud {...props} />);
    const ws = FakeWebSocket.instancias[0];

    // Act
    unmount();
    ws.onclose({ code: 4401 });

    // Assert
    expect(props.onSesionInvalida).not.toHaveBeenCalled();
  });

  test('un error real del socket mientras el panel está abierto sí se registra', async () => {
    // Arrange
    mockHistorial([]);
    render(<DashboardAptitud {...props} />);
    console.error.mockClear();

    // Act
    FakeWebSocket.instancias[0].onerror({ type: 'error' });

    // Assert
    expect(console.error).toHaveBeenCalledWith('✗ Error en WebSocket:', { type: 'error' });
  });
});

describe('modo sin seguridad (backend con SEGURIDAD_ACTIVA=false)', () => {
  const abierta = { token: null, rol: 'admin', usuario: 'Sin seguridad' };

  test('pide los datos sin cabecera de autorización', async () => {
    // Arrange
    mockHistorial([evaluacion(1)]);

    // Act
    render(<DashboardAptitud {...props} sesion={abierta} sinSeguridad />);
    await screen.findAllByText('Socio 1');

    // Assert
    const [, opciones] = global.fetch.mock.calls[0];
    expect(opciones.headers).not.toHaveProperty('Authorization');
  });

  test('avisa que la seguridad está desactivada y no ofrece cerrar sesión', async () => {
    // Arrange
    mockHistorial([]);

    // Act
    render(<DashboardAptitud {...props} sesion={abierta} sinSeguridad />);

    // Assert
    expect(screen.getByRole('alert')).toHaveTextContent('Seguridad desactivada');
    expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin seguridad · admin/)).not.toBeInTheDocument();
  });

  test('el WebSocket no envía ningún token', async () => {
    // Arrange
    mockHistorial([]);
    render(<DashboardAptitud {...props} sesion={abierta} sinSeguridad />);
    const ws = FakeWebSocket.instancias[0];

    // Act
    act(() => ws.onopen());

    // Assert
    expect(ws.enviados).toEqual([]);
  });

  test('con seguridad (modo normal) sigue mostrando el usuario, el cierre de sesión y enviando el token', async () => {
    // Arrange
    mockHistorial([]);
    render(<DashboardAptitud {...props} />);
    const ws = FakeWebSocket.instancias[0];

    // Act
    act(() => ws.onopen());

    // Assert
    expect(screen.getByText('ana · encargado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(screen.queryByText(/Seguridad desactivada/)).not.toBeInTheDocument();
    expect(JSON.parse(ws.enviados[0])).toEqual({ token: 'tok123' });
  });

  test('una evaluación nueva llega por WebSocket también sin seguridad', async () => {
    // Arrange
    mockHistorial([]);
    render(<DashboardAptitud {...props} sesion={abierta} sinSeguridad />);
    await screen.findByText(/Esperando evaluaciones/);

    // Act
    act(() => FakeWebSocket.instancias[0].onmessage({ data: JSON.stringify(evaluacion(7)) }));

    // Assert
    expect(await screen.findAllByText('Socio 7')).not.toHaveLength(0);
  });
});
