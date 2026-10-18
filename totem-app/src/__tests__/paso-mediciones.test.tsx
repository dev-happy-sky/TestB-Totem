import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import PasoMediciones from '../components/paso-mediciones';
import {
  crearSensoresSimulados, ErrorSensor, type ErrorMedicion, type Lectura, type LecturaEnVivo, type Sensor, type Sensores, type TipoSensor,
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

describe('registro manual del oxímetro', () => {
  const abrir = async (nombre = 'Oxímetro') => fireEvent.press(screen.getByLabelText(`Ingresar manualmente ${nombre}`));
  const escribir = async (etiqueta: string, texto: string) => fireEvent.changeText(screen.getByLabelText(etiqueta), texto);

  test('solo los oxímetros y la balanza ofrecen ingresar los valores a mano', async () => {
    // Arrange / Act
    await montar();

    // Assert
    expect(screen.getByLabelText('Ingresar manualmente Oxímetro')).toBeTruthy();
    expect(screen.getByLabelText('Ingresar manualmente Oxímetro (FC de recuperación)')).toBeTruthy();
    expect(screen.queryByLabelText('Ingresar manualmente Tensiómetro')).toBeNull();
    expect(screen.getByLabelText('Ingresar manualmente Balanza')).toBeTruthy();
    expect(screen.queryByLabelText('Ingresar manualmente Prueba de esfuerzo')).toBeNull();
  });

  test('registra SpO₂ y FC escritos a mano como una lectura del dispositivo "manual"', async () => {
    // Arrange
    const { alLeer, alFallar } = await montar();
    await abrir();

    // Act
    await escribir('SpO₂ manual', '97');
    await escribir('FC REPOSO manual', '72');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Oxímetro'));

    // Assert
    await screen.findByText('✓ Medición terminada correctamente');
    expect(alLeer).toHaveBeenCalledTimes(1);
    expect(alLeer.mock.calls[0][0]).toMatchObject({
      sensor: 'oximetro', valores: { spo2: 97, fcReposo: 72 }, dispositivo: { id: 'manual', calibracion: 'desconocida' },
    });
    expect(alFallar).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('SpO₂ manual')).toBeNull();
  });

  test('registra la FC de recuperación a mano', async () => {
    // Arrange
    const { alLeer } = await montar();
    await abrir('Oxímetro (FC de recuperación)');

    // Act
    await escribir('FC RECUP. manual', '110');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Oxímetro (FC de recuperación)'));

    // Assert
    await screen.findByText('✓ Medición terminada correctamente');
    expect(alLeer.mock.calls[0][0]).toMatchObject({ sensor: 'oximetro_recuperacion', valores: { fcRecup: 110 } });
  });

  test('acepta un número con coma o espacios y rechaza uno que no es entero', async () => {
    // Arrange
    const { alLeer } = await montar();
    await abrir();
    await escribir('SpO₂ manual', '96,5');
    await escribir('FC REPOSO manual', '72');

    // Act
    await fireEvent.press(screen.getByLabelText('Registrar valores de Oxímetro'));

    // Assert
    expect((await screen.findByRole('alert')).props.children).toContain('número entero');
    expect(alLeer).not.toHaveBeenCalled();
  });

  test('con un campo vacío pide completarlo y no registra nada', async () => {
    // Arrange
    const { alLeer } = await montar();
    await abrir();
    await escribir('SpO₂ manual', '97');

    // Act
    await fireEvent.press(screen.getByLabelText('Registrar valores de Oxímetro'));

    // Assert
    expect((await screen.findByRole('alert')).props.children).toContain('FC REPOSO');
    expect(alLeer).not.toHaveBeenCalled();
  });

  test('un valor imposible (SpO₂ 150) se rechaza con la misma validación que el sensor', async () => {
    // Arrange
    const { alLeer } = await montar();
    await abrir();
    await escribir('SpO₂ manual', '150');
    await escribir('FC REPOSO manual', '72');

    // Act
    await fireEvent.press(screen.getByLabelText('Registrar valores de Oxímetro'));

    // Assert
    expect((await screen.findByRole('alert')).props.children).toContain('fuera de lo posible');
    expect(alLeer).not.toHaveBeenCalled();
  });

  test('cancelar cierra el ingreso sin registrar', async () => {
    // Arrange
    const { alLeer } = await montar();
    await abrir();

    // Act
    await fireEvent.press(screen.getByLabelText('Cancelar ingreso manual de Oxímetro'));

    // Assert
    expect(screen.queryByLabelText('SpO₂ manual')).toBeNull();
    expect(alLeer).not.toHaveBeenCalled();
  });

  test('funciona aunque el oxímetro esté desconectado', async () => {
    // Arrange
    const sensores = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 });
    const desconectado: Sensor = { tipo: 'oximetro', disponible: async () => false, medir: async () => { throw new Error('x'); } };
    const { alLeer } = await montar({ ...sensores, oximetro: desconectado });
    await screen.findByText(/Sensor desconectado/);

    // Act
    await abrir();
    await escribir('SpO₂ manual', '98');
    await escribir('FC REPOSO manual', '65');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Oxímetro'));

    // Assert
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));
    expect(alLeer.mock.calls[0][0].dispositivo.id).toBe('manual');
  });
});

