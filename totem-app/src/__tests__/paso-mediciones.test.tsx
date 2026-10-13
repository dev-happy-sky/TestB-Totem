import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import PasoMediciones from '../components/paso-mediciones';
import {
  crearSensoresSimulados, ErrorSensor, type ErrorMedicion, type Lectura, type Sensor, type Sensores, type TipoSensor,
} from '../sensores';

jest.mock('@react-native-community/slider', () => 'Slider');

// Envuelve el componente con el estado que normalmente tiene la pantalla principal.
function Contenedor({ sensores, alLeer, alFallar }: { sensores: Sensores; alLeer: (l: Lectura) => void; alFallar: (e: ErrorMedicion) => void }) {
  const [lecturas, setLecturas] = useState<Partial<Record<TipoSensor, Lectura>>>({});
  return (
    <PasoMediciones
      sensores={sensores}
      lecturas={lecturas}
      onLectura={(l) => { alLeer(l); setLecturas((previas) => ({ ...previas, [l.sensor]: l })); }}
      onError={alFallar}
    />
  );
}

const montar = async (sensores: Sensores = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 })) => {
  const alLeer = jest.fn();
  const alFallar = jest.fn();
  await render(<Contenedor sensores={sensores} alLeer={alLeer} alFallar={alFallar} />);
  return { sensores, alLeer, alFallar };
};

const colorDe = (texto: RegExp | string) => StyleSheet.flatten(screen.getByText(texto).props.style).color;

