import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import main
from models import AuditLog


@pytest.fixture()
def abierto(monkeypatch, client):
    """El backend con la seguridad apagada (las demás pruebas la tienen activa)."""
    monkeypatch.setattr(main, "SEGURIDAD_ACTIVA", False)
    return client


def _guardar_evaluacion(client, payload, headers=None):
    r = client.post("/api/evaluaciones", json=payload, headers=headers or {})
    assert r.status_code == 200, r.text
    return client.get("/api/evaluaciones").json()[0]["idBaseDatos"]


# --------------------------------------------------------------------------------------- el interruptor

@pytest.mark.parametrize("valor, esperado", [
    (None, False), ("", False), ("   ", False), ("false", False), ("0", False), ("no", False), ("cualquier cosa", False),
    ("true", True), ("TRUE", True), (" True ", True), ("1", True), ("si", True), ("sí", True), ("yes", True), ("on", True),
])
def test_el_interruptor_solo_se_activa_con_valores_afirmativos_explicitos(valor, esperado):
    # Arrange / Act
    resultado = main._a_booleano(valor)

    # Assert
    assert resultado is esperado


def test_si_la_variable_no_esta_definida_la_seguridad_queda_apagada():
    # Arrange / Act / Assert
    assert main._a_booleano(None) is False


def test_la_configuracion_publica_informa_si_la_seguridad_esta_activa(client, monkeypatch):
    # Arrange / Act
    activa = client.get("/api/configuracion").json()
    monkeypatch.setattr(main, "SEGURIDAD_ACTIVA", False)
    apagada = client.get("/api/configuracion").json()

    # Assert
    assert activa == {"seguridad": True} and apagada == {"seguridad": False}


def test_la_configuracion_publica_no_exige_sesion_ni_clave(client):
    # Arrange / Act
    r = client.get("/api/configuracion")

    # Assert
    assert r.status_code == 200


@pytest.mark.parametrize("seguridad, jwt, clave, esperados", [
    (False, True, True, ["SEGURIDAD DESACTIVADA"]),
    (False, False, False, ["SEGURIDAD DESACTIVADA"]),      # apagada: no hace falta quejarse de las variables
    (True, False, False, ["JWT_SECRET no definido", "TOTEM_API_KEY no definido"]),
    (True, True, False, ["TOTEM_API_KEY no definido"]),
    (True, False, True, ["JWT_SECRET no definido"]),
    (True, True, True, []),
])
def test_el_arranque_avisa_de_la_seguridad_apagada_y_de_las_variables_que_faltan(seguridad, jwt, clave, esperados):
    # Arrange / Act
    avisos = main.avisos_de_arranque(seguridad, jwt, clave)

    # Assert
    assert len(avisos) == len(esperados)
    for aviso, esperado in zip(avisos, esperados):
        assert esperado in aviso


# ---------------------------------------------------------------------------- login y roles del dashboard

def test_sin_seguridad_el_historial_no_pide_sesion(abierto, payload, totem_headers):
    # Arrange
    _guardar_evaluacion(abierto, payload)

    # Act
    r = abierto.get("/api/evaluaciones")

    # Assert
    assert r.status_code == 200 and len(r.json()) == 1


def test_con_seguridad_el_mismo_historial_si_pide_sesion(client):
    # Arrange / Act
    r = client.get("/api/evaluaciones")

    # Assert
    assert r.status_code == 401


def test_sin_seguridad_se_puede_decidir_una_evaluacion_sin_iniciar_sesion(abierto, payload):
    # Arrange
    eval_id = _guardar_evaluacion(abierto, payload)

    # Act
    r = abierto.put(f"/api/evaluaciones/{eval_id}", json={"nivel_final": "A3", "observaciones": "Todo bien"})

    # Assert
    assert r.status_code == 200 and r.json()["evaluacion"]["estadoRevision"] == "revisada"


