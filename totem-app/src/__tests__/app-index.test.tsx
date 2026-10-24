import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import App from '../app/index';
import {
  crearSensores, crearSensoresSimulados, SensorEscalon, SensorOximetroPuente, type OpcionesSimulador, type Sensor,
} from '../sensores';

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
type RutaOFuncion = Ruta | (() => Ruta);

// Enruta fetch por "METODO /ruta". Una ruta no declarada falla la prueba en lugar de responder en silencio.
const mockApi = (rutas: Record<string, RutaOFuncion>) => {
  global.fetch = jest.fn(async (url: unknown, init?: { method?: string }) => {
    const clave = `${init?.method ?? 'GET'} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`;
    const definida = rutas[clave];
    if (!definida) throw new Error(`Ruta sin mock: ${clave}`);
    const ruta = typeof definida === 'function' ? definida() : definida;
    const status = ruta.status ?? 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(ruta.body ?? {}), json: async () => ruta.body ?? {} };
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
const DATOS: Datos = { nombre: 'Ana', apellido: 'Pérez Soto', fecha: '15/03/2002', telefono: '+56 9 1234 5678', plan: 'Estudiante' };
const llenarDatos = async (cambios: Partial<Datos> = {}) => {
  const d = { ...DATOS, ...cambios };
  await fireEvent.changeText(screen.getByLabelText('Nombre'), d.nombre);
  await fireEvent.changeText(screen.getByLabelText('Apellido'), d.apellido);
  await fireEvent.changeText(screen.getByLabelText('Fecha de nacimiento'), d.fecha);
  await fireEvent.changeText(screen.getByLabelText('Teléfono'), d.telefono);
  if (d.plan) await fireEvent.press(screen.getByLabelText(`Plan de membresía: ${d.plan}`));   // el plan se elige de una lista
};
const botonDeAlerta = (titulo: string, texto: string): AlertButton => {
  const llamada = alerta.mock.calls.find(([t]) => t === titulo);
  return (llamada?.[2] as AlertButton[]).find((b) => b.text === texto) as AlertButton;
};

// La estatura es el primer dato del paso 2: hasta que se escribe, el resto de las mediciones está bloqueado.
const ESTATURA_POR_DEFECTO = '172';
const ponerEstatura = async (texto: string = ESTATURA_POR_DEFECTO) => {
  await fireEvent.changeText(screen.getByLabelText('Estatura manual'), texto);
  await fireEvent.press(screen.getByLabelText('Guardar estatura'));
};

// Un socio ya registrado con los datos completos entra directo al paso 2 (mediciones), donde se pide el consentimiento.
const aceptarConsentimiento = async () => fireEvent.press(screen.getByText(CONSENTIMIENTO));
// Con «← Atrás» desde el paso 2 se vuelve al formulario, con los datos de la matrícula ya cargados.
const volverAlFormulario = async () => {
  await fireEvent.press(screen.getByText('← Atrás'));
  await screen.findByText('PASO 1 - IDENTIFICACIÓN');
};

// Deja a un socio ya registrado en el paso 2 (mediciones), con el consentimiento aceptado y la estatura ya escrita;
// `{ estatura: null }` deja la estatura sin escribir.
const llegarAlPaso2 = async ({ estatura = ESTATURA_POR_DEFECTO as string | null } = {}) => {
  await render(<App inicio="evaluacion" />);
  await buscar();
  await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
  await aceptarConsentimiento();
  if (estatura !== null) await ponerEstatura(estatura);
};
const ETIQUETAS_SENSORES = ['Tensiómetro', 'Oxímetro', 'Balanza', 'Prueba de esfuerzo', 'Oxímetro (FC de recuperación)'];
const escapar = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const medir = async (sensor: string) => fireEvent.press(screen.getByLabelText(new RegExp(`^(Medir|Volver a medir|Reintentar) ${escapar(sensor)}$`)));
const medirTodo = async () => {
  for (const sensor of ETIQUETAS_SENSORES) await medir(sensor);
  await waitFor(() => expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(5));
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

describe('pantalla de bienvenida (modo kiosco)', () => {
  test('la app arranca en la bienvenida y "Comenzar" entra al wizard', async () => {
    // Arrange / Act: sin prop arranca en la bienvenida
    await render(<App />);

    // Assert: se ve la bienvenida y aún no el wizard
    expect(screen.getByText('Consejos de salud')).toBeTruthy();
    expect(screen.getByText('Horario del gimnasio')).toBeTruthy();
    expect(screen.queryByText('PASO 1 - IDENTIFICACIÓN')).toBeNull();

    // Al comenzar entra al paso 1
    await fireEvent.press(screen.getByLabelText('Comenzar evaluación'));
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
  });
});

describe('identificación por matrícula (R.1, R.2)', () => {
  test('el paso 1 pide la matrícula y aún no deja continuar', async () => {
    // Arrange / Act
    await render(<App inicio="evaluacion" />);

    // Assert
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
    expect(screen.queryByText('Continuar →')).toBeNull();
    expect(screen.queryByText('Cancelar evaluación')).toBeNull();
  });

  test('una matrícula con formato inválido muestra el error sin llamar al servidor', async () => {
    // Arrange
    global.fetch = jest.fn() as unknown as typeof fetch;
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar('ab$12');

    // Assert
    expect(await screen.findByText(/Matrícula inválida/)).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('la matrícula se envía normalizada', async () => {
    // Arrange
    mockApi(NUEVO);
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar(' 2023-1234 a ');

    // Assert
    await screen.findByText('No encontramos tu matrícula');
    expect(JSON.parse(llamadas('POST /api/socios/identificar')[0][1].body)).toEqual({ matricula: MATRICULA });
  });

  test('si el servidor limita las consultas muestra su mensaje y permite reintentar', async () => {
    // Arrange
    mockApi({ 'POST /api/socios/identificar': { status: 429, body: { detail: 'Demasiadas consultas. Intenta en unos minutos.' } } });
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('Demasiadas consultas. Intenta en unos minutos.')).toBeTruthy();
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
  });

  test('si no hay conexión muestra el error', async () => {
    // Arrange
    global.fetch = jest.fn().mockRejectedValue(new Error('sin red')) as unknown as typeof fetch;
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('sin red')).toBeTruthy();
  });
});

describe('socio ya registrado (R.4, R.5, R.7): pasa directo a las mediciones', () => {
  const entrar = async (extra: object = {}, rutas: Record<string, RutaOFuncion> = {}) => {
    mockApi({ ...registrado(extra), ...rutas });
    await render(<App inicio="evaluacion" />);
    await buscar();
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
  };

  test('con una matrícula existente pasa directo a las mediciones, sin mostrar el formulario', async () => {
    // Arrange / Act
    await entrar();

    // Assert
    expect(screen.queryByLabelText('Nombre')).toBeNull();
    expect(screen.queryByLabelText('Fecha de nacimiento')).toBeNull();
    expect(screen.queryByText('Buscar mi matrícula')).toBeNull();
    expect(screen.getByText('Tus mediciones de hoy')).toBeTruthy();
  });

  test('saluda por su nombre en el paso de mediciones', async () => {
    // Arrange / Act
    await entrar();

    // Assert
    expect(screen.getByText('Hola, Ana')).toBeTruthy();
  });

  test('los datos asociados a la matrícula quedan cargados en el formulario', async () => {
    // Arrange
    await entrar();

    // Act
    await volverAlFormulario();

    // Assert
    expect(screen.getByLabelText('Matrícula').props.value).toBe(MATRICULA);
    expect(screen.getByLabelText('Nombre').props.value).toBe('Ana');
    expect(screen.getByLabelText('Apellido').props.value).toBe('Pérez Soto');
    expect(screen.getByLabelText('Fecha de nacimiento').props.value).toBe('15/03/2002');
    expect(screen.getByLabelText('Teléfono').props.value).toBe('+56 9 1234 5678');
    // un plan anterior que no está en la lista se conserva como opción elegida
    expect(screen.getByLabelText('Plan de membresía: Plan Estudiante').props.accessibilityState.selected).toBe(true);
  });

  test('no llama a actualizar ni a registrar: solo identifica', async () => {
    // Arrange / Act
    await entrar();

    // Assert
    expect(llamadas('PUT /api/socios/20231234A')).toHaveLength(0);
    expect(llamadas('POST /api/socios')).toHaveLength(0);
    expect(llamadas('POST /api/socios/identificar')).toHaveLength(1);
  });

  test('avisa en las mediciones si ya tiene una evaluación vigente', async () => {
    // Arrange
    const fecha = new Date().toISOString();

    // Act
    await entrar({ evaluacion_vigente: { fecha, estado: 'revisada' }, evaluaciones_previas: [{ fecha, estado: 'revisada' }] });

    // Assert
    expect(screen.getByText(/Ya completaste una evaluación/)).toBeTruthy();
    expect(screen.getByText(/Es válida por 24 horas/, { exact: false })).toBeTruthy();
  });

  test('las evaluaciones anteriores se ven al volver al formulario', async () => {
    // Arrange
    const fecha = new Date().toISOString();
    await entrar({ evaluaciones_previas: [{ fecha, estado: 'revisada' }, { fecha: '2026-09-01T10:00:00Z', estado: 'derivada' }] });

    // Act
    await volverAlFormulario();

    // Assert
    expect(screen.getByText('Evaluaciones anteriores:')).toBeTruthy();
    expect(screen.getByText(/· derivada/)).toBeTruthy();
  });

  test('sin evaluación vigente no muestra el aviso de repetición', async () => {
    // Arrange / Act
    await entrar();

    // Assert
    expect(screen.queryByText(/Ya completaste una evaluación/)).toBeNull();
  });

  // --- consentimiento: ya no se acepta en el paso 1, así que se pide antes de tomar cualquier dato de salud

  test('antes de medir pide el consentimiento y no muestra los sensores', async () => {
    // Arrange / Act
    await entrar();

    // Assert
    expect(screen.getByText(CONSENTIMIENTO)).toBeTruthy();
    expect(screen.queryByLabelText('Estatura manual')).toBeNull();
    expect(screen.queryByLabelText('Medir Tensiómetro')).toBeNull();
  });

  test('al aceptar el consentimiento aparecen la estatura y los sensores', async () => {
    // Arrange
    await entrar();

    // Act
    await aceptarConsentimiento();

    // Assert
    expect(screen.getByLabelText('Estatura manual')).toBeTruthy();
    expect(screen.getByLabelText('Medir Tensiómetro')).toBeTruthy();
  });

  test('sin consentimiento no deja continuar', async () => {
    // Arrange
    await entrar();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Consentimiento requerido', expect.any(String));
    expect(screen.getByText('PASO 2 - ESTACIÓN DE SENSORES')).toBeTruthy();
  });

  test('el consentimiento aceptado viaja en la evaluación', async () => {
    // Arrange
    mockApi({ ...registrado(), 'POST /api/evaluaciones': { body: { status: 'success' } } });
    await llegarAlPaso2();

    // Act
    await irAlUltimoPaso();
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    const cuerpo = JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body);
    expect(cuerpo.consentimiento).toBe(true);
    expect(cuerpo.estudiante).toMatchObject({ matricula: MATRICULA, nombre: 'Ana', apellido: 'Pérez Soto', fecha_nacimiento: '2002-03-15' });
  });

  // --- actualizar datos desactualizados (R.5): ahora con «Atrás»

  test('si no cambió ningún dato no llama a actualizar', async () => {
    // Arrange / Act
    await llegarAlPaso2();

    // Assert
    expect(llamadas('PUT /api/socios/20231234A')).toHaveLength(0);
  });

  test('si cambió un dato lo actualiza enviando solo ese campo', async () => {
    // Arrange
    await entrar({}, { 'PUT /api/socios/20231234A': { body: { status: 'success', cambios: ['plan_membresia'] } } });
    await volverAlFormulario();
    await fireEvent.press(screen.getByLabelText('Plan de membresía: Profesor'));
    await aceptarConsentimiento();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('PUT /api/socios/20231234A')[0][1].body)).toEqual({ plan_membresia: 'Profesor' });
  });

  test('si falla la actualización avisa y no avanza', async () => {
    // Arrange
    await entrar({}, { 'PUT /api/socios/20231234A': { status: 404, body: { detail: 'Socio no encontrado' } } });
    await volverAlFormulario();
    await fireEvent.changeText(screen.getByLabelText('Teléfono'), '987654321');
    await aceptarConsentimiento();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('No se pudieron actualizar tus datos', 'Socio no encontrado'));
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
  });

  test('un cambio de fecha de nacimiento se envía en formato ISO y un teléfono borrado, vacío', async () => {
    // Arrange
    await entrar({}, { 'PUT /api/socios/20231234A': { body: { status: 'success', cambios: [] } } });
    await volverAlFormulario();
    await fireEvent.changeText(screen.getByLabelText('Fecha de nacimiento'), '10/01/2001');
    await fireEvent.changeText(screen.getByLabelText('Teléfono'), '');
    await aceptarConsentimiento();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('PUT /api/socios/20231234A')[0][1].body)).toEqual({ fecha_nacimiento: '2001-01-10', telefono: '' });
  });

  test('tras actualizar sus datos vuelve a las mediciones con el consentimiento ya aceptado', async () => {
    // Arrange
    await entrar({}, { 'PUT /api/socios/20231234A': { body: { status: 'success', cambios: ['telefono'] } } });
    await volverAlFormulario();
    await fireEvent.changeText(screen.getByLabelText('Teléfono'), '987654321');
    await aceptarConsentimiento();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(screen.queryByText(CONSENTIMIENTO)).toBeNull();
    expect(screen.getByLabelText('Estatura manual')).toBeTruthy();
  });

  // --- socios con datos incompletos: no se saltan el formulario

  test('un socio antiguo sin fecha de nacimiento se queda en el formulario para completarla', async () => {
    // Arrange
    mockApi(registrado({ socio: { ...SOCIO, fecha_nacimiento: null, edad: 33 } }));
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('Hola, Ana')).toBeTruthy();
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
    expect(screen.getByLabelText('Fecha de nacimiento').props.value).toBe('');
  });

  test('un socio antiguo sin fecha de nacimiento debe completarla antes de continuar', async () => {
    // Arrange
    mockApi(registrado({ socio: { ...SOCIO, fecha_nacimiento: null, edad: 33 } }));
    await render(<App inicio="evaluacion" />);
    await buscar();
    await screen.findByText('Hola, Ana');
    await aceptarConsentimiento();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Fecha de nacimiento inválida', expect.any(String));
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
  });

  test.each([
    ['sin plan', { plan_membresia: null }],
    ['sin apellido', { apellido: '' }],
    ['con un teléfono inválido guardado', { telefono: 'sin-numero' }],
  ])('un socio %s también se queda en el formulario', async (_caso, cambios) => {
    // Arrange
    mockApi(registrado({ socio: { ...SOCIO, ...cambios } }));
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('Hola, Ana')).toBeTruthy();
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
  });

  test('"Usar otra matrícula" vuelve a la búsqueda', async () => {
    // Arrange
    await entrar();
    await volverAlFormulario();

    // Act
    await fireEvent.press(screen.getByText('Usar otra matrícula'));

    // Assert
    expect(screen.getByText('Buscar mi matrícula')).toBeTruthy();
    expect(screen.getByLabelText('Matrícula').props.value).toBe('');
  });

  test('un socio nuevo sigue pasando por el formulario de registro', async () => {
    // Arrange
    mockApi(NUEVO);
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar();

    // Assert
    expect(await screen.findByText('No encontramos tu matrícula')).toBeTruthy();
    expect(screen.getByText('PASO 1 - IDENTIFICACIÓN')).toBeTruthy();
  });
});

