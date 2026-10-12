import { isoADisplay, parseFechaNacimiento, telefonoValido } from '../utils/fecha';

const HOY = new Date(2026, 2, 15); // 15/03/2026

describe('parseFechaNacimiento', () => {
  test.each([
    ['15/03/2002', '2002-03-15'],
    ['5/3/2002', '2002-03-05'],
    ['15-03-2002', '2002-03-15'],
    ['15.03.2002', '2002-03-15'],
    ['  15/03/2002  ', '2002-03-15'],
    ['29/02/2000', '2000-02-29'],      // año bisiesto
    ['15/03/2026', '2026-03-15'],      // nace hoy
    ['15/03/1906', '1906-03-15'],      // exactamente 120 años
  ])('acepta %p', (texto, esperado) => {
    // Arrange / Act
    const resultado = parseFechaNacimiento(texto, HOY);

    // Assert
    expect(resultado).toBe(esperado);
  });

  test.each([
    ['', 'vacía'],
    ['2002-03-15', 'en formato ISO'],
    ['15/03/02', 'con año de 2 dígitos'],
    ['30/02/2002', 'con un día inexistente'],
    ['29/02/2001', 'un 29 de febrero sin año bisiesto'],
    ['31/04/2002', 'abril no tiene 31'],
    ['00/03/2002', 'con día 0'],
    ['15/13/2002', 'con mes 13'],
    ['16/03/2026', 'de mañana'],
    ['15/03/1905', 'de más de 120 años'],
    ['abc', 'con texto'],
  ])('rechaza %p (%s)', (texto) => {
    // Arrange / Act
    const resultado = parseFechaNacimiento(texto, HOY);

    // Assert
    expect(resultado).toBeNull();
  });
});

describe('isoADisplay', () => {
  test.each([
    ['2002-03-15', '15/03/2002'],
    ['2002-03-15T00:00:00', '15/03/2002'],
    [null, ''],
    [undefined, ''],
    ['', ''],
    ['no-es-fecha', ''],
  ])('%p → %p', (iso, esperado) => {
    // Arrange / Act
    const resultado = isoADisplay(iso);

    // Assert
    expect(resultado).toBe(esperado);
  });
});

describe('telefonoValido', () => {
  test.each([
    ['', true], ['   ', true],                         // opcional
    ['+56 9 1234 5678', true], ['912345678', true], ['(2) 2345-6789', true],
    ['12345', false], ['abc', false], ['9'.repeat(30), false],
  ])('%p es válido: %p', (telefono, valido) => {
    // Arrange / Act
    const resultado = telefonoValido(telefono);

    // Assert
    expect(resultado).toBe(valido);
  });
});
