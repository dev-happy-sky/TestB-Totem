import { calcularTendencia, describirOrigen, duracionEvaluacion, estadoRevision, evaluacionesPrevias, filtrarCola, ordenarCola } from '../cola';

const ev = (id, extra = {}) => ({
  idBaseDatos: `u${id}`, nombre: `Socio ${id}`, iaSugerida: 'A3', estado: 'pendiente', estadoRevision: 'pendiente',
  alerta: null, alertaNivel: null, alertaRevisada: false, nivelFinal: null, fecha: `2026-10-0${id}T10:00:00`,
  mediciones: { peso: '80.0', presionSys: 120, presionDia: 80, fcReposo: 70, imc: '25.0', grasa: '20.0' },
  ...extra,
});
const ids = (lista) => lista.map((e) => e.idBaseDatos);

describe('estadoRevision', () => {
  test('usa estadoRevision cuando viene del servidor', () => {
    // Arrange
    const e = ev(1, { estadoRevision: 'derivada', estado: 'validado' });

    // Act / Assert
    expect(estadoRevision(e)).toBe('derivada');
  });

  test.each([
    ['validado', 'revisada'],
    ['pendiente', 'pendiente'],
  ])('deduce el estado de evaluaciones antiguas sin estadoRevision (%s)', (estado, esperado) => {
    // Arrange
    const antigua = { estado };

    // Act / Assert
    expect(estadoRevision(antigua)).toBe(esperado);
  });
});

describe('ordenarCola por riesgo (R.123)', () => {
  test('deja las cerradas al final', () => {
    // Arrange
    const cola = [ev(1, { estadoRevision: 'revisada', iaSugerida: 'A1' }), ev(2, { iaSugerida: 'A4' })];

    // Act
    const resultado = ordenarCola(cola);

    // Assert
    expect(ids(resultado)).toEqual(['u2', 'u1']);
  });

  test('pone primero las alertas críticas sin revisar y luego ordena A1 → A4', () => {
    // Arrange
    const cola = [
      ev(1, { iaSugerida: 'A3' }),
      ev(2, { iaSugerida: 'A2', alerta: 'DERIVAR', alertaNivel: 'riesgo' }),
      ev(3, { iaSugerida: 'A2', alerta: 'DERIVAR', alertaNivel: 'critica' }),
      ev(4, { iaSugerida: 'A1' }),
    ];

    // Act
    const resultado = ordenarCola(cola);

    // Assert
    expect(ids(resultado)).toEqual(['u3', 'u4', 'u2', 'u1']);
  });

  test('una alerta crítica ya revisada deja de tener prioridad', () => {
    // Arrange
    const cola = [ev(1, { iaSugerida: 'A3' }), ev(2, { iaSugerida: 'A2', alertaNivel: 'critica', alerta: 'DERIVAR', alertaRevisada: true })];

    // Act
    const resultado = ordenarCola(cola);

    // Assert
    expect(ids(resultado)).toEqual(['u2', 'u1']); // por categoría: A2 antes que A3
  });

  test('usa la categoría final del encargado en lugar de la sugerida', () => {
    // Arrange
    const cola = [ev(1, { iaSugerida: 'A4' }), ev(2, { iaSugerida: 'A4', nivelFinal: 'A1' })];

    // Act
    const resultado = ordenarCola(cola);

    // Assert
    expect(ids(resultado)).toEqual(['u2', 'u1']);
  });

  test('no modifica el arreglo original', () => {
    // Arrange
    const cola = [ev(1), ev(2, { iaSugerida: 'A1' })];

    // Act
    ordenarCola(cola);

    // Assert
    expect(ids(cola)).toEqual(['u1', 'u2']);
  });

  test('con una cola vacía devuelve una lista vacía', () => {
    // Arrange / Act / Assert
    expect(ordenarCola([])).toEqual([]);
  });
});

describe('ordenarCola por fecha', () => {
  test('pone primero la más reciente', () => {
    // Arrange
    const cola = [ev(1), ev(3), ev(2)];

    // Act
    const resultado = ordenarCola(cola, 'reciente');

    // Assert
    expect(ids(resultado)).toEqual(['u3', 'u2', 'u1']);
  });
});