describe('lectura en vivo del oxímetro', () => {
  const montarConVivo = async (secuencia: LecturaEnVivo[]) => {
    const simulados = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 });
    let i = 0;
    const enVivo = jest.fn(async () => secuencia[Math.min(i++, secuencia.length - 1)]);
    const conVivo = (tipo: 'oximetro' | 'oximetro_recuperacion'): Sensor => ({ ...simulados[tipo], tipo, disponible: simulados[tipo].disponible.bind(simulados[tipo]), medir: simulados[tipo].medir.bind(simulados[tipo]), enVivo });
    const sensores = { ...simulados, oximetro: conVivo('oximetro'), oximetro_recuperacion: conVivo('oximetro_recuperacion') };
    await render(
      <PasoMediciones sensores={sensores} lecturas={{}} onLectura={jest.fn()} onError={jest.fn()} intervaloEnVivoMs={20} />,
    );
    return enVivo;
  };

  test('muestra SpO₂ y FC que va enviando el oxímetro sin pulsar nada', async () => {
    // Arrange / Act
    await montarConVivo([{ valida: true, spo2: 97, fc: 72 }]);

    // Assert
    const tarjeta = await screen.findByLabelText('En vivo Oxímetro');
    expect(tarjeta).toBeTruthy();
    expect(await screen.findByText('SpO₂ 97 %  ·  FC 72 lpm')).toBeTruthy();
    expect(await screen.findByText('FC 72 lpm')).toBeTruthy();   // la tarjeta de recuperación solo muestra FC
  });

  test('actualiza los valores cuando cambian', async () => {
    // Arrange / Act
    await montarConVivo([{ valida: true, spo2: 97, fc: 72 }, { valida: true, spo2: 95, fc: 80 }]);

    // Assert
    expect(await screen.findByText('SpO₂ 95 %  ·  FC 80 lpm')).toBeTruthy();
  });

  test.each([
    ['sin_dedo', 'Coloca el dedo en el oxímetro'],
    ['sin_senal', 'Sin señal del oxímetro'],
    ['desconectado', 'Oxímetro no conectado'],
  ] as const)('cuando no hay valor explica por qué (%s)', async (motivo, texto) => {
    // Arrange / Act
    await montarConVivo([{ valida: false, motivo }]);

    // Assert
    expect((await screen.findAllByText(texto)).length).toBe(2);
  });

  test('los sensores sin lectura en vivo no muestran el recuadro', async () => {
    // Arrange / Act
    await montarConVivo([{ valida: true, spo2: 97, fc: 72 }]);
    await screen.findByLabelText('En vivo Oxímetro');

    // Assert
    expect(screen.queryByLabelText('En vivo Tensiómetro')).toBeNull();
    expect(screen.queryByLabelText('En vivo Balanza')).toBeNull();
  });

  test('deja de consultar al salir de la pantalla', async () => {
    // Arrange
    const enVivo = await montarConVivo([{ valida: true, spo2: 97, fc: 72 }]);
    await screen.findByLabelText('En vivo Oxímetro');

    // Act
    await screen.unmount();
    const llamadas = enVivo.mock.calls.length;
    await new Promise((r) => setTimeout(r, 80));

    // Assert
    expect(enVivo.mock.calls.length).toBe(llamadas);
  });

  test('con sensores simulados (sin lectura en vivo) todo sigue igual', async () => {
    // Arrange / Act
    await montar();

    // Assert
    expect(screen.queryByLabelText('En vivo Oxímetro')).toBeNull();
  });
});

