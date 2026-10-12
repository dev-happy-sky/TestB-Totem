import datetime

from identidad import calcular_edad
import pytest
from starlette.websockets import WebSocketDisconnect

import main
from models import (
    AuditLog, CuestionarioObjetivo, InferenciaIA, MedicionCorporal, ResultadoRutina, SesionTotem, Socio, Totem,
)


def _contar(modelo):
    db = main.SessionLocal()
    try:
        return db.query(modelo).count()
    finally:
        db.close()


def test_guarda_evaluacion_en_todas_las_tablas(client, payload, totem_headers):
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    assert r.status_code == 200
    for modelo in (Socio, Totem, SesionTotem, MedicionCorporal, CuestionarioObjetivo, InferenciaIA):
        assert _contar(modelo) == 1, modelo.__name__
    assert _contar(ResultadoRutina) == 0  # aún no la valida el encargado


def test_datos_quedan_mapeados_al_modelo(client, payload, totem_headers):
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert (socio.rut, socio.nombre, socio.apellido) == ("20231234A", "Ana", "Pérez Soto")
        assert (str(socio.fecha_nacimiento), socio.telefono, socio.plan_membresia) == ("2002-03-15", "+56 9 1234 5678", "Plan Estudiante")
        med = db.query(MedicionCorporal).one()
        assert (med.peso_kg, med.presion_sistolica, med.frecuencia_cardiaca) == (70.5, 118, 70)
        cues = db.query(CuestionarioObjetivo).one()
        assert cues.antecedentes_cronicos is True and cues.lesiones_previas == "Lesión de rodilla"
        sesion = db.query(SesionTotem).one()
        assert sesion.consentimiento is True and sesion.consentimiento_en is not None
        inf = db.query(InferenciaIA).one()
        assert inf.version_modelo == "reglas-v1" and inf.categoria_aptitud == "A3" and inf.alerta is None
    finally:
        db.close()


def test_mismo_socio_en_dos_evaluaciones_no_se_duplica(client, payload, totem_headers):
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    assert _contar(Socio) == 1
    assert _contar(SesionTotem) == 2
    assert _contar(Totem) == 1


def test_sintomas_generan_alerta_y_categoria_a2(client, payload, totem_headers, auth):
    payload["salud"]["sintomas"] = ["Mareos"]
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert fila["iaSugerida"] == "A2" and fila["alerta"] == "DERIVAR"


def test_rechaza_sin_consentimiento(client, payload, totem_headers):
    payload["consentimiento"] = False
    assert client.post("/api/evaluaciones", json=payload, headers=totem_headers).status_code == 400
    assert _contar(SesionTotem) == 0


def test_rechaza_sin_clave_de_totem(client, payload):
    assert client.post("/api/evaluaciones", json=payload).status_code == 401


def test_historial_requiere_login(client):
    assert client.get("/api/evaluaciones").status_code == 401


def test_historial_mantiene_el_contrato_del_dashboard(client, payload, totem_headers, auth):
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert fila["id"] == "20231234A" and fila["nombre"] == "Ana Pérez Soto" and fila["edad"] == str(calcular_edad(datetime.date(2002, 3, 15), datetime.date.today()))
    assert fila["estado"] == "pendiente" and fila["nivelFinal"] is None
    assert fila["mediciones"]["presionSys"] == 118 and fila["mediciones"]["peso"] == "70.5"
    assert fila["salud"]["condiciones"] == ["Asma", "Lesión de rodilla"]


def test_validar_crea_resultado_y_audita(client, payload, totem_headers, auth):
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    h = auth()
    eval_id = client.get("/api/evaluaciones", headers=h).json()[0]["idBaseDatos"]
    assert client.put(f"/api/evaluaciones/{eval_id}", json={"nivel_final": "A1"}, headers=h).status_code == 200

    fila = client.get("/api/evaluaciones", headers=h).json()[0]
    assert fila["estado"] == "validado" and fila["nivelFinal"] == "A1"
    db = main.SessionLocal()
    try:
        res = db.query(ResultadoRutina).one()
        assert res.decision_personal == "modificada" and res.personal_id is not None
        assert db.query(AuditLog).filter(AuditLog.accion == "validacion:A1").one().sesion_id is not None
    finally:
        db.close()


def test_validar_con_mismo_nivel_de_la_ia_es_confirmacion(client, payload, totem_headers, auth):
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    h = auth()
    eval_id = client.get("/api/evaluaciones", headers=h).json()[0]["idBaseDatos"]
    client.put(f"/api/evaluaciones/{eval_id}", json={"nivel_final": "A3"}, headers=h)
    db = main.SessionLocal()
    try:
        assert db.query(ResultadoRutina).one().decision_personal == "confirmada"
    finally:
        db.close()


def test_validar_inexistente_devuelve_404(client, auth):
    r = client.put("/api/evaluaciones/00000000-0000-0000-0000-000000000000", json={"nivel_final": "A1"}, headers=auth())
    assert r.status_code == 404


def test_auditoria_solo_para_admin(client, auth):
    assert client.get("/api/auditoria", headers=auth("encargado", "enc-pass")).status_code == 403
    assert client.get("/api/auditoria", headers=auth("admin", "admin-pass")).status_code == 200


def test_login_invalido_y_bloqueo_por_intentos(client):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "admin", "password": "mal"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": "admin-pass"}).status_code == 429


def test_websocket_rechaza_token_invalido_y_recibe_evaluaciones(client, payload, totem_headers, auth):
    with client.websocket_connect("/ws/dashboard") as ws:
        ws.send_text('{"token":"malo"}')
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()
    token = auth()["Authorization"].split()[1]
    with client.websocket_connect("/ws/dashboard") as ws:
        ws.send_text('{"token":"' + token + '"}')
        client.post("/api/evaluaciones", json=payload, headers=totem_headers)
        assert "idBaseDatos" in ws.receive_text()
