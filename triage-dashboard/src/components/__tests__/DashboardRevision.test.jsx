import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardAptitud from '../DashboardAptitud';

const sesion = { token: 'tok123', rol: 'encargado', usuario: 'ana' };

const evaluacion = (n, extra = {}) => ({
  idBaseDatos: `uuid-${n}`, idUnico: `db_${n}`, id: `rut-${n}`, nombre: `Socio ${n}`, carrera: 'Plan', edad: '30',
  objetivo: 'Fuerza', iaSugerida: 'A3', alerta: null, alertaNivel: null, alertaRevisada: false, factores: [],
  estado: 'pendiente', estadoRevision: 'pendiente', nivelFinal: null, observaciones: null, motivoDerivacion: null,
  revisadoPor: null, tiempoEspera: 'Registrado', fecha: `2026-10-0${n}T10:00:00`,
  apellido: 'Pérez', fechaNacimiento: '2002-03-15', telefono: '+56 9 1234 5678', planMembresia: 'Plan Estudiante',
  entrenamiento: { objetivo: 'Fuerza', experiencia: 'Intermedio', diasSemana: 3, duracion: 60 },
  mediciones: {
    presionSys: 118, presionDia: 78, fcReposo: 70, fcRecup: 100, peso: '70.0', imc: '24.0', grasa: '20.0', vo2Max: '40.0',
    masaMuscular: '30.5', estatura: '172.0', capturadoEn: '2026-10-01T10:00:00', validado: false,
  },
  salud: { sintomas: [], condiciones: [], lesionesPrevias: null, antecedentesCronicos: false },
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

describe('campos del modelo de datos', () => {
  test('muestra los datos del socio: matrícula, edad, plan, fecha de nacimiento y teléfono', async () => {
    // Arrange
    const e = evaluacion(1, { id: '20231234A', edad: '24' });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);

    // Assert
    expect(await screen.findByText('20231234A · 24 años · Plan Estudiante')).toBeInTheDocument();
    expect(screen.getByText('Nacimiento: 15/03/2002 · Tel. +56 9 1234 5678')).toBeInTheDocument();
  });

  test('la lista muestra el plan de membresía junto al objetivo', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('Fuerza · Plan Estudiante')).toBeInTheDocument();
  });

  test('muestra peso y masa muscular además del resto de las mediciones', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    for (const [etiqueta, valor] of [['PESO', '70.0'], ['ESTATURA', '172.0'], ['MASA MUSCULAR', '30.5'], ['GRASA', '20.0'], ['IMC', '24.0'], ['VO₂ MÁX', '40.0']]) {
      expect(screen.getByText(etiqueta).nextSibling).toHaveTextContent(valor);
    }
  });

  test('las mediciones faltantes se muestran como guiones', async () => {
    // Arrange
    const sinDatos = evaluacion(1, { mediciones: { presionSys: 118, presionDia: 78 } });
    mockApi({ 'GET /api/evaluaciones': { body: [sinDatos] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('MASA MUSCULAR').nextSibling).toHaveTextContent('--');
    expect(screen.getByText('PESO').nextSibling).toHaveTextContent('--');
  });

  test('la estatura se muestra en centímetros junto al peso y el IMC', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    const tarjeta = screen.getByText('ESTATURA').parentElement;
    expect(tarjeta).toHaveTextContent('172.0');
    expect(tarjeta).toHaveTextContent('cm');
  });

  test('una evaluación sin estatura (versión anterior de la app) la muestra como guiones', async () => {
    // Arrange
    const sinEstatura = evaluacion(1, { mediciones: { ...evaluacion(1).mediciones, estatura: undefined } });
    mockApi({ 'GET /api/evaluaciones': { body: [sinEstatura] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('ESTATURA').nextSibling).toHaveTextContent('--');
  });

  test('una evaluación con estatura vacía (servidor sin ese dato) la muestra como guiones', async () => {
    // Arrange
    const vacia = evaluacion(1, { mediciones: { ...evaluacion(1).mediciones, estatura: '' } });
    mockApi({ 'GET /api/evaluaciones': { body: [vacia] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('ESTATURA').nextSibling).toHaveTextContent('--');
  });

  test('muestra los objetivos y las respuestas del cuestionario', async () => {
    // Arrange
    const e = evaluacion(1, { salud: { sintomas: [], condiciones: ['Asma'], lesionesPrevias: 'Esguince de tobillo', antecedentesCronicos: true } });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    const valorDe = (etiqueta) => screen.getByText(etiqueta).nextSibling.textContent;
    expect(valorDe('Objetivo principal')).toBe('Fuerza');
    expect(valorDe('Nivel de experiencia')).toBe('Intermedio');
    expect(valorDe('Días disponibles por semana')).toBe('3 días');
    expect(valorDe('Antecedentes crónicos')).toBe('Sí');
    expect(valorDe('Lesiones previas')).toBe('Esguince de tobillo');
  });

  test('sin lesiones ni días indicados lo dice', async () => {
    // Arrange
    const e = evaluacion(1, { entrenamiento: { objetivo: 'Cardio', experiencia: 'Principiante', diasSemana: null, duracion: 60 } });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('Días disponibles por semana').nextSibling).toHaveTextContent('Sin indicar');
    expect(screen.getByText('Lesiones previas').nextSibling).toHaveTextContent('Ninguna indicada');
    expect(screen.getByText('Antecedentes crónicos').nextSibling).toHaveTextContent('No');
  });
});

describe('validación de mediciones por el encargado', () => {
  test('muestra "sin validar" y permite validarlas', async () => {
    // Arrange
    const validada = evaluacion(1, { mediciones: { ...evaluacion(1).mediciones, validado: true } });
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1)] },
      'GET /api/socios/.*': { body: [] },
      'POST /api/evaluaciones/uuid-1/mediciones/validar': { body: { status: 'success', evaluacion: validada } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');
    expect(screen.getByText('SIN VALIDAR')).toBeInTheDocument();

    // Act
    await user.click(screen.getByRole('button', { name: 'Validar mediciones' }));

    // Assert
    expect(await screen.findByText('✓ MEDICIONES VALIDADAS')).toBeInTheDocument();
    expect(JSON.parse(llamadas('POST', '/mediciones/validar')[0][1].body)).toEqual({ validado: true });
    expect(llamadas('POST', '/mediciones/validar')[0][1].headers.Authorization).toBe('Bearer tok123');
    expect(screen.getByRole('button', { name: 'Retirar validación' })).toBeInTheDocument();
  });

  test('retirar la validación envía validado=false', async () => {
    // Arrange
    const ya = evaluacion(1, { mediciones: { ...evaluacion(1).mediciones, validado: true } });
    mockApi({
      'GET /api/evaluaciones': { body: [ya] },
      'GET /api/socios/.*': { body: [] },
      'POST /api/evaluaciones/uuid-1/mediciones/validar': { body: { status: 'success', evaluacion: evaluacion(1) } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: 'Retirar validación' }));

    // Assert
    expect(await screen.findByText('SIN VALIDAR')).toBeInTheDocument();
    expect(JSON.parse(llamadas('POST', '/mediciones/validar')[0][1].body)).toEqual({ validado: false });
  });

  test('si el servidor la rechaza muestra el error y no cambia el estado', async () => {
    // Arrange
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1)] },
      'GET /api/socios/.*': { body: [] },
      'POST /api/evaluaciones/uuid-1/mediciones/validar': { status: 409, body: { detail: 'La evaluación ya fue revisada o derivada' } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: 'Validar mediciones' }));

    // Assert
    expect(await screen.findByText('La evaluación ya fue revisada o derivada')).toBeInTheDocument();
    expect(screen.getByText('SIN VALIDAR')).toBeInTheDocument();
  });

  test('en un caso cerrado se ve el estado pero no se puede cambiar', async () => {
    // Arrange
    const cerrada = evaluacion(1, {
      estado: 'validado', estadoRevision: 'revisada', nivelFinal: 'A3',
      mediciones: { ...evaluacion(1).mediciones, validado: true },
    });
    mockApi({ 'GET /api/evaluaciones': { body: [cerrada] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('✓ MEDICIONES VALIDADAS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mediciones|validación/i })).not.toBeInTheDocument();
  });

  test('una sesión expirada al validar avisa para volver a iniciar sesión', async () => {
    // Arrange
    mockApi({
      'GET /api/evaluaciones': { body: [evaluacion(1)] },
      'GET /api/socios/.*': { body: [] },
      'POST /api/evaluaciones/uuid-1/mediciones/validar': { status: 401, body: { detail: 'Sesión inválida o expirada' } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: 'Validar mediciones' }));

    // Assert
    expect(props.onSesionInvalida).toHaveBeenCalled();
  });
});

describe('sugerencia de IA: confianza, revisión y reglas (R.97, R.100, R.101, R.102, R.115)', () => {
  const conIA = (extra = {}) => evaluacion(1, {
    iaSugerida: 'A2', confianza: 0.85, versionModelo: 'reglas-v2', intensidad: 'Baja intensidad y supervisión del encargado',
    requiereRevision: false, motivoRevision: null, reglasAplicadas: [], ...extra,
  });

  test('muestra la confianza real en lugar de un valor fijo', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conIA()] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByLabelText('Confianza de la sugerencia')).toHaveTextContent('85%');
    expect(screen.queryByText(/70%/)).not.toBeInTheDocument();
  });

  test('si el servidor no informa la confianza muestra N/D', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conIA({ confianza: null })] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByLabelText('Confianza de la sugerencia')).toHaveTextContent('N/D');
  });

  test('muestra el nombre de la categoría y la intensidad recomendada', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conIA()] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByRole('heading', { name: 'Apto con precaución' })).toBeInTheDocument();
    expect(screen.getByText('Intensidad recomendada: Baja intensidad y supervisión del encargado')).toBeInTheDocument();
  });

  test.each([
    ['A1', 'Requiere evaluación médica'], ['A3', 'Apto con intensidad moderada'], ['A4', 'Apto'],
  ])('la categoría %s se muestra como "%s"', async (categoria, nombre) => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conIA({ iaSugerida: categoria })] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByRole('heading', { name: nombre })).toBeInTheDocument();
  });

  test('una sugerencia de baja confianza pide la revisión del encargado con el motivo', async () => {
    // Arrange
    const e = conIA({
      confianza: 0.55, requiereRevision: true, alerta: 'REVISAR', alertaNivel: 'riesgo',
      motivoRevision: 'Confianza baja (55%): falta la presión arterial',
    });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    const aviso = screen.getByRole('note');
    expect(aviso).toHaveTextContent('Requiere tu revisión');
    expect(aviso).toHaveTextContent('Confianza baja (55%): falta la presión arterial');
    expect(screen.getByText('REVISAR')).toBeInTheDocument();
  });

  test('con confianza suficiente no aparece el aviso de revisión', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conIA()] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  test('lista las reglas aplicadas con su severidad y valor, y la versión del modelo', async () => {
    // Arrange
    const e = conIA({
      reglasAplicadas: [
        { id: 'PRESION_SISTOLICA_FUERA_DE_RANGO', descripcion: 'Presión sistólica 135 mmHg: fuera del rango normal', severidad: 'precaucion', valor: 135 },
        { id: 'CONDICION_DECLARADA', descripcion: 'Condición declarada: Asma', severidad: 'leve', valor: null },
      ],
    });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('Reglas aplicadas (2)')).toBeInTheDocument();
    expect(screen.getByText(/PRESION_SISTOLICA_FUERA_DE_RANGO/).closest('li')).toHaveTextContent('Precaución · valor 135');
    expect(screen.getByText(/CONDICION_DECLARADA/).closest('li')).toHaveTextContent('Leve');
    expect(screen.getByText(/Versión: reglas-v2/)).toBeInTheDocument();
  });

  test('sin reglas aplicadas no muestra el desplegable', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conIA()] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.queryByText(/Reglas aplicadas/)).not.toBeInTheDocument();
  });
});

