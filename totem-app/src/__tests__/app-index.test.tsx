import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import App from '../app/index';
import { crearSensores, crearSensoresSimulados, type OpcionesSimulador } from '../sensores';

jest.mock('@react-native-community/slider', () => 'Slider');
// Los sensores reales (Bluetooth) no existen todavía: las pruebas usan el simulador, sin latencia y con valores fijos.
jest.mock('../sensores', () => ({ ...jest.requireActual('../sensores'), crearSensores: jest.fn() }));

const usarSensores = (opciones: OpcionesSimulador = {}) => {
  const sensores = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5, ...opciones });
  (crearSensores as jest.Mock).mockReturnValue(sensores);
  return sensores;
};

const MATRICULA = '20231234A';
const CONSENTIMIENTO = /Autorizo el registro y uso de mis datos/;

type Ruta = { status?: number; body?: unknown };

// Enruta fetch por "METODO /ruta". Una ruta no declarada falla la prueba en lugar de responder en silencio.
const mockApi = (rutas: Record<string, Ruta>) => {
  global.fetch = jest.fn(async (url: unknown, init?: { method?: string }) => {
    const clave = `${init?.method ?? 'GET'} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`;
    const ruta = rutas[clave];
    if (!ruta) throw new Error(`Ruta sin mock: ${clave}`);
    const status = ruta.status ?? 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(ruta.body ?? {}) };
  }) as unknown as typeof fetch;
};

const llamadas = (clave: string) =>
  (global.fetch as jest.Mock).mock.calls.filter(
    ([url, init]) => `${init?.method ?? 'GET'} ${String(url).replace(/^https?:\/\/[^/]+/, '')}` === clave,
  );

const SOCIO = {
  nombre: 'Ana', apellido: 'Pérez Soto', fecha_nacimiento: '2002-03-15', telefono: '+56 9 1234 5678',
  plan_membresia: 'Plan Estudiante', edad: 24,
};
const NUEVO = { 'POST /api/socios/identificar': { body: { registrado: false, matricula: MATRICULA } } };
const registrado = (extra: object = {}) => ({
  'POST /api/socios/identificar': {
    body: {
      registrado: true, matricula: MATRICULA, socio: SOCIO,
      evaluacion_vigente: null, evaluaciones_previas: [], vigencia_horas: 24, ...extra,
    },
  },
});

