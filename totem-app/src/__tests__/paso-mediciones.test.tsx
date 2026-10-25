import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import PasoMediciones from '../components/paso-mediciones';
import {
  crearSensoresSimulados, ErrorSensor, GUIA_ESCALON, type ErrorMedicion, type Lectura, type LecturaEnVivo, type ProgresoPrueba, type Sensor,
  type Sensores, type TipoSensor,
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
    expect(await screen.findByText('Esperando la medición: pulsa Start en el tensiómetro…')).toBeTruthy();
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

  test('el tensiómetro, los oxímetros, la balanza y la prueba de esfuerzo ofrecen ingresar los valores a mano', async () => {
    // Arrange / Act
    await montar();

    // Assert
    expect(screen.getByLabelText('Ingresar manualmente Oxímetro')).toBeTruthy();
    expect(screen.getByLabelText('Ingresar manualmente Oxímetro (FC de recuperación)')).toBeTruthy();
    expect(screen.getByLabelText('Ingresar manualmente Tensiómetro')).toBeTruthy();
    expect(screen.getByLabelText('Ingresar manualmente Balanza')).toBeTruthy();
    expect(screen.getByLabelText('Ingresar manualmente Prueba de esfuerzo')).toBeTruthy();
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

describe('tensiómetro: presión manual', () => {
  const abrir = async () => {
    const montado = await montar();
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Tensiómetro'));
    return montado;
  };

  test('registra sistólica y diastólica escritas a mano como dispositivo manual', async () => {
    // Arrange
    const { alLeer } = await abrir();

    // Act
    await fireEvent.changeText(screen.getByLabelText('SISTÓLICA manual'), '118');
    await fireEvent.changeText(screen.getByLabelText('DIASTÓLICA manual'), '78');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Tensiómetro'));

    // Assert
    await screen.findByText('✓ Medición terminada correctamente');
    expect(alLeer.mock.calls[0][0]).toMatchObject({
      sensor: 'tensiometro', valores: { presionSys: 118, presionDia: 78 }, dispositivo: { id: 'manual', calibracion: 'desconocida' },
    });
  });

  test('una sistólica menor o igual que la diastólica se rechaza', async () => {
    // Arrange
    const { alLeer } = await abrir();

    // Act
    await fireEvent.changeText(screen.getByLabelText('SISTÓLICA manual'), '80');
    await fireEvent.changeText(screen.getByLabelText('DIASTÓLICA manual'), '90');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Tensiómetro'));

    // Assert
    expect((await screen.findByRole('alert')).props.children).toContain('mayor que la diastólica');
    expect(alLeer).not.toHaveBeenCalled();
  });

  test('exige números enteros', async () => {
    // Arrange
    await abrir();

    // Act
    await fireEvent.changeText(screen.getByLabelText('SISTÓLICA manual'), '118,5');
    await fireEvent.changeText(screen.getByLabelText('DIASTÓLICA manual'), '78');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Tensiómetro'));

    // Assert
    expect((await screen.findByRole('alert')).props.children).toContain('número entero');
  });
});

describe('estatura manual e IMC', () => {
  const LECTURA_PESO: Lectura = {
    sensor: 'balanza', valores: { peso: '53.7' }, dispositivo: { id: 'E0:D3', calibracion: 'desconocida' }, capturadoEn: '2026-10-17T22:30:00Z',
  };

  const montarEstatura = async (opciones: { peso?: boolean; estatura?: number | null } = {}) => {
    const alCambiar = jest.fn();
    const sensores = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 });
    const lecturas: Partial<Record<TipoSensor, Lectura>> = opciones.peso ? { balanza: LECTURA_PESO } : {};
    await render(
      <PasoMediciones sensores={sensores} lecturas={lecturas} onLectura={jest.fn()} onError={jest.fn()}
                      estaturaCm={opciones.estatura ?? null} onEstatura={alCambiar} />,
    );
    return { alCambiar };
  };

  test('sin onEstatura la tarjeta no aparece', async () => {
    // Arrange / Act
    await montar();

    // Assert
    expect(screen.queryByLabelText('Estatura e IMC')).toBeNull();
  });

  test('con onEstatura aparece la tarjeta, sin valores inventados', async () => {
    // Arrange / Act
    await montarEstatura();

    // Assert
    expect(screen.getByLabelText('Estatura e IMC')).toBeTruthy();
    expect(screen.getByLabelText('Estatura manual')).toBeTruthy();
    expect(screen.getAllByText('--', { exact: false }).length).toBeGreaterThanOrEqual(2);
  });

  test('guarda la estatura escrita en centímetros (acepta coma)', async () => {
    // Arrange
    const { alCambiar } = await montarEstatura();

    // Act
    await fireEvent.changeText(screen.getByLabelText('Estatura manual'), '172,5');
    await fireEvent.press(screen.getByLabelText('Guardar estatura'));

    // Assert
    expect(alCambiar).toHaveBeenCalledWith(172.5);
  });

  test.each([['abc', 'centímetros'], ['1,72', 'no en metros'], ['300', 'entre 100 y 250']])(
    'una estatura inválida (%j) muestra el motivo y no se guarda', async (texto, motivo) => {
      // Arrange
      const { alCambiar } = await montarEstatura();

      // Act
      await fireEvent.changeText(screen.getByLabelText('Estatura manual'), texto);
      await fireEvent.press(screen.getByLabelText('Guardar estatura'));

      // Assert
      expect((await screen.findByRole('alert')).props.children).toContain(motivo);
      expect(alCambiar).not.toHaveBeenCalled();
    });

  test('con estatura y peso muestra el IMC calculado', async () => {
    // Arrange / Act
    await montarEstatura({ peso: true, estatura: 172 });

    // Assert
    expect(screen.getByText(/^172 /)).toBeTruthy();
    expect(screen.getByText(/^18\.2 /)).toBeTruthy();
    expect(screen.getByLabelText('Cambiar estatura')).toBeTruthy();
    expect(screen.queryByLabelText('Estatura manual')).toBeNull();
  });

  test('un IMC fuera del rango normal se resalta en rojo', async () => {
    // Arrange / Act: 53,7 kg a 172 cm = 18,2 (< 18,5)
    await montarEstatura({ peso: true, estatura: 172 });

    // Assert
    expect(colorDe(/^18\.2 /)).toBe('#ef4444');
  });

  test('un IMC normal no se resalta', async () => {
    // Arrange / Act: 53,7 kg a 160 cm = 21,0
    await montarEstatura({ peso: true, estatura: 160 });

    // Assert
    expect(colorDe(/^21\.0 /)).toBe('#0f172a');
  });

  test('con estatura pero sin peso avisa que falta pesarse', async () => {
    // Arrange / Act
    await montarEstatura({ estatura: 172 });

    // Assert
    expect(screen.getByText(/Falta el peso/)).toBeTruthy();
  });

  test('un IMC imposible muestra el error', async () => {
    // Arrange / Act: 53,7 kg a 250 cm = 8,6
    await montarEstatura({ peso: true, estatura: 250 });

    // Assert
    expect((await screen.findByRole('alert')).props.children).toContain('fuera de lo posible');
  });

  test('cambiar la estatura la borra para volver a escribirla', async () => {
    // Arrange
    const { alCambiar } = await montarEstatura({ peso: true, estatura: 172 });

    // Act
    await fireEvent.press(screen.getByLabelText('Cambiar estatura'));

    // Assert
    expect(alCambiar).toHaveBeenCalledWith(null);
  });
});

describe('bloqueo hasta escribir la estatura', () => {
  const montarBloqueo = async (estaturaCm: number | null, conTarjeta = true) => {
    const alLeer = jest.fn();
    const sensores = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 });
    await render(
      <PasoMediciones sensores={sensores} lecturas={{}} onLectura={alLeer} onError={jest.fn()}
                      {...(conTarjeta ? { estaturaCm, onEstatura: jest.fn() } : {})} />,
    );
    return { alLeer };
  };
  const SENSORES = ['Tensiómetro', 'Oxímetro', 'Balanza', 'Prueba de esfuerzo', 'Oxímetro (FC de recuperación)'];

  test('sin estatura cada sensor muestra el candado y su botón está deshabilitado', async () => {
    // Arrange / Act
    await montarBloqueo(null);

    // Assert
    expect(screen.getAllByText('🔒 Primero ingresa tu estatura')).toHaveLength(SENSORES.length);
    for (const sensor of SENSORES) {
      expect(screen.getByLabelText(`Medir ${sensor}`).props.accessibilityState?.disabled).toBe(true);
      expect(screen.getByLabelText(`Sensor ${sensor}`).props.accessibilityState?.disabled).toBe(true);
    }
  });

  test('sin estatura no se puede medir ni registrar valores a mano', async () => {
    // Arrange
    const { alLeer } = await montarBloqueo(null);

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));

    // Assert
    expect(alLeer).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Ingresar manualmente Tensiómetro')).toBeNull();
    expect(screen.queryByLabelText('Ingresar manualmente Balanza')).toBeNull();
  });

  test('con estatura guardada todo queda habilitado y se puede medir', async () => {
    // Arrange
    const { alLeer } = await montarBloqueo(172);

    // Act
    await fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));

    // Assert
    expect(screen.queryByText('🔒 Primero ingresa tu estatura')).toBeNull();
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Ingresar manualmente Tensiómetro')).toBeTruthy();
  });

  test('sin la tarjeta de estatura (onEstatura no pasado) no hay bloqueo', async () => {
    // Arrange / Act
    await montarBloqueo(null, false);

    // Assert
    expect(screen.queryByText('🔒 Primero ingresa tu estatura')).toBeNull();
    expect(screen.getByLabelText('Medir Tensiómetro').props.accessibilityState?.disabled).toBeFalsy();
  });

  test('la tarjeta de estatura aparece antes que los sensores', async () => {
    // Arrange / Act
    await montarBloqueo(null);

    // Assert
    const texto = JSON.stringify(screen.toJSON());
    expect(texto.indexOf('Estatura e IMC')).toBeLessThan(texto.indexOf('Sensor Tensiómetro'));
  });
});

