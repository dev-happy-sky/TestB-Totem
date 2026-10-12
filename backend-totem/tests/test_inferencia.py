import pytest
from sqlalchemy import inspect, text

import inferencia
import main
from migraciones import agregar_columnas_faltantes
from models import InferenciaIA, ResultadoRutina
from motor_aptitud import Entrada, cargar_configuracion, evaluar

CFG = cargar_configuracion()


def _enviar(client, payload, headers):
    r = client.post("/api/evaluaciones", json=payload, headers=headers)
    assert r.status_code == 200, r.text


def _primera(client, headers):
    return client.get("/api/evaluaciones", headers=headers).json()[0]


# ------------------------------------------------------------------ lo que se guarda y se entrega (R.100, R.108, R.114, R.115)

def test_la_evaluacion_guarda_confianza_version_reglas_e_intensidad(client, payload, totem_headers, auth):
    # Arrange / Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert fila["confianza"] == 1.0 and fila["versionModelo"] == "reglas-v2"
    assert fila["intensidad"] == "Intensidad moderada"
    assert fila["rutinaSugerida"] == "Apto con intensidad moderada. Intensidad moderada."
    assert fila["requiereRevision"] is False and fila["motivoRevision"] is None
    assert isinstance(fila["latenciaMs"], float) and fila["latenciaMs"] < 2500   # objetivo: inferencia < 2,5 s


def test_las_reglas_aplicadas_quedan_registradas_en_la_base(client, payload, totem_headers):
    # Arrange
    payload["mediciones"]["presionSys"] = 190
    payload["mediciones"]["presionDia"] = 100
    payload["mediciones"]["fcReposo"] = 130

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    db = main.SessionLocal()
    try:
        reglas = {r["id"]: r for r in db.query(InferenciaIA).one().reglas_aplicadas}
    finally:
        db.close()
    assert reglas["PRESION_SISTOLICA_CRITICA"] == {
        "id": "PRESION_SISTOLICA_CRITICA", "descripcion": "Presión sistólica 190 mmHg: en rango crítico",
        "severidad": "critico", "valor": 190}
    assert "FC_REPOSO_CRITICA" in reglas and "CONDICION_DECLARADA" in reglas


