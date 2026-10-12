import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardAptitud from '../DashboardAptitud';

const sesion = { token: 'tok123', rol: 'encargado', usuario: 'ana' };

const evaluacion = (n, extra = {}) => ({
  idBaseDatos: `uuid-${n}`, idUnico: `db_${n}`, id: `rut-${n}`, nombre: `Socio ${n}`, carrera: 'Plan', edad: '30',
  objetivo: 'Fuerza', iaSugerida: 'A3', alerta: null, alertaNivel: null, alertaRevisada: false, factores: [],
  estado: 'pendiente', estadoRevision: 'pendiente', nivelFinal: null, observaciones: null, motivoDerivacion: null,
  revisadoPor: null, tiempoEspera: 'Registrado', fecha: `2026-10-0${n}T10:00:00`,
  mediciones: { presionSys: 118, presionDia: 78, fcReposo: 70, fcRecup: 100, peso: '70.0', imc: '24.0', grasa: '20.0', vo2Max: '40.0' },
  salud: { sintomas: [], condiciones: [] },
  ...extra,
});

class FakeWebSocket {
  constructor() { FakeWebSocket.ultimo = this; }
  send() {}
  close() {}
}

// Enruta fetch por método y ruta. `rutas` mapea "METODO /ruta" → { status, body } (o función).
const mockApi = (rutas) => {
  global.fetch = jest.fn(async (url, opciones = {}) => {
    const ruta = url.replace(/^https?:\/\/[^/]+/, '');
    const clave = `${opciones.method || 'GET'} ${ruta}`;
    const entrada = Object.entries(rutas).find(([patron]) => new RegExp(`^${patron}$`).test(clave));
    const { status = 200, body = [] } = entrada ? (typeof entrada[1] === 'function' ? entrada[1](opciones) : entrada[1]) : {};
    return { ok: status < 400, status, json: async () => body };
  });
};
const llamadas = (metodo, patron) =>
  global.fetch.mock.calls.filter(([url, o = {}]) => (o.method || 'GET') === metodo && new RegExp(patron).test(url));

let props;
beforeEach(() => {
  global.WebSocket = FakeWebSocket;
  props = { sesion, onSesionInvalida: jest.fn(), onLogout: jest.fn() };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const nombresEnCola = () =>
  [...document.querySelectorAll('.cursor-pointer span.text-sm.font-bold')].map((el) => el.textContent);

describe('cola: filtros y orden (R.123, R.135, R.136)', () => {
  const cola = [
    evaluacion(1),
    evaluacion(2, { estado: 'validado', estadoRevision: 'revisada', nivelFinal: 'A3' }),
    evaluacion(3, { estado: 'validado', estadoRevision: 'derivada', nivelFinal: 'A1' }),
  ];

  test('muestra los contadores por estado y filtra la lista', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: cola }, 'GET /api/socios/.*': { body: [] } });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('tab', { name: /Derivadas/ }));

    // Assert
    expect(screen.getByRole('tab', { name: 'Todas (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pendientes (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Revisadas (1)' })).toBeInTheDocument();
    expect(nombresEnCola()).toEqual(['Socio 3']);
  });

  test('un filtro sin resultados lo explica', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('tab', { name: /Derivadas/ }));

    // Assert
    expect(screen.getByText('No hay evaluaciones en este filtro.')).toBeInTheDocument();
  });

  test('ordenar por más reciente cambia el orden de la cola', async () => {
    // Arrange
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1, { iaSugerida: 'A1' }), evaluacion(3, { iaSugerida: 'A4' })] },
      'GET /api/socios/.*': { body: [] },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');
    expect(nombresEnCola()).toEqual(['Socio 1', 'Socio 3']); // por riesgo

    // Act
    await user.selectOptions(screen.getByLabelText(/Ordenar por/), 'reciente');

    // Assert
    expect(nombresEnCola()).toEqual(['Socio 3', 'Socio 1']);
  });
});