describe('socio nuevo (R.3) y posibles duplicados (R.11)', () => {
  const prepararNuevo = async (rutas: Record<string, RutaOFuncion> = {}) => {
    mockApi({ ...NUEVO, ...rutas });
    await render(<App inicio="evaluacion" />);
    await buscar();
    await screen.findByText('No encontramos tu matrícula');
  };

  test('muestra el formulario vacío para registrarse', async () => {
    // Arrange / Act
    await prepararNuevo();

    // Assert
    for (const etiqueta of ['Nombre', 'Apellido', 'Fecha de nacimiento', 'Teléfono']) {
      expect(screen.getByLabelText(etiqueta).props.value).toBe('');
    }
    for (const plan of ['Estudiante', 'Encargado', 'Profesor']) {
      expect(screen.getByLabelText(`Plan de membresía: ${plan}`).props.accessibilityState.selected).toBe(false);
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
      telefono: '+56 9 1234 5678', plan_membresia: 'Estudiante', confirmar_duplicado: false,
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
    await ponerEstatura();   // tras cancelar la estatura también se borra: hay que volver a escribirla
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
    expect(screen.getByText(/Coloca el dedo índice limpio y seco/)).toBeTruthy();
    expect(screen.getByText(/Apenas termines el ejercicio, vuelve a colocar el dedo/)).toBeTruthy();
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
    expect(mensaje).toContain('Oxímetro, Balanza, Prueba de esfuerzo, Oxímetro (FC de recuperación)');
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
    expect(cuerpo.mediciones).toEqual({ estatura: '172.0' });   // sin sensores medidos, solo la estatura
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
    usarSensores({ calibracion: { balanza: 'vencida', oximetro: 'desconocida' } });
    conEnvio();
    await llegarAlPaso2();

    // Act
    const cuerpo = await enviarEvaluacion();

    // Assert
    expect(Object.keys(cuerpo.dispositivos).sort()).toEqual(['balanza', 'oximetro', 'oximetro_recuperacion', 'prueba_esfuerzo', 'tensiometro']);
    expect(cuerpo.dispositivos.balanza).toMatchObject({ id: 'SIM-BALANZA', calibracion: 'vencida' });
    expect(cuerpo.dispositivos.tensiometro.calibracion).toBe('vigente');
    expect(cuerpo.dispositivos.oximetro.calibracion).toBe('desconocida');
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
    const sensores = usarSensores({ desconectados: ['oximetro'] });
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    const aviso = await screen.findByText(/Sensor desconectado\. Revisa que esté encendido/);
    (sensores.oximetro as unknown as { conectar: () => void }).conectar();
    await fireEvent.press(screen.getByText('Reintentar conexión'));

    // Assert
    expect(aviso).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Sensor desconectado/)).toBeNull());
    expect(screen.getByLabelText('Medir Oxímetro')).toBeTruthy();
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

describe('oxímetro real a través del puente Bluetooth', () => {
  const MEDICION = (spo2: number, fc: number) => ({
    status: 200,
    body: { spo2, fc, indice_perfusion: 4.1, muestras: 5, capturado_en: new Date().toISOString(), dispositivo: { id: 'AA:BB:CC:DD:EE:FF', calibracion: 'desconocida' } },
  });

  const usarPuente = () => {
    const config = { url: 'http://puente:8765' };
    (crearSensores as jest.Mock).mockReturnValue({
      ...crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 }),
      oximetro: new SensorOximetroPuente('oximetro', config),
      oximetro_recuperacion: new SensorOximetroPuente('oximetro_recuperacion', config),
    });
  };

  const secuencia = (...respuestas: Ruta[]) => { let i = 0; return () => respuestas[Math.min(i++, respuestas.length - 1)]; };

  test('la medición en reposo muestra SpO₂ y FC y viaja con la evaluación, junto con el dispositivo', async () => {
    // Arrange
    usarPuente();
    mockApi({
      ...registrado(), 'GET /estado': { body: { conectado: true } },
      'POST /medir': secuencia(MEDICION(96, 74), MEDICION(98, 121)),
      'POST /api/evaluaciones': { body: { status: 'success' } },
    });
    await llegarAlPaso2();

    // Act
    await medir('Oxímetro');
    await medir('Oxímetro (FC de recuperación)');
    await waitFor(() => expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(2));
    for (const sensor of ['Tensiómetro', 'Balanza', 'Prueba de esfuerzo']) await medir(sensor);
    await waitFor(() => expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(5));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByLabelText('3 días a la semana'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    // Assert
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    const cuerpo = JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body);
    expect(cuerpo.mediciones).toMatchObject({ spo2: 96, fcReposo: 74, fcRecup: 121 });
    expect(cuerpo.dispositivos.oximetro).toMatchObject({ id: 'AA:BB:CC:DD:EE:FF', calibracion: 'desconocida' });
    expect(cuerpo.dispositivos.oximetro_recuperacion.id).toBe('AA:BB:CC:DD:EE:FF');
  });

  test('si no se detecta el dedo muestra el motivo, registra el error y permite repetir', async () => {
    // Arrange
    usarPuente();
    mockApi({
      ...registrado(), 'GET /estado': { body: { conectado: true } },
      'POST /medir': secuencia(
        { status: 422, body: { codigo: 'lectura_invalida', mensaje: 'No se detecta el dedo. Colócalo bien en el oxímetro.' } },
        MEDICION(97, 70)),
      'POST /api/evaluaciones': { body: { status: 'success' } },
    });
    await llegarAlPaso2();

    // Act
    await medir('Oxímetro');

    // Assert
    expect(await screen.findByText(/No se detecta el dedo\. Colócalo bien en el oxímetro/)).toBeTruthy();
    await medir('Oxímetro');
    await screen.findByText('✓ Medición terminada correctamente');
    const cuerpo = await (async () => {
      await medirTodo();
      await fireEvent.press(screen.getByText('Continuar →'));
      await fireEvent.press(screen.getByLabelText('3 días a la semana'));
      await fireEvent.press(screen.getByText('Continuar →'));
      await fireEvent.press(screen.getByText('Continuar →'));
      await fireEvent.press(screen.getByText('Registrar mi ingreso'));
      await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
      return JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body);
    })();
    expect(cuerpo.errores_medicion[0]).toMatchObject({ sensor: 'oximetro', codigo: 'lectura_invalida' });
  });

  test('si el puente no está disponible, las dos mediciones del oxímetro figuran como desconectadas', async () => {
    // Arrange
    usarPuente();
    mockApi({ ...registrado(), 'GET /estado': { body: { conectado: false } } });

    // Act
    await llegarAlPaso2();

    // Assert
    await waitFor(() => expect(screen.getAllByText(/Sensor desconectado/)).toHaveLength(2));
    expect(screen.getByLabelText('Medir Tensiómetro')).toBeTruthy();   // los demás sensores siguen disponibles
  });

  test('al conectar el oxímetro se puede reintentar la conexión', async () => {
    // Arrange
    usarPuente();
    mockApi({ ...registrado(), 'GET /estado': secuencia({ body: { conectado: false } }, { body: { conectado: false } }, { body: { conectado: true } }) });
    await llegarAlPaso2();
    await waitFor(() => expect(screen.getAllByText('Reintentar conexión')).toHaveLength(2));

    // Act
    await fireEvent.press(screen.getAllByText('Reintentar conexión')[0]);

    // Assert
    await waitFor(() => expect(screen.getByLabelText('Medir Oxímetro')).toBeTruthy());
    expect(screen.getAllByText(/Sensor desconectado/)).toHaveLength(1);   // la medición de recuperación sigue desconectada
  });

  test('si el puente se cae durante la medición se informa como sensor desconectado', async () => {
    // Arrange
    usarPuente();
    mockApi({ ...registrado(), 'GET /estado': { body: { conectado: true } }, 'POST /medir': { status: 503, body: { codigo: 'desconectado', mensaje: 'El oxímetro no está conectado. Enciéndelo y acércalo al tótem.' } } });
    await llegarAlPaso2();

    // Act
    await medir('Oxímetro');

    // Assert
    expect(await screen.findByText(/Sensor desconectado/)).toBeTruthy();
    expect(screen.getByText('Reintentar conexión')).toBeTruthy();
  });
});

