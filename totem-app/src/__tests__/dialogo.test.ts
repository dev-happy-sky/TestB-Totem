import { Alert, Platform } from 'react-native';

import { mostrarAlerta } from '../utils/dialogo';

type VentanaFalsa = { alert: jest.Mock; confirm: jest.Mock };
const ventana = (confirmar = true): VentanaFalsa => ({ alert: jest.fn(), confirm: jest.fn().mockReturnValue(confirmar) });

const conPlataforma = (os: string, v?: VentanaFalsa) => {
  jest.replaceProperty(Platform, 'OS', os as typeof Platform.OS);
  if (v) (globalThis as unknown as { window: VentanaFalsa }).window = v;
};

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('mostrarAlerta en el teléfono y la tablet instalada', () => {
  test('usa Alert.alert con exactamente lo recibido', () => {
    // Arrange
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const botones = [{ text: 'Aceptar' }];

    // Act
    mostrarAlerta('Título', 'Mensaje', botones);
    mostrarAlerta('Solo título y mensaje', 'Texto');
    mostrarAlerta('Solo título');

    // Assert
    expect(alerta.mock.calls).toEqual([['Título', 'Mensaje', botones], ['Solo título y mensaje', 'Texto'], ['Solo título']]);
  });
});

describe('mostrarAlerta en la versión web (donde Alert.alert no hace nada)', () => {
  test('sin botones muestra el aviso con window.alert, con título y mensaje', () => {
    // Arrange
    const v = ventana();
    conPlataforma('web', v);
    const nativa = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    // Act
    mostrarAlerta('Fecha de nacimiento inválida', 'Escríbela como DD/MM/AAAA.');

    // Assert
    expect(v.alert).toHaveBeenCalledWith('Fecha de nacimiento inválida\n\nEscríbela como DD/MM/AAAA.');
    expect(nativa).not.toHaveBeenCalled();
  });

  test('un aviso sin mensaje muestra solo el título', () => {
    // Arrange
    const v = ventana();
    conPlataforma('web', v);

    // Act
    mostrarAlerta('Solo título');

    // Assert
    expect(v.alert).toHaveBeenCalledWith('Solo título');
  });

  test('con un solo botón avisa y luego ejecuta su acción', () => {
    // Arrange
    const v = ventana();
    conPlataforma('web', v);
    const alAceptar = jest.fn();

    // Act
    mostrarAlerta('Listo', 'Se guardó', [{ text: 'Entendido', onPress: alAceptar }]);

    // Assert
    expect(v.alert).toHaveBeenCalled();
    expect(alAceptar).toHaveBeenCalledTimes(1);
  });

  test('con dos botones pregunta con window.confirm y Aceptar ejecuta la acción', () => {
    // Arrange
    const v = ventana(true);
    conPlataforma('web', v);
    const revisar = jest.fn();
    const otra = jest.fn();

    // Act
    mostrarAlerta('¿Ya estás registrado?', 'Hay alguien con tu nombre', [
      { text: 'Revisar mis datos', style: 'cancel', onPress: revisar },
      { text: 'Soy otra persona', onPress: otra },
    ]);

    // Assert
    expect(otra).toHaveBeenCalledTimes(1);
    expect(revisar).not.toHaveBeenCalled();
    const pregunta = v.confirm.mock.calls[0][0] as string;
    expect(pregunta).toContain('Hay alguien con tu nombre');
    expect(pregunta).toContain('Aceptar: Soy otra persona');
    expect(pregunta).toContain('Cancelar: Revisar mis datos');
  });

  test('Cancelar ejecuta el botón de cancelar', () => {
    // Arrange
    const v = ventana(false);
    conPlataforma('web', v);
    const revisar = jest.fn();
    const otra = jest.fn();

    // Act
    mostrarAlerta('¿Ya estás registrado?', 'x', [
      { text: 'Revisar mis datos', style: 'cancel', onPress: revisar },
      { text: 'Soy otra persona', onPress: otra },
    ]);

    // Assert
    expect(revisar).toHaveBeenCalledTimes(1);
    expect(otra).not.toHaveBeenCalled();
  });

  test('el botón de cancelar puede venir en cualquier posición', () => {
    // Arrange
    const v = ventana(false);
    conPlataforma('web', v);
    const cancelar = jest.fn();
    const aceptar = jest.fn();

    // Act
    mostrarAlerta('¿Cancelar la evaluación?', 'x', [
      { text: 'Sí, cancelar', style: 'destructive', onPress: aceptar },
      { text: 'Seguir evaluándome', style: 'cancel', onPress: cancelar },
    ]);

    // Assert
    expect(cancelar).toHaveBeenCalledTimes(1);
    expect(aceptar).not.toHaveBeenCalled();
  });

  test('sin botón marcado como cancelar, el primero cancela y el segundo acepta', () => {
    // Arrange
    const v = ventana(true);
    conPlataforma('web', v);
    const primero = jest.fn();
    const segundo = jest.fn();

    // Act
    mostrarAlerta('Faltan mediciones', 'x', [{ text: 'Volver', onPress: primero }, { text: 'Continuar sin ellas', onPress: segundo }]);

    // Assert
    expect(segundo).toHaveBeenCalledTimes(1);
    expect(primero).not.toHaveBeenCalled();
  });

  test('si no existe window (entorno sin navegador) no falla', () => {
    // Arrange
    conPlataforma('web');

    // Act / Assert
    expect(() => mostrarAlerta('Aviso', 'Texto')).not.toThrow();
    expect(() => mostrarAlerta('Aviso', 'Texto', [{ text: 'a' }, { text: 'b' }])).not.toThrow();
  });
});