describe('ingreso manual mientras el sensor espera', () => {
  const LECTURA_AUTO: Lectura = {
    sensor: 'tensiometro', valores: { presionSys: 130, presionDia: 85 }, dispositivo: { id: '0C:7F:ED:74:07:54', calibracion: 'desconocida' },
    capturadoEn: '2026-10-18T10:00:00Z',
  };

  // Un tensiómetro cuya medición queda pendiente hasta que la prueba la termine o falle.
  const montarEspera = async () => {
    let terminar: (l: Lectura) => void = () => {};
    let fallar: (e: Error) => void = () => {};
    const simulados = crearSensoresSimulados({ latenciaMs: 0 });
    const lento: Sensor = {
      tipo: 'tensiometro', disponible: async () => true,
      medir: () => new Promise<Lectura>((resolver, rechazar) => { terminar = resolver; fallar = rechazar; }),
    };
    const alLeer = jest.fn();
    const alFallar = jest.fn();
    await render(<PasoMediciones sensores={{ ...simulados, tensiometro: lento }} lecturas={{}} onLectura={alLeer} onError={alFallar} />);
    return { alLeer, alFallar, terminar: (l: Lectura) => terminar(l), fallar: (e: Error) => fallar(e) };
  };

  // Empieza a esperar la medición; la promesa devuelta debe esperarse al final de la prueba, cuando el sensor ya respondió.
  const empezarEspera = async () => {
    const pulsacion = fireEvent.press(screen.getByLabelText('Medir Tensiómetro'));
    await screen.findByText('Esperando la medición: pulsa Start en el tensiómetro…');
    return { pulsacion };   // envuelta: devolver la promesa tal cual haría que `await` espere a que termine la medición
  };

  const escribirManual = async (sistolica: string, diastolica: string) => {
    await fireEvent.press(await screen.findByLabelText('Ingresar manualmente Tensiómetro'));
    await fireEvent.changeText(screen.getByLabelText('SISTÓLICA manual'), sistolica);
    await fireEvent.changeText(screen.getByLabelText('DIASTÓLICA manual'), diastolica);
    await fireEvent.press(screen.getByLabelText('Registrar valores de Tensiómetro'));
  };

  test('mientras espera la medición del tensiómetro sigue disponible escribir los valores a mano', async () => {
    // Arrange
    const { terminar } = await montarEspera();

    // Act
    const { pulsacion } = await empezarEspera();

    // Assert
    expect(screen.getByLabelText('Ingresar manualmente Tensiómetro')).toBeTruthy();
    terminar(LECTURA_AUTO);
    await pulsacion;
  });

  test('escribir a mano cancela la espera y registra los valores manuales', async () => {
    // Arrange
    const { alLeer, terminar } = await montarEspera();
    const { pulsacion } = await empezarEspera();

    // Act
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Tensiómetro'));
    expect(screen.queryByText('Esperando la medición: pulsa Start en el tensiómetro…')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('SISTÓLICA manual'), '118');
    await fireEvent.changeText(screen.getByLabelText('DIASTÓLICA manual'), '78');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Tensiómetro'));

    // Assert
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));
    expect(alLeer.mock.calls[0][0]).toMatchObject({ valores: { presionSys: 118, presionDia: 78 }, dispositivo: { id: 'manual' } });
    terminar(LECTURA_AUTO);
    await pulsacion;
  });

  test('si el aparato entrega su medición después de cancelar, se descarta y no pisa los valores manuales', async () => {
    // Arrange
    const { alLeer, terminar } = await montarEspera();
    const { pulsacion } = await empezarEspera();
    await escribirManual('118', '78');
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));

    // Act: llega tarde la medición del aparato
    terminar(LECTURA_AUTO);
    await pulsacion;

    // Assert
    expect(alLeer).toHaveBeenCalledTimes(1);
    expect(alLeer.mock.calls[0][0].dispositivo.id).toBe('manual');
  });

  test('un error tardío del aparato tras cancelar no muestra ningún aviso ni se registra', async () => {
    // Arrange
    const { alFallar, fallar } = await montarEspera();
    const { pulsacion } = await empezarEspera();
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Tensiómetro'));

    // Act
    fallar(new Error('se agotó el tiempo'));
    await pulsacion;

    // Assert
    expect(alFallar).not.toHaveBeenCalled();
    expect(screen.queryByText(/No se pudo medir/)).toBeNull();
  });

  test('abrir el ingreso manual sin que haya espera no cambia nada más', async () => {
    // Arrange
    const { alLeer } = await montarEspera();

    // Act
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Tensiómetro'));

    // Assert
    expect(screen.getByLabelText('SISTÓLICA manual')).toBeTruthy();
    expect(alLeer).not.toHaveBeenCalled();
  });

  test('una nueva medición automática después de cancelar sí se acepta', async () => {
    // Arrange: la primera espera se cancela al escribir a mano y su resultado tardío se descarta
    const { alLeer, terminar } = await montarEspera();
    const { pulsacion: primera } = await empezarEspera();
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Tensiómetro'));
    terminar(LECTURA_AUTO);
    await primera;
    expect(alLeer).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Cancelar ingreso manual de Tensiómetro'));

    // Act
    const { pulsacion: segunda } = await empezarEspera();
    terminar(LECTURA_AUTO);
    await segunda;

    // Assert
    expect(alLeer).toHaveBeenCalledTimes(1);
    expect(alLeer).toHaveBeenCalledWith(LECTURA_AUTO);
  });
});