describe('estatura primero: bloquea el resto de las mediciones hasta escribirla', () => {
  const conEnvio = () => mockApi({ ...registrado(), 'POST /api/evaluaciones': { body: { status: 'success' } } });

  // Una báscula real que solo entrega el peso (sin IMC, grasa ni masa muscular).
  const usarBasculaSoloPeso = () => {
    const sensores = usarSensores();
    const simulada = sensores.balanza;
    sensores.balanza = {
      tipo: 'balanza', disponible: simulada.disponible.bind(simulada),
      medir: async () => ({
        sensor: 'balanza', valores: { peso: '53.7' }, dispositivo: { id: 'E0:D3:8E:62:51:3D', calibracion: 'desconocida' },
        capturadoEn: new Date().toISOString(),
      }),
    } as Sensor;
  };

  const avanzarYEnviar = async () => {
    await screen.findByText('PASO 3 - TU OBJETIVO');
    await fireEvent.press(screen.getByLabelText('3 días a la semana'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    return JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body);
  };

  test('el paso 2 empieza pidiendo la estatura y el resto de los sensores está bloqueado', async () => {
    // Arrange / Act
    mockApi(registrado());
    await llegarAlPaso2({ estatura: null });

    // Assert
    expect(screen.getByLabelText('Estatura manual')).toBeTruthy();
    expect(screen.getAllByText('🔒 Primero ingresa tu estatura')).toHaveLength(ETIQUETAS_SENSORES.length);
    for (const sensor of ETIQUETAS_SENSORES) {
      expect(screen.getByLabelText(`Medir ${sensor}`).props.accessibilityState?.disabled).toBe(true);
    }
  });

  test('medir con la estatura sin escribir no hace nada', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2({ estatura: null });

    // Act
    await medir('Tensiómetro');

    // Assert
    expect(screen.queryByText('✓ Medición terminada correctamente')).toBeNull();
    expect(screen.queryByText('Midiendo…')).toBeNull();
  });

  test('al guardar la estatura se desbloquean todos los sensores', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2({ estatura: null });

    // Act
    await ponerEstatura('172');

    // Assert
    expect(screen.queryByText('🔒 Primero ingresa tu estatura')).toBeNull();
    for (const sensor of ETIQUETAS_SENSORES) {
      expect(screen.getByLabelText(`Medir ${sensor}`).props.accessibilityState?.disabled).toBe(false);
    }
    await medir('Tensiómetro');
    expect(await screen.findByText('✓ Medición terminada correctamente')).toBeTruthy();
  });

  test('una estatura inválida no desbloquea nada', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2({ estatura: null });

    // Act
    await ponerEstatura('1,72');

    // Assert
    expect(screen.getAllByText('🔒 Primero ingresa tu estatura')).toHaveLength(ETIQUETAS_SENSORES.length);
  });

  test('la estatura es lo primero que aparece en el paso de mediciones', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2({ estatura: null });

    // Act
    const orden = screen.toJSON() as unknown;
    const texto = JSON.stringify(orden);

    // Assert
    expect(texto.indexOf('Estatura e IMC')).toBeGreaterThan(-1);
    expect(texto.indexOf('Estatura e IMC')).toBeLessThan(texto.indexOf('Tensiómetro'));
  });

  test('cambiar la estatura vuelve a bloquear las demás mediciones hasta guardarla otra vez', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    expect(screen.queryByText('🔒 Primero ingresa tu estatura')).toBeNull();

    // Act
    await fireEvent.press(screen.getByLabelText('Cambiar estatura'));

    // Assert
    expect(screen.getAllByText('🔒 Primero ingresa tu estatura')).toHaveLength(ETIQUETAS_SENSORES.length);
  });

  test('las mediciones ya tomadas se conservan si se cambia la estatura', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();
    await medir('Tensiómetro');
    await screen.findByText('✓ Medición terminada correctamente');

    // Act
    await fireEvent.press(screen.getByLabelText('Cambiar estatura'));
    await ponerEstatura('175');

    // Assert
    expect(screen.getByText('✓ Medición terminada correctamente')).toBeTruthy();
  });

  test('si se sigue sin estatura, avisa que falta antes de continuar y envía sin ella', async () => {
    // Arrange
    conEnvio();
    await llegarAlPaso2({ estatura: null });

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    const [, mensaje] = alerta.mock.calls.find(([t]) => t === 'Faltan mediciones') as [string, string];
    expect(mensaje).toContain('Estatura (para el IMC)');
    await botonDeAlerta('Faltan mediciones', 'Continuar sin ellas').onPress?.();
    const cuerpo = await avanzarYEnviar();
    expect(cuerpo.mediciones).toEqual({});
    expect(cuerpo.mediciones).not.toHaveProperty('estatura');
  });

  test('la báscula solo con peso más la estatura envían el IMC calculado y la estatura', async () => {
    // Arrange
    usarBasculaSoloPeso();
    conEnvio();
    await llegarAlPaso2({ estatura: '172' });
    await medirTodo();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));
    const cuerpo = await avanzarYEnviar();

    // Assert: 53,7 kg / 1,72 m² = 18,2
    expect(cuerpo.mediciones).toMatchObject({ peso: '53.7', imc: '18.2', estatura: '172.0' });
    expect(alerta).not.toHaveBeenCalledWith('Faltan mediciones', expect.anything(), expect.anything());
  });

  test('el IMC calculado con la estatura reemplaza al que traiga un sensor', async () => {
    // Arrange: el simulador entrega peso 85,0 e IMC 25,3
    usarSensores();
    conEnvio();
    await llegarAlPaso2({ estatura: '180' });
    await medirTodo();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));
    const cuerpo = await avanzarYEnviar();

    // Assert: 85,0 / 1,80² = 26,2
    expect(cuerpo.mediciones).toMatchObject({ peso: '85.0', imc: '26.2', estatura: '180.0' });
  });

  test('una estatura con coma decimal viaja con punto', async () => {
    // Arrange
    usarBasculaSoloPeso();
    conEnvio();
    await llegarAlPaso2({ estatura: '172,5' });
    await medirTodo();

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));
    const cuerpo = await avanzarYEnviar();

    // Assert
    expect(cuerpo.mediciones.estatura).toBe('172.5');
  });

  test('si se cambia el peso después, el IMC se recalcula con la misma estatura', async () => {
    // Arrange
    usarBasculaSoloPeso();
    conEnvio();
    await llegarAlPaso2({ estatura: '172' });
    await medirTodo();
    expect(screen.getByText(/^18\.2 /)).toBeTruthy();

    // Act: otra medición de peso
    (crearSensores as jest.Mock).mock.results.at(-1)!.value.balanza.medir = async () => ({
      sensor: 'balanza', valores: { peso: '70.0' }, dispositivo: { id: 'E0:D3', calibracion: 'desconocida' }, capturadoEn: new Date().toISOString(),
    });
    await medir('Balanza');

    // Assert: 70,0 / 1,72² = 23,7
    expect(await screen.findByText(/^23\.7 /)).toBeTruthy();
  });
});