def test_sin_seguridad_funcionan_la_revision_de_alertas_la_validacion_de_mediciones_y_el_historial(abierto, payload):
    # Arrange
    payload["salud"]["sintomas"] = ["Medicación permanente"]
    eval_id = _guardar_evaluacion(abierto, payload)

    # Act
    alerta = abierto.post(f"/api/evaluaciones/{eval_id}/alerta/revisar")
    mediciones = abierto.post(f"/api/evaluaciones/{eval_id}/mediciones/validar", json={})
    historial = abierto.get("/api/socios/20231234A/evaluaciones")

    # Assert
    assert (alerta.status_code, mediciones.status_code, historial.status_code) == (200, 200, 200)


def test_sin_seguridad_la_auditoria_tambien_queda_abierta(abierto):
    # Arrange / Act
    r = abierto.get("/api/auditoria")

    # Assert
    assert r.status_code == 200


def test_las_acciones_sin_seguridad_quedan_registradas_con_el_usuario_acceso_libre(abierto, payload):
    # Arrange
    eval_id = _guardar_evaluacion(abierto, payload)

    # Act
    abierto.put(f"/api/evaluaciones/{eval_id}", json={"nivel_final": "A3"})

    # Assert
    db = main.SessionLocal()
    try:
        registro = db.query(AuditLog).filter(AuditLog.accion == "validacion:A3").one()
        assert registro.detalle["usuario"] == "acceso-libre" and registro.personal_id is None
    finally:
        db.close()


def test_el_login_sigue_funcionando_si_se_usa_aunque_la_seguridad_este_apagada(abierto):
    # Arrange / Act
    ok = abierto.post("/api/auth/login", json={"username": "encargado", "password": "enc-pass"})
    mal = abierto.post("/api/auth/login", json={"username": "encargado", "password": "mala"})

    # Assert
    assert ok.status_code == 200 and mal.status_code == 401


def test_sin_seguridad_los_intentos_de_login_fallidos_no_bloquean(abierto):
    # Arrange / Act
    codigos = [abierto.post("/api/auth/login", json={"username": "admin", "password": "mala"}).status_code for _ in range(8)]

    # Assert
    assert set(codigos) == {401}


def test_con_seguridad_el_mismo_numero_de_intentos_si_bloquea(client):
    # Arrange / Act
    codigos = [client.post("/api/auth/login", json={"username": "admin", "password": "mala"}).status_code for _ in range(6)]

    # Assert
    assert codigos[-1] == 429


# ----------------------------------------------------------------------------------- clave del tótem

def test_sin_seguridad_el_totem_no_necesita_clave(abierto, payload):
    # Arrange / Act
    sin_clave = abierto.post("/api/evaluaciones", json=payload)
    clave_mala = abierto.post("/api/evaluaciones", json=payload, headers={"X-Totem-Key": "cualquiera"})

    # Assert
    assert (sin_clave.status_code, clave_mala.status_code) == (200, 200)


def test_con_seguridad_el_totem_sin_clave_se_rechaza(client, payload):
    # Arrange / Act
    r = client.post("/api/evaluaciones", json=payload)

    # Assert
    assert r.status_code == 401


def test_sin_seguridad_la_identificacion_y_el_registro_de_socios_no_piden_clave(abierto):
    # Arrange
    socio = {"matricula": "20231234A", "nombre": "Ana", "apellido": "Pérez", "fecha_nacimiento": "2002-03-15", "plan_membresia": "Plan"}

    # Act
    identificar = abierto.post("/api/socios/identificar", json={"matricula": "20231234A"})
    registrar = abierto.post("/api/socios", json=socio)
    actualizar = abierto.put("/api/socios/20231234A", json={"plan_membresia": "Plan Premium"})

    # Assert
    assert (identificar.status_code, registrar.status_code, actualizar.status_code) == (200, 201, 200)