let alerta: jest.SpyInstance;
beforeEach(() => {
  usarSensores();
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const buscar = async (matricula = MATRICULA) => {
  await fireEvent.changeText(screen.getByLabelText('Matrícula'), matricula);
  await fireEvent.press(screen.getByText('Buscar mi matrícula'));
};
type Datos = { nombre: string; apellido: string; fecha: string; telefono: string; plan: string };
const DATOS: Datos = { nombre: 'Ana', apellido: 'Pérez Soto', fecha: '15/03/2002', telefono: '+56 9 1234 5678', plan: 'Plan Estudiante' };
const llenarDatos = async (cambios: Partial<Datos> = {}) => {
  const d = { ...DATOS, ...cambios };
  await fireEvent.changeText(screen.getByLabelText('Nombre'), d.nombre);
  await fireEvent.changeText(screen.getByLabelText('Apellido'), d.apellido);
  await fireEvent.changeText(screen.getByLabelText('Fecha de nacimiento'), d.fecha);
  await fireEvent.changeText(screen.getByLabelText('Teléfono'), d.telefono);
  await fireEvent.changeText(screen.getByLabelText('Plan de membresía'), d.plan);
};
const botonDeAlerta = (titulo: string, texto: string): AlertButton => {
  const llamada = alerta.mock.calls.find(([t]) => t === titulo);
  return (llamada?.[2] as AlertButton[]).find((b) => b.text === texto) as AlertButton;
};

// Deja a un socio ya registrado en el paso 2 (mediciones).
const llegarAlPaso2 = async () => {
  await render(<App />);
  await buscar();
  await screen.findByText(/Hola, Ana/);
  await fireEvent.press(screen.getByText(CONSENTIMIENTO));
  await fireEvent.press(screen.getByText('Continuar →'));
  await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
};
const ETIQUETAS_SENSORES = ['Tensiómetro', 'Banda de pecho', 'Balanza', 'Prueba de esfuerzo'];
const medir = async (sensor: string) => fireEvent.press(screen.getByLabelText(new RegExp(`^(Medir|Volver a medir|Reintentar) ${sensor}$`)));
const medirTodo = async () => {
  for (const sensor of ETIQUETAS_SENSORES) await medir(sensor);
  await waitFor(() => expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(4));
};
const irAlPaso3 = async () => {
  await medirTodo();
  await fireEvent.press(screen.getByText('Continuar →'));
  await screen.findByText('PASO 3 - TU OBJETIVO');
};
const irAlUltimoPaso = async (dias = 3) => {
  await irAlPaso3(); // paso 3
  await fireEvent.press(screen.getByLabelText(`${dias} ${dias === 1 ? 'día' : 'días'} a la semana`));
  await fireEvent.press(screen.getByText('Continuar →')); // paso 4
  await fireEvent.press(screen.getByText('Continuar →')); // paso 5
};

describe('identificación por matrícula (R.1, R.2)', () => {
  test('el paso 1 pide la matrícula y aún no deja continuar', async () => {
    // Arrange / Act
    await render(<App />);

    // Assert
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
    expect(screen.queryByText('Continuar →')).toBeNull();
    expect(screen.queryByText('Cancelar evaluación')).toBeNull();
  });

  test('una matrícula con formato inválido muestra el error sin llamar al servidor', async () => {
    // Arrange
    global.fetch = jest.fn() as unknown as typeof fetch;
    await render(<App />);

    // Act
    await buscar('12');

    // Assert
    expect(await screen.findByText(/Matrícula inválida/)).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('la matrícula se envía normalizada', async () => {
    // Arrange
    mockApi(NUEVO);
    await render(<App />);

    // Act
    await buscar(' 2023-1234 a ');

    // Assert
    await screen.findByText('No encontramos tu matrícula');
    expect(JSON.parse(llamadas('POST /api/socios/identificar')[0][1].body)).toEqual({ matricula: MATRICULA });
  });

  test('si el servidor limita las consultas muestra su mensaje y permite reintentar', async () => {
    // Arrange
    mockApi({ 'POST /api/socios/identificar': { status: 429, body: { detail: 'Demasiadas consultas. Intenta en unos minutos.' } } });
    await render(<App />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('Demasiadas consultas. Intenta en unos minutos.')).toBeTruthy();
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
  });

  test('si no hay conexión muestra el error', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('sin red')) as unknown as typeof fetch;
    await render(<App />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('sin red')).toBeTruthy();
  });
});

describe('socio ya registrado (R.4, R.5, R.7)', () => {
  test('saluda y precarga sus datos', async () => {
    // Arrange
    mockApi(registrado());
    await render(<App />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('Hola, Ana')).toBeTruthy();
    expect(screen.getByLabelText('Nombre').props.value).toBe('Ana');
    expect(screen.getByLabelText('Apellido').props.value).toBe('Pérez Soto');
    expect(screen.getByLabelText('Fecha de nacimiento').props.value).toBe('15/03/2002');
    expect(screen.getByLabelText('Teléfono').props.value).toBe('+56 9 1234 5678');
    expect(screen.getByLabelText('Plan de membresía').props.value).toBe('Plan Estudiante');
  });

  test('avisa si ya tiene una evaluación vigente y lista las anteriores', async () => {
    // Arrange
    const fecha = new Date().toISOString();
    mockApi(registrado({
      evaluacion_vigente: { fecha, estado: 'revisada' },
      evaluaciones_previas: [{ fecha, estado: 'revisada' }, { fecha: '2026-09-01T10:00:00Z', estado: 'derivada' }],
    }));
    await render(<App />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText(/Ya completaste una evaluación/)).toBeTruthy();
    expect(screen.getByText(/Es válida por 24 horas/, { exact: false })).toBeTruthy();
    expect(screen.getByText('Evaluaciones anteriores:')).toBeTruthy();
    expect(screen.getByText(/· derivada/)).toBeTruthy();
  });

  test('sin evaluación vigente no muestra el aviso de repetición', async () => {
    // Arrange
    mockApi(registrado());
    await render(<App />);

    // Act
    await buscar();

    // Assert
    await screen.findByText('Hola, Ana');
    expect(screen.queryByText(/Ya completaste una evaluación/)).toBeNull();
    expect(screen.queryByText('Evaluaciones anteriores:')).toBeNull();
  });

  test('si no cambió ningún dato no llama a actualizar', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();

    // Assert
    expect(llamadas('PUT /api/socios/20231234A')).toHaveLength(0);
  });

  test('si cambió un dato lo actualiza enviando solo ese campo', async () => {
    // Arrange
    mockApi({ ...registrado(), 'PUT /api/socios/20231234A': { body: { status: 'success', cambios: ['plan_membresia'] } } });
    await render(<App />);
    await buscar();
    await screen.findByText('Hola, Ana');
    await fireEvent.changeText(screen.getByLabelText('Plan de membresía'), 'Plan Premium');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('PUT /api/socios/20231234A')[0][1].body)).toEqual({ plan_membresia: 'Plan Premium' });
  });

  test('si falla la actualización avisa y no avanza', async () => {
    // Arrange
    mockApi({ ...registrado(), 'PUT /api/socios/20231234A': { status: 404, body: { detail: 'Socio no encontrado' } } });
    await render(<App />);
    await buscar();
    await screen.findByText('Hola, Ana');
    await fireEvent.changeText(screen.getByLabelText('Teléfono'), '987654321');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('No se pudieron actualizar tus datos', 'Socio no encontrado'));
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
  });

  test('un cambio de fecha de nacimiento se envía en formato ISO y un teléfono borrado, vacío', async () => {
    // Arrange
    mockApi({ ...registrado(), 'PUT /api/socios/20231234A': { body: { status: 'success', cambios: [] } } });
    await render(<App />);
    await buscar();
    await screen.findByText('Hola, Ana');
    await fireEvent.changeText(screen.getByLabelText('Fecha de nacimiento'), '10/01/2001');
    await fireEvent.changeText(screen.getByLabelText('Teléfono'), '');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('PUT /api/socios/20231234A')[0][1].body)).toEqual({ fecha_nacimiento: '2001-01-10', telefono: '' });
  });

  test('un socio antiguo sin fecha de nacimiento debe completarla antes de continuar', async () => {
    // Arrange
    mockApi(registrado({ socio: { ...SOCIO, fecha_nacimiento: null, edad: 33 } }));
    await render(<App />);
    await buscar();
    await screen.findByText('Hola, Ana');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Fecha de nacimiento inválida', expect.any(String));
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
  });

  test('"Usar otra matrícula" vuelve a la búsqueda', async () => {
    // Arrange
    mockApi(registrado());
    await render(<App />);
    await buscar();
    await screen.findByText('Hola, Ana');

    // Act
    await fireEvent.press(screen.getByText('Usar otra matrícula'));

    // Assert
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
    expect(screen.getByLabelText('Matrícula').props.value).toBe('');
  });
});

