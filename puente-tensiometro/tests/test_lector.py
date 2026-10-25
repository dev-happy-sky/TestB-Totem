import asyncio
import datetime
from types import SimpleNamespace

from puente.lector import LectorTensiometro
from puente.protocolo import CARACTERISTICA_PRESION

MAC = "0C:7F:ED:74:07:54"
AHORA = datetime.datetime(2026, 10, 18, 22, 30, 0)


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


def dispositivo(direccion=MAC):
    return SimpleNamespace(address=direccion, name="BM54")


class ClienteFalso:
    def __init__(self, dispositivo, falla_conexion=False, falla_notify=False, usar_cache=True, fallos_notify=0, mensaje_notify="característica no disponible"):
        self.dispositivo, self.usar_cache = dispositivo, usar_cache
        self.fallos_notify, self.mensaje_notify, self.intentos_notify = fallos_notify, mensaje_notify, 0
        self.falla_conexion, self.falla_notify = falla_conexion, falla_notify
        self.is_connected = False
        self.callback = None
        self.uuid = None
        self.desconexiones = 0
        self.emparejado = False

    async def connect(self):
        if self.falla_conexion:
            raise TimeoutError("el aparato se volvió a dormir")
        self.is_connected = True

    async def pair(self):
        self.emparejado = True

    async def start_notify(self, uuid, callback):
        self.intentos_notify += 1
        if self.falla_notify or self.intentos_notify <= self.fallos_notify:
            raise RuntimeError(self.mensaje_notify)
        self.uuid, self.callback = uuid, callback

    async def disconnect(self):
        self.is_connected = False
        self.desconexiones += 1


class Fabrica:
    def __init__(self, *guion):
        self.guion = list(guion)     # opciones por cada cliente que se cree; luego, clientes sanos
        self.clientes = []

    def __call__(self, disp, usar_cache=True):
        opciones = self.guion.pop(0) if self.guion else {}
        cliente = ClienteFalso(disp, usar_cache=usar_cache, **opciones)
        self.clientes.append(cliente)
        return cliente


class EscanerFalso:
    def __init__(self, al_detectar, falla_inicio=False):
        self.al_detectar = al_detectar
        self.falla_inicio = falla_inicio
        self.iniciado = self.detenido = False

    async def start(self):
        if self.falla_inicio:
            raise OSError("Bluetooth apagado")
        self.iniciado = True

    async def stop(self):
        self.detenido = True


class FabricaEscaner:
    def __init__(self, *guion):
        self.guion = list(guion)
        self.escaneres = []

    def __call__(self, al_detectar):
        opciones = self.guion.pop(0) if self.guion else {}
        escaner = EscanerFalso(al_detectar, **opciones)
        self.escaneres.append(escaner)
        return escaner

    def ver(self, disp=None):
        """Simula que el escáner en marcha ve un dispositivo."""
        self.escaneres[-1].al_detectar(disp or dispositivo(), SimpleNamespace())


async def ceder(veces=10):
    for _ in range(veces):
        await asyncio.sleep(0)


def lector(fabrica, escaner=None, **opciones):
    return LectorTensiometro(MAC, cliente_factory=fabrica, escaner_factory=escaner or FabricaEscaner(), ahora=lambda: AHORA,
                             dormir=lambda _s: asyncio.sleep(0), **opciones)


async def con_aparato_conectado(**opciones):
    fabrica, escaner = Fabrica(), FabricaEscaner()
    tensiometro = lector(fabrica, escaner, **opciones)
    await tensiometro.iniciar()
    await ceder()
    escaner.ver()
    await ceder()
    return tensiometro, fabrica, escaner


# ------------------------------------------------------------------------------------------ escaneo y conexión

async def test_al_iniciar_enciende_el_escaner_y_no_conecta_mientras_no_ve_al_aparato():
    # Arrange
    fabrica, escaner = Fabrica(), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    assert tensiometro.activo is False

    # Act
    await tensiometro.iniciar()
    await ceder(30)

    # Assert: escuchar sin ver al aparato es lo normal (duerme)
    assert tensiometro.activo is True and escaner.escaneres[0].iniciado is True
    assert fabrica.clientes == [] and tensiometro.conectado is False
    await tensiometro.detener()


async def test_en_cuanto_ve_al_aparato_conecta_con_ese_dispositivo_y_se_suscribe_a_la_presion():
    # Arrange / Act
    tensiometro, fabrica, _ = await con_aparato_conectado()

    # Assert
    assert tensiometro.conectado is True
    assert fabrica.clientes[0].dispositivo.address == MAC     # se conecta con lo que vio el escaneo, no con una dirección
    assert fabrica.clientes[0].uuid == CARACTERISTICA_PRESION
    await tensiometro.detener()


