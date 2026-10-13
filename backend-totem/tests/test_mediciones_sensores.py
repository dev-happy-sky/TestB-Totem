import copy
import datetime

import pytest
from sqlalchemy import inspect, text

import main
from migraciones import agregar_columnas_faltantes
from models import MedicionCorporal
from motor_aptitud import ConfiguracionInvalida, Entrada, cargar_configuracion, evaluar, validar_configuracion

CFG = cargar_configuracion()
SANA = dict(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, fc_recuperacion=100, imc=22.0)


def ahora():
    return datetime.datetime.now(datetime.timezone.utc)


def dispositivo(identificador="BP-01", calibracion="vigente", hace_minutos=2):
    return {"id": identificador, "calibracion": calibracion, "capturado_en": (ahora() - datetime.timedelta(minutes=hace_minutos)).isoformat()}


def _enviar(client, payload, headers, codigo=200):
    r = client.post("/api/evaluaciones", json=payload, headers=headers)
    assert r.status_code == codigo, r.text
    return r


def _primera(client, headers):
    return client.get("/api/evaluaciones", headers=headers).json()[0]["mediciones"]


# ------------------------------------------------------------------ motor: calibración vencida (R.60)

def test_un_dispositivo_con_calibracion_vencida_descuenta_confianza_y_se_informa():
    # Arrange
    entrada = Entrada(**SANA, calibracion_vencida=("tensiometro",))

    # Act
    resultado = evaluar(entrada, CFG)

    # Assert
    assert resultado.confianza == 0.9
    assert "Calibración vencida: Tensiómetro" in resultado.factores


def test_cada_dispositivo_vencido_descuenta_una_sola_vez():
    # Arrange
    entrada = Entrada(**SANA, calibracion_vencida=("tensiometro", "balanza", "tensiometro"))

    # Act
    resultado = evaluar(entrada, CFG)

    # Assert
    assert resultado.confianza == 0.8
    assert [f for f in resultado.factores if f.startswith("Calibración vencida")] == [
        "Calibración vencida: Balanza", "Calibración vencida: Tensiómetro"]


def test_sin_dispositivos_vencidos_la_confianza_no_cambia():
    # Arrange / Act
    resultado = evaluar(Entrada(**SANA), CFG)

    # Assert
    assert resultado.confianza == 1.0 and not any("Calibración" in f for f in resultado.factores)


def test_un_sensor_desconocido_se_muestra_con_su_clave():
    # Arrange
    entrada = Entrada(**SANA, calibracion_vencida=("termometro",))

    # Act
    resultado = evaluar(entrada, CFG)

    # Assert
    assert "Calibración vencida: termometro" in resultado.factores


def test_la_calibracion_vencida_puede_llevar_a_revision_y_aparece_en_el_motivo():
    # Arrange
    cfg = copy.deepcopy(CFG)
    cfg["confianza"]["calibracion_vencida"] = 0.35

    # Act
    resultado = evaluar(Entrada(**SANA, calibracion_vencida=("balanza",)), cfg)

    # Assert
    assert resultado.requiere_revision is True
    assert resultado.motivo_revision == "Confianza baja (65%): calibración vencida de balanza"


@pytest.mark.parametrize("rompe, mensaje", [
    (lambda c: c.pop("dispositivos"), "dispositivos"),
    (lambda c: c.update(dispositivos={}), "dispositivos"),
    (lambda c: c.update(dispositivos={"balanza": 5}), "dispositivos"),
    (lambda c: c["confianza"].pop("calibracion_vencida"), "calibracion_vencida"),
    (lambda c: c["confianza"].update(calibracion_vencida=-0.1), "calibracion_vencida"),
])
def test_la_configuracion_exige_los_dispositivos_y_su_descuento(rompe, mensaje):
    # Arrange
    cfg = copy.deepcopy(CFG)
    rompe(cfg)

    # Act
    with pytest.raises(ConfiguracionInvalida) as error:
        validar_configuracion(cfg)

    # Assert
    assert mensaje in str(error.value)


# ----------------------------------------------------------------------- API: dispositivos (R.58, R.59)

def test_los_dispositivos_quedan_guardados_y_llegan_al_dashboard(client, payload, totem_headers, auth):
    # Arrange
    payload["dispositivos"] = {"tensiometro": dispositivo("BP-01"), "balanza": dispositivo("SCALE-7", "desconocida")}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    dispositivos = _primera(client, auth())["dispositivos"]
    assert set(dispositivos) == {"tensiometro", "balanza"}
    assert (dispositivos["tensiometro"]["id"], dispositivos["tensiometro"]["calibracion"]) == ("BP-01", "vigente")
    assert dispositivos["balanza"]["calibracion"] == "desconocida"
    db = main.SessionLocal()
    try:
        assert db.query(MedicionCorporal).one().dispositivos["tensiometro"]["id"] == "BP-01"
    finally:
        db.close()


def test_sin_dispositivos_la_evaluacion_se_guarda_igual(client, payload, totem_headers, auth):
    # Arrange / Act
    _enviar(client, payload, totem_headers)

    # Assert
    medicion = _primera(client, auth())
    assert medicion["dispositivos"] == {} and medicion["errores"] == []


def test_la_hora_de_captura_es_la_de_la_ultima_medicion(client, payload, totem_headers, auth):
    # Arrange
    reciente = ahora() - datetime.timedelta(minutes=1)
    payload["dispositivos"] = {
        "tensiometro": {"id": "BP-01", "capturado_en": (ahora() - datetime.timedelta(minutes=6)).isoformat()},
        "balanza": {"id": "SCALE-7", "capturado_en": reciente.isoformat()},
    }

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    capturado = datetime.datetime.fromisoformat(_primera(client, auth())["capturadoEn"])
    assert abs((capturado - reciente).total_seconds()) < 1