describe('socio nuevo (R.3) y posibles duplicados (R.11)', () => {
  const prepararNuevo = async (rutas: Record<string, Ruta> = {}) => {
    mockApi({ ...NUEVO, ...rutas });
    await render(<App />);
    await buscar();
    await screen.findByText('No encontramos tu matrícula');
  };

  test('muestra el formulario vacío para registrarse', async () => {
    // Arrange / Act
    await prepararNuevo();

    // Assert
    for (const etiqueta of ['Nombre', 'Apellido', 'Fecha de nacimiento', 'Teléfono', 'Plan de membresía']) {
      expect(screen.getByLabelText(etiqueta).props.value).toBe('');
    }
    expect(screen.getByText(CONSENTIMIENTO)).toBeTruthy();
  });

  test('no deja continuar sin aceptar el consentimiento', async () => {
    // Arrange
    await prepararNuevo();
    await llenarDatos();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Consentimiento requerido', expect.any(String));
    expect(llamadas('POST /api/socios')).toHaveLength(0);
  });

  test.each([
    ['sin nombre', { nombre: '' }, 'Datos incompletos'],
    ['sin apellido', { apellido: '' }, 'Datos incompletos'],
    ['sin plan de membresía', { plan: '' }, 'Datos incompletos'],
    ['con fecha mal escrita', { fecha: '2002-03-15' }, 'Fecha de nacimiento inválida'],
    ['con fecha inexistente', { fecha: '30/02/2002' }, 'Fecha de nacimiento inválida'],
    ['con fecha futura', { fecha: '01/01/2999' }, 'Fecha de nacimiento inválida'],
    ['con fecha de hace más de 120 años', { fecha: '01/01/1800' }, 'Fecha de nacimiento inválida'],
    ['con teléfono inválido', { telefono: 'abc' }, 'Teléfono inválido'],
  ])('no registra un socio %s', async (_nombre, cambios, titulo) => {
    // Arrange
    await prepararNuevo();
    await llenarDatos(cambios);
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith(titulo, expect.any(String));
    expect(llamadas('POST /api/socios')).toHaveLength(0);
  });

  test('registra al socio con la matrícula normalizada y la edad numérica, y pasa a las mediciones', async () => {
    // Arrange
    await prepararNuevo({ 'POST /api/socios': { status: 201, body: { status: 'success' } } });
    await llenarDatos({ nombre: '  Ana ', apellido: ' Pérez Soto  ' });
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('POST /api/socios')[0][1].body)).toEqual({
      matricula: MATRICULA, nombre: 'Ana', apellido: 'Pérez Soto', fecha_nacimiento: '2002-03-15',
      telefono: '+56 9 1234 5678', plan_membresia: 'Plan Estudiante', confirmar_duplicado: false,
    });
  });

  test('el teléfono en blanco no se envía', async () => {
    // Arrange
    await prepararNuevo({ 'POST /api/socios': { status: 201, body: { status: 'success' } } });
    await llenarDatos({ telefono: '   ' });
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('POST /api/socios')[0][1].body)).not.toHaveProperty('telefono');
  });

  test('ante un posible duplicado pide confirmar y reenvía si es otra persona', async () => {
    // Arrange
    const duplicado = { status: 409, body: { detail: { code: 'posible_duplicado', message: 'Ya existe un socio con ese nombre.', coincidencias: [] } } };
    await prepararNuevo({ 'POST /api/socios': duplicado });
    await llenarDatos();
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));
    await fireEvent.press(screen.getByText('Continuar →'));
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('¿Ya estás registrado?', expect.any(String), expect.any(Array)));
    mockApi({ 'POST /api/socios': { status: 201, body: { status: 'success' } } });

    // Act
    await botonDeAlerta('¿Ya estás registrado?', 'Soy otra persona').onPress?.();

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('POST /api/socios')[0][1].body).confirmar_duplicado).toBe(true);
  });

  test('si la matrícula ya estaba registrada vuelve a la búsqueda', async () => {
    // Arrange
    const existente = { status: 409, body: { detail: { code: 'matricula_registrada', message: 'Esa matrícula ya está registrada' } } };
    await prepararNuevo({ 'POST /api/socios': existente });
    await llenarDatos();
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('Matrícula ya registrada', expect.any(String)));
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
  });

  test('muestra el mensaje del servidor si el registro es rechazado', async () => {
    // Arrange
    await prepararNuevo({ 'POST /api/socios': { status: 422, body: { detail: [{ msg: 'Value error, Matrícula inválida' }] } } });
    await llenarDatos();
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('No se pudo registrar', 'Matrícula inválida'));
  });
});

