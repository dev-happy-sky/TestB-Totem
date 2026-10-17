import asyncio
import datetime

import httpx
import pytest

from puente import __main__ as principal
from puente.captura import Captura
from puente.protocolo import Muestra
from puente.servidor import crear_app


class Reloj:
    def __init__(self):
        self.t = 0.0
        self.al_dormir = None

    def __call__(self):
        return self.t

    async def dormir(self, segundos):
        self.t += segundos
        await asyncio.sleep(0)
        if self.al_dormir:
            self.al_dormir(self.t)


class EscuchaFalsa:
    def __init__(self, escuchando=True):
        self.escuchando = escuchando
        self.direccion = "E0:D3:8E:62:51:3D"
        self._reloj = Reloj()
        self._dormir = self._reloj.dormir
        self.captura = Captura(self._reloj)
        self.iniciado = self.detenido = False

    async def iniciar(self):
        self.iniciado = True

    async def detener(self):
        self.detenido = True


def peso(kg=53.4):
    return Muestra(kg, True)


VACIA = Muestra(0.0, False, "Sin carga")


def con_muestras(escucha, factoria):
    escucha._reloj.al_dormir = lambda t: escucha.captura.agregar(factoria())


def cliente(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://puente")


# ------------------------------------------------------------------------------------------- /estado

async def test_estado_indica_si_escucha_y_cuanto_hace_del_ultimo_anuncio():
    # Arrange
    escucha = EscuchaFalsa()
    escucha._reloj.t = 10.0
    escucha.captura.agregar(peso())
    escucha._reloj.t = 12.5

    # Act
    async with cliente(crear_app(escucha)) as c:
        r = await c.get("/estado")

    # Assert
    assert r.json() == {"escuchando": True, "dispositivo": "E0:D3:8E:62:51:3D", "ultimo_anuncio_hace_s": 2.5}


async def test_estado_sin_anuncios_aun():
    # Arrange / Act
    async with cliente(crear_app(EscuchaFalsa())) as c:
        r = await c.get("/estado")

    # Assert: la báscula duerme hasta que alguien se sube; escuchar sin ver anuncios es normal
    assert r.json()["escuchando"] is True and r.json()["ultimo_anuncio_hace_s"] is None


# ------------------------------------------------------------------------------------------ /lectura

async def _lectura(escucha, **opciones):
    async with cliente(crear_app(escucha, **opciones)) as c:
        return await c.get("/lectura")


async def test_lectura_devuelve_el_ultimo_peso_valido():
    # Arrange
    escucha = EscuchaFalsa()
    escucha.captura.agregar(peso(50.0))
    escucha.captura.agregar(peso(53.4))

    # Act
    r = await _lectura(escucha)

    # Assert
    assert r.json() == {"escuchando": True, "valida": True, "peso_kg": 53.4, "motivo": None}


async def test_lectura_sin_carga_no_entrega_peso():
    # Arrange
    escucha = EscuchaFalsa()
    escucha.captura.agregar(VACIA)

    # Act
    r = await _lectura(escucha)

    # Assert
    assert r.json() == {"escuchando": True, "valida": False, "peso_kg": None, "motivo": "sin_carga"}


async def test_lectura_vieja_o_inexistente_es_sin_senal():
    # Arrange
    vieja = EscuchaFalsa()
    vieja.captura.agregar(peso())
    vieja._reloj.t += 25

    # Act
    r_vieja = await _lectura(vieja)
    r_nada = await _lectura(EscuchaFalsa())

    # Assert
    assert r_vieja.json()["motivo"] == "sin_senal" and r_vieja.json()["peso_kg"] is None
    assert r_nada.json()["motivo"] == "sin_senal"


async def test_lectura_reciente_dentro_de_la_vigencia_sigue_valida():
    # Arrange: la báscula anuncia cada varios segundos
    escucha = EscuchaFalsa()
    escucha.captura.agregar(peso())
    escucha._reloj.t += 15

    # Act
    r = await _lectura(escucha)

    # Assert
    assert r.json()["valida"] is True


async def test_lectura_sin_escaneo_no_muestra_el_peso_viejo():
    # Arrange
    escucha = EscuchaFalsa(escuchando=False)
    escucha.captura.agregar(peso())

    # Act
    r = await _lectura(escucha)

    # Assert
    assert r.json() == {"escuchando": False, "valida": False, "peso_kg": None, "motivo": "desconectado"}


async def test_lectura_exige_la_clave_si_el_puente_tiene_token():
    # Arrange
    escucha = EscuchaFalsa()
    escucha.captura.agregar(peso())

    # Act
    sin_clave = await _lectura(escucha, token="secreta")
    async with cliente(crear_app(escucha, token="secreta")) as c:
        con_clave = await c.get("/lectura", headers={"X-Puente-Key": "secreta"})

    # Assert
    assert sin_clave.status_code == 401 and con_clave.status_code == 200


# -------------------------------------------------------------------------------------------- /medir

async def test_medir_devuelve_el_peso_estable_con_dispositivo_y_hora():
    # Arrange
    escucha = EscuchaFalsa()
    con_muestras(escucha, peso)

    # Act
    async with cliente(crear_app(escucha)) as c:
        r = await c.post("/medir")

    # Assert
    cuerpo = r.json()
    assert r.status_code == 200
    assert (cuerpo["peso_kg"], cuerpo["muestras"]) == (53.4, 2)
    assert cuerpo["dispositivo"] == {"id": "E0:D3:8E:62:51:3D", "calibracion": "desconocida"}
    assert datetime.datetime.fromisoformat(cuerpo["capturado_en"]).tzinfo is not None


async def test_medir_no_guarda_nada_en_disco(tmp_path, monkeypatch):
    # Arrange
    monkeypatch.chdir(tmp_path)
    escucha = EscuchaFalsa()
    con_muestras(escucha, peso)

    # Act
    async with cliente(crear_app(escucha)) as c:
        await c.post("/medir")
        await c.get("/lectura")

    # Assert
    assert list(tmp_path.iterdir()) == []


async def test_medir_sin_escaneo_responde_503_desconectado():
    # Arrange / Act
    async with cliente(crear_app(EscuchaFalsa(escuchando=False))) as c:
        r = await c.post("/medir")

    # Assert
    assert r.status_code == 503 and r.json()["codigo"] == "desconectado"


@pytest.mark.parametrize("factoria, estado, codigo", [
    (None, 504, "timeout"),                  # la báscula no anuncia: nadie se subió
    (lambda: VACIA, 422, "lectura_invalida"),   # anuncia, pero sin carga
])
async def test_los_fallos_se_traducen_a_codigos_http_y_de_la_app(factoria, estado, codigo):
    # Arrange
    escucha = EscuchaFalsa()
    if factoria:
        con_muestras(escucha, factoria)

    # Act
    async with cliente(crear_app(escucha, timeout_s=3)) as c:
        r = await c.post("/medir")

    # Assert
    assert r.status_code == estado and r.json()["codigo"] == codigo and r.json()["mensaje"]


async def test_dos_mediciones_a_la_vez_la_segunda_recibe_409():
    # Arrange
    escucha = EscuchaFalsa()
    app = crear_app(escucha, timeout_s=3)

    # Act
    async with cliente(app) as c:
        primera = asyncio.create_task(c.post("/medir"))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        segunda = await c.post("/medir")
        await primera

    # Assert
    assert segunda.status_code == 409


async def test_medir_exige_la_clave_si_el_puente_tiene_token():
    # Arrange
    escucha = EscuchaFalsa()
    con_muestras(escucha, peso)
    app = crear_app(escucha, token="secreta")

    # Act
    async with cliente(app) as c:
        sin = await c.post("/medir")
        con = await c.post("/medir", headers={"X-Puente-Key": "secreta"})

    # Assert
    assert sin.status_code == 401 and con.status_code == 200


# ---------------------------------------------------------------------------------------- arranque

async def test_el_ciclo_de_vida_inicia_y_detiene_la_escucha():
    # Arrange
    escucha = EscuchaFalsa()
    app = crear_app(escucha)

    # Act
    async with app.router.lifespan_context(app):
        iniciado = escucha.iniciado
    # Assert
    assert iniciado and escucha.detenido


def test_sin_bascula_id_el_programa_no_arranca(monkeypatch, capsys):
    # Arrange
    monkeypatch.delenv("BASCULA_ID", raising=False)

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 1 and "BASCULA_ID" in capsys.readouterr().err


def test_fuera_de_localhost_exige_token(monkeypatch, capsys):
    # Arrange
    monkeypatch.setenv("BASCULA_ID", "E0:D3:8E:62:51:3D")
    monkeypatch.setenv("PUENTE_HOST", "0.0.0.0")
    monkeypatch.delenv("PUENTE_TOKEN", raising=False)

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 1 and "PUENTE_TOKEN" in capsys.readouterr().err