describe('báscula: lectura en vivo y peso manual', () => {
  const montarBascula = async (secuencia: LecturaEnVivo[]) => {
    const simulados = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 });
    let i = 0;
    const enVivo = jest.fn(async () => secuencia[Math.min(i++, secuencia.length - 1)]);
    const balanza: Sensor = { ...simulados.balanza, tipo: 'balanza', disponible: async () => true, medir: simulados.balanza.medir.bind(simulados.balanza), enVivo };
    const alLeer = jest.fn();
    await render(
      <PasoMediciones sensores={{ ...simulados, balanza }} lecturas={{}} onLectura={alLeer} onError={jest.fn()} intervaloEnVivoMs={20} />,
    );
    return { alLeer };
  };

  test('muestra el peso que emite la báscula sin pulsar nada', async () => {
    // Arrange / Act
    await montarBascula([{ valida: true, peso: 53.4 }]);

    // Assert
    expect(await screen.findByText('Peso 53.4 kg')).toBeTruthy();
    expect(screen.getByLabelText('En vivo Balanza')).toBeTruthy();
  });

  test.each([
    ['sin_carga', 'Súbete a la báscula'], ['sin_senal', 'Súbete a la báscula'], ['desconectado', 'Báscula no disponible'],
  ] as const)('sin peso explica qué hacer (%s)', async (motivo, texto) => {
    // Arrange / Act
    await montarBascula([{ valida: false, motivo }]);

    // Assert
    expect(await screen.findByText(texto)).toBeTruthy();
  });

  test('el peso manual acepta decimales (con coma) y se registra con un decimal como dispositivo manual', async () => {
    // Arrange
    const { alLeer } = await montarBascula([{ valida: false, motivo: 'sin_senal' }]);
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Balanza'));

    // Act
    await fireEvent.changeText(screen.getByLabelText('PESO manual'), '53,4');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Balanza'));

    // Assert
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));
    expect(alLeer.mock.calls[0][0]).toMatchObject({
      sensor: 'balanza', valores: { peso: '53.4' }, dispositivo: { id: 'manual', calibracion: 'desconocida' },
    });
    expect(Object.keys(alLeer.mock.calls[0][0].valores)).toEqual(['peso']);
  });

  test.each([['', 'ingresa un número'], ['abc', 'ingresa un número'], ['900', 'fuera de lo posible'], ['5', 'fuera de lo posible']])(
    'un peso manual inválido (%j) se rechaza', async (texto, mensaje) => {
      // Arrange
      const { alLeer } = await montarBascula([{ valida: false, motivo: 'sin_senal' }]);
      await fireEvent.press(screen.getByLabelText('Ingresar manualmente Balanza'));

      // Act
      await fireEvent.changeText(screen.getByLabelText('PESO manual'), texto);
      await fireEvent.press(screen.getByLabelText('Registrar valores de Balanza'));

      // Assert
      expect((await screen.findByRole('alert')).props.children).toContain(mensaje);
      expect(alLeer).not.toHaveBeenCalled();
    });
});
