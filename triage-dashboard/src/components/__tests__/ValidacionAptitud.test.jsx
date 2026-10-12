import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ValidacionAptitud from '../ValidacionAptitud';

const pendiente = { idUnico: 'db_1', iaSugerida: 'A2', estado: 'pendiente', estadoRevision: 'pendiente', nivelFinal: null };

const montar = (estudiante = pendiente, onValidar = jest.fn().mockResolvedValue({ ok: true })) => {
  render(<ValidacionAptitud estudiante={estudiante} onValidar={onValidar} />);
  return { onValidar, user: userEvent.setup() };
};

test('confirmar la sugerencia envía la categoría de la IA sin derivar', async () => {
  // Arrange
  const { onValidar, user } = montar();

  // Act
  await user.click(screen.getByRole('button', { name: /Confirmar sugerencia IA/ }));

  // Assert
  expect(onValidar).toHaveBeenCalledWith('db_1', 'A2', { observaciones: null, derivar: false, motivo: null });
});

test('ajustar la categoría cambia el texto del botón y lo que se envía', async () => {
  // Arrange
  const { onValidar, user } = montar();

  // Act
  await user.click(screen.getByRole('button', { name: /A4/ }));
  await user.click(screen.getByRole('button', { name: /Confirmar cambio y cerrar caso/ }));

  // Assert
  expect(onValidar).toHaveBeenCalledWith('db_1', 'A4', expect.objectContaining({ derivar: false }));
});

test('las observaciones se envían sin espacios sobrantes (R.129)', async () => {
  // Arrange
  const { onValidar, user } = montar();

  // Act
  await user.type(screen.getByLabelText(/Observaciones del encargado/), '  Calentar bien  ');
  await user.click(screen.getByRole('button', { name: /Confirmar sugerencia IA/ }));

  // Assert
  expect(onValidar).toHaveBeenCalledWith('db_1', 'A2', expect.objectContaining({ observaciones: 'Calentar bien' }));
});

test('derivar exige el motivo antes de habilitar la confirmación (R.107)', async () => {
  // Arrange
  const { user } = montar();
  await user.click(screen.getByRole('button', { name: 'Derivar a evaluación médica' }));

  // Act
  const confirmar = screen.getByRole('button', { name: 'Confirmar derivación' });

  // Assert
  expect(confirmar).toBeDisabled();
  await user.type(screen.getByLabelText(/Motivo de la derivación/), '   ');
  expect(confirmar).toBeDisabled();
});

test('derivar con motivo envía derivar=true y el motivo', async () => {
  // Arrange
  const { onValidar, user } = montar();
  await user.click(screen.getByRole('button', { name: 'Derivar a evaluación médica' }));
  await user.type(screen.getByLabelText(/Motivo de la derivación/), 'Presión alta en reposo');

  // Act
  await user.click(screen.getByRole('button', { name: 'Confirmar derivación' }));

  // Assert
  expect(onValidar).toHaveBeenCalledWith('db_1', 'A2', { observaciones: null, derivar: true, motivo: 'Presión alta en reposo' });
});

test('cancelar la derivación vuelve a las acciones normales', async () => {
  // Arrange
  const { user } = montar();
  await user.click(screen.getByRole('button', { name: 'Derivar a evaluación médica' }));

  // Act
  await user.click(screen.getByRole('button', { name: 'Cancelar' }));

  // Assert
  expect(screen.getByRole('button', { name: /Confirmar sugerencia IA/ })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Motivo de la derivación/)).not.toBeInTheDocument();
});

test('muestra el error cuando el servidor no guarda la decisión', async () => {
  // Arrange
  const onValidar = jest.fn().mockResolvedValue({ ok: false, error: 'La evaluación ya fue revisada o derivada' });
  const { user } = montar(pendiente, onValidar);

  // Act
  await user.click(screen.getByRole('button', { name: /Confirmar sugerencia IA/ }));

  // Assert
  expect(await screen.findByRole('alert')).toHaveTextContent('La evaluación ya fue revisada o derivada');
});

test('un caso derivado muestra quién, el motivo y las observaciones, y bloquea los botones', () => {
  // Arrange
  const derivada = {
    ...pendiente, estado: 'validado', estadoRevision: 'derivada', nivelFinal: 'A1',
    motivoDerivacion: 'Presión alta', observaciones: 'Volver con certificado', revisadoPor: 'encargado',
  };

  // Act
  montar(derivada);

  // Assert
  expect(screen.getByText(/Derivado a evaluación médica externa por encargado/)).toBeInTheDocument();
  expect(screen.getByText(/Presión alta/)).toBeInTheDocument();
  expect(screen.getByText(/Volver con certificado/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /A1/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Derivar a evaluación médica' })).not.toBeInTheDocument();
});
