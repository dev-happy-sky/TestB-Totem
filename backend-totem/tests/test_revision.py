import pytest
from sqlalchemy import inspect, text

import main
from migraciones import agregar_columnas_faltantes
from models import AuditLog, ResultadoRutina
from persistencia import evaluar_reglas
from schemas import EvaluacionPayload


def _enviar(client, payload, headers, **cambios_salud):
    payload["salud"].update(cambios_salud)
    assert client.post("/api/evaluaciones", json=payload, headers=headers).status_code == 200


def _primera(client, headers):
    return client.get("/api/evaluaciones", headers=headers).json()[0]


# ---------------------------------------------------------------- reglas de alerta (R.124, R.125, R.132)

@pytest.mark.parametrize("salud, categoria, nivel", [
    ({"sintomas": [], "condiciones": []}, "A3", None),
    ({"sintomas": ["Medicación permanente"], "condiciones": []}, "A2", "riesgo"),
    ({"sintomas": ["Lesión articular u ósea"], "condiciones": ["Asma"]}, "A2", "riesgo"),
    ({"sintomas": ["Dolor de pecho al esforzarte"], "condiciones": []}, "A2", "critica"),
    ({"sintomas": ["Mareos o pérdida de equilibrio"], "condiciones": []}, "A2", "critica"),
    ({"sintomas": [], "condiciones": ["Problema cardíaco"]}, "A2", "critica"),
    ({"sintomas": ["Medicación permanente"], "condiciones": ["Problema cardíaco"]}, "A2", "critica"),
])
def test_evaluar_reglas_clasifica_el_nivel_de_alerta(payload, salud, categoria, nivel):
    # Arrange
    payload["salud"] = salud

    # Act
    cat, alerta, _, nivel_alerta, _ = evaluar_reglas(EvaluacionPayload(**payload))

    # Assert
    assert (cat, nivel_alerta) == (categoria, nivel)
    assert (alerta == "DERIVAR") == (nivel is not None)


def test_evaluar_reglas_lista_los_factores_que_uso(payload):
    # Arrange
    payload["salud"] = {"sintomas": ["Medicación permanente"], "condiciones": ["Asma", "Problema cardíaco"]}

    # Act
    *_, factores = evaluar_reglas(EvaluacionPayload(**payload))

    # Assert
    assert factores == ["Síntoma declarado: Medicación permanente", "Condición crítica: Problema cardíaco"]


def test_dashboard_recibe_nivel_de_alerta_y_factores(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers, sintomas=["Dolor de pecho al esforzarte"])

    # Act
    fila = _primera(client, auth())

    # Assert
    assert fila["alertaNivel"] == "critica" and fila["alertaRevisada"] is False
    assert fila["factores"] == ["Síntoma declarado: Dolor de pecho al esforzarte"]
    assert fila["estadoRevision"] == "pendiente" and fila["fecha"]


# ------------------------------------------------------- decisión del encargado (R.105-107, R.129, R.133-138)

