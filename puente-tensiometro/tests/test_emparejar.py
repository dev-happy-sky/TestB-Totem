import asyncio

from puente.emparejar import emparejar
from puente.protocolo import CARACTERISTICA_PRESION

MAC = "0C:7F:ED:74:07:54"
RECHAZO = RuntimeError("(5, 'GATT Protocol Error: Insufficient Authentication')")


class Reloj:
    """Cada consulta avanza el tiempo, para que el bucle de espera termine sin esperar de verdad."""

    def __init__(self, paso=1.0):
        self.t = 0.0
        self.paso = paso

    def __call__(self):
        self.t += self.paso
        return self.t


class ClienteFalso:
    def __init__(self, dispositivo, falla_connect=None, falla_unpair=False, falla_pair=None, falla_notify=None):
        self.dispositivo = dispositivo
        self.falla_connect, self.falla_unpair, self.falla_pair, self.falla_notify = falla_connect, falla_unpair, falla_pair, falla_notify
        self.llamadas = []

    async def connect(self):
        self.llamadas.append("connect")
        if self.falla_connect:
            raise self.falla_connect

    async def unpair(self):
        self.llamadas.append("unpair")
        if self.falla_unpair:
            raise RuntimeError("sin vínculo")

    async def pair(self):
        # bleak pierde su sesión tras borrar el vínculo: emparejar en la misma conexión da AssertionError (falló con el BM 54 real)
        if "unpair" in self.llamadas:
            raise AssertionError()
        self.llamadas.append("pair")
        if self.falla_pair:
            raise self.falla_pair

    async def start_notify(self, uuid, callback):
        self.llamadas.append(("start_notify", uuid))
        if self.falla_notify:
            raise self.falla_notify

    async def stop_notify(self, uuid):
        self.llamadas.append("stop_notify")

    async def disconnect(self):
        self.llamadas.append("disconnect")


class Fabrica:
    """Cada llamada entrega un cliente nuevo; `guion` da las opciones de los primeros clientes y luego son clientes sanos."""

    def __init__(self, *guion):
        self.guion = list(guion)
        self.clientes = []

    def __call__(self, dispositivo):
        cliente = ClienteFalso(dispositivo, **(self.guion.pop(0) if self.guion else {}))
        self.clientes.append(cliente)
        return cliente


async def siempre_visible(direccion):
    return direccion


async def invisible(direccion):
    await asyncio.sleep(0)
    return None


async def sin_pausa(_segundos):
    await asyncio.sleep(0)


async def sin_nivel(_direccion):
    return None      # no se puede consultar (otro sistema operativo) o no hay vínculo


async def correr(fabrica, buscador=siempre_visible, espera_s=30.0, nivel=sin_nivel):
    salida = []
    resultado = await emparejar(MAC, espera_s, buscador, fabrica, salida.append, Reloj(), sin_pausa, nivel)
    return resultado, salida


async def test_borra_el_vinculo_viejo_cierra_esa_conexion_y_empareja_en_una_nueva():
    # Arrange
    fabrica = Fabrica()

    # Act
    resultado, salida = await correr(fabrica)

    # Assert: tras borrar el vínculo hay que reconectar (con la misma conexión bleak da AssertionError)
    assert resultado is True and len(fabrica.clientes) == 2
    assert fabrica.clientes[0].llamadas == ["connect", "unpair", "disconnect"]
    assert fabrica.clientes[1].llamadas == ["connect", "pair", ("start_notify", CARACTERISTICA_PRESION), "stop_notify", "disconnect"]
    assert any("LISTO" in linea for linea in salida)


async def test_si_tras_emparejar_la_lectura_se_rechaza_reconecta_porque_el_vinculo_se_activa_en_una_conexion_nueva():
    # Arrange: el segundo cliente (el que empareja) aún es rechazado; el tercero ya lee
    fabrica = Fabrica({}, {"falla_notify": RECHAZO}, {})

    # Act
    resultado, salida = await correr(fabrica)

    # Assert
    assert resultado is True and len(fabrica.clientes) == 3
    assert fabrica.clientes[1].llamadas[-1] == "disconnect"
    assert fabrica.clientes[2].llamadas == ["connect", ("start_notify", CARACTERISTICA_PRESION), "stop_notify", "disconnect"]
    assert any("se reconecta" in linea for linea in salida)


async def test_se_conecta_con_el_dispositivo_que_vio_el_escaneo():
    # Arrange
    async def buscador(direccion):
        return "dispositivo-del-escaneo"

    fabrica = Fabrica()

    # Act
    await correr(fabrica, buscador)

    # Assert
    assert all(c.dispositivo == "dispositivo-del-escaneo" for c in fabrica.clientes)


