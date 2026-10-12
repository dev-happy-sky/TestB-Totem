import { describirContacto, etiquetaDias, formatearFechaISO, horaLocal } from '../formato';

describe('formatearFechaISO', () => {
  test.each([
    ['2002-03-15', '15/03/2002'],
    ['2002-03-15T23:59:00-04:00', '15/03/2002'],   // no depende de la zona horaria
    [null, ''],
    [undefined, ''],
    ['', ''],
    ['15/03/2002', ''],
    ['no-es-fecha', ''],
  ])('%p → %p', (iso, esperado) => {
    // Arrange / Act
    const resultado = formatearFechaISO(iso);

    // Assert
    expect(resultado).toBe(esperado);
  });
});

describe('horaLocal', () => {
  test('devuelve la hora y los minutos de un instante válido', () => {
    // Arrange
    const iso = new Date(2026, 9, 1, 14, 5).toISOString();

    // Act
    const hora = horaLocal(iso);

    // Assert
    expect(hora).toMatch(/^14:05$/);
  });

  test.each([[null], [undefined], [''], ['no-es-fecha']])('devuelve vacío para %p', (iso) => {
    // Arrange / Act / Assert
    expect(horaLocal(iso)).toBe('');
  });
});

describe('describirContacto', () => {
  test.each([
    [{ fechaNacimiento: '2002-03-15', telefono: '+56 9 1234 5678' }, 'Nacimiento: 15/03/2002 · Tel. +56 9 1234 5678'],
    [{ fechaNacimiento: '2002-03-15', telefono: null }, 'Nacimiento: 15/03/2002'],
    [{ fechaNacimiento: null, telefono: '912345678' }, 'Tel. 912345678'],
    [{}, ''],
  ])('%j → %p', (socio, esperado) => {
    // Arrange / Act
    const resultado = describirContacto(socio);

    // Assert
    expect(resultado).toBe(esperado);
  });
});

describe('etiquetaDias', () => {
  test.each([[1, '1 día'], [3, '3 días'], [7, '7 días'], [null, 'Sin indicar'], [undefined, 'Sin indicar']])(
    '%p → %p', (n, esperado) => {
      // Arrange / Act / Assert
      expect(etiquetaDias(n)).toBe(esperado);
    });
});