describe('filtrarCola (R.135)', () => {
  const cola = [
    ev(1),
    ev(2, { estadoRevision: 'revisada', estado: 'validado' }),
    ev(3, { estadoRevision: 'derivada', estado: 'validado' }),
  ];

  test.each([
    ['todas', ['u1', 'u2', 'u3']],
    ['pendiente', ['u1']],
    ['revisada', ['u2']],
    ['derivada', ['u3']],
  ])('filtro %s', (filtro, esperado) => {
    // Arrange / Act
    const resultado = filtrarCola(cola, filtro);

    // Assert
    expect(ids(resultado)).toEqual(esperado);
  });
});

describe('calcularTendencia (R.130, R.131)', () => {
  test('compara con la evaluación anterior más reciente', () => {
    // Arrange
    const actual = ev(3, { mediciones: { peso: '78.5', presionSys: 125, presionDia: 80, fcReposo: 65, imc: '24.0', grasa: '19.0' } });
    const historial = [ev(1, { mediciones: { ...ev(1).mediciones, peso: '90.0' } }), ev(2)];

    // Act
    const tendencia = calcularTendencia(actual, [actual, ...historial]);

    // Assert
    const peso = tendencia.find((t) => t.clave === 'peso');
    expect(peso).toMatchObject({ actual: 78.5, anterior: 80, delta: -1.5 });
    expect(tendencia.find((t) => t.clave === 'presionSys').delta).toBe(5);
    expect(tendencia.find((t) => t.clave === 'presionDia').delta).toBe(0);
  });

  test('sin evaluaciones anteriores devuelve null', () => {
    // Arrange
    const actual = ev(1);

    // Act / Assert
    expect(calcularTendencia(actual, [actual])).toBeNull();
    expect(calcularTendencia(actual, [])).toBeNull();
    expect(calcularTendencia(actual, null)).toBeNull();
  });

  test('ignora evaluaciones posteriores a la actual', () => {
    // Arrange
    const actual = ev(1);

    // Act
    const previas = evaluacionesPrevias(actual, [ev(2), ev(3)]);

    // Assert
    expect(previas).toEqual([]);
  });

  test('omite las métricas que no se pueden comparar', () => {
    // Arrange
    const actual = ev(2, { mediciones: { peso: '', presionSys: 120 } });
    const anterior = ev(1, { mediciones: { peso: '80.0', presionSys: 110 } });

    // Act
    const tendencia = calcularTendencia(actual, [anterior]);

    // Assert
    expect(tendencia.map((t) => t.clave)).toEqual(['presionSys']);
  });
});

describe('duracionEvaluacion (R.16)', () => {
  test('calcula los minutos entre inicio y término', () => {
    // Arrange
    const e = { inicioEvaluacion: '2026-10-01T10:00:00Z', finEvaluacion: '2026-10-01T10:04:40Z' };

    // Act / Assert
    expect(duracionEvaluacion(e)).toBe(5);
  });

  test.each([
    [{}],
    [{ inicioEvaluacion: '2026-10-01T10:00:00Z' }],
    [{ inicioEvaluacion: 'no-es-fecha', finEvaluacion: '2026-10-01T10:00:00Z' }],
    [{ inicioEvaluacion: '2026-10-01T10:05:00Z', finEvaluacion: '2026-10-01T10:00:00Z' }],
  ])('devuelve null si faltan datos o el término es anterior al inicio (%j)', (e) => {
    // Arrange / Act / Assert
    expect(duracionEvaluacion(e)).toBeNull();
  });

  test('una evaluación sin diferencia de tiempo dura 0 minutos', () => {
    // Arrange
    const e = { inicioEvaluacion: '2026-10-01T10:00:00Z', finEvaluacion: '2026-10-01T10:00:00Z' };

    // Act / Assert
    expect(duracionEvaluacion(e)).toBe(0);
  });
});

describe('describirOrigen (R.18, R.19)', () => {
  test.each([
    [{ totem: 'TOTEM-01', sucursal: 'Campus San Joaquín' }, 'Tótem TOTEM-01 · Campus San Joaquín'],
    [{ totem: 'TOTEM-01', sucursal: null }, 'Tótem TOTEM-01'],
    [{ totem: null, sucursal: 'Campus A' }, 'Campus A'],
    [{}, ''],
  ])('%j → %p', (e, esperado) => {
    // Arrange / Act / Assert
    expect(describirOrigen(e)).toBe(esperado);
  });
});