describe('prueba de esfuerzo: ingreso manual del VO₂ máx', () => {
  const abrir = async () => {
    const montado = await montar();
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Prueba de esfuerzo'));
    return montado;
  };

  test('registra el VO₂ máx escrito a mano (acepta coma) como dispositivo manual', async () => {
    // Arrange
    const { alLeer } = await abrir();

    // Act
    await fireEvent.changeText(screen.getByLabelText('VO₂ MÁX manual'), '45,5');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Prueba de esfuerzo'));

    // Assert
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));
    expect(alLeer.mock.calls[0][0]).toMatchObject({
      sensor: 'prueba_esfuerzo', valores: { vo2Max: '45.5' }, dispositivo: { id: 'manual', calibracion: 'desconocida' },
    });
  });

  test.each([['', 'ingresa un número'], ['abc', 'ingresa un número'], ['3', 'fuera de lo posible'], ['150', 'fuera de lo posible']])(
    'un valor inválido (%j) se rechaza', async (texto, motivo) => {
      // Arrange
      const { alLeer } = await abrir();

      // Act
      await fireEvent.changeText(screen.getByLabelText('VO₂ MÁX manual'), texto);
      await fireEvent.press(screen.getByLabelText('Registrar valores de Prueba de esfuerzo'));

      // Assert
      expect((await screen.findByRole('alert')).props.children).toContain(motivo);
      expect(alLeer).not.toHaveBeenCalled();
    });

  test('con sensores simulados (sin prueba guiada) no se pregunta el sexo ni se muestran instrucciones del escalón', async () => {
    // Arrange / Act
    await montar();

    // Assert
    expect(screen.queryByLabelText('Sexo para la prueba')).toBeNull();
    expect(screen.queryByText(/PRUEBA DEL ESCALÓN/)).toBeNull();
  });
});

