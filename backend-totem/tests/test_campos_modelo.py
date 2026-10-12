import datetime

import pytest

import main
from identidad import calcular_edad, fecha_nacimiento_valida, telefono_valido
from models import AuditLog, CuestionarioObjetivo, MedicionCorporal


def _enviar(client, payload, headers):
    assert client.post("/api/evaluaciones", json=payload, headers=headers).status_code == 200


def _primera(client, headers):
    return client.get("/api/evaluaciones", headers=headers).json()[0]


# ------------------------------------------------------------- reglas puras (edad, fecha, teléfono)

@pytest.mark.parametrize("nacimiento, hoy, esperada", [
    (datetime.date(2002, 3, 15), datetime.date(2026, 3, 15), 24),   # cumple años hoy
    (datetime.date(2002, 3, 15), datetime.date(2026, 3, 14), 23),   # un día antes
    (datetime.date(2002, 3, 15), datetime.date(2026, 12, 31), 24),
    (datetime.date(2000, 2, 29), datetime.date(2026, 2, 28), 25),   # nacido un 29 de febrero
    (datetime.date(2000, 2, 29), datetime.date(2026, 3, 1), 26),
    (datetime.date(2026, 3, 15), datetime.date(2026, 3, 15), 0),
])
def test_calcular_edad_cuenta_los_anios_cumplidos(nacimiento, hoy, esperada):
    # Arrange / Act
    edad = calcular_edad(nacimiento, hoy)

    # Assert
    assert edad == esperada


@pytest.mark.parametrize("nacimiento, valida", [
    (datetime.date(2026, 3, 15), True),    # nace hoy
    (datetime.date(2026, 3, 16), False),   # mañana
    (datetime.date(1906, 3, 15), True),    # exactamente 120 años
    (datetime.date(1905, 3, 15), False),   # 121 años
])
def test_fecha_nacimiento_valida_rechaza_futuras_y_mayores_de_120(nacimiento, valida):
    # Arrange
    hoy = datetime.date(2026, 3, 15)

    # Act / Assert
    assert fecha_nacimiento_valida(nacimiento, hoy) is valida


@pytest.mark.parametrize("telefono, valido", [
    ("+56 9 1234 5678", True), ("912345678", True), ("(2) 2345-6789", True),
    ("12345", False), ("abc", False), ("", False), (None, False), ("9" * 30, False),
])
def test_telefono_valido(telefono, valido):
    # Arrange / Act
    resultado = telefono_valido(telefono)

    # Assert
    assert resultado is valido


# --------------------------------------------------------------------------- mediciones del modelo

def test_la_masa_muscular_se_guarda_y_se_entrega_al_dashboard(client, payload, totem_headers, auth):
    # Arrange / Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert fila["mediciones"]["masaMuscular"] == "30.5"
    db = main.SessionLocal()
    try:
        assert db.query(MedicionCorporal).one().masa_muscular_kg == 30.5
    finally:
        db.close()


def test_sin_masa_muscular_el_campo_queda_vacio(client, payload, totem_headers, auth):
    # Arrange
    del payload["mediciones"]["masaMuscular"]

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["mediciones"]["masaMuscular"] == ""


def test_las_mediciones_llegan_con_captura_y_sin_validar(client, payload, totem_headers, auth):
    # Arrange / Act
    _enviar(client, payload, totem_headers)

    # Assert
    medicion = _primera(client, auth())["mediciones"]
    assert medicion["validado"] is False
    assert datetime.datetime.fromisoformat(medicion["capturadoEn"])
    assert (medicion["peso"], medicion["grasa"], medicion["presionSys"], medicion["fcReposo"]) == ("70.5", "20.2", 118, 70)


# ----------------------------------------------------------------- validación por el encargado

