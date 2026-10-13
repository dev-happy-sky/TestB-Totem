import asyncio

from puente.lector import LectorOximetro
from puente.protocolo import NOTIFY_UUID


class ClienteFalso:
    """Imita a BleakClient sin Bluetooth."""

    def __init__(self, direccion, falla_conexion=False, falla_notify=False):
        self.direccion = direccion
        self.falla_conexion, self.falla_notify = falla_conexion, falla_notify
        self.is_connected = False
        self.callback = None
        self.uuid = None
        self.desconexiones = 0

    async def connect(self):
        if self.falla_conexion:
            raise OSError("fuera de alcance")
        self.is_connected = True

    async def start_notify(self, uuid, callback):
        if self.falla_notify:
            raise RuntimeError("característica no disponible")
        self.uuid, self.callback = uuid, callback

    async def disconnect(self):
        self.is_connected = False
        self.desconexiones += 1


class Fabrica:
    def __init__(self, *guion):
        self.guion = list(guion)       # opciones por cada cliente que se cree; luego, clientes sanos
        self.clientes = []

    def __call__(self, direccion):
        opciones = self.guion.pop(0) if self.guion else {}
        cliente = ClienteFalso(direccion, **opciones)
        self.clientes.append(cliente)
        return cliente


async def ceder(veces=10):
    for _ in range(veces):
        await asyncio.sleep(0)


def lector(fabrica):
    return LectorOximetro("AA:BB:CC:DD:EE:FF", cliente_factory=fabrica, dormir=lambda _s: asyncio.sleep(0))


PAQUETE_OK = bytearray([0xA7, 0, 0, 0, 0, 0, 97, 72, 41])


async def test_al_iniciar_se_conecta_con_la_direccion_y_se_suscribe_a_las_notificaciones():
    # Arrange
    fabrica = Fabrica()
    oximetro = lector(fabrica)
    assert oximetro.conectado is False

    # Act
    await oximetro.iniciar()
    await ceder()

    # Assert
    assert oximetro.conectado is True
    assert fabrica.clientes[0].direccion == "AA:BB:CC:DD:EE:FF"
    assert fabrica.clientes[0].uuid == NOTIFY_UUID
    await oximetro.detener()


async def test_los_paquetes_recibidos_llegan_a_la_captura_y_los_ajenos_se_ignoran():
    # Arrange
    fabrica = Fabrica()
    oximetro = lector(fabrica)
    await oximetro.iniciar()
    await ceder()
    notificar = fabrica.clientes[0].callback

    # Act
    notificar(None, PAQUETE_OK)
    notificar(None, bytearray([0x55, 1, 2]))                 # no es un paquete de mediciones
    notificar(None, bytearray([0xA7, 0, 0, 0, 0, 0, 0, 0, 0]))   # sin dedo: llega como muestra no válida

    # Assert
    muestras = [m for _, m in oximetro.captura.desde(-1)]
    assert [(m.spo2, m.valida) for m in muestras] == [(97, True), (0, False)]
    await oximetro.detener()


async def test_si_no_logra_conectar_reintenta_hasta_conseguirlo():
    # Arrange
    fabrica = Fabrica({"falla_conexion": True}, {"falla_conexion": True})
    oximetro = lector(fabrica)

    # Act
    await oximetro.iniciar()
    await ceder(40)

    # Assert
    assert len(fabrica.clientes) >= 3
    assert oximetro.conectado is True
    assert fabrica.clientes[0].desconexiones >= 1       # el intento fallido se cierra
    await oximetro.detener()


async def test_si_falla_la_suscripcion_cierra_el_cliente_y_reintenta():
    # Arrange
    fabrica = Fabrica({"falla_notify": True})
    oximetro = lector(fabrica)

    # Act
    await oximetro.iniciar()
    await ceder(40)

    # Assert
    assert fabrica.clientes[0].desconexiones >= 1
    assert oximetro.conectado is True and len(fabrica.clientes) >= 2
    await oximetro.detener()


async def test_si_se_pierde_la_conexion_se_reconecta_y_se_descartan_las_muestras_viejas():
    # Arrange
    fabrica = Fabrica()
    oximetro = lector(fabrica)
    await oximetro.iniciar()
    await ceder()
    fabrica.clientes[0].callback(None, PAQUETE_OK)
    assert len(oximetro.captura.desde(-1)) == 1

    # Act
    fabrica.clientes[0].is_connected = False       # el oxímetro se apagó o salió de alcance
    await ceder(40)

    # Assert
    assert len(fabrica.clientes) >= 2 and fabrica.clientes[-1].is_connected
    assert oximetro.conectado is True
    assert oximetro.captura.desde(-1) == []
    await oximetro.detener()


async def test_detener_cancela_la_tarea_y_desconecta_el_oximetro():
    # Arrange
    fabrica = Fabrica()
    oximetro = lector(fabrica)
    await oximetro.iniciar()
    await ceder()

    # Act
    await oximetro.detener()

    # Assert
    assert oximetro.conectado is False
    assert fabrica.clientes[0].desconexiones == 1


async def test_detener_sin_haber_iniciado_no_falla():
    # Arrange
    oximetro = lector(Fabrica())

    # Act / Assert
    await oximetro.detener()


async def test_iniciar_dos_veces_no_crea_dos_conexiones():
    # Arrange
    fabrica = Fabrica()
    oximetro = lector(fabrica)

    # Act
    await oximetro.iniciar()
    await oximetro.iniciar()
    await ceder(10)

    # Assert
    assert len(fabrica.clientes) == 1
    await oximetro.detener()