describe('prueba de esfuerzo guiada (prueba del escalón)', () => {
  const FC = (fc: number): Lectura => ({
    sensor: 'oximetro_recuperacion', valores: { fcRecup: fc }, dispositivo: { id: 'AA:BB', calibracion: 'desconocida' }, capturadoEn: '2026-10-19T10:00:00Z',
  });
  const VO2 = (adicionales: Lectura[] = [FC(150)]): Lectura => ({
    sensor: 'prueba_esfuerzo', valores: { vo2Max: '48.3' }, dispositivo: { id: 'prueba-escalon', calibracion: 'desconocida' },
    capturadoEn: '2026-10-19T10:00:00Z', adicionales,
  });

  // Una prueba guiada controlada desde la prueba: la pantalla ve el progreso que se le fije y el resultado que se le entregue.
  const crearGuiada = () => {
    let progreso: ProgresoPrueba | null = null;
    let terminar: (l: Lectura) => void = () => {};
    let fallar: (e: Error) => void = () => {};
    const sensor = {
      tipo: 'prueba_esfuerzo' as const, guia: GUIA_ESCALON,
      disponible: async () => true,
      medir: () => new Promise<Lectura>((resolver, rechazar) => { terminar = resolver; fallar = rechazar; }),
      configurar: jest.fn(), cancelar: jest.fn(), progreso: () => progreso,
    };
    return {
      sensor, fijar: (p: ProgresoPrueba | null) => { progreso = p; },
      terminar: (l: Lectura) => terminar(l), fallar: (e: Error) => fallar(e),
    };
  };

  const montarGuiada = async () => {
    const guiada = crearGuiada();
    const simulados = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 });
    const alLeer = jest.fn();
    const alFallar = jest.fn();
    await render(<Contenedor sensores={{ ...simulados, prueba_esfuerzo: guiada.sensor as unknown as Sensor }} alLeer={alLeer} alFallar={alFallar} />);
    return { ...guiada, alLeer, alFallar };
  };

  const empezar = async (sexo: 'Hombre' | 'Mujer' = 'Hombre') => {
    await fireEvent.press(screen.getByLabelText(`Sexo para la prueba: ${sexo}`));
    const pulsacion = fireEvent.press(screen.getByLabelText('Iniciar prueba del escalón'));
    await screen.findByLabelText('Progreso Prueba de esfuerzo');
    return { pulsacion };   // envuelta: devolver la promesa tal cual haría que `await` espere a que termine la prueba
  };

  const prueba = (restanteS: number, transcurridoS: number, tiemposPorMinuto = 96): ProgresoPrueba =>
    ({ fase: 'prueba', restanteS, transcurridoS, tiemposPorMinuto });

  test('muestra las instrucciones de la prueba del escalón', async () => {
    // Arrange / Act
    await montarGuiada();

    // Assert
    expect(screen.getByText('PRUEBA DEL ESCALÓN')).toBeTruthy();
    expect(screen.getByText(/escalón o banco de unos 40 cm/)).toBeTruthy();
    expect(screen.getByText(/durante 3 minutos/)).toBeTruthy();
  });

  test('pide el sexo y no deja iniciar hasta elegirlo', async () => {
    // Arrange
    const { sensor } = await montarGuiada();

    // Assert
    expect(screen.getByLabelText('Sexo para la prueba: Hombre')).toBeTruthy();
    expect(screen.getByLabelText('Sexo para la prueba: Mujer')).toBeTruthy();
    expect(screen.getByLabelText('Iniciar prueba del escalón').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('Iniciar prueba del escalón'));
    expect(screen.queryByLabelText('Progreso Prueba de esfuerzo')).toBeNull();
    expect(sensor.configurar).not.toHaveBeenCalled();
  });

  test('elegir el sexo lo informa a la prueba y habilita el botón', async () => {
    // Arrange
    const { sensor } = await montarGuiada();

    // Act
    await fireEvent.press(screen.getByLabelText('Sexo para la prueba: Mujer'));

    // Assert
    expect(sensor.configurar).toHaveBeenCalledWith({ sexo: 'mujer' });
    expect(screen.getByLabelText('Sexo para la prueba: Mujer').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Sexo para la prueba: Hombre').props.accessibilityState.selected).toBe(false);
    expect(screen.getByLabelText('Iniciar prueba del escalón').props.accessibilityState.disabled).toBe(false);
  });

  test('durante la prueba muestra la cuenta regresiva y marca el tiempo del ritmo que toca', async () => {
    // Arrange
    const { fijar, terminar, alLeer } = await montarGuiada();
    fijar(prueba(165, 15));                               // 15 s a 96 tiempos/min = 24 tiempos → índice 24 % 4 = 0 → SUBE
    const { pulsacion } = await empezar();

    // Assert
    await waitFor(() => expect(screen.getByLabelText('Tiempo restante')).toHaveTextContent('2:45'));
    expect(screen.getByText('Sube y baja al ritmo')).toBeTruthy();
    expect(screen.getAllByText('SUBE')).toHaveLength(2);
    expect(screen.getAllByText('BAJA')).toHaveLength(2);
    const activos = screen.getAllByText(/SUBE|BAJA/).filter((t) => t.props.style && JSON.stringify(t.props.style).includes('#fff'));
    expect(activos.length).toBeGreaterThanOrEqual(1);
    terminar(VO2());
    await pulsacion;
    expect(alLeer).toHaveBeenCalled();
  });

  test('la cuenta regresiva se actualiza con el avance de la prueba', async () => {
    // Arrange
    const { fijar, terminar } = await montarGuiada();
    fijar(prueba(180, 0));
    const { pulsacion } = await empezar();
    await waitFor(() => expect(screen.getByLabelText('Tiempo restante')).toHaveTextContent('3:00'));

    // Act
    fijar(prueba(59, 121));

    // Assert
    await waitFor(() => expect(screen.getByLabelText('Tiempo restante')).toHaveTextContent('0:59'));
    terminar(VO2());
    await pulsacion;
  });

  test('al terminar la prueba pide sentarse y poner el dedo, y luego avisa que mide el pulso', async () => {
    // Arrange
    const { fijar, terminar } = await montarGuiada();
    fijar(prueba(1, 179));
    const { pulsacion } = await empezar();

    // Act / Assert
    fijar({ fase: 'espera', restanteS: 4, transcurridoS: 180, tiemposPorMinuto: 96 });
    expect(await screen.findByText('Siéntate y coloca el dedo en el oxímetro')).toBeTruthy();
    expect(screen.getByText('4 s')).toBeTruthy();
    fijar({ fase: 'midiendo', restanteS: 0, transcurridoS: 180, tiemposPorMinuto: 96 });
    expect(await screen.findByText(/Midiendo tu pulso/)).toBeTruthy();
    terminar(VO2());
    await pulsacion;
  });

  test('mientras corre no se puede volver a iniciar y aparece «Cancelar prueba»', async () => {
    // Arrange
    const { fijar, terminar } = await montarGuiada();
    fijar(prueba(100, 80));

    // Act
    const { pulsacion } = await empezar();

    // Assert
    expect(screen.queryByLabelText('Iniciar prueba del escalón')).toBeNull();
    expect(screen.getByLabelText('Cancelar la prueba del escalón')).toBeTruthy();
    expect(screen.queryByLabelText('Sexo para la prueba')).toBeNull();
    terminar(VO2());
    await pulsacion;
  });

  test('al terminar registra el VO₂ máx y también la FC de recuperación que midió', async () => {
    // Arrange
    const { terminar, alLeer } = await montarGuiada();
    const { pulsacion } = await empezar();

    // Act
    terminar(VO2([FC(142)]));
    await pulsacion;

    // Assert: terminan las dos tarjetas, la de la prueba y la de la FC de recuperación
    expect(await screen.findAllByText('✓ Medición terminada correctamente')).toHaveLength(2);
    expect(alLeer).toHaveBeenCalledTimes(2);
    expect(alLeer.mock.calls[0][0]).toMatchObject({ sensor: 'prueba_esfuerzo', valores: { vo2Max: '48.3' } });
    expect(alLeer.mock.calls[1][0]).toMatchObject({ sensor: 'oximetro_recuperacion', valores: { fcRecup: 142 } });
    expect(screen.getByLabelText('Repetir prueba del escalón')).toBeTruthy();
  });

  test('una FC de recuperación adicional imposible no se registra, pero el resultado sí', async () => {
    // Arrange
    const { terminar, alLeer } = await montarGuiada();
    const { pulsacion } = await empezar();

    // Act
    terminar(VO2([FC(999)]));
    await pulsacion;

    // Assert
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));
    expect(alLeer.mock.calls[0][0].sensor).toBe('prueba_esfuerzo');
  });

  test('cancelar detiene la prueba, no registra nada y permite volver a empezar', async () => {
    // Arrange
    const { sensor, terminar, alLeer } = await montarGuiada();
    const { pulsacion } = await empezar();

    // Act
    await fireEvent.press(screen.getByLabelText('Cancelar la prueba del escalón'));

    // Assert
    expect(sensor.cancelar).toHaveBeenCalled();
    expect(screen.queryByLabelText('Progreso Prueba de esfuerzo')).toBeNull();
    expect(screen.getByLabelText('Iniciar prueba del escalón')).toBeTruthy();
    terminar(VO2());                                   // el resultado tardío de la prueba cancelada se descarta
    await pulsacion;
    expect(alLeer).not.toHaveBeenCalled();
  });

  test('escribir el VO₂ a mano durante la prueba la cancela y el resultado tardío no pisa lo escrito', async () => {
    // Arrange
    const { sensor, terminar, alLeer } = await montarGuiada();
    const { pulsacion } = await empezar();

    // Act
    await fireEvent.press(screen.getByLabelText('Ingresar manualmente Prueba de esfuerzo'));
    expect(sensor.cancelar).toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('VO₂ MÁX manual'), '40');
    await fireEvent.press(screen.getByLabelText('Registrar valores de Prueba de esfuerzo'));
    await waitFor(() => expect(alLeer).toHaveBeenCalledTimes(1));
    terminar(VO2());
    await pulsacion;

    // Assert
    expect(alLeer).toHaveBeenCalledTimes(1);
    expect(alLeer.mock.calls[0][0]).toMatchObject({ valores: { vo2Max: '40.0' }, dispositivo: { id: 'manual' } });
  });

  test('si falla (por ejemplo, sin dedo en el oxímetro) muestra el motivo, lo registra y permite reintentar', async () => {
    // Arrange
    const { fallar, alFallar } = await montarGuiada();
    const { pulsacion } = await empezar();

    // Act
    fallar(new ErrorSensor('lectura_invalida', 'No se detecta el dedo'));
    await pulsacion;

    // Assert
    expect((await screen.findByRole('alert')).props.children.join('')).toContain('No se detecta el dedo');
    expect(alFallar).toHaveBeenCalledWith(expect.objectContaining({ sensor: 'prueba_esfuerzo', codigo: 'lectura_invalida' }));
    expect(screen.getByLabelText('Reintentar prueba del escalón')).toBeTruthy();
  });

  test('al salir de la pantalla se cancela la prueba para que no siga corriendo', async () => {
    // Arrange
    const { sensor, terminar } = await montarGuiada();
    const { pulsacion } = await empezar();

    // Act
    await screen.unmount();
    terminar(VO2());
    await pulsacion;

    // Assert
    expect(sensor.cancelar).toHaveBeenCalled();
  });

  test('las demás tarjetas no piden el sexo ni muestran instrucciones de la prueba', async () => {
    // Arrange / Act
    await montarGuiada();

    // Assert
    expect(screen.getAllByLabelText('Sexo para la prueba')).toHaveLength(1);
    expect(screen.getAllByText('PRUEBA DEL ESCALÓN')).toHaveLength(1);
  });
});