describe('cancelar la evaluación (R.9)', () => {
  test('pide confirmación y, si se acepta, borra todo y vuelve al inicio', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    await fireEvent.press(screen.getByText('Cancelar evaluación'));
    await botonDeAlerta('¿Cancelar la evaluación?', 'Sí, cancelar').onPress?.();

    // Assert
    await screen.findByText('PASO 1 - IDENTIFICACIÓN');
    expect(screen.getByLabelText('Matrícula').props.value).toBe('');
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
    expect(llamadas('POST /api/evaluaciones')).toHaveLength(0);
  });

  test('si se elige seguir, la evaluación continúa donde estaba', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    await fireEvent.press(screen.getByText('Cancelar evaluación'));
    const seguir = botonDeAlerta('¿Cancelar la evaluación?', 'Seguir evaluándome');

    // Assert
    expect(seguir.style).toBe('cancel');
    expect(screen.getByText('PASO 2 - ESTACIÓN DE SENSORES')).toBeTruthy();
  });

  test('tras cancelar hay que volver a dar el consentimiento', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    await fireEvent.press(screen.getByText('Cancelar evaluación'));
    await botonDeAlerta('¿Cancelar la evaluación?', 'Sí, cancelar').onPress?.();
    await screen.findByText('PASO 1 - IDENTIFICACIÓN');

    // Act
    await buscar();
    await screen.findByText(/Hola, Ana/);
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Consentimiento requerido', expect.any(String));
  });
});

