import React from 'react';
import { Text, TouchableOpacity, type AlertButton } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import AlertaHost from '../components/alerta-modal';
import { emitirAlerta, registrarAlertaHost, type Alerta } from '../utils/dialogo';

afterEach(() => registrarAlertaHost(null));

// Igual que en la app: una pantalla con el host montado y un botón que dispara una alerta (desde un onPress, como en la realidad).
// `emitirAlerta` es la misma vía por la que `mostrarAlerta` alimenta al host en web, sin depender de la plataforma.
function Pantalla({ alerta }: { alerta: Alerta }) {
  return (
    <>
      <TouchableOpacity accessibilityLabel="disparar" onPress={() => emitirAlerta(alerta)}><Text>disparar</Text></TouchableOpacity>
      <AlertaHost />
    </>
  );
}

describe('AlertaHost (cuadro de alerta propio en web)', () => {
  test('muestra título, mensaje y botones; el botón pulsado corre su acción y cierra el cuadro', async () => {
    // Arrange
    const volver = jest.fn();
    const continuar = jest.fn();
    const botones: AlertButton[] = [
      { text: 'Volver a medir', style: 'cancel', onPress: volver },
      { text: 'Continuar sin ellas', onPress: continuar },
    ];
    await render(<Pantalla alerta={{ titulo: 'Faltan mediciones', mensaje: 'Aún no se midió: Tensiómetro.', botones }} />);

    // Act: disparar la alerta
    await fireEvent.press(screen.getByLabelText('disparar'));

    // Assert: aparece con su contenido
    expect(await screen.findByLabelText('Alerta: Faltan mediciones')).toBeTruthy();
    expect(screen.getByText('Aún no se midió: Tensiómetro.')).toBeTruthy();

    // Act: pulsar "Continuar sin ellas"
    await fireEvent.press(screen.getByLabelText('Continuar sin ellas'));

    // Assert: corre esa acción, no la otra, y el cuadro desaparece
    expect(continuar).toHaveBeenCalledTimes(1);
    expect(volver).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText('Alerta: Faltan mediciones')).toBeNull());
  });

  test('una alerta sin botones muestra "Aceptar" y al pulsarlo se cierra', async () => {
    // Arrange
    await render(<Pantalla alerta={{ titulo: '¡Éxito!', mensaje: 'Tus datos han sido enviados al profesor.' }} />);

    // Act
    await fireEvent.press(screen.getByLabelText('disparar'));
    expect(await screen.findByLabelText('Alerta: ¡Éxito!')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Aceptar'));

    // Assert
    await waitFor(() => expect(screen.queryByLabelText('Alerta: ¡Éxito!')).toBeNull());
  });

  test('sin host montado, emitir no hace nada (y mostrarAlerta usaría el respaldo del navegador)', () => {
    expect(emitirAlerta({ titulo: 'Sin host' })).toBe(false);
  });
});
