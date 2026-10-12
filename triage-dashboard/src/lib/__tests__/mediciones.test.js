import { ETIQUETA_CALIBRACION, ETIQUETA_ERROR, ETIQUETA_SENSOR, hayCalibracionVencida, resumirDispositivos, resumirErrores } from '../mediciones';

describe('resumirDispositivos (R.58, R.59, R.60)', () => {
  test('lista cada dispositivo con su sensor, identificador, calibración y hora', () => {
    // Arrange
    const dispositivos = { tensiometro: { id: 'BP-01', calibracion: 'vigente', capturado_en: new Date(2026, 9, 1, 14, 5).toISOString() } };

    // Act
    const [d] = resumirDispositivos(dispositivos);

    // Assert
    expect(d).toMatchObject({
      sensor: 'tensiometro', etiqueta: 'Tensiómetro', id: 'BP-01', calibracion: 'vigente',
      calibracionTexto: 'calibración vigente', vencida: false, hora: '14:05',
    });
  });

  test('los ordena como están en el tótem, sin importar cómo lleguen', () => {
    // Arrange
    const dispositivos = {
      prueba_esfuerzo: { id: 'D' }, balanza: { id: 'C' }, tensiometro: { id: 'A' }, banda_pecho: { id: 'B' },
    };

    // Act
    const orden = resumirDispositivos(dispositivos).map((d) => d.id);

    // Assert
    expect(orden).toEqual(['A', 'B', 'C', 'D']);
  });

  test('marca la calibración vencida', () => {
    // Arrange / Act
    const [d] = resumirDispositivos({ balanza: { id: 'S1', calibracion: 'vencida' } });

    // Assert
    expect(d.vencida).toBe(true);
    expect(d.calibracionTexto).toBe(ETIQUETA_CALIBRACION.vencida);
  });

  test.each([[null], [undefined], [{}]])('sin dispositivos (%p) devuelve una lista vacía', (dispositivos) => {
    // Arrange / Act / Assert
    expect(resumirDispositivos(dispositivos)).toEqual([]);
  });

  test('un dispositivo incompleto o desconocido no rompe el resumen', () => {
    // Arrange
    const dispositivos = { oximetro: { id: 'OX-1' }, balanza: {} };

    // Act
    const resumen = resumirDispositivos(dispositivos);

    // Assert
    expect(resumen.map((d) => d.etiqueta)).toEqual(['Balanza', 'oximetro']);
    expect(resumen[0]).toMatchObject({ id: 'sin identificar', calibracion: 'desconocida', hora: '' });
  });

  test('hayCalibracionVencida detecta si algún dispositivo la tiene vencida', () => {
    // Arrange / Act / Assert
    expect(hayCalibracionVencida({ tensiometro: { id: 'A', calibracion: 'vigente' }, balanza: { id: 'B', calibracion: 'vencida' } })).toBe(true);
    expect(hayCalibracionVencida({ tensiometro: { id: 'A', calibracion: 'vigente' } })).toBe(false);
    expect(hayCalibracionVencida({})).toBe(false);
    expect(hayCalibracionVencida(undefined)).toBe(false);
  });
});

describe('resumirErrores (R.65)', () => {
  test('describe cada error con sensor, tipo, mensaje y hora, en orden', () => {
    // Arrange
    const errores = [
      { sensor: 'tensiometro', codigo: 'movimiento', mensaje: 'Se detectó movimiento', ocurrido_en: new Date(2026, 9, 1, 9, 30).toISOString() },
      { sensor: 'balanza', codigo: 'timeout', mensaje: '', ocurrido_en: null },
    ];

    // Act
    const resumen = resumirErrores(errores);

    // Assert
    expect(resumen).toEqual([
      { sensor: 'Tensiómetro', tipo: 'Movimiento durante la medición', mensaje: 'Se detectó movimiento', hora: '09:30' },
      { sensor: 'Balanza', tipo: 'Sin respuesta del sensor', mensaje: '', hora: '' },
    ]);
  });

  test.each([[null], [undefined], [[]]])('sin errores (%p) devuelve una lista vacía', (errores) => {
    // Arrange / Act / Assert
    expect(resumirErrores(errores)).toEqual([]);
  });

  test('un código o sensor desconocido usa un texto por defecto', () => {
    // Arrange / Act
    const [e] = resumirErrores([{ sensor: 'oximetro', codigo: 'raro', mensaje: 'x' }]);

    // Assert
    expect(e).toMatchObject({ sensor: 'oximetro', tipo: ETIQUETA_ERROR.error });
  });

  test('todos los códigos que acepta el backend tienen etiqueta', () => {
    // Arrange / Act / Assert
    expect(Object.keys(ETIQUETA_ERROR).sort()).toEqual(['desconectado', 'error', 'lectura_invalida', 'movimiento', 'timeout']);
    expect(Object.keys(ETIQUETA_SENSOR)).toEqual(['tensiometro', 'banda_pecho', 'balanza', 'prueba_esfuerzo']);
  });
});