async def test_ignora_a_otros_dispositivos_aunque_haya_muchos_alrededor():
    # Arrange
    fabrica, escaner = Fabrica(), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver(dispositivo("68:FC:CA:DC:92:A7"))
    escaner.ver(dispositivo("58:7E:61:B2:06:10"))
    await ceder(30)

    # Assert
    assert fabrica.clientes == []
    await tensiometro.detener()


async def test_reconoce_la_direccion_aunque_venga_en_minusculas():
    # Arrange
    fabrica, escaner = Fabrica(), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver(dispositivo(MAC.lower()))
    await ceder()

    # Assert
    assert tensiometro.conectado is True
    await tensiometro.detener()


async def test_si_sigue_visible_estando_conectado_no_abre_otra_conexion():
    # Arrange
    tensiometro, fabrica, escaner = await con_aparato_conectado()

    # Act
    escaner.ver()
    escaner.ver()
    await ceder(30)

    # Assert
    assert len(fabrica.clientes) == 1
    await tensiometro.detener()


async def test_tras_entregar_la_medicion_se_desconecta_y_al_verlo_otra_vez_reconecta():
    # Arrange
    tensiometro, fabrica, escaner = await con_aparato_conectado()

    # Act: el aparato se desconecta y vuelve a aparecer en la siguiente medición
    fabrica.clientes[0].is_connected = False
    await ceder(10)
    escaner.ver()
    await ceder(10)

    # Assert
    assert len(fabrica.clientes) == 2 and tensiometro.conectado is True
    await tensiometro.detener()


async def test_si_el_aparato_se_duerme_a_mitad_de_la_conexion_cierra_el_cliente_y_vuelve_a_intentar_al_verlo():
    # Arrange: visible solo un par de segundos: el primer intento se corta
    fabrica, escaner = Fabrica({"falla_conexion": True}), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver()
    await ceder(30)
    assert tensiometro.conectado is False and fabrica.clientes[0].desconexiones == 1
    escaner.ver()
    await ceder(30)

    # Assert
    assert len(fabrica.clientes) == 2 and tensiometro.conectado is True
    await tensiometro.detener()


async def test_si_falla_la_suscripcion_cierra_el_cliente():
    # Arrange
    fabrica, escaner = Fabrica({"falla_notify": True}), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver()
    await ceder(30)

    # Assert
    assert fabrica.clientes[0].desconexiones == 1 and tensiometro.conectado is False
    await tensiometro.detener()


async def test_con_emparejar_activado_empareja_antes_de_suscribirse():
    # Arrange / Act
    tensiometro, fabrica, _ = await con_aparato_conectado(emparejar=True)

    # Assert
    assert fabrica.clientes[0].emparejado is True
    await tensiometro.detener()


async def test_por_defecto_no_empareja():
    # Arrange / Act
    tensiometro, fabrica, _ = await con_aparato_conectado()

    # Assert
    assert fabrica.clientes[0].emparejado is False
    await tensiometro.detener()


async def test_si_el_bluetooth_esta_apagado_reintenta_encender_el_escaner():
    # Arrange
    escaner = FabricaEscaner({"falla_inicio": True}, {"falla_inicio": True})
    tensiometro = lector(Fabrica(), escaner)

    # Act
    await tensiometro.iniciar()
    await ceder(40)

    # Assert
    assert len(escaner.escaneres) >= 3 and escaner.escaneres[-1].iniciado is True
    await tensiometro.detener()


async def test_un_error_inesperado_no_mata_el_bucle():
    # Arrange
    llamadas = []
    sana = Fabrica()

    def fabrica(disp):
        llamadas.append(1)
        if len(llamadas) == 1:
            raise RuntimeError("fallo inesperado del adaptador")
        return sana(disp)

    escaner = FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver()
    await ceder(30)
    escaner.ver()
    await ceder(30)

    # Assert
    assert len(llamadas) >= 2 and tensiometro.conectado is True
    await tensiometro.detener()


async def test_al_detener_cierra_el_cliente_y_el_escaner():
    # Arrange
    tensiometro, fabrica, escaner = await con_aparato_conectado()

    # Act
    await tensiometro.detener()

    # Assert
    assert fabrica.clientes[0].desconexiones == 1 and escaner.escaneres[0].detenido is True
    assert tensiometro.activo is False and tensiometro.conectado is False


# --------------------------------------------------------------------------------------------- mediciones

async def test_la_medicion_recibida_llega_a_la_captura():
    # Arrange
    tensiometro, fabrica, _ = await con_aparato_conectado()

    # Act
    fabrica.clientes[0].callback(None, paquete())

    # Assert
    muestra = tensiometro.captura.desde(-1)[0][1]
    assert (muestra.sistolica, muestra.diastolica, muestra.pulso, muestra.valida) == (118, 78, 72, True)
    await tensiometro.detener()


