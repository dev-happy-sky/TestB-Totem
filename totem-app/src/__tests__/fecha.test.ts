import { formatearFechaEntrada, isoADisplay, parseFechaNacimiento, telefonoValido } from '../utils/fecha';

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

describe('formatearFechaEntrada (máscara DD/MM/AAAA)', () => {
  test.each([
    ['', ''], ['1', '1'], ['15', '15'], ['150', '15/0'], ['1503', '15/03'], ['15032', '15/03/2'], ['150320', '15/03/20'],
    ['15032002', '15/03/2002'],
  ])('al escribir %j queda %j', (escrito, esperado) => {
    // Arrange / Act / Assert
    expect(formatearFechaEntrada(escrito)).toBe(esperado);
  });

  test('no pone la barra al final: borrar no deja el campo trabado', () => {
    // Arrange: la persona borra el último dígito de "15/03/2" y queda "15/03/"
    // Act / Assert
    expect(formatearFechaEntrada('15/03/')).toBe('15/03');
    expect(formatearFechaEntrada('15/')).toBe('15');
  });

  test('ignora todo lo que no sea un número', () => {
    // Arrange / Act / Assert
    expect(formatearFechaEntrada('ab15/03-2002')).toBe('15/03/2002');
    expect(formatearFechaEntrada(' 1 5 . 0 3 . 2 0 0 2 ')).toBe('15/03/2002');
    expect(formatearFechaEntrada('abc')).toBe('');
  });

  test('no admite más de 8 dígitos', () => {
    // Arrange / Act / Assert
    expect(formatearFechaEntrada('150320021234')).toBe('15/03/2002');
  });

  test('es idempotente: aplicarla a algo ya formateado no lo cambia', () => {
    // Arrange / Act / Assert
    for (const texto of ['', '1', '15/0', '15/03', '15/03/2', '15/03/2002']) {
      expect(formatearFechaEntrada(formatearFechaEntrada(texto))).toBe(formatearFechaEntrada(texto));
    }
  });

  test('una fecha pegada en formato ISO se reordena como números y la validación la rechaza', () => {
    // Arrange: "2002-03-15" no se interpreta como ISO
    const pegada = formatearFechaEntrada('2002-03-15');

    // Act / Assert
    expect(pegada).toBe('20/02/0315');
    expect(parseFechaNacimiento(pegada, new Date(2026, 2, 15))).toBeNull();
  });

  test('lo que da la máscara con 8 dígitos válidos lo entiende parseFechaNacimiento', () => {
    // Arrange / Act / Assert
    expect(parseFechaNacimiento(formatearFechaEntrada('15032002'), new Date(2026, 2, 15))).toBe('2002-03-15');
  });

  test('es la misma forma que isoADisplay entrega al mostrar la fecha de un socio ya registrado', () => {
    // Arrange / Act / Assert
    expect(formatearFechaEntrada(isoADisplay('2002-03-15'))).toBe(isoADisplay('2002-03-15'));
  });
});