def test_confirmar_guarda_observaciones_y_quien_reviso(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.put(f"/api/evaluaciones/{eval_id}", headers=h,
                   json={"nivel_final": "A3", "observaciones": "  Calentar 10 min  "})

    # Assert
    ev = r.json()["evaluacion"]
    assert r.status_code == 200
    assert (ev["estadoRevision"], ev["estado"], ev["nivelFinal"]) == ("revisada", "validado", "A3")
    assert ev["observaciones"] == "Calentar 10 min" and ev["revisadoPor"] == "encargado"


def test_derivar_sin_motivo_es_rechazado(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.put(f"/api/evaluaciones/{eval_id}", headers=h, json={"nivel_final": "A2", "derivar": True, "motivo": "   "})

    # Assert
    assert r.status_code == 422
    assert _primera(client, h)["estadoRevision"] == "pendiente"


def test_derivar_con_motivo_cierra_el_caso_como_derivado(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.put(f"/api/evaluaciones/{eval_id}", headers=h,
                   json={"nivel_final": "A3", "derivar": True, "motivo": "Presión alta en reposo"})

    # Assert
    ev = r.json()["evaluacion"]
    assert (ev["estadoRevision"], ev["nivelFinal"], ev["motivoDerivacion"]) == ("derivada", "A1", "Presión alta en reposo")
    db = main.SessionLocal()
    try:
        assert db.query(ResultadoRutina).one().decision_personal == "derivada"
        assert db.query(AuditLog).filter(AuditLog.accion == "derivacion").count() == 1
    finally:
        db.close()


def test_motivo_se_ignora_si_no_se_deriva(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.put(f"/api/evaluaciones/{eval_id}", headers=h, json={"nivel_final": "A4", "motivo": "irrelevante"})

    # Assert
    assert r.json()["evaluacion"]["motivoDerivacion"] is None


def test_un_caso_cerrado_no_admite_otra_decision(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]
    client.put(f"/api/evaluaciones/{eval_id}", headers=h, json={"nivel_final": "A3"})

    # Act
    r = client.put(f"/api/evaluaciones/{eval_id}", headers=h, json={"nivel_final": "A1"})

    # Assert
    assert r.status_code == 409
    assert _primera(client, h)["nivelFinal"] == "A3"


def test_nivel_fuera_de_a1_a4_es_rechazado(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.put(f"/api/evaluaciones/{eval_id}", headers=h, json={"nivel_final": "Z9"})

    # Assert
    assert r.status_code == 422


# --------------------------------------------------------------- gestión de alertas (R.139, R.140)

def test_revisar_alerta_no_cierra_el_caso(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers, sintomas=["Medicación permanente"])
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.post(f"/api/evaluaciones/{eval_id}/alerta/revisar", headers=h)

    # Assert
    ev = r.json()["evaluacion"]
    assert r.status_code == 200
    assert ev["alertaRevisada"] is True and ev["estadoRevision"] == "pendiente"


def test_revisar_alerta_dos_veces_es_idempotente(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers, sintomas=["Medicación permanente"])
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]
    client.post(f"/api/evaluaciones/{eval_id}/alerta/revisar", headers=h)

    # Act
    r = client.post(f"/api/evaluaciones/{eval_id}/alerta/revisar", headers=h)

    # Assert
    assert r.status_code == 200 and r.json()["evaluacion"]["alertaRevisada"] is True


def test_revisar_alerta_en_evaluacion_sin_alerta_devuelve_409(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.post(f"/api/evaluaciones/{eval_id}/alerta/revisar", headers=h)

    # Assert
    assert r.status_code == 409


def test_revisar_alerta_inexistente_devuelve_404(client, auth):
    # Arrange / Act
    r = client.post("/api/evaluaciones/00000000-0000-0000-0000-000000000000/alerta/revisar", headers=auth())

    # Assert
    assert r.status_code == 404


def test_cerrar_el_caso_da_por_revisada_la_alerta(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers, sintomas=["Medicación permanente"])
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    client.put(f"/api/evaluaciones/{eval_id}", headers=h, json={"nivel_final": "A2"})

    # Assert
    assert _primera(client, h)["alertaRevisada"] is True


def test_revisar_alerta_requiere_sesion(client):
    # Arrange / Act
    r = client.post("/api/evaluaciones/00000000-0000-0000-0000-000000000000/alerta/revisar")

    # Assert
    assert r.status_code == 401


# ------------------------------------------------------------ historial y tendencia (R.130, R.131)

def test_historial_del_socio_incluye_solo_sus_evaluaciones_en_orden(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["peso"] = "80.0"
    _enviar(client, payload, totem_headers)
    payload["mediciones"]["peso"] = "78.5"
    _enviar(client, payload, totem_headers)
    otro = {**payload, "estudiante": {**payload["estudiante"], "matricula": "99.999.999-9"}}
    _enviar(client, otro, totem_headers)

    # Act
    r = client.get("/api/socios/12.345.678-9/evaluaciones", headers=auth())

    # Assert
    pesos = [e["mediciones"]["peso"] for e in r.json()]
    assert r.status_code == 200
    assert pesos == ["78.5", "80.0"]  # la más reciente primero
    assert {e["id"] for e in r.json()} == {"12.345.678-9"}


def test_historial_de_socio_sin_evaluaciones_es_lista_vacia(client, auth):
    # Arrange / Act
    r = client.get("/api/socios/no-existe/evaluaciones", headers=auth())

    # Assert
    assert r.status_code == 200 and r.json() == []


def test_historial_de_socio_requiere_sesion(client):
    # Arrange / Act
    r = client.get("/api/socios/12.345.678-9/evaluaciones")

    # Assert
    assert r.status_code == 401


# --------------------------------------------------------------------------- migración de columnas

def test_migracion_no_hace_nada_fuera_de_postgresql(client):
    # Arrange / Act
    agregadas = agregar_columnas_faltantes(main.engine)

    # Assert
    assert agregadas == [] or main.engine.dialect.name == "postgresql"


@pytest.mark.skipif(main.engine.dialect.name != "postgresql", reason="requiere TEST_DATABASE_URL de PostgreSQL")
def test_migracion_agrega_columnas_a_una_tabla_existente(client):
    # Arrange: simula una tabla creada antes de esta versión
    with main.engine.begin() as conn:
        conn.execute(text("ALTER TABLE inferencias_ia DROP COLUMN alerta_revisada_por"))
        conn.execute(text("ALTER TABLE inferencias_ia DROP COLUMN alerta_nivel"))
        conn.execute(text("ALTER TABLE resultados_rutina DROP COLUMN motivo_derivacion"))

    # Act
    agregadas = agregar_columnas_faltantes(main.engine)

    # Assert
    assert sorted(agregadas) == ["inferencias_ia.alerta_nivel", "inferencias_ia.alerta_revisada_por",
                                 "resultados_rutina.motivo_derivacion"]
    columnas = {c["name"] for c in inspect(main.engine).get_columns("inferencias_ia")}
    assert {"alerta_nivel", "alerta_revisada_por"} <= columnas
    assert agregar_columnas_faltantes(main.engine) == []  # segunda vez: nada que hacer