describe('comparación entre la IA y el encargado (R.110)', () => {
  const cerrada = (n, ia, final, decision) => evaluacion(n, {
    iaSugerida: ia, nivelFinal: final, estado: 'validado', estadoRevision: final === 'A1' && decision === 'derivada' ? 'derivada' : 'revisada',
    decisionPersonal: decision, confianza: 0.9,
  });

  test('el KPI muestra el porcentaje de coincidencia en los casos cerrados', async () => {
    // Arrange
    const cola = [cerrada(1, 'A2', 'A2', 'confirmada'), cerrada(2, 'A3', 'A3', 'confirmada'), cerrada(3, 'A3', 'A1', 'modificada'), evaluacion(4)];
    mockApi({ 'GET /api/evaluaciones': { body: cola }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    const kpi = screen.getByText('COINCIDENCIA IA').parentElement;
    expect(kpi).toHaveTextContent('67%');
    expect(kpi).toHaveTextContent('2 de 3 casos cerrados');
  });

  test('sin casos cerrados el KPI muestra guiones', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('COINCIDENCIA IA').parentElement).toHaveTextContent('--');
  });

  test('un caso cerrado explica qué sugirió la IA y qué decidió el encargado', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [cerrada(1, 'A2', 'A1', 'modificada')] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    const texto = screen.getByTestId('comparacion-ia');
    expect(texto).toHaveTextContent('la IA sugirió A2 (Apto con precaución)');
    expect(texto).toHaveTextContent('el encargado dejó A1 (Requiere evaluación médica)');
    expect(texto).toHaveTextContent('difieren');
  });

  test('cuando coinciden lo indica', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [cerrada(1, 'A3', 'A3', 'confirmada')] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByTestId('comparacion-ia')).toHaveTextContent('coinciden');
  });

  test('un caso abierto no muestra comparación', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.queryByTestId('comparacion-ia')).not.toBeInTheDocument();
  });

  test('al cerrar un caso la comparación aparece con la respuesta del servidor', async () => {
    // Arrange
    const abierta = evaluacion(1, { iaSugerida: 'A3' });
    mockApi({
      'GET /api/evaluaciones': { body: [abierta] },
      'GET /api/socios/.*': { body: [] },
      'PUT /api/evaluaciones/uuid-1': { body: { status: 'success', evaluacion: cerrada(1, 'A3', 'A2', 'modificada') } },
    });
    const user = userEvent.setup();
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Act
    await user.click(screen.getByRole('button', { name: /A2/ }));
    await user.click(screen.getByRole('button', { name: /Confirmar cambio y cerrar caso/ }));

    // Assert
    expect(await screen.findByTestId('comparacion-ia')).toHaveTextContent('la IA sugirió A3');
    expect(screen.getByText('COINCIDENCIA IA').parentElement).toHaveTextContent('0%');
  });
});

