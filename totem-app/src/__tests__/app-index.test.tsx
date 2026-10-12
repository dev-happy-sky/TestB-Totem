import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import App from '../app/index';

jest.mock('@react-native-community/slider', () => 'Slider');

const CONSENTIMIENTO = /Autorizo el registro y uso de mis datos/;

const irAlUltimoPaso = async () => {
  await fireEvent.press(screen.getByText(CONSENTIMIENTO));
  for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByText('Continuar →'));
};

let alerta: jest.SpyInstance;
beforeEach(() => {
  alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('consentimiento (R.183)', () => {
  test('el paso 1 muestra la casilla de consentimiento', async () => {
    await render(<App />);
    expect(screen.getByText('PASO 1 - REGISTRO')).toBeTruthy();
    expect(screen.getByText(CONSENTIMIENTO)).toBeTruthy();
  });

  test('no deja avanzar sin aceptar y avisa al usuario', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByText('Continuar →'));

    expect(alerta).toHaveBeenCalledWith('Consentimiento requerido', expect.any(String));
    expect(screen.getByText('PASO 1 - REGISTRO')).toBeTruthy();
  });

  test('al aceptar permite avanzar al paso 2', async () => {
    await render(<App />);
    await fireEvent.press(screen.getByText(CONSENTIMIENTO));
    await fireEvent.press(screen.getByText('Continuar →'));

    expect(screen.getByText('PASO 2 - ESTACIÓN DE SENSORES')).toBeTruthy();
    expect(alerta).not.toHaveBeenCalled();
  });
});

describe('envío de la evaluación', () => {
  test('envía consentimiento y la clave del tótem al backend', async () => {
    process.env.EXPO_PUBLIC_TOTEM_KEY = 'clave-test';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ status: 'success' }),
    }) as unknown as typeof fetch;
    await render(<App />);
    await irAlUltimoPaso();
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, opciones] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toMatch(/\/api\/evaluaciones$/);
    expect(opciones.method).toBe('POST');
    expect(opciones.headers['X-Totem-Key']).toBe('clave-test');
    const cuerpo = JSON.parse(opciones.body);
    expect(cuerpo.consentimiento).toBe(true);
    expect(cuerpo).toEqual(expect.objectContaining({
      estudiante: expect.any(Object), mediciones: expect.any(Object),
      entrenamiento: expect.any(Object), salud: expect.any(Object),
    }));
    await waitFor(() => expect(alerta).toHaveBeenCalledWith('¡Éxito!', expect.any(String)));
  });

  test('tras un envío exitoso vuelve al paso 1 y pide el consentimiento de nuevo', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => '{"status":"success"}',
    }) as unknown as typeof fetch;
    await render(<App />);
    await irAlUltimoPaso();
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    await waitFor(() => expect(screen.getByText('PASO 1 - REGISTRO')).toBeTruthy());
    await fireEvent.press(screen.getByText('Continuar →'));
    expect(alerta).toHaveBeenCalledWith('Consentimiento requerido', expect.any(String));
  });

  test('muestra el error cuando el servidor rechaza la evaluación', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => JSON.stringify({ detail: 'Se requiere el consentimiento' }),
    }) as unknown as typeof fetch;
    await render(<App />);
    await irAlUltimoPaso();
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    await waitFor(() =>
      expect(alerta).toHaveBeenCalledWith('Error del servidor', expect.stringContaining('400')));
  });

  test('muestra un error de conexión si falla la red', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('sin red')) as unknown as typeof fetch;
    await render(<App />);
    await irAlUltimoPaso();
    await fireEvent.press(screen.getByText('Registrar mi ingreso'));

    await waitFor(() => expect(alerta).toHaveBeenCalledWith('Error de conexión', 'sin red'));
  });
});