async def test_los_paquetes_truncados_se_ignoran():
    # Arrange
    tensiometro, fabrica, _ = await con_aparato_conectado()

    # Act
    fabrica.clientes[0].callback(None, bytearray(b"\x00\x01"))

    # Assert
    assert tensiometro.captura.desde(-1) == []
    await tensiometro.detener()


async def test_una_medicion_almacenada_con_fecha_antigua_se_descarta():
    # Arrange: el tensiómetro entrega al conectar mediciones guardadas de ayer
    tensiometro, fabrica, _ = await con_aparato_conectado()

    # Act
    fabrica.clientes[0].callback(None, paquete((2026, 10, 17, 8, 0, 0)))

    # Assert
    assert tensiometro.captura.desde(-1) == []
    await tensiometro.detener()


async def test_una_medicion_reciente_con_fecha_se_acepta():
    # Arrange
    tensiometro, fabrica, _ = await con_aparato_conectado()

    # Act: 2 minutos antes de "ahora"
    fabrica.clientes[0].callback(None, paquete((2026, 10, 18, 22, 28, 0)))

    # Assert
    assert len(tensiometro.captura.desde(-1)) == 1
    await tensiometro.detener()


async def test_con_antiguedad_maxima_cero_no_se_descarta_por_fecha():
    # Arrange: reloj del aparato mal configurado
    tensiometro, fabrica, _ = await con_aparato_conectado(antiguedad_maxima_s=0)

    # Act
    fabrica.clientes[0].callback(None, paquete((2020, 1, 1, 0, 0, 0)))

    # Assert
    assert len(tensiometro.captura.desde(-1)) == 1
    await tensiometro.detener()


async def test_si_la_conexion_se_cuelga_se_abandona_a_tiempo_y_el_puente_sigue_escuchando():
    # Arrange: el aparato se durmió a mitad de la conexión y connect() nunca responde
    class ClienteColgado(ClienteFalso):
        async def connect(self):
            await asyncio.sleep(30)

    class FabricaColgada(Fabrica):
        def __call__(self, disp):
            cliente = ClienteColgado(disp) if not self.clientes else ClienteFalso(disp)
            self.clientes.append(cliente)
            return cliente

    fabrica, escaner = FabricaColgada(), FabricaEscaner()
    tensiometro = lector(fabrica, escaner, espera_conexion_s=0.05)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver()
    await asyncio.sleep(0.3)           # supera el tope de espera
    escaner.ver()                      # el aparato vuelve a aparecer en la siguiente medición
    await ceder(30)

    # Assert
    assert fabrica.clientes[0].desconexiones == 1
    assert len(fabrica.clientes) == 2 and tensiometro.conectado is True
    await tensiometro.detener()


async def test_si_windows_aun_no_lista_el_servicio_reintenta_la_suscripcion_en_la_misma_conexion():
    # Arrange
    fabrica, escaner = Fabrica({"fallos_notify": 2, "mensaje_notify": "Characteristic 2a35 was not found!"}), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver()
    await ceder(30)

    # Assert
    assert len(fabrica.clientes) == 1 and fabrica.clientes[0].intentos_notify == 3 and tensiometro.conectado is True
    await tensiometro.detener()


async def test_si_la_suscripcion_nunca_funciona_se_rinde_tras_los_intentos_y_cierra_el_cliente():
    # Arrange
    fabrica, escaner = Fabrica({"falla_notify": True}), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    escaner.ver()
    await ceder(30)

    # Assert
    assert fabrica.clientes[0].intentos_notify == 4 and fabrica.clientes[0].desconexiones == 1
    await tensiometro.detener()


async def test_pausa_el_escaner_mientras_conecta():
    # Arrange
    tensiometro, _, escaner = await con_aparato_conectado()

    # Assert
    assert escaner.escaneres[0].detenido is True
    await tensiometro.detener()


async def test_tras_no_encontrar_la_caracteristica_el_siguiente_intento_renueva_la_cache_y_luego_vuelve_a_la_cache():
    # Arrange: el 1.º y el 2.º cliente fallan con «not found» en todos sus intentos; el 3.º ya sirve
    no_esta = {"falla_notify": True, "mensaje_notify": "Characteristic 2a35 was not found!"}
    fabrica, escaner = Fabrica(no_esta, no_esta), FabricaEscaner()
    tensiometro = lector(fabrica, escaner)
    await tensiometro.iniciar()
    await ceder()

    # Act
    for _ in range(3):
        escaner.ver()
        await ceder(40)

    # Assert
    assert [c.usar_cache for c in fabrica.clientes[:3]] == [True, False, True]
    await tensiometro.detener()