describe('PasoMediciones', () => {
  test('muestra los cuatro sensores con sus instrucciones y sin valores', async () => {
    // Arrange / Act
    await montar();

    // Assert
    for (const nombre of ['Tensiómetro', 'Oxímetro', 'Balanza', 'Prueba de esfuerzo', 'Oxímetro (FC de recuperación)']) {
      expect(screen.getByLabelText(`Sensor ${nombre}`)).toBeTruthy();
      expect(screen.getByLabelText(`Medir ${nombre}`)).toBeTruthy();
    }
    expect(screen.getByText(/coloca el brazalete/)).toBeTruthy();
    expect(screen.queryByText('✓ Medición terminada correctamente')).toBeNull();
  });

  test('una medición correcta entrega la lectura al padre y muestra los valores', async () => {
    // Arrange
    const { alLeer, alFallar } = await montar();

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));

    // Assert
    await screen.findByText('✓ Medición terminada correctamente');
    expect(alLeer).toHaveBeenCalledTimes(1);
    expect(alLeer.mock.calls[0][0]).toMatchObject({ sensor: 'tensiometro', valores: { presionSys: 115, presionDia: 75 } });
    expect(alFallar).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Volver a medir Tensiómetro')).toBeTruthy();
  });

  test('mientras mide muestra "Midiendo…" y no deja medir de nuevo', async () => {
    // Arrange
    let terminar: (l: Lectura) => void = () => {};
    const sensores = crearSensoresSimulados({ latenciaMs: 0 });
    const lenta: Sensor = {
      tipo: 'tensiometro', disponible: async () => true,
      medir: () => new Promise<Lectura>((resolver) => { terminar = resolver; }),
    };
    await montar({ ...sensores, tensiometro: lenta });

    // Act (no se espera la promesa del botón: la medición sigue pendiente a propósito)
    const pulsacion = fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));

    // Assert
    expect(await screen.findByText('Midiendo…')).toBeTruthy();
    expect(screen.queryByLabelText('Medir Tensiómetro')).toBeNull();
    terminar(await crearSensoresSimulados({ latenciaMs: 0 }).tensiometro.medir());
    await pulsacion;
    await screen.findByText('✓ Medición terminada correctamente');
  });

  test('un fallo avisa al padre con sensor, código, mensaje y hora, y permite reintentar', async () => {
    // Arrange
    const { alFallar } = await montar(crearSensoresSimulados({ latenciaMs: 0, guion: { balanza: ['movimiento'] } }));

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Balanza'));

    // Assert
    expect(await screen.findByText(/No se pudo medir: Se detectó movimiento durante la medición/)).toBeTruthy();
    expect(alFallar).toHaveBeenCalledWith({
      sensor: 'balanza', codigo: 'movimiento', mensaje: 'Se detectó movimiento durante la medición', ocurrido_en: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(alFallar.mock.calls[0][0].ocurrido_en))).toBe(false);
    expect(screen.getByLabelText('Reintentar Balanza')).toBeTruthy();
  });

  test('una lectura imposible no llega al padre y se informa como lectura inválida', async () => {
    // Arrange
    const { alLeer, alFallar } = await montar(crearSensoresSimulados({ latenciaMs: 0, guion: { oximetro: ['valor_invalido'] } }));

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Oxímetro'));

    // Assert
    expect(await screen.findByText(/fuera de lo posible/)).toBeTruthy();
    expect(alLeer).not.toHaveBeenCalled();
    expect(alFallar).toHaveBeenCalledWith(expect.objectContaining({ sensor: 'oximetro', codigo: 'lectura_invalida' }));
  });

  test('un error que no es del sensor se registra como error genérico con su mensaje', async () => {
    // Arrange
    const roto: Sensor = { tipo: 'prueba_esfuerzo', disponible: async () => true, medir: async () => { throw new Error('falló el bluetooth'); } };
    const { alFallar } = await montar({ ...crearSensoresSimulados({ latenciaMs: 0 }), prueba_esfuerzo: roto });

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Prueba de esfuerzo'));

    // Assert
    expect(await screen.findByText(/falló el bluetooth/)).toBeTruthy();
    expect(alFallar).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'error', mensaje: 'falló el bluetooth' }));
  });

  test('un error sin mensaje usa un texto por defecto y los mensajes largos se recortan a 200 caracteres', async () => {
    // Arrange
    const sinMensaje: Sensor = { tipo: 'balanza', disponible: async () => true, medir: async () => { throw new Error(''); } };
    const largo: Sensor = { tipo: 'tensiometro', disponible: async () => true, medir: async () => { throw new ErrorSensor('timeout', 'x'.repeat(500)); } };
    const { alFallar } = await montar({ ...crearSensoresSimulados({ latenciaMs: 0 }), balanza: sinMensaje, tensiometro: largo });

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Balanza'));
    await fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));

    // Assert
    await waitFor(() => expect(alFallar).toHaveBeenCalledTimes(2));
    expect(alFallar.mock.calls[0][0].mensaje).toBe('Error inesperado del sensor');
    expect(alFallar.mock.calls[1][0].mensaje).toHaveLength(200);
  });

  test('un sensor desconectado al entrar muestra el aviso y "Reintentar conexión"', async () => {
    // Arrange / Act
    await montar(crearSensoresSimulados({ latenciaMs: 0, desconectados: ['tensiometro'] }));

    // Assert
    expect(await screen.findByText(/Sensor desconectado\. Revisa que esté encendido/)).toBeTruthy();
    expect(screen.getByText('Reintentar conexión')).toBeTruthy();
    expect(screen.queryByLabelText('Medir Tensiómetro')).toBeNull();
  });

  test('si disponible() falla se considera desconectado', async () => {
    // Arrange
    const caido: Sensor = { tipo: 'balanza', disponible: async () => { throw new Error('sin radio'); }, medir: async () => { throw new Error('x'); } };

    // Act
    await montar({ ...crearSensoresSimulados({ latenciaMs: 0 }), balanza: caido });

    // Assert
    expect(await screen.findByText(/Sensor desconectado/)).toBeTruthy();
  });

  test('al reconectar el sensor vuelve a poder medirse', async () => {
    // Arrange
    const sensores = crearSensoresSimulados({ latenciaMs: 0, desconectados: ['tensiometro'] });
    await montar(sensores);
    await screen.findByText(/Sensor desconectado/);
    (sensores.tensiometro as unknown as { conectar: () => void }).conectar();

    // Act
    await fireEvent.press(screen.getByText('Reintentar conexión'));

    // Assert
    await waitFor(() => expect(screen.getByLabelText('Medir Tensiómetro')).toBeTruthy());
    expect(screen.queryByText(/Sensor desconectado/)).toBeNull();
  });

  test('si el sensor se desconecta al medir se muestra como desconectado y se registra el error', async () => {
    // Arrange
    const sensores = crearSensoresSimulados({ latenciaMs: 0 });
    const { alFallar } = await montar(sensores);
    (sensores.balanza as unknown as { desconectar: () => void }).desconectar();

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Balanza'));

    // Assert
    expect(await screen.findByText(/Sensor desconectado/)).toBeTruthy();
    expect(alFallar).toHaveBeenCalledWith(expect.objectContaining({ sensor: 'balanza', codigo: 'desconectado' }));
  });

  test('volver a medir reemplaza la lectura anterior', async () => {
    // Arrange
    let azar = 0;
    const sensores = crearSensoresSimulados({ latenciaMs: 0, azar: () => azar });
    const { alLeer } = await montar(sensores);
    await fireEvent.press(screen.getByLabelText('Medir Oxímetro'));
    await screen.findByText('✓ Medición terminada correctamente');
    azar = 0.9;

    // Act
    await fireEvent.press(screen.getByLabelText('Volver a medir Oxímetro'));

    // Assert
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(2));
    expect(alLeer.mock.calls[1][0].valores.fcReposo).toBeGreaterThan(alLeer.mock.calls[0][0].valores.fcReposo);
    expect(screen.getAllByText('✓ Medición terminada correctamente')).toHaveLength(1);
  });

  test('los valores fuera del rango normal se resaltan en rojo', async () => {
    // Arrange: con azar máximo la sistólica sale en 140 mmHg (≥ 130) y el simulador mantiene la lectura válida
    await montar(crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.999 }));

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));
    await screen.findByText('✓ Medición terminada correctamente');

    // Assert
    expect(colorDe(/^140 /)).toBe('#ef4444');
  });

  test('los valores normales no se resaltan', async () => {
    // Arrange
    await montar(crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 }));

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));
    await screen.findByText('✓ Medición terminada correctamente');

    // Assert
    expect(colorDe(/^115 /)).toBe('#0f172a');
  });
});