describe('dispositivos, calibración y errores de medición (R.58-R.60, R.65)', () => {
  const conSensores = (extra = {}) => evaluacion(1, {
    mediciones: {
      ...evaluacion(1).mediciones,
      dispositivos: {
        balanza: { id: 'SCALE-7', calibracion: 'vigente', capturado_en: new Date(2026, 9, 1, 10, 4).toISOString() },
        tensiometro: { id: 'BP-01', calibracion: 'vigente', capturado_en: new Date(2026, 9, 1, 10, 2).toISOString() },
      },
      errores: [],
      ...extra,
    },
  });

  test('lista los dispositivos que tomaron las mediciones, con su calibración y hora', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conSensores()] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    const items = within(screen.getByRole('list', { name: 'Dispositivos de medición' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Tensiómetro · BP-01 · calibración vigente · 10:02');
    expect(items[1]).toHaveTextContent('Balanza · SCALE-7 · calibración vigente · 10:04');
  });

  test('una calibración vencida se destaca y avisa que baja la confianza', async () => {
    // Arrange
    const e = conSensores({ dispositivos: { balanza: { id: 'SCALE-7', calibracion: 'vencida' } } });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('calibración vencida')).toHaveClass('text-red-600');
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText(/Hay dispositivos con la calibración vencida/)).toBeInTheDocument();
  });

  test('con calibración vigente no aparece el aviso', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conSensores()] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.queryByText(/Hay dispositivos con la calibración vencida/)).not.toBeInTheDocument();
  });

  test('lista los errores ocurridos durante la medición', async () => {
    // Arrange
    const e = conSensores({
      errores: [
        { sensor: 'tensiometro', codigo: 'movimiento', mensaje: 'Se detectó movimiento durante la medición', ocurrido_en: new Date(2026, 9, 1, 10, 1).toISOString() },
        { sensor: 'balanza', codigo: 'lectura_invalida', mensaje: 'Peso 999 kg está fuera de lo posible', ocurrido_en: null },
      ],
    });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('Errores durante la medición (2)')).toBeInTheDocument();
    expect(screen.getByText('Tensiómetro: Movimiento durante la medición — Se detectó movimiento durante la medición (10:01)')).toBeInTheDocument();
    expect(screen.getByText('Balanza: Lectura inválida — Peso 999 kg está fuera de lo posible')).toBeInTheDocument();
  });

  test('sin dispositivos ni errores no muestra esas secciones', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [evaluacion(1)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.queryByRole('list', { name: 'Dispositivos de medición' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Errores durante la medición/)).not.toBeInTheDocument();
  });
});

