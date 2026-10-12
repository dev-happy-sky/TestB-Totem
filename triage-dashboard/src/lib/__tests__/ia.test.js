import { CATEGORIAS, ETIQUETA_SEVERIDAD, coincidenciaIA, compararConIA, nivelConfianza, nombreCategoria, porcentajeConfianza } from '../ia';

const cerrado = (iaSugerida, nivelFinal, extra = {}) => ({ estado: 'validado', iaSugerida, nivelFinal, ...extra });

describe('nombreCategoria', () => {
  test.each([
    ['A1', 'Requiere evaluación médica'], ['A2', 'Apto con precaución'],
    ['A3', 'Apto con intensidad moderada'], ['A4', 'Apto'],
    [null, 'Sin clasificar'], [undefined, 'Sin clasificar'], ['Z9', 'Sin clasificar'],
  ])('%p → %p', (categoria, esperado) => {
    // Arrange / Act / Assert
    expect(nombreCategoria(categoria)).toBe(esperado);
  });

  test('las cuatro categorías tienen nombre y etiqueta corta', () => {
    // Arrange / Act / Assert
    expect(Object.keys(CATEGORIAS)).toEqual(['A1', 'A2', 'A3', 'A4']);
    for (const c of Object.values(CATEGORIAS)) expect(c.nombre && c.corto).toBeTruthy();
  });
});

describe('porcentajeConfianza y nivelConfianza (R.100)', () => {
  test.each([
    [1, 100], [0.85, 85], [0.605, 61], [0.6, 60], [0.05, 5], [0, 0],
    [null, null], [undefined, null], ['0.9', null], [NaN, null], [Infinity, null],
  ])('porcentaje de %p → %p', (confianza, esperado) => {
    // Arrange / Act / Assert
    expect(porcentajeConfianza(confianza)).toBe(esperado);
  });

  test.each([
    [0.95, 'alta'], [0.7, 'alta'], [0.69, 'baja'], [0.05, 'baja'], [null, 'sin-dato'], [undefined, 'sin-dato'],
  ])('nivel de %p → %p', (confianza, esperado) => {
    // Arrange / Act / Assert
    expect(nivelConfianza(confianza)).toBe(esperado);
  });
});

describe('compararConIA (R.110)', () => {
  test('en un caso cerrado indica qué sugirió la IA y qué decidió el encargado', () => {
    // Arrange
    const caso = cerrado('A2', 'A1', { decisionPersonal: 'modificada' });

    // Act
    const comparacion = compararConIA(caso);

    // Assert
    expect(comparacion).toEqual({ categoriaIA: 'A2', categoriaFinal: 'A1', coincide: false, decision: 'modificada' });
  });

  test('si el encargado dejó la misma categoría coinciden', () => {
    // Arrange / Act
    const comparacion = compararConIA(cerrado('A3', 'A3', { decisionPersonal: 'confirmada' }));

    // Assert
    expect(comparacion.coincide).toBe(true);
  });

  test('una derivación coincide con la IA solo si la IA ya había dicho A1', () => {
    // Arrange / Act / Assert
    expect(compararConIA(cerrado('A1', 'A1', { decisionPersonal: 'derivada' })).coincide).toBe(true);
    expect(compararConIA(cerrado('A3', 'A1', { decisionPersonal: 'derivada' })).coincide).toBe(false);
  });

  test.each([
    [{ estado: 'pendiente', iaSugerida: 'A2', nivelFinal: null }],
    [{ estado: 'validado', iaSugerida: 'A2', nivelFinal: null }],
    [{ estado: 'validado', iaSugerida: null, nivelFinal: 'A2' }],
    [{}],
  ])('devuelve null mientras no haya decisión completa (%j)', (caso) => {
    // Arrange / Act / Assert
    expect(compararConIA(caso)).toBeNull();
  });

  test('sin decisionPersonal la decisión queda en null', () => {
    // Arrange / Act / Assert
    expect(compararConIA(cerrado('A2', 'A2')).decision).toBeNull();
  });
});

describe('coincidenciaIA', () => {
  test('cuenta solo los casos cerrados', () => {
    // Arrange
    const cola = [
      cerrado('A2', 'A2'), cerrado('A3', 'A3'), cerrado('A3', 'A1'), cerrado('A4', 'A4'),
      { estado: 'pendiente', iaSugerida: 'A1', nivelFinal: null },
    ];

    // Act
    const resultado = coincidenciaIA(cola);

    // Assert
    expect(resultado).toEqual({ total: 4, coinciden: 3, porcentaje: 75 });
  });

  test('sin casos cerrados no hay porcentaje (no divide por cero)', () => {
    // Arrange / Act
    const resultado = coincidenciaIA([{ estado: 'pendiente' }]);

    // Assert
    expect(resultado).toEqual({ total: 0, coinciden: 0, porcentaje: null });
    expect(coincidenciaIA([])).toEqual({ total: 0, coinciden: 0, porcentaje: null });
  });

  test('redondea el porcentaje', () => {
    // Arrange
    const cola = [cerrado('A1', 'A1'), cerrado('A1', 'A2'), cerrado('A1', 'A2')];

    // Act / Assert
    expect(coincidenciaIA(cola).porcentaje).toBe(33);
  });
});

test('las severidades de las reglas tienen etiqueta', () => {
  // Arrange / Act / Assert
  expect(ETIQUETA_SEVERIDAD).toEqual({ leve: 'Leve', precaucion: 'Precaución', critico: 'Crítico' });
});