@pytest.mark.parametrize("minutos", [-10, 60 * 30])   # en el futuro y de hace 30 horas
def test_una_hora_de_captura_no_creible_se_reemplaza_por_la_del_registro(client, payload, totem_headers, auth, minutos):
    # Arrange
    falsa = (ahora() - datetime.timedelta(minutes=minutos)).isoformat()
    payload["dispositivos"] = {"tensiometro": {"id": "BP-01", "capturado_en": falsa}}
    antes = ahora()

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    capturado = datetime.datetime.fromisoformat(_primera(client, auth())["capturadoEn"])
    assert abs((capturado - antes).total_seconds()) < 30


def test_la_calibracion_vencida_baja_la_confianza_de_la_evaluacion(client, payload, totem_headers, auth):
    # Arrange
    payload["dispositivos"] = {"tensiometro": dispositivo("BP-01", "vencida")}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert fila["confianza"] == 0.9 and "Calibración vencida: Tensiómetro" in fila["factores"]


@pytest.mark.parametrize("calibracion", ["vigente", "desconocida"])
def test_una_calibracion_vigente_o_desconocida_no_descuenta(client, payload, totem_headers, auth, calibracion):
    # Arrange
    payload["dispositivos"] = {"tensiometro": dispositivo("BP-01", calibracion)}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert client.get("/api/evaluaciones", headers=auth()).json()[0]["confianza"] == 1.0


@pytest.mark.parametrize("dispositivos", [
    {"termometro": {"id": "X"}},                                 # sensor desconocido
    {"tensiometro": {"id": ""}},                                 # sin identificador
    {"tensiometro": {"id": "x" * 81}},                           # identificador demasiado largo
    {"tensiometro": {"id": "BP-01", "calibracion": "rota"}},     # estado inexistente
    {"tensiometro": {}},
])
def test_los_dispositivos_invalidos_se_rechazan(client, payload, totem_headers, dispositivos):
    # Arrange
    payload["dispositivos"] = dispositivos

    # Act
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert r.status_code == 422


# ------------------------------------------------------------------------------ API: errores (R.65)

def error(sensor="tensiometro", codigo="desconectado", mensaje="Sensor desconectado", hace_minutos=3):
    return {"sensor": sensor, "codigo": codigo, "mensaje": mensaje,
            "ocurrido_en": (ahora() - datetime.timedelta(minutes=hace_minutos)).isoformat()}


def test_los_errores_de_medicion_quedan_registrados(client, payload, totem_headers, auth):
    # Arrange
    payload["errores_medicion"] = [error(), error("balanza", "lectura_invalida", "Peso fuera de lo posible")]

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    errores = _primera(client, auth())["errores"]
    assert [(e["sensor"], e["codigo"]) for e in errores] == [("tensiometro", "desconectado"), ("balanza", "lectura_invalida")]
    assert errores[1]["mensaje"] == "Peso fuera de lo posible"
    db = main.SessionLocal()
    try:
        assert len(db.query(MedicionCorporal).one().errores_medicion) == 2
    finally:
        db.close()


@pytest.mark.parametrize("codigo", ["desconectado", "timeout", "movimiento", "lectura_invalida", "error"])
def test_se_aceptan_todos_los_codigos_de_error_conocidos(client, payload, totem_headers, codigo):
    # Arrange
    payload["errores_medicion"] = [error(codigo=codigo)]

    # Act / Assert
    _enviar(client, payload, totem_headers)


@pytest.mark.parametrize("malo", [
    error(codigo="explotó"), error(sensor="termometro"), error(mensaje="x" * 201),
])
def test_un_error_de_medicion_invalido_se_rechaza(client, payload, totem_headers, malo):
    # Arrange
    payload["errores_medicion"] = [malo]

    # Act
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert r.status_code == 422


def test_hay_un_maximo_de_errores_por_evaluacion(client, payload, totem_headers):
    # Arrange
    payload["errores_medicion"] = [error() for _ in range(51)]

    # Act
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert r.status_code == 422


def test_cincuenta_errores_se_aceptan(client, payload, totem_headers):
    # Arrange
    payload["errores_medicion"] = [error() for _ in range(50)]

    # Act / Assert
    _enviar(client, payload, totem_headers)


def test_un_error_sin_hora_se_acepta(client, payload, totem_headers, auth):
    # Arrange
    payload["errores_medicion"] = [{"sensor": "banda_pecho", "codigo": "timeout", "mensaje": "Sin respuesta"}]

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["errores"][0]["ocurrido_en"] is None


# --------------------------------------------------------------------------------- migración

@pytest.mark.skipif(main.engine.dialect.name != "postgresql", reason="requiere TEST_DATABASE_URL de PostgreSQL")
def test_la_migracion_agrega_las_columnas_de_dispositivos_y_errores(client):
    # Arrange
    with main.engine.begin() as conn:
        conn.execute(text("ALTER TABLE mediciones_corporales DROP COLUMN dispositivos"))
        conn.execute(text("ALTER TABLE mediciones_corporales DROP COLUMN errores_medicion"))

    # Act
    agregadas = agregar_columnas_faltantes(main.engine)

    # Assert
    assert sorted(agregadas) == ["mediciones_corporales.dispositivos", "mediciones_corporales.errores_medicion"]
    assert {"dispositivos", "errores_medicion"} <= {c["name"] for c in inspect(main.engine).get_columns("mediciones_corporales")}