describe('envío de la evaluación', () => {
  const rutasEnvio = (evaluacion: Ruta) => ({ ...registrado(), 'POST /api/evaluaciones': evaluacion });

  test('envía consentimiento, matrícula, inicio y tótem con la clave del tótem', async () => {
    // Arrange
    process.env.EXPO_PUBLIC_TOTEM_KEY = 'clave-test';
    process.env.EXPO_PUBLIC_TOTEM_SERIAL = 'TOTEM-GIM-01';
    process.env.EXPO_PUBLIC_TOTEM_SUCURSAL = 'Campus San Joaquín';
    mockApi(rutasEnvio({ body: { status: 'success' } }));
    await llegarAlPaso2();
    await irAlUltimoPaso();

    // Act
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    const [, init] = llamadas('POST /api/evaluaciones')[0];
    const cuerpo = JSON.parse(init.body);
    expect(init.headers['X-Totem-Key']).toBe('clave-test');
    expect(cuerpo.consentimiento).toBe(true);
    expect(cuerpo.estudiante).toEqual({
      matricula: MATRICULA, nombre: 'Ana', apellido: 'Pérez Soto', fecha_nacimiento: '2002-03-15',
      telefono: '+56 9 1234 5678', plan_membresia: 'Plan Estudiante',
    });
    expect(cuerpo.entrenamiento).toMatchObject({ diasSemana: 3, objetivo: 'Fuerza', experiencia: 'Intermedio' });
    expect(cuerpo.mediciones.masaMuscular).toBe('35.0');
    expect(cuerpo.totem_serial).toBe('TOTEM-GIM-01');
    expect(cuerpo.totem_sucursal).toBe('Campus San Joaquín');
    expect(Number.isNaN(Date.parse(cuerpo.inicio))).toBe(false);
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('¡Éxito!', expect.any(String)));
  });

  test('tras un envío exitoso borra los datos y vuelve al inicio', async () => {
    // Arrange
    mockApi(rutasEnvio({ body: { status: 'success' } }));
    await llegarAlPaso2();
    await irAlUltimoPaso();

    // Act
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy());
    expect(screen.getByLabelText('Matrícula').props.value).toBe('');
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
  });

  test('muestra el error cuando el servidor rechaza la evaluación', async () => {
    // Arrange
    mockApi(rutasEnvio({ status: 400, body: { detail: 'Se requiere el consentimiento' } }));
    await llegarAlPaso2();
    await irAlUltimoPaso();

    // Act
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() =>
      expect(alerta).toHaveBeenCalledWith('Error del servidor', 'Código 400: Se requiere el consentimiento'));
  });

  test('muestra un error de conexión si falla la red al enviar', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    await irAlUltimoPaso();
    global.fetch = jest.fn().mockRejectedValue(new Error('sin red')) as unknown as typeof fetch;

    // Act
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('Error de conexión', 'sin red'));
  });
});