describe('campo de fecha de nacimiento (DD/MM/AAAA)', () => {
  const prepararNuevo = async (rutas: Record<string, RutaOFuncion> = {}) => {
    mockApi({ ...NUEVO, ...rutas });
    await render(<App inicio="evaluacion" />);
    await buscar();
    await screen.findByText('No encontramos tu matrícula');
  };
  const campo = () => screen.getByLabelText('Fecha de nacimiento');
  const escribir = async (texto: string) => fireEvent.changeText(campo(), texto);

  test('muestra el formato esperado, teclado numérico y largo máximo 10', async () => {
    // Arrange / Act
    await prepararNuevo();

    // Assert
    expect(campo().props.placeholder).toBe('DD/MM/AAAA');
    expect(campo().props.maxLength).toBe(10);
    expect(campo().props.keyboardType).toBe('number-pad');
  });

  test('al escribir solo números coloca las barras automáticamente', async () => {
    // Arrange
    await prepararNuevo();

    // Act / Assert
    await escribir('15');
    expect(campo().props.value).toBe('15');
    await escribir('150');
    expect(campo().props.value).toBe('15/0');
    await escribir('1503');
    expect(campo().props.value).toBe('15/03');
    await escribir('15032002');
    expect(campo().props.value).toBe('15/03/2002');
  });

  test('descarta letras y símbolos', async () => {
    // Arrange
    await prepararNuevo();

    // Act
    await escribir('1a5-0.3,2x002');

    // Assert
    expect(campo().props.value).toBe('15/03/2002');
  });

  test('no admite más de 8 dígitos', async () => {
    // Arrange
    await prepararNuevo();

    // Act
    await escribir('150320029999');

    // Assert
    expect(campo().props.value).toBe('15/03/2002');
  });

  test('se puede borrar hacia atrás pasando por las barras', async () => {
    // Arrange
    await prepararNuevo();
    await escribir('15/03/2');

    // Act: borrar de a un carácter, como lo hace el teclado
    await escribir('15/03/');
    expect(campo().props.value).toBe('15/03');
    await escribir('15/0');
    expect(campo().props.value).toBe('15/0');
    await escribir('15/');
    expect(campo().props.value).toBe('15');
    await escribir('1');
    await escribir('');

    // Assert
    expect(campo().props.value).toBe('');
  });

  test('escrita solo con números se envía al servidor como fecha ISO', async () => {
    // Arrange
    await prepararNuevo({ 'POST /api/socios': { status: 201, body: { status: 'success' } } });
    await llenarDatos({ fecha: '15032002' });
    expect(campo().props.value).toBe('15/03/2002');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('POST /api/socios')[0][1].body).fecha_nacimiento).toBe('2002-03-15');
  });

  test('una fecha incompleta no deja continuar y avisa del formato', async () => {
    // Arrange
    await prepararNuevo();
    await llenarDatos({ fecha: '150320' });
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Fecha de nacimiento inválida', expect.any(String));
  });

  test('una fecha imposible como 31/02/2002 se rechaza aunque tenga el formato correcto', async () => {
    // Arrange
    await prepararNuevo();
    await llenarDatos({ fecha: '31022002' });
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(campo().props.value).toBe('31/02/2002');
    expect(alerta).toHaveBeenCalledWith('Fecha de nacimiento inválida', expect.any(String));
  });

  test('la fecha de un socio ya registrado aparece con el mismo formato', async () => {
    // Arrange
    mockApi(registrado());

    // Act
    await render(<App inicio="evaluacion" />);
    await buscar();
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    await volverAlFormulario();

    // Assert
    expect(campo().props.value).toBe('15/03/2002');
  });
});

