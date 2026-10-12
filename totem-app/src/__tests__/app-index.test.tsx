import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import App from '../app/index';

jest.mock('@react-native-community/slider', () => 'Slider');

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

const NUEVO = { 'POST /api/socios/identificar': { body: { registrado: false, matricula: MATRICULA } } };
const registrado = (extra: object = {}) => ({
  'POST /api/socios/identificar': {
    body: {
      registrado: true, matricula: MATRICULA, socio: { nombre: 'Ana Pérez Soto', carrera: 'Ingeniería Civil', edad: 21 },
      evaluacion_vigente: null, evaluaciones_previas: [], vigencia_horas: 24, ...extra,
    },
  },
});

let alerta: jest.SpyInstance;
beforeEach(() => {
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const buscar = async (matricula = MATRICULA) => {
  await fireEvent.changeText(screen.getByLabelText('Matrícula'), matricula);
  await fireEvent.press(screen.getByText('Buscar mi matrícula'));
};
const llenarDatos = async (nombre = 'Ana Pérez Soto', carrera = 'Ingeniería Civil', edad = '21') => {
  await fireEvent.changeText(screen.getByLabelText('Nombre completo'), nombre);
  await fireEvent.changeText(screen.getByLabelText('Carrera'), carrera);
  await fireEvent.changeText(screen.getByLabelText('Edad'), edad);
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
const irAlUltimoPaso = async () => {
  for (let i = 0; i < 3; i++) await fireEvent.press(screen.getByText('Continuar →'));
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
    expect(screen.getByLabelText('Nombre completo').props.value).toBe('Ana Pérez Soto');
    expect(screen.getByLabelText('Carrera').props.value).toBe('Ingeniería Civil');
    expect(screen.getByLabelText('Edad').props.value).toBe('21');
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
    mockApi({ ...registrado(), 'PUT /api/socios/20231234A': { body: { status: 'success', cambios: ['carrera'] } } });
    await render(<App />);
    await buscar();
    await screen.findByText('Hola, Ana');
    await fireEvent.changeText(screen.getByLabelText('Carrera'), 'Ingeniería Informática');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('PUT /api/socios/20231234A')[0][1].body)).toEqual({ carrera: 'Ingeniería Informática' });
  });

  test('si falla la actualización avisa y no avanza', async () => {
    // Arrange
    mockApi({ ...registrado(), 'PUT /api/socios/20231234A': { status: 404, body: { detail: 'Socio no encontrado' } } });
    await render(<App />);
    await buscar();
    await screen.findByText('Hola, Ana');
    await fireEvent.changeText(screen.getByLabelText('Edad'), '22');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('No se pudieron actualizar tus datos', 'Socio no encontrado'));
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
    expect(screen.getByLabelText('Nombre completo').props.value).toBe('');
    expect(screen.getByLabelText('Carrera').props.value).toBe('');
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
    ['sin nombre', ['', 'Ingeniería', '21']],
    ['sin carrera', ['Ana Pérez', '', '21']],
    ['con edad no numérica', ['Ana Pérez', 'Ingeniería', 'abc']],
    ['con edad fuera de rango', ['Ana Pérez', 'Ingeniería', '200']],
  ])('no registra un socio %s', async (_nombre, [n, c, e]) => {
    // Arrange
    await prepararNuevo();
    await llenarDatos(n, c, e);
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    expect(alerta).toHaveBeenCalledWith('Datos incompletos', expect.any(String));
    expect(llamadas('POST /api/socios')).toHaveLength(0);
  });

  test('registra al socio con la matrícula normalizada y la edad numérica, y pasa a las mediciones', async () => {
    // Arrange
    await prepararNuevo({ 'POST /api/socios': { status: 201, body: { status: 'success' } } });
    await llenarDatos('  Ana Pérez Soto ', 'Ingeniería Civil', '21');
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));

    // Act
    await fireEvent.press(screen.getByText('Continuar →'));

    // Assert
    await screen.findByText('PASO 2 - ESTACIÓN DE SENSORES');
    expect(JSON.parse(llamadas('POST /api/socios')[0][1].body)).toEqual({
      matricula: MATRICULA, nombre: 'Ana Pérez Soto', carrera: 'Ingeniería Civil', edad: 21, confirmar_duplicado: false,
    });
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
    expect(cuerpo.estudiante).toEqual({ nombre: 'Ana Pérez Soto', matricula: MATRICULA, edad: '21', carrera: 'Ingeniería Civil' });
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
