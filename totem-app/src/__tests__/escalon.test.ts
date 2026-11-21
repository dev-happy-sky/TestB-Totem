import {
  CICLOS_POR_MINUTO, DURACION_PRUEBA_S, ErrorSensor, estimarVO2Max, ESPERA_SENTARSE_S, ID_DISPOSITIVO_ESCALON, SensorEscalon,
  TIEMPOS_POR_MINUTO, type Lectura, type ProgresoPrueba, type Sensor,
} from '../sensores';

describe('estimarVO2Max (Queen\'s College Step Test)', () => {
  test.each([
    ['hombre', 150, 48.3], ['hombre', 120, 60.9], ['hombre', 180, 35.7],
    ['mujer', 150, 38.1], ['mujer', 120, 43.6], ['mujer', 180, 32.6],
  ] as const)('%s con %i lpm da %s ml/kg·min', (sexo, fc, esperado) => {
    // Arrange / Act / Assert
    expect(estimarVO2Max(sexo, fc)).toBe(esperado);
  });

  test('usa la fórmula de los hombres: 111,33 − 0,42 × FC', () => {
    // Arrange / Act / Assert
    expect(estimarVO2Max('hombre', 100)).toBe(69.3);
  });

  test('usa la fórmula de las mujeres: 65,81 − 0,1847 × FC', () => {
    // Arrange / Act / Assert
    expect(estimarVO2Max('mujer', 100)).toBe(47.3);
  });

  test.each([NaN, Infinity, 0, 39, 251, -10])('un pulso imposible (%p) no da resultado', (fc) => {
    // Arrange / Act / Assert
    expect(estimarVO2Max('hombre', fc)).toBeNull();
    expect(estimarVO2Max('mujer', fc)).toBeNull();
  });

  test('un resultado fuera de lo posible (pulso muy alto) no se acepta', () => {
    // Arrange: hombre con 250 lpm daría 6,3 (válido); con la fórmula de mujer y 250 lpm da 19,6; el límite lo da el piso de 5
    // Act / Assert
    expect(estimarVO2Max('hombre', 250)).toBe(6.3);
    expect(estimarVO2Max('hombre', 252)).toBeNull();
  });

  test('el resultado lleva un solo decimal', () => {
    // Arrange / Act
    const vo2 = estimarVO2Max('mujer', 137) as number;

    // Assert
    expect(vo2).toBe(40.5);
    expect(String(vo2).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe('parámetros de la prueba', () => {
  test('dura 3 minutos y espera 10 s antes de medir el pulso', () => {
    // Arrange / Act / Assert
    expect(DURACION_PRUEBA_S).toBe(180);
    expect(ESPERA_SENTARSE_S).toBe(10);
  });

  test('hombres 24 ciclos por minuto y mujeres 22; el metrónomo marca 4 tiempos por ciclo', () => {
    // Arrange / Act / Assert
    expect(CICLOS_POR_MINUTO).toEqual({ hombre: 24, mujer: 22 });
    expect(TIEMPOS_POR_MINUTO).toEqual({ hombre: 24 * 4, mujer: 22 * 4 });
  });
});

// ------------------------------------------------------------------------------------------------ el sensor

const LECTURA_FC = (fc: number): Lectura => ({
  sensor: 'oximetro_recuperacion', valores: { fcRecup: fc }, dispositivo: { id: 'AA:BB', calibracion: 'desconocida' }, capturadoEn: '2026-10-19T10:00:00Z',
});

// Un reloj falso: `dormir` avanza el tiempo sin esperar de verdad.
function relojFalso() {
  let ahora = 0;
  return { reloj: () => ahora, dormir: async (ms: number) => { ahora += ms; }, avanzar: (ms: number) => { ahora += ms; } };
}

function oximetroFalso(resultado: (() => Promise<Lectura>) | Error = async () => LECTURA_FC(150), disponible = true): Sensor & { llamadas: number } {
  const sensor = {
    tipo: 'oximetro_recuperacion' as const, llamadas: 0,
    disponible: async () => disponible,
    medir: async () => {
      sensor.llamadas += 1;
      if (resultado instanceof Error) throw resultado;
      return resultado();
    },
  };
  return sensor;
}

const crear = (oximetro: Sensor, opciones: Record<string, unknown> = {}) => {
  const tiempo = relojFalso();
  const sensor = new SensorEscalon(oximetro, { reloj: tiempo.reloj, dormir: tiempo.dormir, ...opciones });
  return { sensor, tiempo };
};

describe('SensorEscalon', () => {
  test('es la prueba de esfuerzo y trae su guía con las instrucciones', () => {
    // Arrange / Act
    const { sensor } = crear(oximetroFalso());

    // Assert
    expect(sensor.tipo).toBe('prueba_esfuerzo');
    expect(sensor.guia.nombre).toBe('Prueba del escalón');
    expect(sensor.guia.requiereSexo).toBe(true);
    expect(sensor.guia.instrucciones.join(' ')).toMatch(/40 cm/);
    expect(sensor.guia.instrucciones.join(' ')).toMatch(/3 minutos/);
  });

  test('está disponible solo si lo está el oxímetro que mide el pulso', async () => {
    // Arrange / Act / Assert
    expect(await crear(oximetroFalso(undefined, true)).sensor.disponible()).toBe(true);
    expect(await crear(oximetroFalso(undefined, false)).sensor.disponible()).toBe(false);
  });

  test('sin indicar el sexo no empieza y no toca el oxímetro', async () => {
    // Arrange
    const oximetro = oximetroFalso();
    const { sensor } = crear(oximetro);

    // Act
    const error = await sensor.medir().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.message).toMatch(/hombre o mujer/);
    expect(oximetro.llamadas).toBe(0);
  });

  test('un hombre con 150 lpm de recuperación obtiene 48,3 ml/kg·min', async () => {
    // Arrange
    const { sensor } = crear(oximetroFalso(async () => LECTURA_FC(150)));
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const lectura = await sensor.medir();

    // Assert
    expect(lectura.sensor).toBe('prueba_esfuerzo');
    expect(lectura.valores).toEqual({ vo2Max: '48.3' });
    expect(lectura.dispositivo).toEqual({ id: ID_DISPOSITIVO_ESCALON, calibracion: 'desconocida' });
  });

  test('una mujer con 150 lpm obtiene 38,1: el sexo cambia la fórmula', async () => {
    // Arrange
    const { sensor } = crear(oximetroFalso(async () => LECTURA_FC(150)));
    sensor.configurar({ sexo: 'mujer' });

    // Act
    const lectura = await sensor.medir();

    // Assert
    expect(lectura.valores.vo2Max).toBe('38.1');
  });

  test('entrega también la FC de recuperación medida, para no pedirla otra vez', async () => {
    // Arrange
    const fc = LECTURA_FC(142);
    const { sensor } = crear(oximetroFalso(async () => fc));
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const lectura = await sensor.medir();

    // Assert
    expect(lectura.adicionales).toEqual([fc]);
    expect(lectura.capturadoEn).toBe(fc.capturadoEn);
  });

  test('espera los 3 minutos y los 10 s antes de pedir el pulso al oxímetro', async () => {
    // Arrange
    const tiempo = relojFalso();
    let momentoDeLaMedicion = -1;
    const oximetro = oximetroFalso(async () => { momentoDeLaMedicion = tiempo.reloj(); return LECTURA_FC(150); });
    const sensor = new SensorEscalon(oximetro, { reloj: tiempo.reloj, dormir: tiempo.dormir });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    await sensor.medir();

    // Assert
    expect(momentoDeLaMedicion).toBeGreaterThanOrEqual((180 + 10) * 1000);
    expect(momentoDeLaMedicion).toBeLessThan((180 + 10) * 1000 + 1000);
  });

  test('si el oxímetro se desconectó durante la prueba, espera a que vuelva a conectarse antes de medir', async () => {
    // Arrange
    const tiempo = relojFalso();
    let consultas = 0;
    const oximetro = oximetroFalso(async () => LECTURA_FC(150));
    oximetro.disponible = async () => { consultas += 1; return consultas > 4; };
    const sensor = new SensorEscalon(oximetro, { reloj: tiempo.reloj, dormir: tiempo.dormir });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const lectura = await sensor.medir();

    // Assert
    expect(consultas).toBe(5);
    expect(oximetro.llamadas).toBe(1);
    expect(lectura.valores.vo2Max).toBe('48.3');
  });

  test('si el oxímetro no reaparece en el margen, igual lo intenta y propaga su error', async () => {
    // Arrange
    const tiempo = relojFalso();
    const oximetro = oximetroFalso(new ErrorSensor('desconectado', 'El oxímetro no está conectado.'), false);
    const sensor = new SensorEscalon(oximetro, { reloj: tiempo.reloj, dormir: tiempo.dormir, esperaConexionS: 2 });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const error = await sensor.medir().catch((e) => e);

    // Assert
    expect(error).toMatchObject({ codigo: 'desconectado' });
    expect(oximetro.llamadas).toBe(1);
    expect(tiempo.reloj()).toBeLessThan((180 + 10 + 2) * 1000 + 1000);
  });

  test('la duración y la espera se pueden ajustar', async () => {
    // Arrange
    const tiempo = relojFalso();
    let momento = -1;
    const oximetro = oximetroFalso(async () => { momento = tiempo.reloj(); return LECTURA_FC(150); });
    const sensor = new SensorEscalon(oximetro, { reloj: tiempo.reloj, dormir: tiempo.dormir, duracionS: 10, esperaS: 2 });
    sensor.configurar({ sexo: 'mujer' });

    // Act
    await sensor.medir();

    // Assert
    expect(momento).toBeGreaterThanOrEqual(12000);
    expect(momento).toBeLessThan(13000);
  });

  test('informa el progreso en cada fase: prueba, espera y medición del pulso', async () => {
    // Arrange
    const tiempo = relojFalso();
    const vistas: ProgresoPrueba[] = [];
    let sensor!: SensorEscalon;
    const oximetro = oximetroFalso(async () => { vistas.push(sensor.progreso() as ProgresoPrueba); return LECTURA_FC(150); });
    sensor = new SensorEscalon(oximetro, {
      reloj: tiempo.reloj, dormir: async (ms: number) => { const p = sensor.progreso(); if (p) vistas.push({ ...p }); await tiempo.dormir(ms); },
      duracionS: 4, esperaS: 2,
    });
    sensor.configurar({ sexo: 'mujer' });
    expect(sensor.progreso()).toBeNull();

    // Act
    await sensor.medir();

    // Assert
    const fases = [...new Set(vistas.map((p) => p.fase))];
    expect(fases).toEqual(['prueba', 'espera', 'midiendo']);
    const prueba = vistas.filter((p) => p.fase === 'prueba');
    expect(prueba[0]).toMatchObject({ restanteS: 4, transcurridoS: 0, tiemposPorMinuto: 88 });
    expect(prueba[prueba.length - 1].restanteS).toBe(1);
    expect(vistas.filter((p) => p.fase === 'espera')[0].restanteS).toBe(2);
    expect(sensor.progreso()).toBeNull();           // al terminar no queda progreso
  });

  test('el ritmo del metrónomo depende del sexo (96 tiempos por minuto los hombres, 88 las mujeres)', async () => {
    // Arrange
    const tiempo = relojFalso();
    const vistas: number[] = [];
    let sensor!: SensorEscalon;
    sensor = new SensorEscalon(oximetroFalso(), {
      reloj: tiempo.reloj, dormir: async (ms: number) => { const p = sensor.progreso(); if (p) vistas.push(p.tiemposPorMinuto); await tiempo.dormir(ms); },
      duracionS: 1, esperaS: 0,
    });

    // Act
    sensor.configurar({ sexo: 'hombre' });
    await sensor.medir();
    sensor.configurar({ sexo: 'mujer' });
    await sensor.medir();

    // Assert
    expect(new Set(vistas)).toEqual(new Set([96, 88]));
  });

  test('cancelar durante la prueba la detiene sin llamar al oxímetro', async () => {
    // Arrange
    const tiempo = relojFalso();
    const oximetro = oximetroFalso();
    let sensor!: SensorEscalon;
    let pasos = 0;
    sensor = new SensorEscalon(oximetro, {
      reloj: tiempo.reloj, dormir: async (ms: number) => { pasos += 1; if (pasos === 3) sensor.cancelar(); await tiempo.dormir(ms); },
    });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const error = await sensor.medir().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.message).toBe('Prueba cancelada.');
    expect(oximetro.llamadas).toBe(0);
    expect(pasos).toBeLessThan(10);                  // no siguió contando hasta los 3 minutos
    expect(sensor.progreso()).toBeNull();
  });

  test('cancelar mientras el oxímetro mide descarta el resultado', async () => {
    // Arrange
    let sensor!: SensorEscalon;
    const oximetro = oximetroFalso(async () => { sensor.cancelar(); return LECTURA_FC(150); });
    const tiempo = relojFalso();
    sensor = new SensorEscalon(oximetro, { reloj: tiempo.reloj, dormir: tiempo.dormir, duracionS: 1, esperaS: 0 });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const error = await sensor.medir().catch((e) => e);

    // Assert
    expect(error.message).toBe('Prueba cancelada.');
  });

  test('si el oxímetro falla, el error de ese sensor llega tal cual (desconectado, sin dedo...)', async () => {
    // Arrange
    const { sensor } = crear(oximetroFalso(new ErrorSensor('lectura_invalida', 'No se detecta el dedo')), { duracionS: 1, esperaS: 0 });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const error = await sensor.medir().catch((e) => e);

    // Assert
    expect(error).toBeInstanceOf(ErrorSensor);
    expect(error.codigo).toBe('lectura_invalida');
    expect(error.message).toBe('No se detecta el dedo');
    expect(sensor.progreso()).toBeNull();
  });

  test.each([30, 260])('un pulso imposible (%i lpm) da lectura inválida y pide repetir', async (fc) => {
    // Arrange
    const { sensor } = crear(oximetroFalso(async () => LECTURA_FC(fc)), { duracionS: 1, esperaS: 0 });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const error = await sensor.medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('lectura_invalida');
    expect(error.message).toMatch(/Repite la prueba/);
  });

  test('una lectura del oxímetro sin FC de recuperación también es inválida', async () => {
    // Arrange
    const sinFc: Lectura = { ...LECTURA_FC(0), valores: {} };
    const { sensor } = crear(oximetroFalso(async () => sinFc), { duracionS: 1, esperaS: 0 });
    sensor.configurar({ sexo: 'hombre' });

    // Act
    const error = await sensor.medir().catch((e) => e);

    // Assert
    expect(error.codigo).toBe('lectura_invalida');
  });

  test('se puede repetir la prueba después de terminar o de fallar', async () => {
    // Arrange
    let intento = 0;
    const oximetro = oximetroFalso(async () => { intento += 1; if (intento === 1) throw new ErrorSensor('timeout', 'sin datos'); return LECTURA_FC(140); });
    const { sensor } = crear(oximetro, { duracionS: 1, esperaS: 0 });
    sensor.configurar({ sexo: 'mujer' });

    // Act
    const primero = await sensor.medir().catch((e) => e);
    const segundo = await sensor.medir();

    // Assert
    expect(primero).toBeInstanceOf(ErrorSensor);
    expect(segundo.valores.vo2Max).toBe('40.0');   // 65,81 − 0,1847 × 140 = 39,95
  });
});