describe('saturación de oxígeno del oxímetro', () => {
  const conSpo2 = (spo2) => evaluacion(1, { mediciones: { ...evaluacion(1).mediciones, spo2 } });

  test('muestra la SpO₂ medida', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conSpo2(97)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('SpO₂').nextSibling).toHaveTextContent('97');
    expect(screen.getByText('SpO₂').nextSibling).toHaveClass('text-slate-800');
  });

  test.each([[94], [90], [85]])('una SpO₂ de %p se destaca en rojo', async (spo2) => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conSpo2(spo2)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('SpO₂').nextSibling).toHaveClass('text-red-600');
  });

  test('una SpO₂ de 95 % es normal', async () => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conSpo2(95)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('SpO₂').nextSibling).toHaveClass('text-slate-800');
  });

  test.each([[null], [undefined]])('sin SpO₂ (%p) muestra guiones', async (spo2) => {
    // Arrange
    mockApi({ 'GET /api/evaluaciones': { body: [conSpo2(spo2)] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    expect(screen.getByText('SpO₂').nextSibling).toHaveTextContent('--');
  });

  test('lista el oxímetro y su medición de recuperación entre los dispositivos', async () => {
    // Arrange
    const e = evaluacion(1, {
      mediciones: {
        ...evaluacion(1).mediciones,
        dispositivos: {
          oximetro_recuperacion: { id: 'OXI-1', calibracion: 'desconocida' },
          oximetro: { id: 'OXI-1', calibracion: 'desconocida' },
        },
      },
    });
    mockApi({ 'GET /api/evaluaciones': { body: [e] }, 'GET /api/socios/.*': { body: [] } });

    // Act
    render(<DashboardAptitud {...props} />);
    await screen.findAllByText('Socio 1');

    // Assert
    const items = within(screen.getByRole('list', { name: 'Dispositivos de medición' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Oxímetro · OXI-1 · calibración sin informar');
    expect(items[1]).toHaveTextContent('Oxímetro (FC de recuperación) · OXI-1');
  });
});
