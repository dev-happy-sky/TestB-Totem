import datetime

import pytest
from sqlalchemy import inspect, text

import main
from migraciones import agregar_columnas_faltantes
from models import AuditLog, SesionTotem, Socio, Totem
from persistencia import rellenar_identidad

MATRICULA = "20231234A"


@pytest.fixture()
def registro():
    return {"matricula": MATRICULA, "nombre": "Ana Pérez Soto", "carrera": "Ingeniería Civil", "edad": 21}


def _identificar(client, headers, matricula=MATRICULA):
    return client.post("/api/socios/identificar", json={"matricula": matricula}, headers=headers)


def _registrar(client, headers, datos):
    return client.post("/api/socios", json=datos, headers=headers)


# ---------------------------------------------------------------- identificación (R.1, R.2, R.4, R.7)

def test_identificar_requiere_la_clave_del_totem(client):
    # Arrange / Act
    r = client.post("/api/socios/identificar", json={"matricula": MATRICULA})

    # Assert
    assert r.status_code == 401


@pytest.mark.parametrize("matricula", ["", "123", "ab$cd12", "A" * 16])
def test_identificar_rechaza_matriculas_con_formato_invalido(client, totem_headers, matricula):
    # Arrange / Act
    r = _identificar(client, totem_headers, matricula)

    # Assert
    assert r.status_code == 422
    assert "Matrícula inválida" in r.text


def test_identificar_matricula_no_registrada_indica_que_debe_registrarse(client, totem_headers):
    # Arrange / Act
    r = _identificar(client, totem_headers, "2023-1234 a")

    # Assert
    assert r.status_code == 200
    assert r.json() == {"registrado": False, "matricula": MATRICULA}