def test_los_signos_vitales_criticos_derivan_a_a1_con_alerta_critica(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"].update(presionSys=185, presionDia=95)

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert (fila["iaSugerida"], fila["alerta"], fila["alertaNivel"]) == ("A1", "DERIVAR", "critica")
    assert "Presión sistólica 185 mmHg: en rango crítico" in fila["factores"]


def test_un_imc_fuera_de_rango_da_precaucion_sin_alerta(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["imc"] = "28.0"

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert (fila["iaSugerida"], fila["alerta"], fila["alertaNivel"]) == ("A2", None, None)


# ----------------------------------------------------------------------------- información faltante (R.93, R.113)

def test_una_evaluacion_con_mediciones_faltantes_se_guarda_y_baja_la_confianza(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"] = {"peso": "70.0", "imc": "22.0"}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert fila["confianza"] == 0.6 and fila["requiereRevision"] is True
    assert fila["motivoRevision"] == "Confianza baja (60%): falta la presión arterial; falta la frecuencia cardíaca en reposo"
    assert fila["alerta"] == "REVISAR" and fila["alertaNivel"] == "riesgo"
    assert fila["mediciones"]["presionSys"] is None and fila["mediciones"]["fcReposo"] is None


def test_una_evaluacion_sin_ninguna_medicion_no_falla(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"] = {}

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert fila["confianza"] == 0.55 and fila["requiereRevision"] is True
    assert fila["mediciones"]["peso"] == ""


def test_un_signo_vital_imposible_se_descarta_y_se_informa(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["fcReposo"] = 400

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert fila["confianza"] == 0.8
    assert any(f.startswith("Dato inválido") for f in fila["factores"])
    assert not any(r["id"].startswith("FC_REPOSO") for r in fila["reglasAplicadas"])


# ------------------------------------------------------------------------- decisión del encargado vs IA (R.110)

@pytest.mark.parametrize("cuerpo, decision", [
    ({"nivel_final": "A3"}, "confirmada"),
    ({"nivel_final": "A2"}, "modificada"),
    ({"nivel_final": "A3", "derivar": True, "motivo": "Revisión médica"}, "derivada"),
])
def test_la_decision_del_encargado_se_compara_con_la_sugerencia_de_la_ia(client, payload, totem_headers, auth, cuerpo, decision):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    r = client.put(f"/api/evaluaciones/{eval_id}", json=cuerpo, headers=h)

    # Assert
    evaluacion = r.json()["evaluacion"]
    assert evaluacion["decisionPersonal"] == decision and evaluacion["iaSugerida"] == "A3"


def test_antes_de_decidir_no_hay_decision_del_encargado(client, payload, totem_headers, auth):
    # Arrange / Act
    _enviar(client, payload, totem_headers)

    # Assert
    assert _primera(client, auth())["decisionPersonal"] is None


def test_la_rutina_final_usa_el_texto_de_la_configuracion(client, payload, totem_headers, auth):
    # Arrange
    _enviar(client, payload, totem_headers)
    h = auth()
    eval_id = _primera(client, h)["idBaseDatos"]

    # Act
    client.put(f"/api/evaluaciones/{eval_id}", json={"nivel_final": "A2"}, headers=h)

    # Assert
    db = main.SessionLocal()
    try:
        assert db.query(ResultadoRutina).one().rutina_final == "Apto con precaución. Baja intensidad y supervisión del encargado."
    finally:
        db.close()


# --------------------------------------------------------------------------- modelo de ML opcional

class PredictorFalso:
    version = "xgb-prueba"

    def __init__(self, categoria="A2", probabilidad=0.9, falla=False):
        self.categoria, self.probabilidad, self.falla = categoria, probabilidad, falla

    def predecir(self, entrada):
        if self.falla:
            raise RuntimeError("modelo roto")
        return self.categoria, self.probabilidad


def test_sin_modelo_el_resultado_es_el_de_las_reglas(monkeypatch):
    # Arrange
    monkeypatch.delenv("MODELO_IA_PATH", raising=False)
    monkeypatch.setattr(inferencia, "_predictor_cargado", False)
    entrada = Entrada(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, imc=22.0)

    # Act
    resultado = inferencia.evaluar_entrada(entrada, CFG)

    # Assert
    assert resultado == evaluar(entrada, CFG)


def test_con_un_modelo_la_categoria_es_la_mas_grave_y_la_version_lo_indica():
    # Arrange
    entrada = Entrada(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, imc=22.0)

    # Act
    resultado = inferencia.evaluar_entrada(entrada, CFG, PredictorFalso("A2", 0.9))

    # Assert
    assert resultado.categoria == "A2" and resultado.version == "xgb-prueba+reglas-v2" and resultado.confianza == 0.9


def test_si_el_modelo_falla_se_usan_solo_las_reglas():
    # Arrange
    entrada = Entrada(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, imc=22.0)

    # Act
    resultado = inferencia.evaluar_entrada(entrada, CFG, PredictorFalso(falla=True))

    # Assert
    assert resultado == evaluar(entrada, CFG)


def test_una_ruta_de_modelo_invalida_no_rompe_el_sistema(monkeypatch, tmp_path):
    # Arrange
    monkeypatch.setenv("MODELO_IA_PATH", str(tmp_path / "no-existe"))
    monkeypatch.setattr(inferencia, "_predictor_cargado", False)
    monkeypatch.setattr(inferencia, "_predictor", None)

    # Act
    predictor = inferencia.obtener_predictor()

    # Assert
    assert predictor is None


def test_la_evaluacion_completa_usa_el_modelo_inyectado(client, payload, totem_headers, auth, monkeypatch):
    # Arrange
    monkeypatch.setattr(inferencia, "_predictor", PredictorFalso("A2", 0.9))
    monkeypatch.setattr(inferencia, "_predictor_cargado", True)

    # Act
    _enviar(client, payload, totem_headers)

    # Assert
    fila = _primera(client, auth())
    assert fila["iaSugerida"] == "A2" and fila["versionModelo"] == "xgb-prueba+reglas-v2" and fila["confianza"] == 0.9
    assert "El modelo de IA sugiere A2 (probabilidad 90%)" in fila["factores"]


# ----------------------------------------------------------------------------------- migración de columnas

@pytest.mark.skipif(main.engine.dialect.name != "postgresql", reason="requiere TEST_DATABASE_URL de PostgreSQL")
def test_la_migracion_agrega_las_columnas_de_inferencia_a_una_tabla_existente(client):
    # Arrange
    with main.engine.begin() as conn:
        for columna in ("reglas_aplicadas", "requiere_revision", "motivo_revision"):
            conn.execute(text(f"ALTER TABLE inferencias_ia DROP COLUMN {columna}"))

    # Act
    agregadas = agregar_columnas_faltantes(main.engine)

    # Assert
    assert sorted(agregadas) == ["inferencias_ia.motivo_revision", "inferencias_ia.reglas_aplicadas", "inferencias_ia.requiere_revision"]
    assert {"reglas_aplicadas", "requiere_revision", "motivo_revision"} <= {c["name"] for c in inspect(main.engine).get_columns("inferencias_ia")}
