import { calcularIMC, parsearEstatura } from '../sensores';

describe('parsearEstatura', () => {
  test.each([
    ['172', 172], ['172,5', 172.5], ['172.5', 172.5], ['  165  ', 165], ['100', 100], ['250', 250], ['172.54', 172.5],
  ])('acepta %j como %s cm', (texto, cm) => {
    // Arrange / Act / Assert
    expect(parsearEstatura(texto)).toEqual({ cm });
  });

  test.each(['', '   ', 'abc', '17a', 'NaN'])('rechaza lo que no es un número (%j)', (texto) => {
    // Arrange / Act
    const resultado = parsearEstatura(texto);

    // Assert
    expect(resultado).toEqual({ error: 'Ingresa la estatura en centímetros (por ejemplo 172).' });
  });

  test.each(['1,72', '1.72', '2'])('detecta metros en vez de centímetros (%j)', (texto) => {
    // Arrange / Act
    const resultado = parsearEstatura(texto);

    // Assert
    expect(resultado).toEqual({ error: 'Ingresa la estatura en centímetros, no en metros (por ejemplo 172).' });
  });

  test.each(['99', '99.9', '251', '300', '1720', '-170', '0'])('rechaza una estatura fuera de 100-250 cm (%j)', (texto) => {
    // Arrange / Act
    const resultado = parsearEstatura(texto);

    // Assert
    expect('error' in resultado).toBe(true);
  });

  test('el mensaje de rango nombra los límites', () => {
    // Arrange / Act / Assert
    expect(parsearEstatura('50')).toEqual({ error: 'La estatura debe estar entre 100 y 250 cm.' });
  });
});

describe('calcularIMC', () => {
  test('calcula peso / estatura² con un decimal', () => {
    // Arrange / Act / Assert
    expect(calcularIMC('53.7', 172)).toEqual({ imc: '18.2' });
    expect(calcularIMC(70, 175)).toEqual({ imc: '22.9' });
    expect(calcularIMC('85.0', 180)).toEqual({ imc: '26.2' });
  });

  test('acepta el peso como texto (como lo entrega la báscula) o como número', () => {
    // Arrange / Act / Assert
    expect(calcularIMC('70.0', 175)).toEqual(calcularIMC(70, 175));
  });

  test.each([['', 172], ['abc', 172], ['0', 172], ['-5', 172], ['70', 0], ['70', NaN]])(
    'sin peso o estatura válidos no hay IMC (%j, %s)', (peso, cm) => {
      // Arrange / Act
      const resultado = calcularIMC(peso, cm as number);

      // Assert
      expect(resultado).toEqual({ error: 'No hay peso o estatura válidos para calcular el IMC.' });
    });

  test('un IMC imposible se rechaza con un mensaje que pide revisar los datos', () => {
    // Arrange: 20 kg a 250 cm da 3,2; 300 kg a 100 cm da 300
    const bajo = calcularIMC(20, 250);
    const alto = calcularIMC(300, 100);

    // Assert
    expect(bajo).toEqual({ error: 'IMC 3.2 fuera de lo posible: revisa el peso y la estatura.' });
    expect('error' in alto).toBe(true);
  });

  test('los límites del IMC posible (10 y 80) son válidos', () => {
    // Arrange: 10 = 40 kg a 200 cm; 80 = 80 kg a 100 cm
    expect(calcularIMC(40, 200)).toEqual({ imc: '10.0' });
    expect(calcularIMC(80, 100)).toEqual({ imc: '80.0' });
  });
});
