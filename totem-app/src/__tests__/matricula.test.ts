import { matriculaValida, normalizarMatricula } from '../utils/matricula';

describe('normalizarMatricula', () => {
  test.each([
    ['20231234A', '20231234A'],
    ['  2023-1234 a ', '20231234A'],
    ['20.231.234', '20231234'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('normaliza %p como %p', (entrada, esperado) => {
    // Arrange / Act
    const resultado = normalizarMatricula(entrada);

    // Assert
    expect(resultado).toBe(esperado);
  });
});

describe('matriculaValida', () => {
  test.each([
    ['20231234A', true],
    ['2023-1234 a', true],
    ['ABC123', true],
    ['ABC12', false],
    ['A'.repeat(15), true],
    ['A'.repeat(16), false],
    ['', false],
    [null, false],
    ['2023$1234', false],
  ])('%p es válida: %p', (matricula, valida) => {
    // Arrange / Act
    const resultado = matriculaValida(matricula);

    // Assert
    expect(resultado).toBe(valida);
  });
});