describe('alertas (R.124, R.125, R.139, R.140)', () => {
  const critica = evaluacion(1, {
    iaSugerida: 'A2', alerta: 'DERIVAR', alertaNivel: 'critica',
    factores: ['Síntoma declarado: Dolor de pecho al esforzarte'],
  });

  test('distingue las alertas críticas y muestra los factores usados', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [critica, evaluacion(2, { alerta: 'DERIVAR', alertaNivel: 'riesgo' })] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('ALERTA CRÍTICA')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Alerta' })).toHaveTextContent('Alerta CRÍTICA');
    expect(screen.getByText('Síntoma declarado: Dolor de pecho al esforzarte')).toBeInTheDocument();
  });

  test('marcar la alerta como revisada la guarda y baja el contador', async () => {
    // Arrange
    mockApi({
      'GET /api/evaluaciones': { body: [critica] },
      'GET /api/socios/.*': { body: [] },
      'POST /api/evaluaciones/uuid-1/alerta/revisar': { body: { status: 'success', evaluacion: { ...critica, alertaRevisada: true } } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');
    expect(screen.getByText('ALERTAS PENDIENTES').nextSibling).toHaveTextContent('1');

    // Act
    await user.click(screen.getByRole('button', { name: 'Marcar alerta como revisada' }));

    // Assert
    expect(await screen.findByText(/· revisada/)).toBeInTheDocument();
    expect(screen.getByText('ALERTAS PENDIENTES').nextSibling).toHaveTextContent('0');
    expect(screen.queryByText('ALERTA CRÍTICA')).not.toBeInTheDocument();
    expect(llamadas('POST', '/alerta/revisar')).toHaveLength(1);
    expect(llamadas('POST', '/alerta/revisar')[0][1].headers.Authorization).toBe('Bearer tok123');
  });

  test('si falla al revisar la alerta muestra el error y la deja pendiente', async () => {
    // Arrange
    mockApi({
      'GET /api/evaluaciones': { body: [critica] },
      'GET /api/socios/.*': { body: [] },
      'POST /api/evaluaciones/uuid-1/alerta/revisar': { status: 409, body: { detail: 'La evaluación no tiene alertas' } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: 'Marcar alerta como revisada' }));

    // Assert
    expect(await screen.findByText('La evaluación no tiene alertas')).toBeInTheDocument();
    expect(screen.getByText('ALERTAS PENDIENTES').nextSibling).toHaveTextContent('1');
  });
});

describe('decisión del encargado (R.105-107, R.129, R.133, R.134, R.137, R.138)', () => {
  test('confirmar guarda observaciones y cierra el caso con lo que responde el servidor', async () => {
    // Arrange
    const cerrada = evaluacion(1, {
      estado: 'validado', estadoRevision: 'revisada', nivelFinal: 'A3', observaciones: 'Todo bien', revisadoPor: 'ana@gym.cl',
    });
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1)] },
      'GET /api/socios/.*': { body: [] },
      'PUT /api/evaluaciones/uuid-1': { body: { status: 'success', evaluacion: cerrada } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.type(screen.getByLabelText(/Observaciones del encargado/), 'Todo bien');
    await user.click(screen.getByRole('button', { name: /Confirmar sugerencia IA/ }));

    // Assert
    expect(await screen.findByText(/Evaluación revisada por ana@gym.cl/)).toBeInTheDocument();
    expect(JSON.parse(llamadas('PUT', 'uuid-1')[0][1].body)).toEqual({
      nivel_final: 'A3', observaciones: 'Todo bien', derivar: false, motivo: null,
    });
    expect(screen.getByText('POR VALIDAR').nextSibling).toHaveTextContent('0');
  });

  test('derivar envía el motivo y deja el caso como derivado', async () => {
    // Arrange
    const derivada = evaluacion(1, {
      estado: 'validado', estadoRevision: 'derivada', nivelFinal: 'A1', motivoDerivacion: 'Mareos frecuentes',
    });
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1)] },
      'GET /api/socios/.*': { body: [] },
      'PUT /api/evaluaciones/uuid-1': { body: { status: 'success', evaluacion: derivada } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: 'Derivar a evaluación médica' }));
    await user.type(screen.getByLabelText(/Motivo de la derivación/), 'Mareos frecuentes');
    await user.click(screen.getByRole('button', { name: 'Confirmar derivación' }));

    // Assert
    expect(await screen.findByText(/Derivado a evaluación médica externa/)).toBeInTheDocument();
    expect(screen.getByText('DERIVADA')).toBeInTheDocument();
    expect(JSON.parse(llamadas('PUT', 'uuid-1')[0][1].body)).toMatchObject({ derivar: true, motivo: 'Mareos frecuentes' });
  });

  test('si el servidor rechaza la decisión el caso sigue pendiente y se muestra el error', async () => {
    // Arrange
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1)] },
      'GET /api/socios/.*': { body: [] },
      'PUT /api/evaluaciones/uuid-1': { status: 409, body: { detail: 'La evaluación ya fue revisada o derivada' } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: /Confirmar sugerencia IA/ }));

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('La evaluación ya fue revisada o derivada');
    expect(screen.getByText('POR VALIDAR').nextSibling).toHaveTextContent('1');
  });

  test('una sesión expirada al guardar avisa para volver a iniciar sesión', async () => {
    // Arrange
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1)] },
      'GET /api/socios/.*': { body: [] },
      'PUT /api/evaluaciones/uuid-1': { status: 401, body: { detail: 'Sesión inválida o expirada' } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: /Confirmar sugerencia IA/ }));

    // Assert
    expect(props.onSesionInvalida).toHaveBeenCalled();
  });
});