def test_el_consentimiento_se_sigue_exigiendo_sin_seguridad(abierto, payload):
    # Arrange
    payload["consentimiento"] = False

    # Act
    r = abierto.post("/api/evaluaciones", json=payload)

    # Assert: no es seguridad de acceso sino el aviso legal al usuario: se mantiene
    assert r.status_code == 400


# ------------------------------------------------------------------------- límites de identificación

def test_sin_seguridad_la_identificacion_no_tiene_tope_de_consultas(abierto, monkeypatch):
    # Arrange
    monkeypatch.setattr(main, "MAX_CONSULTAS", 2)
    main._consultas.clear()

    # Act
    codigos = [abierto.post("/api/socios/identificar", json={"matricula": "20231234A"}).status_code for _ in range(6)]

    # Assert
    assert set(codigos) == {200}


def test_con_seguridad_la_identificacion_si_tiene_tope(client, totem_headers, monkeypatch):
    # Arrange
    monkeypatch.setattr(main, "MAX_CONSULTAS", 2)
    main._consultas.clear()

    # Act
    codigos = [client.post("/api/socios/identificar", json={"matricula": "20231234A"}, headers=totem_headers).status_code for _ in range(3)]

    # Assert
    assert codigos == [200, 200, 429]


# ---------------------------------------------------------------------------------------- WebSocket

def test_sin_seguridad_el_websocket_recibe_evaluaciones_sin_enviar_token(abierto, payload):
    # Arrange / Act
    with abierto.websocket_connect("/ws/dashboard") as ws:
        abierto.post("/api/evaluaciones", json=payload)
        recibido = ws.receive_text()

    # Assert
    assert "idBaseDatos" in recibido


def test_sin_seguridad_el_websocket_acepta_un_primer_mensaje_cualquiera(abierto, payload):
    # Arrange / Act: el dashboard puede seguir enviando su token; se ignora
    with abierto.websocket_connect("/ws/dashboard") as ws:
        ws.send_text('{"token": null}')
        abierto.post("/api/evaluaciones", json=payload)
        recibido = ws.receive_text()

    # Assert
    assert "idBaseDatos" in recibido


# ------------------------------------------------------------------------------------------- CORS

def _preflight(aplicacion):
    return TestClient(aplicacion).options(
        "/x", headers={"Origin": "https://cualquiera.example", "Access-Control-Request-Method": "POST",
                       "Access-Control-Request-Headers": "x-totem-key"})


def _app_con_cors(seguridad):
    aplicacion = FastAPI()

    @aplicacion.get("/x")
    def x():
        return {}

    main.configurar_cors(aplicacion, seguridad, ["https://dashboard.example"])
    return aplicacion


def test_sin_seguridad_el_cors_acepta_cualquier_origen():
    # Arrange / Act
    r = _preflight(_app_con_cors(False))

    # Assert
    assert r.status_code == 200 and r.headers["access-control-allow-origin"] == "*"


def test_con_seguridad_el_cors_solo_acepta_los_origenes_configurados():
    # Arrange
    aplicacion = _app_con_cors(True)

    # Act
    ajeno = _preflight(aplicacion)
    propio = TestClient(aplicacion).options("/x", headers={
        "Origin": "https://dashboard.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-totem-key"})

    # Assert
    assert ajeno.status_code == 400
    assert propio.status_code == 200 and propio.headers["access-control-allow-origin"] == "https://dashboard.example"


# ------------------------------------------------------------------------------ volver a activarla

def test_al_reactivar_la_seguridad_vuelven_a_exigirse_sesion_y_clave(monkeypatch, client, payload):
    # Arrange
    monkeypatch.setattr(main, "SEGURIDAD_ACTIVA", False)
    assert client.get("/api/evaluaciones").status_code == 200

    # Act
    monkeypatch.setattr(main, "SEGURIDAD_ACTIVA", True)

    # Assert
    assert client.get("/api/evaluaciones").status_code == 401
    assert client.post("/api/evaluaciones", json=payload).status_code == 401