describe('campos del cuestionario y las mediciones del modelo', () => {
  test('el paso 2 muestra la masa muscular junto a peso, IMC y grasa', async () => {
    // Arrange / Act
    mockApi(registrado());
    await llegarAlPaso2();

    // Assert
    expect(screen.getByText('MASA MUSCULAR')).toBeTruthy();
    expect(screen.getByText('PESO')).toBeTruthy();
    expect(screen.getByText('GRASA')).toBeTruthy();
  });

  test('no deja pasar del paso 3 sin indicar los días por semana', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    await irAlPaso3();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Falta un dato', expect.any(String));
    expect(screen.getByText('PASO 3 - TU OBJETIVO')).toBeTruthy();
  });

  test('los días por semana elegidos se envían con la evaluación', async () => {
    // Arrange
    mockApi({ ...registrado(), 'POST /api/evaluaciones': { body: { status: 'success' } } });
    await llegarAlPaso2();
    await irAlUltimoPaso(5);

    // Act
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    expect(JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body).entrenamiento.diasSemana).toBe(5);
  });

  test('las lesiones previas se envían sin espacios sobrantes', async () => {
    // Arrange
    mockApi({ ...registrado(), 'POST /api/evaluaciones': { body: { status: 'success' } } });
    await llegarAlPaso2();
    await irAlPaso3();
    await fireEvent.press(screen.getByLabelText('3 días a la semana'));
    await fireEvent.press(screen.getByText('Continuar →')); // paso 4
    await fireEvent.changeText(screen.getByLabelText('Lesiones previas'), '  Esguince de tobillo en 2025 ');
    await fireEvent.press(screen.getByText('Continuar →')); // paso 5

    // Act
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    expect(JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body).salud.lesionesPrevias).toBe('Esguince de tobillo en 2025');
  });

  test('sin lesiones previas el campo no se envía', async () => {
    // Arrange
    mockApi({ ...registrado(), 'POST /api/evaluaciones': { body: { status: 'success' } } });
    await llegarAlPaso2();
    await irAlUltimoPaso();

    // Act
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    expect(JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body).salud).not.toHaveProperty('lesionesPrevias');
  });

  test('tras cancelar se borran los días y las lesiones', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    await irAlPaso3();
    await fireEvent.press(screen.getByLabelText('4 días a la semana'));
    await fireEvent.press(screen.getByText('Cancelar evaluación'));
    await botonDeAlerta('¿Cancelar la evaluación?', 'Sí, cancelar').onPress?.();
    await screen.findByText('PASO 1 - IDENTIFICACIÓN');

    // Act
    await buscar();
    await screen.findByText(/Hola, Ana/);
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));
    await fireEvent.press(screen.getByText('Continuar →'));
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    await irAlPaso3();
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Falta un dato', expect.any(String));
  });
});