async def test_si_no_habia_vinculo_que_borrar_sigue_adelante():
    # Arrange
    fabrica = Fabrica({"falla_unpair": True})

    # Act
    resultado, salida = await correr(fabrica)

    # Assert
    assert resultado is True
    assert any("sin vínculo anterior" in linea for linea in salida)
    assert fabrica.clientes[0].llamadas[-1] == "disconnect"


async def test_si_sigue_rechazando_tras_reconectar_avisa_que_falta_el_modo_de_emparejamiento_y_reintenta():
    # Arrange: el primer intento completo falla (sin modo de emparejamiento); el segundo funciona
    fabrica = Fabrica({}, {"falla_notify": RECHAZO}, {"falla_notify": RECHAZO}, {}, {})

    # Act
    resultado, salida = await correr(fabrica)

    # Assert
    assert resultado is True
    assert any("no está en modo de emparejamiento" in linea for linea in salida)
    assert all(c.llamadas[-1] == "disconnect" for c in fabrica.clientes)       # siempre cierra la conexión


async def test_si_el_aparato_se_duerme_durante_el_emparejamiento_avisa_y_reintenta():
    # Arrange
    fabrica = Fabrica({}, {"falla_pair": asyncio.TimeoutError()}, {}, {})

    # Act
    resultado, salida = await correr(fabrica)

    # Assert
    assert resultado is True
    assert any("se durmió" in linea for linea in salida)


async def test_cualquier_otro_error_se_informa_con_su_tipo_y_se_reintenta():
    # Arrange
    fabrica = Fabrica({"falla_connect": OSError("fuera de alcance")}, {}, {})

    # Act
    resultado, salida = await correr(fabrica)

    # Assert
    assert resultado is True
    assert any("OSError" in linea for linea in salida)


async def test_un_error_sin_texto_no_se_muestra_como_vacio():
    # Arrange: el AssertionError de antes salía como "AssertionError: " sin ninguna pista
    fabrica = Fabrica({"falla_connect": AssertionError()}, {}, {})

    # Act
    _, salida = await correr(fabrica)

    # Assert
    assert any("AssertionError: sin detalle" in linea for linea in salida)


async def test_si_el_aparato_nunca_aparece_falla_al_agotar_la_espera():
    # Arrange
    fabrica = Fabrica()

    # Act
    resultado, salida = await correr(fabrica, invisible, espera_s=5)

    # Assert
    assert resultado is False and fabrica.clientes == []
    assert "No se logró emparejar" in salida[-1]


async def test_si_aparece_pero_nunca_empareja_termina_sin_exito_al_agotar_la_espera():
    # Arrange
    fabrica = Fabrica(*[{"falla_notify": RECHAZO}] * 60)

    # Act
    resultado, salida = await correr(fabrica, espera_s=8)

    # Assert
    assert resultado is False and len(fabrica.clientes) >= 3
    assert "No se logró emparejar" in salida[-1]


async def test_pide_poner_el_aparato_en_modo_de_emparejamiento_antes_de_empezar():
    # Arrange / Act
    _, salida = await correr(Fabrica())

    # Assert
    assert "modo de emparejamiento" in salida[0]


async def test_si_el_vinculo_quedo_solo_cifrado_lo_explica_y_manda_a_emparejar_desde_windows_sin_seguir_reintentando():
    # Arrange: caso real del BM 54: Windows guardó el vínculo con nivel 2 (Encryption) y el aparato exige autenticación
    async def solo_cifrado(_direccion):
        return 2

    fabrica = Fabrica(*[{"falla_notify": RECHAZO}] * 60)

    # Act
    resultado, salida = await correr(fabrica, nivel=solo_cifrado)

    # Assert: reintentar no sirve; se detiene en el primer intento y da la salida concreta
    assert resultado is False and len(fabrica.clientes) == 3
    assert any("solo CIFRADO" in linea and "Configuración de Windows" in linea for linea in salida)


async def test_si_el_vinculo_ya_es_autenticado_el_rechazo_se_atribuye_al_modo_de_emparejamiento():
    # Arrange
    async def autenticado(_direccion):
        return 3

    fabrica = Fabrica({}, {"falla_notify": RECHAZO}, {"falla_notify": RECHAZO}, {}, {})

    # Act
    resultado, salida = await correr(fabrica, nivel=autenticado)

    # Assert
    assert resultado is True
    assert any("no está en modo de emparejamiento" in linea for linea in salida)
    assert not any("solo CIFRADO" in linea for linea in salida)
