import asyncio
import datetime

import httpx
import pytest
from fastapi.testclient import TestClient

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
    def __init__(self, conectado=True):
        self.conectado = conectado
        self.direccion = "AA:BB:CC:DD:EE:FF"
        self._reloj = Reloj()
        self._dormir = self._reloj.dormir
        self.captura = Captura(self._reloj)
        self.iniciado = self.detenido = False

    async def iniciar(self):
        self.iniciado = True

    async def detener(self):
        self.detenido = True


def buena(spo2=97, fc=72):
    return Muestra(spo2, fc, 4.1, True)


def con_muestras(lector, factoria):
    lector._reloj.al_dormir = lambda t: lector.captura.agregar(factoria())


def cliente(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://puente")


# ------------------------------------------------------------------------------------------- /estado

async def test_estado_indica_si_hay_conexion_y_cuanto_hace_que_llego_el_ultimo_paquete():
    # Arrange
    lector = LectorFalso()
    lector._reloj.t = 10.0
    lector.captura.agregar(buena())
    lector._reloj.t = 12.5
    app = crear_app(lector)

    # Act
    async with cliente(app) as c:
        r = await c.get("/estado")

    # Assert
    assert r.status_code == 200
    assert r.json() == {"conectado": True, "dispositivo": "AA:BB:CC:DD:EE:FF", "ultimo_paquete_hace_s": 2.5}


async def test_estado_sin_paquetes_ni_conexion():
    # Arrange
    app = crear_app(LectorFalso(conectado=False))

    # Act
    async with cliente(app) as c:
        r = await c.get("/estado")

    # Assert
    assert r.json()["conectado"] is False and r.json()["ultimo_paquete_hace_s"] is None


# -------------------------------------------------------------------------------------------- /medir

async def test_medir_devuelve_la_medicion_estable_con_dispositivo_y_hora():
    # Arrange
    lector = LectorFalso()
    con_muestras(lector, lambda: buena(97, 72))
    app = crear_app(lector)

    # Act
    async with cliente(app) as c:
        r = await c.post("/medir")

    # Assert
    cuerpo = r.json()
    assert r.status_code == 200
    assert (cuerpo["spo2"], cuerpo["fc"], cuerpo["indice_perfusion"], cuerpo["muestras"]) == (97, 72, 4.1, 5)
    assert cuerpo["dispositivo"] == {"id": "AA:BB:CC:DD:EE:FF", "calibracion": "desconocida"}
    assert datetime.datetime.fromisoformat(cuerpo["capturado_en"]).tzinfo is not None


async def test_medir_no_guarda_nada_en_disco(tmp_path, monkeypatch):
    # Arrange: el script original escribía un CSV con cada lectura; el puente no debe dejar datos de salud en archivos
    monkeypatch.chdir(tmp_path)
    lector = LectorFalso()
    con_muestras(lector, buena)
    app = crear_app(lector)

    # Act
    async with cliente(app) as c:
        await c.post("/medir")

    # Assert
    assert list(tmp_path.iterdir()) == []


async def test_medir_sin_conexion_responde_503_desconectado():
    # Arrange
    app = crear_app(LectorFalso(conectado=False))

    # Act
    async with cliente(app) as c:
        r = await c.post("/medir")

    # Assert
    assert r.status_code == 503 and r.json()["codigo"] == "desconectado"
    assert "no está conectado" in r.json()["mensaje"]


@pytest.mark.parametrize("muestras, estado, codigo", [
    (None, 504, "timeout"),                                                     # no llega ningún paquete
    (lambda: Muestra(0, 0, 0.0, False, "sin dedo"), 422, "lectura_invalida"),   # sin dedo
])
async def test_los_fallos_se_traducen_a_codigos_http_y_de_la_app(muestras, estado, codigo):
    # Arrange
    lector = LectorFalso()
    if muestras:
        con_muestras(lector, muestras)
    app = crear_app(lector, timeout_s=3)

    # Act
    async with cliente(app) as c:
        r = await c.post("/medir")

    # Assert
    assert (r.status_code, r.json()["codigo"]) == (estado, codigo)
    assert r.json()["mensaje"]


async def test_una_lectura_inestable_responde_422_movimiento():
    # Arrange
    lector = LectorFalso()
    valores = iter([(90, 60), (99, 82)] * 50)
    lector._reloj.al_dormir = lambda t: lector.captura.agregar(buena(*next(valores)))
    app = crear_app(lector, timeout_s=3)

    # Act
    async with cliente(app) as c:
        r = await c.post("/medir")

    # Assert
    assert (r.status_code, r.json()["codigo"]) == (422, "movimiento")


async def test_dos_mediciones_a_la_vez_la_segunda_recibe_409():
    # Arrange
    lector = LectorFalso()
    app = crear_app(lector, timeout_s=3)   # sin muestras: la primera queda esperando hasta el timeout

    # Act
    async with cliente(app) as c:
        primera, segunda = await asyncio.gather(c.post("/medir"), c.post("/medir"))

    # Assert
    estados = sorted([primera.status_code, segunda.status_code])
    assert estados == [409, 504]
    en_curso = primera if primera.status_code == 409 else segunda
    assert "en curso" in en_curso.json()["mensaje"]


async def test_tras_un_fallo_se_puede_volver_a_medir():
    # Arrange
    lector = LectorFalso()
    app = crear_app(lector, timeout_s=2)
    async with cliente(app) as c:
        assert (await c.post("/medir")).status_code == 504
        con_muestras(lector, buena)

        # Act
        r = await c.post("/medir")

    # Assert
    assert r.status_code == 200


# ------------------------------------------------------------------------------------------- token

@pytest.mark.parametrize("encabezados, estado", [
    ({}, 401), ({"X-Puente-Key": "otra"}, 401), ({"X-Puente-Key": ""}, 401), ({"X-Puente-Key": "secreto"}, 200),
])
async def test_con_token_configurado_solo_se_aceptan_peticiones_con_la_clave(encabezados, estado):
    # Arrange
    app = crear_app(LectorFalso(), token="secreto")

    # Act
    async with cliente(app) as c:
        r = await c.get("/estado", headers=encabezados)

    # Assert
    assert r.status_code == estado


async def test_con_token_configurado_medir_tambien_exige_la_clave():
    # Arrange
    lector = LectorFalso()
    con_muestras(lector, buena)
    app = crear_app(lector, token="secreto")

    # Act
    async with cliente(app) as c:
        sin_clave = await c.post("/medir")
        con_clave = await c.post("/medir", headers={"X-Puente-Key": "secreto"})

    # Assert
    assert (sin_clave.status_code, con_clave.status_code) == (401, 200)


async def test_sin_token_configurado_el_puente_es_local_y_no_pide_clave():
    # Arrange
    app = crear_app(LectorFalso())

    # Act
    async with cliente(app) as c:
        r = await c.get("/estado")

    # Assert
    assert r.status_code == 200


# -------------------------------------------------------------------------------------------- CORS

async def test_cors_solo_permite_los_origenes_configurados():
    # Arrange
    app = crear_app(LectorFalso(), origenes=["http://localhost:8081"])

    # Act
    async with cliente(app) as c:
        permitido = await c.get("/estado", headers={"Origin": "http://localhost:8081"})
        ajeno = await c.get("/estado", headers={"Origin": "http://sitio-malicioso.example"})

    # Assert
    assert permitido.headers.get("access-control-allow-origin") == "http://localhost:8081"
    assert "access-control-allow-origin" not in ajeno.headers


# ------------------------------------------------------------------------------------ ciclo de vida

def test_al_arrancar_inicia_el_lector_y_al_cerrar_lo_detiene():
    # Arrange
    lector = LectorFalso()

    # Act
    with TestClient(crear_app(lector)) as c:
        durante = lector.iniciado
        c.get("/estado")

    # Assert
    assert durante is True and lector.detenido is True


# -------------------------------------------------------------------------------------- __main__

def test_sin_oximetro_id_no_arranca(monkeypatch, capsys):
    # Arrange
    monkeypatch.delenv("OXIMETRO_ID", raising=False)

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 1 and "OXIMETRO_ID" in capsys.readouterr().err


def test_si_escucha_fuera_de_localhost_exige_token(monkeypatch, capsys):
    # Arrange
    monkeypatch.setenv("OXIMETRO_ID", "AA:BB")
    monkeypatch.setenv("PUENTE_HOST", "0.0.0.0")
    monkeypatch.delenv("PUENTE_TOKEN", raising=False)
    iniciado = []
    monkeypatch.setattr(principal.uvicorn, "run", lambda *a, **k: iniciado.append((a, k)))

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 1 and "PUENTE_TOKEN" in capsys.readouterr().err and iniciado == []


def test_con_la_configuracion_por_defecto_escucha_solo_en_localhost(monkeypatch):
    # Arrange
    monkeypatch.setenv("OXIMETRO_ID", "AA:BB")
    for variable in ("PUENTE_HOST", "PUENTE_PORT", "PUENTE_TOKEN", "PUENTE_ORIGENES"):
        monkeypatch.delenv(variable, raising=False)
    iniciado = []
    monkeypatch.setattr(principal.uvicorn, "run", lambda app, **k: iniciado.append(k))

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 0 and iniciado == [{"host": "127.0.0.1", "port": 8765}]


def test_fuera_de_localhost_con_token_si_arranca(monkeypatch):
    # Arrange
    monkeypatch.setenv("OXIMETRO_ID", "AA:BB")
    monkeypatch.setenv("PUENTE_HOST", "0.0.0.0")
    monkeypatch.setenv("PUENTE_TOKEN", "secreto")
    monkeypatch.setenv("PUENTE_PORT", "9000")
    iniciado = []
    monkeypatch.setattr(principal.uvicorn, "run", lambda app, **k: iniciado.append(k))

    # Act
    codigo = principal.main()

    # Assert
    assert codigo == 0 and iniciado == [{"host": "0.0.0.0", "port": 9000}]


# ------------------------------------------------------------------------------------------- /lectura

async def _lectura(lector, **opciones):
    async with cliente(crear_app(lector, **opciones)) as c:
        return await c.get("/lectura")


async def test_lectura_devuelve_el_ultimo_valor_valido_para_mostrarlo_en_vivo():
    # Arrange
    lector = LectorFalso()
    lector.captura.agregar(buena(97, 72))

    # Act
    r = await _lectura(lector)

    # Assert
    assert r.status_code == 200
    assert r.json() == {"conectado": True, "valida": True, "spo2": 97, "fc": 72, "indice_perfusion": 4.1, "motivo": None}


async def test_lectura_devuelve_siempre_lo_mas_reciente():
    # Arrange
    lector = LectorFalso()
    lector.captura.agregar(buena(97, 72))
    lector.captura.agregar(buena(95, 80))

    # Act
    r = await _lectura(lector)

    # Assert
    assert (r.json()["spo2"], r.json()["fc"]) == (95, 80)


async def test_lectura_sin_dedo_no_entrega_valores():
    # Arrange
    lector = LectorFalso()
    lector.captura.agregar(Muestra(0, 0, 0.0, False, "sin dedo"))

    # Act
    r = await _lectura(lector)

    # Assert
    assert r.json() == {"conectado": True, "valida": False, "spo2": None, "fc": None, "indice_perfusion": None, "motivo": "sin_dedo"}


async def test_lectura_vieja_se_considera_sin_senal():
    # Arrange
    lector = LectorFalso()
    lector.captura.agregar(buena())
    lector._reloj.t += 3.5

    # Act
    r = await _lectura(lector)

    # Assert
    assert r.json()["valida"] is False and r.json()["motivo"] == "sin_senal" and r.json()["spo2"] is None


async def test_lectura_sin_ningun_paquete_es_sin_senal():
    # Arrange / Act
    r = await _lectura(LectorFalso())

    # Assert
    assert r.json()["motivo"] == "sin_senal" and r.json()["conectado"] is True


async def test_lectura_desconectado_no_muestra_el_ultimo_valor_viejo():
    # Arrange
    lector = LectorFalso(conectado=False)
    lector.captura.agregar(buena())

    # Act
    r = await _lectura(lector)

    # Assert
    assert r.json() == {"conectado": False, "valida": False, "spo2": None, "fc": None, "indice_perfusion": None, "motivo": "desconectado"}


async def test_lectura_exige_la_clave_si_el_puente_tiene_token():
    # Arrange
    lector = LectorFalso()
    lector.captura.agregar(buena())

    # Act
    sin_clave = await _lectura(lector, token="secreta")
    async with cliente(crear_app(lector, token="secreta")) as c:
        con_clave = await c.get("/lectura", headers={"X-Puente-Key": "secreta"})

    # Assert
    assert sin_clave.status_code == 401 and con_clave.status_code == 200


async def test_lectura_no_guarda_nada_en_disco(tmp_path, monkeypatch):
    # Arrange
    monkeypatch.chdir(tmp_path)
    lector = LectorFalso()
    lector.captura.agregar(buena())

    # Act
    await _lectura(lector)

    # Assert
    assert list(tmp_path.iterdir()) == []