describe('plan de membresía por opciones', () => {
  const prepararNuevo = async (rutas: Record<string, RutaOFuncion> = {}, matricula = MATRICULA) => {
    mockApi({ ...NUEVO, ...rutas });
    await render(<App inicio="evaluacion" />);
    await buscar(matricula);
    await screen.findByText('No encontramos tu matrícula');
  };
  const registrar = async (datos: Partial<Datos>) => {
    await llenarDatos(datos);
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));
    await fireEvent.press(screen.getByText('Continuar →'));
  };
  const cuerpoDelRegistro = () => JSON.parse(llamadas('POST /api/socios')[0][1].body);
  const OK = { 'POST /api/socios': { status: 201, body: { status: 'success' } } };

  test('ofrece exactamente tres planes: Estudiante, Encargado y Profesor', async () => {
    // Arrange / Act
    await prepararNuevo();

    // Assert
    const opciones = screen.getAllByRole('radio').map((o) => o.props.accessibilityLabel);
    expect(opciones).toEqual(['Plan de membresía: Estudiante', 'Plan de membresía: Encargado', 'Plan de membresía: Profesor']);
  });

  test.each(['Estudiante', 'Encargado', 'Profesor'])('elegir %s lo marca y se envía tal cual', async (plan) => {
    // Arrange
    await prepararNuevo(OK);

    // Act
    await fireEvent.press(screen.getByLabelText(`Plan de membresía: ${plan}`));

    // Assert
    expect(screen.getByLabelText(`Plan de membresía: ${plan}`).props.accessibilityState.selected).toBe(true);
    await registrar({ plan });
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(cuerpoDelRegistro().plan_membresia).toBe(plan);
  });

  test('solo un plan puede estar elegido a la vez', async () => {
    // Arrange
    await prepararNuevo();

    // Act
    await fireEvent.press(screen.getByLabelText('Plan de membresía: Estudiante'));
    await fireEvent.press(screen.getByLabelText('Plan de membresía: Profesor'));

    // Assert
    const elegidos = screen.getAllByRole('radio').filter((o) => o.props.accessibilityState.selected);
    expect(elegidos).toHaveLength(1);
    expect(elegidos[0].props.accessibilityLabel).toBe('Plan de membresía: Profesor');
  });

  test('sin elegir un plan no deja continuar y lo pide', async () => {
    // Arrange
    await prepararNuevo();
    await llenarDatos({ plan: '' });
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Datos incompletos', expect.stringContaining('plan de membresía'));
  });

  test('un nombre solo con espacios cuenta como vacío', async () => {
    // Arrange
    await prepararNuevo();
    await llenarDatos({ nombre: '    ' });
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Datos incompletos', expect.any(String));
  });

  test('un socio ya registrado con un plan anterior lo ve elegido junto a las tres opciones', async () => {
    // Arrange
    mockApi(registrado());

    // Act
    await render(<App inicio="evaluacion" />);
    await buscar();
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    await volverAlFormulario();

    // Assert
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByLabelText('Plan de membresía: Plan Estudiante').props.accessibilityState.selected).toBe(true);
  });

  test('un socio con uno de los planes de la lista no ve una cuarta opción', async () => {
    // Arrange
    const socio = { ...(registrado()['POST /api/socios/identificar'] as { body: { socio: object } }).body.socio, plan_membresia: 'Profesor' };
    mockApi({ ...registrado(), 'POST /api/socios/identificar': { body: { ...(registrado()['POST /api/socios/identificar'] as { body: object }).body, socio } } });

    // Act
    await render(<App inicio="evaluacion" />);
    await buscar();
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    await volverAlFormulario();

    // Assert
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByLabelText('Plan de membresía: Profesor').props.accessibilityState.selected).toBe(true);
  });

  test.each([
    ['un nombre de un solo carácter', { nombre: 'A' }, 'Datos incompletos'],
    ['un apellido de un solo carácter', { apellido: 'P' }, 'Datos incompletos'],
    ['un teléfono de menos de 6 caracteres', { telefono: '12345' }, 'Teléfono inválido'],
  ])('se rechaza %s (los límites de largo siguen vigentes)', async (_caso, cambios, titulo) => {
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

  test('una matrícula de menos de 6 caracteres se rechaza sin llamar al servidor', async () => {
    // Arrange
    global.fetch = jest.fn() as unknown as typeof fetch;
    await render(<App inicio="evaluacion" />);

    // Act
    await buscar('ABC12');

    // Assert
    expect(await screen.findByText(/entre 6 y 15 letras o números/)).toBeTruthy();
    expect(global.fetch).not.toHaveBeenCalled();
  });

});

