import pytest

import main
from models import MedicionCorporal
from motor_aptitud import Entrada, cargar_configuracion, evaluar

CFG = cargar_configuracion()
SANA = dict(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, fc_recuperacion=100, imc=22.0)


def _enviar(client, payload, headers, codigo=200):
    r = client.post("/api/evaluaciones", json=payload, headers=headers)
    assert r.status_code == codigo, r.text


def _primera(client, headers):
    return client.get("/api/evaluaciones", headers=headers).json()[0]


# --------------------------------------------------------------------- motor: reglas de SpO2 (provisionales)

@pytest.mark.parametrize("spo2, regla, categoria", [
    (100, None, "A4"), (98, None, "A4"), (95, None, "A4"),
    (94, "SPO2_FUERA_DE_RANGO", "A2"), (90, "SPO2_FUERA_DE_RANGO", "A2"),
    (89, "SPO2_CRITICA", "A1"), (70, "SPO2_CRITICA", "A1"), (50, "SPO2_CRITICA", "A1"),
])
def test_limites_de_la_saturacion_de_oxigeno(spo2, regla, categoria):
    # Arrange
    entrada = Entrada(**SANA, spo2=spo2)

    # Act
    resultado = evaluar(entrada, CFG)

    # Assert
    assert {h.id for h in resultado.hallazgos} == ({regla} if regla else set())
    assert resultado.categoria == categoria


def test_una_spo2_baja_genera_alerta():
    # Arrange / Act
    precaucion = evaluar(Entrada(**SANA, spo2=92), CFG)
    critica = evaluar(Entrada(**SANA, spo2=85), CFG)

    # Assert
    assert (precaucion.alerta, precaucion.nivel_alerta) == ("DERIVAR", "riesgo")
    assert (critica.alerta, critica.nivel_alerta) == ("DERIVAR", "critica")


def test_el_factor_describe_la_saturacion_con_su_unidad():
    # Arrange / Act
    resultado = evaluar(Entrada(**SANA, spo2=92), CFG)

    # Assert
    assert "Saturación de oxígeno 92 %: fuera del rango normal" in resultado.factores


def test_no_medir_la_spo2_no_es_un_dato_faltante_ni_baja_la_confianza():
    # Arrange / Act
    resultado = evaluar(Entrada(**SANA), CFG)

    # Assert
    assert resultado.confianza == 1.0
    assert not any("Saturación" in f for f in resultado.factores)


@pytest.mark.parametrize("spo2", [49, 101, 255])
def test_una_spo2_imposible_se_descarta_y_baja_la_confianza(spo2):
    # Arrange / Act
    resultado = evaluar(Entrada(**SANA, spo2=spo2), CFG)

    # Assert
    assert resultado.confianza == 0.8
    assert not any(h.id.startswith("SPO2") for h in resultado.hallazgos)
    assert any(f.startswith("Dato inválido: Saturación de oxígeno") for f in resultado.factores)


# ------------------------------------------------------------------------------------------------- API

def test_la_spo2_queda_guardada_en_la_columna_saturacion_oxigeno_y_llega_al_dashboard(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["spo2"] = 97

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["mediciones"]["spo2"] == 97
    db = main.SessionLocal()
    try:
        assert db.query(MedicionCorporal).one().saturacion_oxigeno == 97
    finally:
        db.close()


def test_sin_spo2_el_campo_llega_vacio(client, payload, totem_headers, auth):
    # Arrange / Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["mediciones"]["spo2"] is None


def test_una_spo2_baja_cambia_la_decision_de_la_evaluacion(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["spo2"] = 88

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert (fila["iaSugerida"], fila["alertaNivel"]) == ("A1", "critica")
    assert "Saturación de oxígeno 88 %: en rango crítico" in fila["factores"]
    assert any(r["id"] == "SPO2_CRITICA" and r["valor"] == 88 for r in fila["reglasAplicadas"])


# ------------------------------------------------------------------------ sensores del oxímetro

def dispositivo(identificador="AA:BB:CC:DD:EE:FF", calibracion="desconocida"):
    return {"id": identificador, "calibracion": calibracion}


@pytest.mark.parametrize("sensor", ["oximetro", "oximetro_recuperacion", "banda_pecho"])
def test_los_dispositivos_del_oximetro_y_el_antiguo_de_la_banda_se_aceptan(client, payload, totem_headers, auth, sensor):
    # Arrange
    payload["dispositivos"] = {sensor: dispositivo()}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["mediciones"]["dispositivos"][sensor]["id"] == "AA:BB:CC:DD:EE:FF"


def test_los_dos_usos_del_oximetro_se_registran_por_separado(client, payload, totem_headers, auth):
    # Arrange
    payload["dispositivos"] = {"oximetro": dispositivo(), "oximetro_recuperacion": dispositivo()}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert set(_primera(client, auth())["mediciones"]["dispositivos"]) == {"oximetro", "oximetro_recuperacion"}


@pytest.mark.parametrize("sensor", ["oximetro", "oximetro_recuperacion"])
def test_los_errores_del_oximetro_se_registran(client, payload, totem_headers, auth, sensor):
    # Arrange
    payload["errores_medicion"] = [{"sensor": sensor, "codigo": "lectura_invalida", "mensaje": "No se detecta el dedo"}]

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    errores = _primera(client, auth())["mediciones"]["errores"]
    assert (errores[0]["sensor"], errores[0]["codigo"]) == (sensor, "lectura_invalida")


def test_la_calibracion_vencida_del_oximetro_descuenta_confianza_con_su_nombre(client, payload, totem_headers, auth):
    # Arrange
    payload["dispositivos"] = {"oximetro": dispositivo(calibracion="vencida")}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert fila["confianza"] == 0.9 and "Calibración vencida: Oxímetro" in fila["factores"]


def test_un_sensor_desconocido_sigue_rechazandose(client, payload, totem_headers):
    # Arrange
    payload["dispositivos"] = {"termometro": dispositivo()}

    # Act
    r = client.post("/api/evaluaciones", json=payload, headers=totem_headers)

    # Assert
    assert r.status_code == 422