describe('tensiómetro: estado en vivo', () => {
  const montarTensiometro = async (vivo: LecturaEnVivo) => {
    const simulados = crearSensoresSimulados({ latenciaMs: 0, azar: () => 0.5 });
    const tensiometro: Sensor = { ...simulados.tensiometro, tipo: 'tensiometro', disponible: async () => true, medir: simulados.tensiometro.medir.bind(simulados.tensiometro), enVivo: async () => vivo };
    await render(<PasoMediciones sensores={{ ...simulados, tensiometro }} lecturas={{}} onLectura={jest.fn()} onError={jest.fn()} intervaloEnVivoMs={20} />);
  };

  test('indica cuándo pulsar Start', async () => {
    // Arrange / Act
    await montarTensiometro({ valida: true, estado: 'Listo: pulsa Start en el brazalete' });

    // Assert
    expect(await screen.findByText('Listo: pulsa Start en el brazalete')).toBeTruthy();
    expect(screen.getByLabelText('En vivo Tensiómetro')).toBeTruthy();
  });

  test('avisa si el puente del tensiómetro no está disponible', async () => {
    // Arrange / Act
    await montarTensiometro({ valida: false, motivo: 'desconectado' });

    // Assert
    expect(await screen.findByText('Puente del tensiómetro no disponible')).toBeTruthy();
  });
});