def test_el_encargado_valida_las_mediciones(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.post(f"/api/evaluaciones/{eval_id}/mediciones/validar", json={}, headers=h)

    # Assert
    assert r.status_code == 200 and r.json()["evaluacion"]["mediciones"]["validado"] is True
    db = main.SessionLocal()
    try:
        assert db.query(MedicionCorporal).one().validado is True
        assert db.query(AuditLog).filter(AuditLog.accion == "mediciones_validadas").count() == 1
    finally:
        db.close()


def test_el_encargado_puede_retirar_la_validacion(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]
    client.post(f"/api/evaluaciones/{eval_id}/mediciones/validar", json={}, headers=h)

    # Act
    r = client.post(f"/api/evaluaciones/{eval_id}/mediciones/validar", json={"validado": False}, headers=h)

    # Assert
    assert r.json()["evaluacion"]["mediciones"]["validado"] is False


def test_no_se_validan_mediciones_de_un_caso_cerrado(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]
    client.put(f"/api/evaluaciones/{eval_id}", json={"nivel_final": "A3"}, headers=h)

    # Act
    r = client.post(f"/api/evaluaciones/{eval_id}/mediciones/validar", json={}, headers=h)

    # Assert
    assert r.status_code == 409
    assert _primera(client, h)["mediciones"]["validado"] is False


def test_validar_mediciones_requiere_sesion(client):
    # Arrange / Act
    r = client.post("/api/evaluaciones/00000000-0000-0000-0000-000000000000/mediciones/validar", json={})

    # Assert
    assert r.status_code == 401


def test_validar_mediciones_de_una_evaluacion_inexistente_devuelve_404(client, auth):
    # Arrange / Act
    r = client.post("/api/evaluaciones/00000000-0000-0000-0000-000000000000/mediciones/validar", json={}, headers=auth())

    # Assert
    assert r.status_code == 404


# ------------------------------------------------------------ cuestionario del modelo (objetivos)

def test_el_cuestionario_guarda_los_dias_por_semana(client, payload, totem_headers, auth):
    # Arrange / Act
    _enviar(client, payload, totem_headers)

    # Assert
    entrenamiento = _primera(client, auth())["entrenamiento"]
    assert entrenamiento == {"objetivo": "Fuerza", "experiencia": "Intermedio", "diasSemana": 3, "duracion": 60}
    db = main.SessionLocal()
    try:
        assert db.query(CuestionarioObjetivo).one().dias_disponibles_semana == 3
    finally:
        db.close()


@pytest.mark.parametrize("dias", [0, 8, -1])
def test_los_dias_por_semana_deben_estar_entre_1_y_7(client, payload, totem_headers, dias):
    # Arrange
    payload["entrenamiento"]["diasSemana"] = dias

    # Act
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert r.status_code == 422


def test_los_dias_por_semana_son_opcionales_para_clientes_antiguos(client, payload, totem_headers, auth):
    # Arrange
    del payload["entrenamiento"]["diasSemana"]

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["entrenamiento"]["diasSemana"] is None


def test_las_lesiones_previas_escritas_por_el_usuario_tienen_prioridad(client, payload, totem_headers, auth):
    # Arrange
    payload["salud"].update(lesionesPrevias="  Esguince de tobillo en 2025 ", condiciones=["Lesión de rodilla"])

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["salud"]["lesionesPrevias"] == "Esguince de tobillo en 2025"


def test_sin_texto_las_lesiones_previas_salen_de_las_condiciones_marcadas(client, payload, totem_headers, auth):
    # Arrange
    payload["salud"]["condiciones"] = ["Asma", "Lesión de rodilla", "Lesión lumbar"]

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["salud"]["lesionesPrevias"] == "Lesión de rodilla, Lesión lumbar"


def test_sin_lesiones_el_campo_queda_vacio(client, payload, totem_headers, auth):
    # Arrange
    payload["salud"]["condiciones"] = ["Asma"]

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["salud"]["lesionesPrevias"] is None


@pytest.mark.parametrize("condiciones, cronicos", [
    (["Asma"], True), (["Hipertensión", "Diabetes"], True), (["Problema cardíaco"], True),
    (["Lesión de rodilla"], False), (["Embarazo"], False), ([], False),
])
def test_antecedentes_cronicos_se_deducen_de_las_condiciones(client, payload, totem_headers, auth, condiciones, cronicos):
    # Arrange
    payload["salud"]["condiciones"] = condiciones

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["salud"]["antecedentesCronicos"] is cronicos
