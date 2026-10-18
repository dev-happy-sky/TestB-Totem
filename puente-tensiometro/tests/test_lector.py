import asyncio
import datetime

from puente.lector import LectorTensiometro
from puente.protocolo import CARACTERISTICA_PRESION

AHORA = datetime.datetime(2026, 10, 17, 22, 30, 0)


def sf(mantisa, exponente=0):
    return (((exponente & 0xF) << 12) | (mantisa & 0xFFF)).to_bytes(2, "little")


def paquete(con_fecha=None):
    """118/78 mmHg, pulso 72, con fecha opcional (año, mes, día, hora, minuto, segundo)."""
    banderas = 0x04 | (0x02 if con_fecha else 0)
    fecha = b""
    if con_fecha:
        a, m, d, h, mi, s = con_fecha
        fecha = a.to_bytes(2, "little") + bytes([m, d, h, mi, s])
    return bytearray(bytes([banderas]) + sf(118) + sf(78) + sf(91) + fecha + sf(72))


class ClienteFalso:
    def __init__(self, direccion, falla_conexion=False, falla_notify=False):
        self.direccion = direccion
        self.falla_conexion, self.falla_notify = falla_conexion, falla_notify
        self.is_connected = False
        self.callback = None
        self.uuid = None
        self.desconexiones = 0
        self.emparejado = False

    async def connect(self):
        if self.falla_conexion:
            raise TimeoutError("el tensiómetro duerme")
        self.is_connected = True

    async def pair(self):
        self.emparejado = True

    async def start_notify(self, uuid, callback):
        if self.falla_notify:
            raise RuntimeError("característica no disponible")
        self.uuid, self.callback = uuid, callback

    async def disconnect(self):
        self.is_connected = False
        self.desconexiones += 1


class Fabrica:
    def __init__(self, *guion):
        self.guion = list(guion)
        self.clientes = []

    def __call__(self, direccion):
        opciones = self.guion.pop(0) if self.guion else {}
        cliente = ClienteFalso(direccion, **opciones)
        self.clientes.append(cliente)
        return cliente


async def ceder(veces=10):
    for _ in range(veces):
        await asyncio.sleep(0)


def lector(fabrica, **opciones):
    return LectorTensiometro("0C:7F:ED:74:07:54", cliente_factory=fabrica, ahora=lambda: AHORA,
                             dormir=lambda _s: asyncio.sleep(0), **opciones)


async def test_al_iniciar_se_conecta_y_se_suscribe_a_la_presion_arterial():
    # Arrange
    fabrica = Fabrica()
    tensiometro = lector(fabrica)
    assert tensiometro.activo is False and tensiometro.conectado is False

    # Act
    await tensiometro.iniciar()
    await ceder()

    # Assert
    assert tensiometro.activo is True and tensiometro.conectado is True
    assert fabrica.clientes[0].direccion == "0C:7F:ED:74:07:54"
    assert fabrica.clientes[0].uuid == CARACTERISTICA_PRESION
    await tensiometro.detener()
    assert tensiometro.activo is False


async def test_la_medicion_recibida_llega_a_la_captura():
    # Arrange
    fabrica = Fabrica()
    tensiometro = lector(fabrica)
    await tensiometro.iniciar()
    await ceder()

    # Act
    fabrica.clientes[0].callback(None, paquete())

    # Assert
    muestra = tensiometro.captura.desde(-1)[0][1]
    assert (muestra.sistolica, muestra.diastolica, muestra.pulso, muestra.valida) == (118, 78, 72, True)
    await tensiometro.detener()


async def test_los_paquetes_truncados_o_ajenos_se_ignoran():
    # Arrange
    fabrica = Fabrica()
    tensiometro = lector(fabrica)
    await tensiometro.iniciar()
    await ceder()

    # Act
    fabrica.clientes[0].callback(None, bytearray(b"\x00\x01"))

    # Assert
    assert tensiometro.captura.desde(-1) == []
    await tensiometro.detener()


async def test_una_medicion_almacenada_con_fecha_antigua_se_descarta():
    # Arrange: el tensiómetro entrega al conectar mediciones guardadas de ayer
    fabrica = Fabrica()
    tensiometro = lector(fabrica)
    await tensiometro.iniciar()
    await ceder()

    # Act
    fabrica.clientes[0].callback(None, paquete((2026, 10, 16, 8, 0, 0)))

    # Assert
    assert tensiometro.captura.desde(-1) == []
    await tensiometro.detener()


async def test_una_medicion_reciente_con_fecha_se_acepta():
    # Arrange
    fabrica = Fabrica()
    tensiometro = lector(fabrica)
    await tensiometro.iniciar()
    await ceder()

    # Act: 2 minutos antes de "ahora"
    fabrica.clientes[0].callback(None, paquete((2026, 10, 17, 22, 28, 0)))

    # Assert
    assert len(tensiometro.captura.desde(-1)) == 1
    await tensiometro.detener()


async def test_con_antiguedad_maxima_cero_no_se_descarta_por_fecha():
    # Arrange: reloj del aparato mal configurado
    fabrica = Fabrica()
    tensiometro = lector(fabrica, antiguedad_maxima_s=0)
    await tensiometro.iniciar()
    await ceder()

    # Act
    fabrica.clientes[0].callback(None, paquete((2020, 1, 1, 0, 0, 0)))

    # Assert
    assert len(tensiometro.captura.desde(-1)) == 1
    await tensiometro.detener()


async def test_si_duerme_reintenta_hasta_conseguir_conectar():
    # Arrange
    fabrica = Fabrica({"falla_conexion": True}, {"falla_conexion": True})
    tensiometro = lector(fabrica)

    # Act
    await tensiometro.iniciar()
    await ceder(40)

    # Assert
    assert len(fabrica.clientes) >= 3 and tensiometro.conectado is True
    assert fabrica.clientes[0].desconexiones >= 1
    await tensiometro.detener()


async def test_si_se_pierde_la_conexion_vuelve_a_conectar():
    # Arrange: tras entregar la medición el aparato se desconecta
    fabrica = Fabrica()
    tensiometro = lector(fabrica)
    await tensiometro.iniciar()
    await ceder()

    # Act
    fabrica.clientes[0].is_connected = False
    await ceder(40)

    # Assert
    assert len(fabrica.clientes) >= 2 and tensiometro.conectado is True
    await tensiometro.detener()


async def test_con_emparejar_activado_empareja_antes_de_suscribirse():
    # Arrange
    fabrica = Fabrica()
    tensiometro = lector(fabrica, emparejar=True)

    # Act
    await tensiometro.iniciar()
    await ceder()

    # Assert
    assert fabrica.clientes[0].emparejado is True
    await tensiometro.detener()


async def test_por_defecto_no_empareja():
    # Arrange
    fabrica = Fabrica()
    tensiometro = lector(fabrica)

    # Act
    await tensiometro.iniciar()
    await ceder()

    # Assert
    assert fabrica.clientes[0].emparejado is False
    await tensiometro.detener()


async def test_un_error_inesperado_no_mata_el_bucle():
    # Arrange
    llamadas = []
    sana = Fabrica()

    def fabrica(direccion):
        llamadas.append(1)
        if len(llamadas) == 1:
            raise RuntimeError("fallo inesperado del adaptador")
        return sana(direccion)

    tensiometro = lector(fabrica)

    # Act
    await tensiometro.iniciar()
    await ceder(40)

    # Assert
    assert len(llamadas) >= 2 and tensiometro.conectado is True
    await tensiometro.detener()