describe('prueba de esfuerzo en la evaluación', () => {
  const conEnvio = () => mockApi({ ...registrado(), 'POST /api/evaluaciones': { body: { status: 'success' } } });

  // Con el oxímetro real la prueba de esfuerzo es la prueba del escalón; aquí, con tiempos cortos y el oxímetro simulado (128 lpm).
  const usarPruebaDelEscalon = () => {
    const sensores = usarSensores();
    sensores.prueba_esfuerzo = new SensorEscalon(sensores.oximetro_recuperacion, { duracionS: 0.2, esperaS: 0.1, pasoMs: 20 });
  };

  const enviarSinLoQueFalta = async () => {
    await fireEvent.press(screen.getByText('Continuar →'));
    await botonDeAlerta('Faltan mediciones', 'Continuar sin ellas').onPress?.();
    await screen.findByText('PASO 3 - TU OBJETIVO');
    await fireEvent.press(screen.getByLabelText('3 días a la semana'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Continuar →'));
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));
    await waitFor(() => expect(llamadas('POST /api/evaluaciones')).toHaveLength(1));
    return JSON.parse(llamadas('POST /api/evaluaciones')[0][1].body);
  };

  test('el VO₂ máx escrito a mano viaja en la evaluación y queda marcado como manual', async () => {
    // Arrange
    conEnvio();
    await llegarAlPaso2();
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Prueba de esfuerzo'));
    await fireEvent.changeText(screen.getByLabelText('VO₂ MÁX manual'), '45,5');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Prueba de esfuerzo'));
    await screen.findByText('✓ Medición terminada correctamente');

    // Act
    const cuerpo = await enviarSinLoQueFalta();

    // Assert
    expect(cuerpo.mediciones.vo2Max).toBe('45.5');
    expect(cuerpo.dispositivos.prueba_esfuerzo).toMatchObject({ id: 'manual', calibracion: 'desconocida' });
  });

  test('la prueba del escalón entrega el VO₂ máx estimado y la FC de recuperación en la evaluación', async () => {
    // Arrange
    usarPruebaDelEscalon();
    conEnvio();
    await llegarAlPaso2();

    // Act
    await fireEvent.press(screen.getByLabelText('Sexo para la prueba: Hombre'));
    await fireEvent.press(screen.getByLabelText('Iniciar prueba del escalón'));
    await waitFor(() => expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(2), { timeout: 5000 });
    const cuerpo = await enviarSinLoQueFalta();

    // Assert: 111,33 − 0,42 × 128 = 57,6
    expect(cuerpo.mediciones).toMatchObject({ vo2Max: '57.6', fcRecup: 128 });
    expect(cuerpo.dispositivos.prueba_esfuerzo).toMatchObject({ id: 'prueba-escalon' });
    expect(cuerpo.dispositivos.oximetro_recuperacion).toMatchObject({ id: 'SIM-OXIMETRO_RECUPERACION' });
  });

  test('para una mujer usa la fórmula de las mujeres con el mismo pulso', async () => {
    // Arrange
    usarPruebaDelEscalon();
    conEnvio();
    await llegarAlPaso2();

    // Act
    await fireEvent.press(screen.getByLabelText('Sexo para la prueba: Mujer'));
    await fireEvent.press(screen.getByLabelText('Iniciar prueba del escalón'));
    await waitFor(() => expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(2), { timeout: 5000 });
    const cuerpo = await enviarSinLoQueFalta();

    // Assert: 65,81 − 0,1847 × 128 = 42,2
    expect(cuerpo.mediciones.vo2Max).toBe('42.2');
  });

  test('el sexo con el que se calculó no se envía al servidor', async () => {
    // Arrange
    usarPruebaDelEscalon();
    conEnvio();
    await llegarAlPaso2();
    await fireEvent.press(screen.getByLabelText('Sexo para la prueba: Mujer'));
    await fireEvent.press(screen.getByLabelText('Iniciar prueba del escalón'));
    await waitFor(() => expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(2), { timeout: 5000 });

    // Act
    const cuerpo = await enviarSinLoQueFalta();

    // Assert
    expect(JSON.stringify(cuerpo)).not.toMatch(/sexo|hombre|mujer/i);
  });

  test('con los sensores simulados la prueba de esfuerzo sigue midiéndose con «Medir» como antes', async () => {
    // Arrange
    mockApi(registrado());
    await llegarAlPaso2();

    // Act
    await medir('Prueba de esfuerzo');

    // Assert
    expect(await screen.findByText('✓ Medición terminada correctamente')).toBeTruthy();
    expect(screen.queryByLabelText('Sexo para la prueba')).toBeNull();
  });
});
