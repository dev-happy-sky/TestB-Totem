import datetime

import pytest
from sqlalchemy import text

import main
from identidad import calcular_edad
from migraciones import agregar_columnas_faltantes, consolidar_identidad
from models import AuditLog, SesionTotem, Socio, Totem

MATRICULA = "20231234A"
NACIMIENTO = datetime.date(2002, 3, 15)
EDAD = calcular_edad(NACIMIENTO, datetime.date.today())


@pytest.fixture()
def registro():
    return {
        "matricula": MATRICULA, "nombre": "Ana", "apellido": "Pérez Soto", "fecha_nacimiento": NACIMIENTO.isoformat(),
        "telefono": "+56 9 1234 5678", "plan_membresia": "Plan Estudiante",
    }


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


def test_identificar_socio_registrado_devuelve_los_datos_del_modelo(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    cuerpo = _identificar(client, totem_headers).json()

    # Assert
    assert cuerpo["registrado"] is True
    assert cuerpo["socio"] == {
        "nombre": "Ana", "apellido": "Pérez Soto", "fecha_nacimiento": "2002-03-15", "telefono": "+56 9 1234 5678",
        "plan_membresia": "Plan Estudiante", "edad": EDAD,
    }
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
    for dato_sensible in ("Dolor de pecho", "iaSugerida", "A2", "peso", "presion", "factores", "lesiones"):
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

def test_registrar_socio_nuevo_guarda_los_campos_del_modelo(client, totem_headers, registro):
    # Arrange / Act
    r = _registrar(client, totem_headers, registro)

    # Assert
    assert r.status_code == 201
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert (socio.rut, socio.nombre, socio.apellido, socio.fecha_nacimiento) == (MATRICULA, "Ana", "Pérez Soto", NACIMIENTO)
        assert (socio.telefono, socio.plan_membresia, socio.edad_declarada) == ("+56 9 1234 5678", "Plan Estudiante", None)
    finally:
        db.close()


def test_el_telefono_es_opcional(client, totem_headers, registro):
    # Arrange
    del registro["telefono"]

    # Act
    r = _registrar(client, totem_headers, registro)

    # Assert
    assert r.status_code == 201
    assert _identificar(client, totem_headers).json()["socio"]["telefono"] is None


def test_registrar_requiere_la_clave_del_totem(client, registro):
    # Arrange / Act
    r = client.post("/api/socios", json=registro)

    # Assert
    assert r.status_code == 401


@pytest.mark.parametrize("campo", ["apellido", "fecha_nacimiento", "plan_membresia", "nombre"])
def test_registrar_exige_los_campos_obligatorios_del_modelo(client, totem_headers, registro, campo):
    # Arrange
    del registro[campo]

    # Act
    r = _registrar(client, totem_headers, registro)

    # Assert
    assert r.status_code == 422


@pytest.mark.parametrize("cambios", [
    {"fecha_nacimiento": "2999-01-01"},          # futura
    {"fecha_nacimiento": "1800-01-01"},          # más de 120 años
    {"fecha_nacimiento": "no-es-fecha"},
    {"fecha_nacimiento": "2002-02-30"},          # día inexistente
    {"nombre": " "}, {"nombre": "A"}, {"apellido": ""}, {"plan_membresia": ""},
    {"telefono": "abc"}, {"telefono": "123"}, {"matricula": "12"},
])
def test_registrar_rechaza_datos_invalidos(client, totem_headers, registro, cambios):
    # Arrange
    registro.update(cambios)

    # Act
    r = _registrar(client, totem_headers, registro)

    # Assert
    assert r.status_code == 422
    assert _identificar(client, totem_headers).json()["registrado"] is False


def test_registrar_con_matricula_ya_registrada_devuelve_409(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)
    registro["nombre"] = "Otra"

    # Act
    r = _registrar(client, totem_headers, {**registro, "matricula": "2023-1234 a"})

    # Assert
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "matricula_registrada"


def test_registrar_con_el_mismo_nombre_y_apellido_avisa_posible_duplicado(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)
    otro = {**registro, "matricula": "20240000B", "nombre": "ANA", "apellido": "  perez   SOTO"}

    # Act
    r = _registrar(client, totem_headers, otro)

    # Assert
    detalle = r.json()["detail"]
    assert r.status_code == 409 and detalle["code"] == "posible_duplicado"
    assert detalle["coincidencias"] == [{"nombre": "Ana Pérez Soto", "plan_membresia": "Plan Estudiante", "matricula": "******34A"}]
    assert "20231234A" not in r.text  # no expone la matrícula ajena
    assert _identificar(client, totem_headers, "20240000B").json()["registrado"] is False


def test_el_mismo_nombre_con_otro_apellido_no_es_duplicado(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)
    otro = {**registro, "matricula": "20240000B", "apellido": "González"}

    # Act
    r = _registrar(client, totem_headers, otro)

    # Assert
    assert r.status_code == 201


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
    r = client.put(f"/api/socios/{MATRICULA}", json={"plan_membresia": "Plan Premium"}, headers=totem_headers)

    # Assert
    assert r.status_code == 200 and r.json()["cambios"] == ["plan_membresia"]
    assert r.json()["socio"]["plan_membresia"] == "Plan Premium"
    assert r.json()["socio"]["nombre"] == "Ana"


def test_actualizar_varios_campos_informa_cada_cambio(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = client.put(f"/api/socios/{MATRICULA}", headers=totem_headers, json={
        "nombre": "Ana María", "apellido": "Pérez", "telefono": "+56 9 8765 4321", "fecha_nacimiento": "2001-01-10"})

    # Assert
    assert sorted(r.json()["cambios"]) == ["apellido", "fecha_nacimiento", "nombre", "telefono"]
    assert r.json()["socio"]["edad"] == calcular_edad(datetime.date(2001, 1, 10), datetime.date.today())


def test_un_telefono_vacio_borra_el_telefono(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = client.put(f"/api/socios/{MATRICULA}", json={"telefono": ""}, headers=totem_headers)

    # Assert
    assert r.json()["cambios"] == ["telefono"] and r.json()["socio"]["telefono"] is None


def test_actualizar_con_los_mismos_datos_no_registra_cambios(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    r = client.put(f"/api/socios/{MATRICULA}", headers=totem_headers, json={
        "nombre": "Ana", "fecha_nacimiento": "2002-03-15", "telefono": "+56 9 1234 5678"})

    # Assert
    assert r.json()["cambios"] == []


def test_actualizar_deja_auditoria_de_los_campos_cambiados(client, totem_headers, registro):
    # Arrange
    _registrar(client, totem_headers, registro)

    # Act
    client.put(f"/api/socios/{MATRICULA}", json={"plan_membresia": "Plan Premium", "nombre": "Ana María"}, headers=totem_headers)

    # Assert
    db = main.SessionLocal()
    try:
        assert db.query(AuditLog).filter(AuditLog.accion == "socio_actualizado:nombre,plan_membresia").count() == 1
    finally:
        db.close()


@pytest.mark.parametrize("matricula, cuerpo, codigo", [
    ("20239999Z", {"plan_membresia": "Plan X"}, 404),
    ("12", {"plan_membresia": "Plan X"}, 422),
    (MATRICULA, {}, 422),
    (MATRICULA, {"fecha_nacimiento": "2999-01-01"}, 422),
    (MATRICULA, {"telefono": "abc"}, 422),
    (MATRICULA, {"apellido": "P"}, 422),
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
    r = client.put(f"/api/socios/{MATRICULA}", json={"plan_membresia": "Plan X"})

    # Assert
    assert r.status_code == 401


# ------------------------------------------------------- evaluación: socio, tótem, sucursal y horas

def test_evaluacion_con_matricula_invalida_es_rechazada(client, totem_headers, payload):
    # Arrange
    payload["estudiante"]["matricula"] = "12"

    # Act
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert r.status_code == 422


def test_evaluacion_de_un_socio_nuevo_lo_crea_con_los_datos_del_modelo(client, totem_headers, payload, auth):
    # Arrange / Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert (fila["nombre"], fila["apellido"], fila["id"]) == ("Ana Pérez Soto", "Pérez Soto", MATRICULA)
    assert (fila["fechaNacimiento"], fila["telefono"], fila["planMembresia"]) == ("2002-03-15", "+56 9 1234 5678", "Plan Estudiante")
    assert fila["edad"] == str(EDAD)


def test_un_cliente_antiguo_que_envia_el_nombre_completo_sin_apellido_se_separa(client, totem_headers, payload):
    # Arrange
    payload["estudiante"] = {"nombre": "Ana Pérez Soto", "matricula": MATRICULA}

    # Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert (socio.nombre, socio.apellido) == ("Ana", "Pérez Soto")
    finally:
        db.close()


def test_evaluacion_no_pisa_los_datos_del_socio_registrado(client, totem_headers, registro, payload):
    # Arrange
    _registrar(client, totem_headers, registro)
    payload["estudiante"].update(nombre="Nombre", apellido="Distinto", plan_membresia="Otro plan", fecha_nacimiento="1990-01-01")

    # Act
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert (socio.nombre, socio.apellido, socio.plan_membresia, socio.fecha_nacimiento) == ("Ana", "Pérez Soto", "Plan Estudiante", NACIMIENTO)
    finally:
        db.close()


def test_edad_de_registros_antiguos_usa_la_edad_declarada(client, totem_headers, payload, auth):
    # Arrange
    client.post("/api/evaluaciones", json=payload, headers=totem_headers)
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        socio.fecha_nacimiento, socio.edad_declarada = None, 33
        db.commit()
    finally:
        db.close()

    # Act
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]

    # Assert
    assert fila["edad"] == "33" and fila["fechaNacimiento"] is None


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


# ----------------------------------------------------- bases de la versión intermedia y migración de columnas

def _agregar_columnas_antiguas():
    with main.engine.begin() as conn:
        conn.execute(text("ALTER TABLE socios ADD COLUMN matricula VARCHAR(20)"))
        conn.execute(text("ALTER TABLE socios ADD COLUMN carrera VARCHAR(120)"))


def test_consolidar_identidad_pasa_la_carrera_al_plan_de_membresia(client):
    # Arrange
    _agregar_columnas_antiguas()
    with main.engine.begin() as conn:
        conn.execute(text("INSERT INTO socios (id, rut, nombre, apellido, carrera, created_at) "
                          "VALUES ('00000000-0000-0000-0000-000000000001', '20231234A', 'Ana', 'X', 'Informática', CURRENT_TIMESTAMP)"))

    # Act
    consolidar_identidad(main.engine)

    # Assert
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert (socio.rut, socio.plan_membresia) == ("20231234A", "Informática")
    finally:
        db.close()


def test_consolidar_identidad_no_pisa_un_plan_ya_definido_y_es_idempotente(client):
    # Arrange
    _agregar_columnas_antiguas()
    with main.engine.begin() as conn:
        conn.execute(text("INSERT INTO socios (id, rut, nombre, apellido, plan_membresia, carrera, created_at) "
                          "VALUES ('00000000-0000-0000-0000-000000000001', '20231234A', 'Ana', 'X', 'Plan Premium', 'Informática', CURRENT_TIMESTAMP)"))

    # Act
    consolidar_identidad(main.engine)
    consolidar_identidad(main.engine)

    # Assert
    db = main.SessionLocal()
    try:
        assert db.query(Socio).one().plan_membresia == "Plan Premium"
    finally:
        db.close()


def test_consolidar_identidad_sin_columnas_antiguas_no_hace_nada(client):
    # Arrange / Act
    movidos = consolidar_identidad(main.engine)

    # Assert
    assert movidos == 0


@pytest.mark.skipif(main.engine.dialect.name != "postgresql", reason="requiere TEST_DATABASE_URL de PostgreSQL")
def test_consolidar_identidad_recupera_la_matricula_de_filas_sin_rut(client):
    # Arrange: base de la versión intermedia, donde `rut` aceptaba NULL y la matrícula estaba en su propia columna
    _agregar_columnas_antiguas()
    with main.engine.begin() as conn:
        conn.execute(text("ALTER TABLE socios ALTER COLUMN rut DROP NOT NULL"))
        conn.execute(text("INSERT INTO socios (id, rut, matricula, nombre, apellido, carrera, created_at) "
                          "VALUES ('00000000-0000-0000-0000-000000000001', NULL, '20231234A', 'Ana', 'X', 'Informática', now())"))

    # Act
    movidos = consolidar_identidad(main.engine)

    # Assert
    db = main.SessionLocal()
    try:
        socio = db.query(Socio).one()
        assert movidos == 1 and (socio.rut, socio.plan_membresia) == ("20231234A", "Informática")
    finally:
        db.close()


@pytest.mark.skipif(main.engine.dialect.name != "postgresql", reason="requiere TEST_DATABASE_URL de PostgreSQL")
def test_migracion_relaja_not_null_cuando_el_modelo_lo_permite(client):
    # Arrange
    with main.engine.begin() as conn:
        conn.execute(text("ALTER TABLE socios ALTER COLUMN telefono SET NOT NULL"))

    # Act
    cambios = agregar_columnas_faltantes(main.engine)

    # Assert
    assert cambios == ["socios.telefono (acepta NULL)"]
    assert agregar_columnas_faltantes(main.engine) == []
