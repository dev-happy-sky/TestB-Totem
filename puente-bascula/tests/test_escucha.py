import asyncio
from types import SimpleNamespace

from puente.escucha import EscuchaBascula

MAC = "E0:D3:8E:62:51:3D"
ANUNCIO_53_4 = SimpleNamespace(manufacturer_data={0x18C0: bytes.fromhex("14dc1388000025e0d38e62513d")})
ANUNCIO_VACIO = SimpleNamespace(manufacturer_data={0x16C0: bytes.fromhex("00000000000024e0d38e62513d")})


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


class Fabrica:
    def __init__(self, *guion):
        self.guion = list(guion)
        self.escaneres = []

    def __call__(self, al_detectar):
        opciones = self.guion.pop(0) if self.guion else {}
        escaner = EscanerFalso(al_detectar, **opciones)
        self.escaneres.append(escaner)
        return escaner


async def ceder(veces=10):
    for _ in range(veces):
        await asyncio.sleep(0)


def escucha(fabrica):
    return EscuchaBascula(MAC, escaner_factory=fabrica, dormir=lambda _s: asyncio.sleep(0))


def dispositivo(direccion=MAC):
    return SimpleNamespace(address=direccion)


async def test_al_iniciar_empieza_a_escuchar():
    # Arrange
    fabrica = Fabrica()
    bascula = escucha(fabrica)
    assert bascula.escuchando is False

    # Act
    await bascula.iniciar()
    await ceder()

    # Assert
    assert bascula.escuchando is True and fabrica.escaneres[0].iniciado
    await bascula.detener()


async def test_los_anuncios_de_la_bascula_llegan_a_la_captura():
    # Arrange
    fabrica = Fabrica()
    bascula = escucha(fabrica)
    await bascula.iniciar()
    await ceder()
    detectar = fabrica.escaneres[0].al_detectar

    # Act
    detectar(dispositivo(), ANUNCIO_53_4)
    detectar(dispositivo(), ANUNCIO_VACIO)

    # Assert
    muestras = [m for _, m in bascula.captura.desde(-1)]
    assert [(m.peso_kg, m.valida) for m in muestras] == [(53.4, True), (0.0, False)]
    await bascula.detener()


async def test_los_anuncios_de_otros_dispositivos_se_ignoran():
    # Arrange
    fabrica = Fabrica()
    bascula = escucha(fabrica)
    await bascula.iniciar()
    await ceder()
    detectar = fabrica.escaneres[0].al_detectar

    # Act
    detectar(dispositivo("AA:BB:CC:DD:EE:FF"), ANUNCIO_53_4)
    detectar(dispositivo(MAC.lower()), SimpleNamespace(manufacturer_data={0x004C: b"\x01\x02"}))

    # Assert
    assert bascula.captura.ultima() is None
    await bascula.detener()


async def test_acepta_la_direccion_en_minusculas():
    # Arrange
    fabrica = Fabrica()
    bascula = escucha(fabrica)
    await bascula.iniciar()
    await ceder()

    # Act
    fabrica.escaneres[0].al_detectar(dispositivo(MAC.lower()), ANUNCIO_53_4)

    # Assert
    assert bascula.captura.ultima()[1].peso_kg == 53.4
    await bascula.detener()


async def test_si_el_bluetooth_esta_apagado_reintenta_hasta_conseguirlo():
    # Arrange
    fabrica = Fabrica({"falla_inicio": True}, {"falla_inicio": True})
    bascula = escucha(fabrica)

    # Act
    await bascula.iniciar()
    await ceder(40)

    # Assert
    assert len(fabrica.escaneres) >= 3 and bascula.escuchando is True
    await bascula.detener()


async def test_un_error_inesperado_no_mata_el_bucle():
    # Arrange
    llamadas = []
    sana = Fabrica()

    def fabrica(al_detectar):
        llamadas.append(1)
        if len(llamadas) == 1:
            raise RuntimeError("fallo inesperado del adaptador")
        return sana(al_detectar)

    bascula = escucha(fabrica)

    # Act
    await bascula.iniciar()
    await ceder(40)

    # Assert
    assert len(llamadas) >= 2 and bascula.escuchando is True
    await bascula.detener()


async def test_al_detener_cierra_el_escaner_y_deja_de_escuchar():
    # Arrange
    fabrica = Fabrica()
    bascula = escucha(fabrica)
    await bascula.iniciar()
    await ceder()

    # Act
    await bascula.detener()

    # Assert
    assert fabrica.escaneres[0].detenido and bascula.escuchando is False