describe('mediciones con sensores (R.52, R.55, R.62, R.63, R.64, R.65)', () => {
  const enviarEvaluacion = async () => {
    await irAlUltimoPaso();
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    return JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body);
  };
  const conEnvio = () => mockApi({ ...registrado(), 'POST /api/evaluaciones': { body: { status: 'success' } } });

  test('cada sensor muestra sus instrucciones antes de medir (R.63)', async () => {
    // Arrange / Act
    mockApi(registrado());
    await llegarAlPaso2();

    // Assert
    expect(screen.getByText(/coloca el brazalete a la altura del corazón/)).toBeTruthy();
    expect(screen.getByText(/Ajusta la banda sobre el pecho/)).toBeTruthy();
    expect(screen.getByText(/Súbete descalzo y quieto/)).toBeTruthy();
    expect(screen.getByText(/Realiza el ejercicio indicado/)).toBeTruthy();
  });

  test('al empezar no hay valores inventados: todo está sin medir', async () => {
    // Arrange / Act
    mockApi(registrado());
    await llegarAlPaso2();

    // Assert
    expect(screen.getAllByText('--', { exact: false }).length).toBeGreaterThanOrEqual(9);
    expect(screen.queryByText('✓ Medición terminada correctamente')).toBeNull();
  });

  test('una medición correcta muestra sus valores y avisa que terminó bien (R.64)', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    await medir('Tensiómetro');

    // Assert
    expect(await screen.findByText('✓ Medición terminada correctamente')).toBeTruthy();
    expect(screen.getByText(/115/)).toBeTruthy();    // sistólica con el simulador fijo
    expect(screen.getByLabelText('Volver a medir Tensiómetro')).toBeTruthy();
  });

  test('si faltan mediciones pregunta antes de continuar y nombra los sensores pendientes', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    await medir('Tensiómetro');
    await screen.findByText('✓ Medición terminada correctamente');

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    const [titulo, mensaje] = alerta.mock.calls.find(([t]) => t === 'Faltan mediciones') as [string, string];
    expect(titulo).toBe('Faltan mediciones');
    expect(mensaje).toContain('Banda de pecho, Balanza, Prueba de esfuerzo');
    expect(mensaje).not.toContain('Tensiómetro');
    expect(screen.getByText('PASO 2 - ESTACIÓN DE SENSORES')).toBeTruthy();
  });

  test('"Volver a medir" mantiene al usuario en el paso 2', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    await fireEvent.press(screen.getByText('Continuar →'));

    // Act
    const boton = botonDeAlerta('Faltan mediciones', 'Volver a medir');

    // Assert
    expect(boton.style).toBe('cancel');
    expect(screen.getByText('PASO 2 - ESTACIÓN DE SENSORES')).toBeTruthy();
  });

  test('"Continuar sin ellas" avanza y la evaluación se envía sin esos datos', async () => {
    // Arrange
    conEnvio();
    await llegarAlPaso2();
    await fireEvent.press(screen.getByText('Continuar →'));

    // Act
    await botonDeAlerta('Faltan mediciones', 'Continuar sin ellas').onPress?.();
    await screen.findByText('PASO 3 - TU OBJETIVO');
    await fireEvent.press(screen.getByLabelText('3 días a la semana'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    const cuerpo = JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body);
    expect(cuerpo.mediciones).toEqual({});
    expect(cuerpo.dispositivos).toEqual({});
    expect(cuerpo.errores_medicion).toEqual([]);
  });

  test('con todos los sensores medidos avanza sin preguntar', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    await irAlPaso3();

    // Assert
    expect(alerta).not.toHaveBeenCalledWith('Faltan mediciones', expect.anything(), expect.anything());
  });

  test('la evaluación incluye el dispositivo, su calibración y la hora de cada medición (R.58, R.59, R.60)', async () => {
    // Arrange
    usarSensores({ calibracion: { balanza: 'vencida', banda_pecho: 'desconocida' } });
    conEnvio();
    await llegarAlPaso2();

    // Act
    const cuerpo = await enviarEvaluacion();

    // Assert
    expect(Object.keys(cuerpo.dispositivos).sort()).toEqual(['balanza', 'banda_pecho', 'prueba_esfuerzo', 'tensiometro']);
    expect(cuerpo.dispositivos.balanza).toMatchObject({ id: 'SIM-BALANZA', calibracion: 'vencida' });
    expect(cuerpo.dispositivos.tensiometro.calibracion).toBe('vigente');
    expect(cuerpo.dispositivos.banda_pecho.calibracion).toBe('desconocida');
    for (const d of Object.values(cuerpo.dispositivos) as { capturado_en: string }[]) {
      expect(Number.isNaN(Date.parse(d.capturado_en))).toBe(false);
    }
    expect(cuerpo.mediciones).toMatchObject({ presionSys: 115, presionDia: 75, fcReposo: 80, peso: '85.0' });
  });

  test('una medición que falla muestra el motivo y se puede reintentar (R.55)', async () => {
    // Arrange
    usarSensores({ guion: { tensiometro: ['timeout', null] } });
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    await medir('Tensiómetro');

    // Assert
    expect(await screen.findByText(/No se pudo medir: El sensor no respondió a tiempo/)).toBeTruthy();
    expect(screen.queryByText('✓ Medición terminada correctamente')).toBeNull();
    await medir('Tensiómetro');                   // el botón ahora dice "Reintentar"
    expect(await screen.findByText('✓ Medición terminada correctamente')).toBeTruthy();
    expect(screen.queryByText(/No se pudo medir/)).toBeNull();
  });

  test('los errores durante la medición se envían con la evaluación (R.65)', async () => {
    // Arrange
    usarSensores({ guion: { tensiometro: ['movimiento', null], balanza: ['timeout', null] } });
    conEnvio();
    await llegarAlPaso2();
    await medir('Tensiómetro');
    await screen.findByText(/Se detectó movimiento/);
    await medir('Balanza');
    await screen.findByText(/El sensor no respondió a tiempo/);

    // Act
    const cuerpo = await enviarEvaluacion();

    // Assert
    expect(cuerpo.errores_medicion).toHaveLength(2);
    expect(cuerpo.errores_medicion[0]).toMatchObject({ sensor: 'tensiometro', codigo: 'movimiento', mensaje: 'Se detectó movimiento durante la medición' });
    expect(cuerpo.errores_medicion[1]).toMatchObject({ sensor: 'balanza', codigo: 'timeout' });
    expect(Number.isNaN(Date.parse(cuerpo.errores_medicion[0].ocurrido_en))).toBe(false);
  });

  test('una lectura físicamente imposible se rechaza, no se guarda y se pide repetir (R.53, R.62)', async () => {
    // Arrange
    usarSensores({ guion: { tensiometro: ['valor_invalido', null] } });
    conEnvio();
    await llegarAlPaso2();

    // Act
    await medir('Tensiómetro');

    // Assert
    expect(await screen.findByText(/Presión sistólica 999 mmHg está fuera de lo posible/)).toBeTruthy();
    expect(screen.queryByText('✓ Medición terminada correctamente')).toBeNull();
    const cuerpo = await enviarEvaluacion();   // al medir todo, el tensiómetro se repite y ahora entrega un valor válido
    expect(cuerpo.mediciones.presionSys).toBe(115);
    expect(cuerpo.errores_medicion).toHaveLength(1);
    expect(cuerpo.errores_medicion[0]).toMatchObject({ sensor: 'tensiometro', codigo: 'lectura_invalida' });
  });

  test('un sensor desconectado se detecta al entrar y se puede reconectar (R.52)', async () => {
    // Arrange
    const sensores = usarSensores({ desconectados: ['banda_pecho'] });
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    const aviso = await screen.findByText(/Sensor desconectado\. Revisa que esté encendido/);
    (sensores.banda_pecho as unknown as { conectar: () => void }).conectar();
    await fireEvent.press(screen.getByText('Reintentar conexión'));

    // Assert
    expect(aviso).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Sensor desconectado/)).toBeNull());
    expect(screen.getByLabelText('Medir Banda de pecho')).toBeTruthy();
  });

  test('si el sensor sigue desconectado al reintentar, el aviso se mantiene', async () => {
    // Arrange
    usarSensores({ desconectados: ['balanza'] });
    mockApi(registrado());
    await llegarAlPaso2();
    await screen.findByText(/Sensor desconectado/);

    // Act
    await fireEvent.press(screen.getByText('Reintentar conexión'));

    // Assert
    expect(await screen.findByText(/Sensor desconectado/)).toBeTruthy();
  });

  test('un sensor que se desconecta durante la medición queda registrado como error', async () => {
    // Arrange
    const sensores = usarSensores();
    conEnvio();
    await llegarAlPaso2();
    (sensores.tensiometro as unknown as { desconectar: () => void }).desconectar();

    // Act
    await medir('Tensiómetro');

    // Assert
    expect(await screen.findByText(/Sensor desconectado/)).toBeTruthy();
    expect(screen.getByText('Reintentar conexión')).toBeTruthy();
  });

  test('al cancelar la evaluación se borran las mediciones y los errores', async () => {
    // Arrange
    usarSensores({ guion: { tensiometro: ['timeout', null] } });
    mockApi(registrado());
    await llegarAlPaso2();
    await medir('Tensiómetro');
    await screen.findByText(/No se pudo medir/);
    await medir('Balanza');
    await screen.findByText('✓ Medición terminada correctamente');
    await fireEvent.press(screen.getByText('Cancelar evaluación'));
    await botonDeAlerta('¿Cancelar la evaluación?', 'Sí, cancelar').onPress?.();
    await screen.findByText('PASO 1 - IDENTIFICACIÓN');

    // Act
    await buscar();
    await screen.findByText(/Hola, Ana/);
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));
    await fireEvent.press(screen.getByText('Continuar →'));
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');

    // Assert
    expect(screen.queryByText('✓ Medición terminada correctamente')).toBeNull();
    expect(screen.queryByText(/No se pudo medir/)).toBeNull();
  });
});