describe('historial y tendencia del socio (R.130, R.131)', () => {
  test('pide el historial del socio seleccionado y muestra cómo cambiaron las mediciones', async () => {
    // Arrange
    const actual = evaluacion(2, { id: '12.345.678-9', mediciones: { ...evaluacion(2).mediciones, peso: '78.5' } });
    const anterior = evaluacion(1, { id: '12.345.678-9', mediciones: { ...evaluacion(1).mediciones, peso: '80.0' } });
    mockApi({
      'GET /api/evaluaciones': { body: [actual] },
      'GET /api/socios/.*': { body: [actual, anterior] },
    });

    // Act
    render(<DashboardAptitud {...props} />);
    const peso = await screen.findByLabelText('Variación de Peso');

    // Assert
    expect(within(peso).getByText('▼ -1.5 (antes 80)')).toBeInTheDocument();
    expect(llamadas('GET', '/api/socios/12.345.678-9/evaluaciones')).toHaveLength(1);
  });

  test('un socio sin evaluaciones previas lo indica', async () => {
    // Arrange
    const actual = evaluacion(1);
    mockApi({ 'GET /api/evaluaciones': { body: [actual] }, 'GET /api/socios/.*': { body: [actual] } });

    // Act
    render(<DashboardAptitud {...props} />);

    // Assert
    expect(await screen.findByText('Primera evaluación registrada de este socio.')).toBeInTheDocument();
  });

  test('si el historial falla muestra un mensaje sin romper el panel', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { status: 500, body: {} } });

    // Act
    render(<DashboardAptitud {...props} />);

    // Assert
    expect(await screen.findByText('No se pudo cargar el historial del socio.')).toBeInTheDocument();
    expect(screen.getAllByText('Socio 1').length).toBeGreaterThan(0);
  });
});

describe('origen y duración de la evaluación (R.16, R.18, R.19)', () => {
  test('muestra el tótem, la sucursal y cuánto duró la evaluación', async () => {
    // Arrange
    const e = evaluacion(1, {
      totem: 'TOTEM-GIM-01', sucursal: 'Campus San Joaquín',
      inicioEvaluacion: '2026-10-01T10:00:00Z', finEvaluacion: '2026-10-01T10:04:00Z',
    });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);

    // Assert
    expect(await screen.findByText('Tótem TOTEM-GIM-01 · Campus San Joaquín · Duración: 4 min')).toBeInTheDocument();
  });

  test('si no hay datos de origen ni de tiempo no muestra esa línea', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.queryByText(/Duración:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tótem /)).not.toBeInTheDocument();
  });
});
