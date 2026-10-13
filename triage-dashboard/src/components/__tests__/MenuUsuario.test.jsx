import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MenuUsuario from '../MenuUsuario';

const PERFIL = { nombre: 'Ana', apellido: 'Soto', email: 'ana', rol: 'encargado', sucursal: 'Campus Norte' };
const sesion = { token: 'tok123', rol: 'encargado', usuario: 'ana' };

let props;
beforeEach(() => {
  props = { sesion, backendUrl: 'http://api.test', authHeaders: { Authorization: 'Bearer tok123' },
            onSesionInvalida: jest.fn(), onLogout: jest.fn() };
  global.fetch = jest.fn();
});

const responder = (cuerpo, status = 200) => ({ ok: status < 400, status, json: async () => cuerpo });
const abrirMenu = () => userEvent.click(screen.getByRole('button', { name: /ana · encargado/ }));

async function abrirEdicion() {
  render(<MenuUsuario {...props} />);
  await abrirMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Modificar perfil' }));
  await screen.findByLabelText('Nombre');
}

async function escribirClaves(actual, nueva, confirmacion) {
  await userEvent.type(screen.getByLabelText('Contraseña actual'), actual);
  await userEvent.type(screen.getByLabelText('Contraseña nueva'), nueva);
  await userEvent.type(screen.getByLabelText('Confirmar contraseña nueva'), confirmacion);
}

test('el menú ofrece ver perfil, modificar perfil y cerrar sesión', async () => {
  // Arrange
  render(<MenuUsuario {...props} />);

  // Act
  await abrirMenu();

  // Assert
  expect(screen.getAllByRole('menuitem').map((e) => e.textContent)).toEqual(['Ver perfil', 'Modificar perfil', 'Cerrar sesión']);
});

test('cerrar sesión llama a onLogout', async () => {
  // Arrange
  render(<MenuUsuario {...props} />);
  await abrirMenu();

  // Act
  await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

  // Assert
  expect(props.onLogout).toHaveBeenCalledTimes(1);
});

test('ver perfil pide los datos con el token y los muestra', async () => {
  // Arrange
  global.fetch.mockResolvedValue(responder(PERFIL));
  render(<MenuUsuario {...props} />);
  await abrirMenu();

  // Act
  await userEvent.click(screen.getByRole('menuitem', { name: 'Ver perfil' }));

  // Assert
  expect(await screen.findByText('Ana Soto')).toBeInTheDocument();
  expect(screen.getByText('Campus Norte')).toBeInTheDocument();
  expect(screen.getByText('Encargado')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('http://api.test/api/perfil', { headers: { Authorization: 'Bearer tok123' } });
});

test('si el servidor responde 401 al ver el perfil avisa de sesión inválida', async () => {
  // Arrange
  global.fetch.mockResolvedValue(responder({}, 401));
  render(<MenuUsuario {...props} />);
  await abrirMenu();

  // Act
  await userEvent.click(screen.getByRole('menuitem', { name: 'Ver perfil' }));

  // Assert
  await waitFor(() => expect(props.onSesionInvalida).toHaveBeenCalled());
});

test('si el servidor no responde muestra el error', async () => {
  // Arrange
  global.fetch.mockRejectedValue(new Error('network'));
  render(<MenuUsuario {...props} />);
  await abrirMenu();

  // Act
  await userEvent.click(screen.getByRole('menuitem', { name: 'Ver perfil' }));

  // Assert
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});

test('modificar perfil guarda los cambios y los confirma', async () => {
  // Arrange
  global.fetch.mockResolvedValueOnce(responder(PERFIL)).mockResolvedValueOnce(responder({ ...PERFIL, nombre: 'Marta' }));
  await abrirEdicion();
  const nombre = screen.getByLabelText('Nombre');

  // Act
  await userEvent.clear(nombre);
  await userEvent.type(nombre, 'Marta');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  // Assert
  expect(await screen.findByRole('status')).toHaveTextContent('Perfil actualizado');
  const [url, opciones] = global.fetch.mock.calls[1];
  expect(url).toBe('http://api.test/api/perfil');
  expect(opciones.method).toBe('PUT');
  expect(JSON.parse(opciones.body)).toEqual({ nombre: 'Marta', apellido: 'Soto', sucursal: 'Campus Norte' });
});

test('la contraseña se envía, junto con la actual, solo si se escribe una nueva', async () => {
  // Arrange
  global.fetch.mockResolvedValueOnce(responder(PERFIL)).mockResolvedValueOnce(responder(PERFIL));
  await abrirEdicion();

  // Act
  await escribirClaves('vieja-clave', 'nueva-clave-1', 'nueva-clave-1');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  // Assert
  await screen.findByRole('status');
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toMatchObject({ password_actual: 'vieja-clave', password_nueva: 'nueva-clave-1' });
});

test('si la confirmación no coincide no se envía nada', async () => {
  // Arrange
  global.fetch.mockResolvedValueOnce(responder(PERFIL));
  await abrirEdicion();

  // Act
  await escribirClaves('vieja-clave', 'nueva-clave-1', 'otra-cosa-99');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  // Assert
  expect(await screen.findByRole('alert')).toHaveTextContent('no coincide');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('muestra el error del servidor (contraseña actual incorrecta)', async () => {
  // Arrange
  global.fetch.mockResolvedValueOnce(responder(PERFIL))
    .mockResolvedValueOnce(responder({ detail: 'La contraseña actual no es correcta' }, 400));
  await abrirEdicion();
  await escribirClaves('mala', 'nueva-clave-1', 'nueva-clave-1');

  // Act
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

  // Assert
  expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña actual no es correcta');
});

test('desde ver perfil se puede pasar a modificar y cerrar el cuadro', async () => {
  // Arrange
  global.fetch.mockResolvedValue(responder(PERFIL));
  render(<MenuUsuario {...props} />);
  await abrirMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Ver perfil' }));
  await screen.findByText('Ana Soto');

  // Act
  await userEvent.click(screen.getByRole('button', { name: 'Modificar perfil' }));

  // Assert
  expect(await screen.findByLabelText('Nombre')).toHaveValue('Ana');
  await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
