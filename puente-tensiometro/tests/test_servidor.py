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


class LectorFalso:
    def __init__(self, activo=True, conectado=False):
        self.activo = activo
        self.conectado = conectado
        self.direccion = "0C:7F:ED:74:07:54"
        self._reloj = Reloj()
        self._dormir = self._reloj.dormir
        self.captura = Captura(self._reloj)
        self.iniciado = self.detenido = False

    async def iniciar(self):
        self.iniciado = True

    async def detener(self):
        self.detenido = True


VALIDA = Muestra(118, 78, 72, True)


def con_medicion(lector, muestra=VALIDA, desde_t=2.0):
    lector._reloj.al_dormir = lambda t: lector.captura.agregar(muestra) if t >= desde_t else None


def cliente(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://puente")


async def test_estado_indica_si_esta_activo_y_conectado_y_la_ultima_medicion():
    # Arrange
    lector = LectorFalso(conectado=False)
    lector._reloj.t = 10.0
    lector.captura.agregar(VALIDA)
    lector._reloj.t = 14.5

    # Act
    async with cliente(crear_app(lector)) as c:
        r = await c.get("/estado")

    # Assert: no estar conectado es lo normal, el tensiómetro duerme
    assert r.json() == {"activo": True, "conectado": False, "dispositivo": "0C:7F:ED:74:07:54", "ultima_medicion_hace_s": 4.5}


async def test_estado_sin_mediciones_aun():
    # Arrange / Act
    async with cliente(crear_app(LectorFalso())) as c:
        r = await c.get("/estado")

    # Assert
    assert r.json()["ultima_medicion_hace_s"] is None


async def test_medir_espera_la_medicion_y_devuelve_presion_pulso_dispositivo_y_hora():
    # Arrange
    lector = LectorFalso()
    con_medicion(lector)

    # Act
    async with cliente(crear_app(lector)) as c:
        r = await c.post("/medir")

    # Assert
    cuerpo = r.json()
    assert r.status_code == 200
    assert (cuerpo["sistolica"], cuerpo["diastolica"], cuerpo["pulso"]) == (118, 78, 72)
    assert cuerpo["dispositivo"] == {"id": "0C:7F:ED:74:07:54", "calibracion": "desconocida"}
    assert datetime.datetime.fromisoformat(cuerpo["capturado_en"]).tzinfo is not None


async def test_medir_no_guarda_nada_en_disco(tmp_path, monkeypatch):
    # Arrange
    monkeypatch.chdir(tmp_path)
    lector = LectorFalso()
    con_medicion(lector)

    # Act
    async with cliente(crear_app(lector)) as c:
        await c.post("/medir")

    # Assert
    assert list(tmp_path.iterdir()) == []


async def test_medir_sin_el_puente_activo_responde_503_desconectado():
    # Arrange / Act
    async with cliente(crear_app(LectorFalso(activo=False))) as c:
        r = await c.post("/medir")

    # Assert
    assert r.status_code == 503 and r.json()["codigo"] == "desconectado"


async def test_medir_no_exige_estar_conectado_porque_el_aparato_duerme():
    # Arrange
    lector = LectorFalso(activo=True, conectado=False)
    con_medicion(lector)

    # Act
    async with cliente(crear_app(lector)) as c:
        r = await c.post("/medir")

    # Assert
    assert r.status_code == 200


async def test_si_nadie_mide_en_el_tiempo_maximo_responde_504_timeout():
    # Arrange / Act
    async with cliente(crear_app(LectorFalso(), timeout_s=5)) as c:
        r = await c.post("/medir")

    # Assert
    assert r.status_code == 504 and r.json()["codigo"] == "timeout" and "Start" in r.json()["mensaje"]


@pytest.mark.parametrize("muestra, codigo", [
    (Muestra(118, 78, 72, False, "Te moviste", "movimiento"), "movimiento"),
    (Muestra(118, 78, 72, False, "Brazalete flojo", "lectura_invalida"), "lectura_invalida"),
])
async def test_una_medicion_invalida_responde_422_con_el_motivo(muestra, codigo):
    # Arrange
    lector = LectorFalso()
    con_medicion(lector, muestra)

    # Act
    async with cliente(crear_app(lector)) as c:
        r = await c.post("/medir")

    # Assert
    assert r.status_code == 422 and r.json()["codigo"] == codigo and r.json()["mensaje"] == muestra.motivo


async def test_dos_mediciones_a_la_vez_la_segunda_recibe_409():
    # Arrange
    lector = LectorFalso()
    app = crear_app(lector, timeout_s=3)

    # Act
    async with cliente(app) as c:
        primera = asyncio.create_task(c.post("/medir"))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        segunda = await c.post("/medir")
        await primera

    # Assert
    assert segunda.status_code == 409


async def test_con_token_exige_la_clave_en_estado_y_medir():
    # Arrange
    lector = LectorFalso()
    con_medicion(lector)
    app = crear_app(lector, token="secreta")

    # Act
    async with cliente(app) as c:
        sin_estado = await c.get("/estado")
        sin_medir = await c.post("/medir")
        con = await c.post("/medir", headers={"X-Puente-Key": "secreta"})

    # Assert
    assert (sin_estado.status_code, sin_medir.status_code, con.status_code) == (401, 401, 200)


async def test_el_ciclo_de_vida_inicia_y_detiene_el_lector():
    # Arrange
    lector = LectorFalso()
    app = crear_app(lector)

    # Act
    async with app.router.lifespan_context(app):
        iniciado = lector.iniciado

    # Assert
    assert iniciado and lector.detenido


def test_sin_tensiometro_id_el_programa_no_arranca(monkeypatch, capsys):
    # Arrange
    monkeypatch.delenv("TENSIOMETRO_ID", raising=False)

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 1 and "TENSIOMETRO_ID" in capsys.readouterr().err


def test_fuera_de_localhost_exige_token(monkeypatch, capsys):
    # Arrange
    monkeypatch.setenv("TENSIOMETRO_ID", "0C:7F:ED:74:07:54")
    monkeypatch.setenv("PUENTE_HOST", "0.0.0.0")
    monkeypatch.delenv("PUENTE_TOKEN", raising=False)

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 1 and "PUENTE_TOKEN" in capsys.readouterr().err