def test_identificar_socio_registrado_devuelve_sus_datos_sin_evaluaciones(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    cuerpo = _identificar(client, totem_headers).json()

    # Assert
    assert cuerpo["registrado"] is True
    assert cuerpo["socio"] == {"nombre": "Ana Pérez Soto", "carrera": "Ingeniería Civil", "edad": 21}
    assert cuerpo["evaluacion_vigente"] is None and cuerpo["evaluaciones_previas"] == []


def test_identificar_acepta_la_matricula_con_otro_formato(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = _identificar(client, totem_headers, " 2023-1234a ")

    # Assert
    assert r.json()["registrado"] is True and r.json()["matricula"] == MATRICULA


def test_evaluacion_reciente_aparece_como_vigente(client, totem_headers, payload):
    # Arrange
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Act
    cuerpo = _identificar(client, totem_headers).json()

    # Assert
    assert cuerpo["evaluacion_vigente"]["estado"] == "pendiente"
    assert len(cuerpo["evaluaciones_previas"]) == 1 and cuerpo["vigencia_horas"] == 24


def test_evaluacion_de_hace_mas_de_la_vigencia_ya_no_es_vigente_pero_sigue_en_el_historial(client, totem_headers, payload):
    # Arrange
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    antigua = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=25)
    db = main.SessionLocal()
    try:
        sesion = db.query(SesionTotem).one()
        sesion.inicio_sesion = sesion.fin_sesion = antigua
        db.commit()
    finally:
        db.close()

    # Act
    cuerpo = _identificar(client, totem_headers).json()

    # Assert
    assert cuerpo["evaluacion_vigente"] is None
    assert len(cuerpo["evaluaciones_previas"]) == 1


def test_identificar_no_expone_categorias_ni_datos_de_salud(client, totem_headers, payload):
    # Arrange
    payload["salud"]["sintomas"] = ["Dolor de pecho al esforzarte"]
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Act
    texto = _identificar(client, totem_headers).text

    # Assert
    for dato_sensible in ("Dolor de pecho", "iaSugerida", "A2", "peso", "presion", "factores"):
        assert dato_sensible not in texto


def test_identificar_limita_las_consultas_por_ip(client, totem_headers, monkeypatch):
    # Arrange
    monkeypatch.setattr(main, "MAX_CONSULTAS", 3)
    main._consultas.clear()

    # Act
    codigos = [_identificar(client, totem_headers).status_code for _ in range(4)]

    # Assert
    assert codigos == [200, 200, 200, 429]


# --------------------------------------------------------------------- registro (R.3) y duplicados (R.11)

def test_registrar_socio_nuevo_responde_201_y_queda_guardado(client, totem_headers, registro):
    # Arrange / Act
    r = _registrar(client, totem_headers, registro)

    # Assert
    assert r.status_code == 201
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert (socio.matricula, socio.nombre, socio.apellido, socio.carrera, socio.edad_declarada) == (
            MATRICULA, "Ana", "Pérez Soto", "Ingeniería Civil", 21)
    finally:
        db.close()


def test_registrar_requiere_la_clave_del_totem(client, registro):
    # Arrange / Act
    r = client.post("/api/socios", json=registro)

    # Assert
    assert r.status_code == 401


@pytest.mark.parametrize("cambios", [
    {"edad": 0}, {"edad": 121}, {"nombre": " "}, {"nombre": "A"}, {"carrera": ""}, {"matricula": "12"},
])
def test_registrar_rechaza_datos_invalidos(client, totem_headers, registro, cambios):
    # Arrange
    registro.update(cambios)

    # Act
    r = _registrar(client, totem_headers, registro)

    # Assert
    assert r.status_code == 422
    assert client.post("/api/socios/identificar", json={"matricula": MATRICULA}, headers=totem_headers).json()["registrado"] is False


def test_registrar_con_matricula_ya_registrada_devuelve_409(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)
    registro["nombre"] = "Otra Persona"

    # Act
    r = _registrar(client, totem_headers, {**registro, "matricula": "2023-1234 a"})

    # Assert
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "matricula_registrada"


def test_registrar_con_el_mismo_nombre_y_otra_matricula_avisa_posible_duplicado(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)
    otro = {**registro, "matricula": "20240000B", "nombre": "ANA PEREZ  soto"}

    # Act
    r = _registrar(client, totem_headers, otro)

    # Assert
    detalle = r.json()["detail"]
    assert r.status_code == 409 and detalle["code"] == "posible_duplicado"
    assert detalle["coincidencias"] == [{"nombre": "Ana Pérez Soto", "carrera": "Ingeniería Civil", "matricula": "******34A"}]
    assert "20231234A" not in r.text  # no expone la matrícula ajena
    assert _identificar(client, totem_headers, "20240000B").json()["registrado"] is False


def test_confirmar_duplicado_permite_registrar_a_una_persona_distinta(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)
    otro = {**registro, "matricula": "20240000B", "confirmar_duplicado": True}

    # Act
    r = _registrar(client, totem_headers, otro)

    # Assert
    assert r.status_code == 201
    assert _identificar(client, totem_headers, "20240000B").json()["registrado"] is True


def test_registro_y_duplicados_quedan_auditados(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)
    _registrar(client, totem_headers, {**registro, "matricula": "20240000B"})

    # Act
    db = main.SessionLocal()
    try:
        acciones = {a.accion for a in db.query(AuditLog).all()}
    finally:
        db.close()

    # Assert
    assert {"socio_registrado", "posible_duplicado"} <= acciones


# ------------------------------------------------------------------------------ actualización (R.5)

def test_actualizar_datos_cambia_solo_lo_enviado(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = client.put(f"/api/socios/{MATRICULA}", json={"carrera": "Ingeniería Informática"}, headers=totem_headers)

    # Assert
    assert r.status_code == 200 and r.json()["cambios"] == ["carrera"]
    assert r.json()["socio"] == {"nombre": "Ana Pérez Soto", "carrera": "Ingeniería Informática", "edad": 21}


def test_actualizar_con_los_mismos_datos_no_registra_cambios(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = client.put(f"/api/socios/{MATRICULA}", json={"nombre": "Ana Pérez Soto", "edad": 21}, headers=totem_headers)

    # Assert
    assert r.json()["cambios"] == []


def test_actualizar_deja_auditoria_de_los_campos_cambiados(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    client.put(f"/api/socios/{MATRICULA}", json={"edad": 22, "nombre": "Ana María Pérez"}, headers=totem_headers)

    # Assert
    db = main.SessionLocal()
    try:
        assert db.query(AuditLog).filter(AuditLog.accion == "socio_actualizado:nombre,edad").count() == 1
    finally:
        db.close()


@pytest.mark.parametrize("matricula, cuerpo, codigo", [
    ("20239999Z", {"edad": 20}, 404),
    ("12", {"edad": 20}, 422),
    (MATRICULA, {}, 422),
    (MATRICULA, {"edad": 0}, 422),
])
def test_actualizar_rechaza_solicitudes_invalidas(client, totem_headers, registro, matricula, cuerpo, codigo):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = client.put(f"/api/socios/{matricula}", json=cuerpo, headers=totem_headers)

    # Assert
    assert r.status_code == codigo


def test_actualizar_requiere_la_clave_del_totem(client, registro, totem_headers):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = client.put(f"/api/socios/{MATRICULA}", json={"edad": 30})

    # Assert
    assert r.status_code == 401


# ------------------------------------------------------- evaluación: matrícula, tótem, sucursal y horas

def test_evaluacion_con_matricula_invalida_es_rechazada(client, totem_headers, payload):
    # Arrange
    payload["estudiante"]["matricula"] = "12"

    # Act
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert r.status_code == 422


def test_evaluacion_no_pisa_los_datos_del_socio_registrado(client, totem_headers, registro, payload):
    # Arrange
    _registrar(client, totem_headers, registro)
    payload["estudiante"].update(nombre="Nombre Distinto", carrera="Otra Carrera", edad="40")

    # Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert (socio.nombre, socio.carrera, socio.edad_declarada) == ("Ana", "Ingeniería Civil", 21)
    finally:
        db.close()


def test_evaluacion_queda_asociada_al_totem_y_la_sucursal(client, totem_headers, payload, auth):
    # Arrange
    payload.update(totem_serial="TOTEM-GIM-01", totem_sucursal="Campus San Joaquín")

    # Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert (fila["totem"], fila["sucursal"]) == ("TOTEM-GIM-01", "Campus San Joaquín")
    db = main.SessionLocal()
    try:
        assert db.query(Totem).one().sucursal == "Campus San Joaquín"
    finally:
        db.close()


def test_la_sucursal_ya_registrada_de_un_totem_no_se_sobrescribe(client, totem_headers, payload, auth):
    # Arrange
    payload.update(totem_serial="T1", totem_sucursal="Campus A")
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    payload["totem_sucursal"] = "Campus B"

    # Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert {f["sucursal"] for f in client.get("/api/evaluaciones", headers=auth()).json()} == {"Campus A"}


def test_evaluacion_registra_inicio_y_termino(client, totem_headers, payload, auth):
    # Arrange
    inicio = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=4)
    payload["inicio"] = inicio.isoformat()

    # Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    inicio_guardado = datetime.datetime.fromisoformat(fila["inicioEvaluacion"])
    fin_guardado = datetime.datetime.fromisoformat(fila["finEvaluacion"])
    assert abs((inicio_guardado - inicio).total_seconds()) < 1
    assert 3 * 60 < (fin_guardado - inicio_guardado).total_seconds() < 5 * 60


@pytest.mark.parametrize("desfase", [datetime.timedelta(minutes=10), datetime.timedelta(hours=30)])
def test_un_inicio_en_el_futuro_o_demasiado_antiguo_se_ignora(client, totem_headers, payload, auth, desfase):
    # Arrange
    ahora = datetime.datetime.now(datetime.timezone.utc)
    payload["inicio"] = (ahora + desfase if desfase < datetime.timedelta(hours=1) else ahora - desfase).isoformat()

    # Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert fila["inicioEvaluacion"] == fila["finEvaluacion"]


def test_evaluacion_sin_inicio_usa_el_momento_del_registro(client, totem_headers, payload, auth):
    # Arrange / Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert fila["inicioEvaluacion"] == fila["finEvaluacion"]


# ----------------------------------------------------- datos de la versión anterior y migración de columnas

def _socio_antiguo(db, rut, plan, nombre="Ana"):
    socio = Socio(rut=rut, nombre=nombre, apellido="X", plan_membresia=plan)
    db.add(socio)
    db.commit()
    return socio


def test_rellenar_identidad_mueve_matricula_y_carrera_de_los_campos_antiguos(client):
    # Arrange
    db = main.SessionLocal()
    try:
        _socio_antiguo(db, "2023-1234a", "Informática")

        # Act
        movidos = rellenar_identidad(db)
        socio = db.query(Socio).one()

        # Assert
        assert movidos == 1
        assert (socio.matricula, socio.rut, socio.carrera, socio.plan_membresia) == ("20231234A", None, "Informática", None)
    finally:
        db.close()


def test_rellenar_identidad_es_idempotente(client):
    # Arrange
    db = main.SessionLocal()
    try:
        _socio_antiguo(db, "20231234A", "Informática")
        rellenar_identidad(db)

        # Act
        movidos = rellenar_identidad(db)

        # Assert
        assert movidos == 0
    finally:
        db.close()


def test_rellenar_identidad_no_pisa_a_otro_socio_con_la_misma_matricula(client):
    # Arrange
    db = main.SessionLocal()
    try:
        db.add(Socio(matricula="20231234A", nombre="Primero", apellido="", carrera="C1"))
        _socio_antiguo(db, "2023-1234A", "C2", nombre="Segundo")

        # Act
        movidos = rellenar_identidad(db)

        # Assert
        assert movidos == 0
        assert db.query(Socio).filter(Socio.rut.isnot(None)).count() == 1  # queda para revisión manual
    finally:
        db.close()


@pytest.mark.skipif(main.engine.dialect.name != "postgresql", reason="requiere TEST_DATABASE_URL de PostgreSQL")
def test_migracion_adapta_la_tabla_socios_de_la_version_anterior(client):
    # Arrange: tabla como la dejó la versión anterior (rut obligatorio, sin matrícula ni carrera)
    with main.engine.begin() as conn:
        conn.execute(text("ALTER TABLE socios DROP COLUMN matricula"))
        conn.execute(text("ALTER TABLE socios DROP COLUMN carrera"))
        conn.execute(text("ALTER TABLE socios ALTER COLUMN rut SET NOT NULL"))

    # Act
    cambios = agregar_columnas_faltantes(main.engine)

    # Assert
    assert sorted(cambios) == ["socios.carrera", "socios.matricula", "socios.rut (acepta NULL)"]
    indices = {i["name"] for i in inspect(main.engine).get_indexes("socios")}
    unicos = {u["name"] for u in inspect(main.engine).get_unique_constraints("socios")}
    assert "uq_socios_matricula" in indices | unicos
    assert agregar_columnas_faltantes(main.engine) == []
