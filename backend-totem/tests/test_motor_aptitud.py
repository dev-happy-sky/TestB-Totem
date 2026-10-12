import copy
import json

import pytest

import motor_aptitud as motor
from motor_aptitud import ConfiguracionInvalida, Entrada, cargar_configuracion, evaluar, fusionar_prediccion

CFG = cargar_configuracion()

# Entrada sana de referencia: todos los valores dentro del rango normal.
SANA = dict(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, fc_recuperacion=100, imc=22.0)


def entrada(**cambios):
    return Entrada(**{**SANA, **cambios})


def ids(resultado):
    return {h.id for h in resultado.hallazgos}


# ---------------------------------------------------------------------------------- configuración

def test_la_configuracion_por_defecto_es_valida_y_esta_marcada_como_provisional():
    # Arrange / Act
    cfg = cargar_configuracion()

    # Assert
    assert cfg["version"].startswith("reglas-")
    assert "PROVISIONAL" in cfg["estado_revision"]
    assert set(cfg["categorias"]) == {"A1", "A2", "A3", "A4"}


def test_se_puede_cargar_la_configuracion_desde_una_ruta_indicada_por_entorno(tmp_path, monkeypatch):
    # Arrange
    cfg = copy.deepcopy(CFG)
    cfg["version"] = "reglas-prueba"
    ruta = tmp_path / "reglas.json"
    ruta.write_text(json.dumps(cfg), encoding="utf-8")
    monkeypatch.setenv("REGLAS_APTITUD_PATH", str(ruta))

    # Act
    cargada = cargar_configuracion()

    # Assert
    assert cargada["version"] == "reglas-prueba"


def test_una_ruta_inexistente_o_un_json_roto_se_informan(tmp_path):
    # Arrange
    roto = tmp_path / "roto.json"
    roto.write_text("{no es json", encoding="utf-8")

    # Act / Assert
    with pytest.raises(ConfiguracionInvalida):
        cargar_configuracion(tmp_path / "no-existe.json")
    with pytest.raises(ConfiguracionInvalida):
        cargar_configuracion(roto)


def _sin(cfg, *ruta):
    destino = cfg
    for clave in ruta[:-1]:
        destino = destino[clave]
    del destino[ruta[-1]]
    return cfg


@pytest.mark.parametrize("rompe, mensaje", [
    (lambda c: _sin(c, "version"), "version"),
    (lambda c: c.update(umbral_baja_confianza=0), "umbral_baja_confianza"),
    (lambda c: c.update(umbral_baja_confianza=1.5), "umbral_baja_confianza"),
    (lambda c: _sin(c, "categorias", "A3"), "A3"),
    (lambda c: _sin(c, "signos_vitales", "fc_reposo"), "fc_reposo"),
    (lambda c: c["signos_vitales"]["imc"]["validos"].update(min=90, max=10), "validos"),
    (lambda c: c["signos_vitales"]["presion_sistolica"]["critico_si"].update(mayor_o_igual_que=120), "crítico alto"),
    (lambda c: c["signos_vitales"]["presion_sistolica"]["critico_si"].update(menor_que=95), "crítico bajo"),
    (lambda c: _sin(c, "cuestionario", "sintomas_criticos"), "sintomas_criticos"),
    (lambda c: c["confianza"].update(falta_fc=-1), "falta_fc"),
])
def test_una_configuracion_incoherente_se_rechaza(rompe, mensaje):
    # Arrange
    cfg = copy.deepcopy(CFG)
    rompe(cfg)

    # Act
    with pytest.raises(ConfiguracionInvalida) as error:
        motor.validar_configuracion(cfg)

    # Assert
    assert mensaje in str(error.value)


# ----------------------------------------------------------------- límites de los signos vitales

@pytest.mark.parametrize("campo, valor, esperado", [
    # presión sistólica: precaución si <90 o >=130; crítico si <80 o >=180
    ("presion_sistolica", 90, None), ("presion_sistolica", 129, None),
    ("presion_sistolica", 89, "PRESION_SISTOLICA_FUERA_DE_RANGO"), ("presion_sistolica", 130, "PRESION_SISTOLICA_FUERA_DE_RANGO"),
    ("presion_sistolica", 80, "PRESION_SISTOLICA_FUERA_DE_RANGO"), ("presion_sistolica", 179, "PRESION_SISTOLICA_FUERA_DE_RANGO"),
    ("presion_sistolica", 79, "PRESION_SISTOLICA_CRITICA"), ("presion_sistolica", 180, "PRESION_SISTOLICA_CRITICA"),
    # presión diastólica: precaución si <60 o >=85; crítico si <50 o >=120 (la sistólica se mantiene mayor)
    ("presion_diastolica", 60, None), ("presion_diastolica", 84, None),
    ("presion_diastolica", 59, "PRESION_DIASTOLICA_FUERA_DE_RANGO"), ("presion_diastolica", 85, "PRESION_DIASTOLICA_FUERA_DE_RANGO"),
    ("presion_diastolica", 49, "PRESION_DIASTOLICA_CRITICA"),
    # frecuencia cardíaca: precaución si >100 o <60; crítico si >120 o <40
    ("fc_reposo", 60, None), ("fc_reposo", 100, None),
    ("fc_reposo", 59, "FC_REPOSO_FUERA_DE_RANGO"), ("fc_reposo", 101, "FC_REPOSO_FUERA_DE_RANGO"),
    ("fc_reposo", 120, "FC_REPOSO_FUERA_DE_RANGO"), ("fc_reposo", 40, "FC_REPOSO_FUERA_DE_RANGO"),
    ("fc_reposo", 121, "FC_REPOSO_CRITICA"), ("fc_reposo", 39, "FC_REPOSO_CRITICA"),
    # IMC: precaución si <18.5 o >=25; nunca crítico
    ("imc", 18.5, None), ("imc", 24.9, None),
    ("imc", 18.4, "IMC_FUERA_DE_RANGO"), ("imc", 25.0, "IMC_FUERA_DE_RANGO"), ("imc", 45.0, "IMC_FUERA_DE_RANGO"),
])
def test_los_limites_de_cada_signo_vital_clasifican_como_esperado(campo, valor, esperado):
    # Arrange
    datos = entrada(**{campo: valor})
    if campo == "presion_diastolica" and valor >= 120:
        datos = entrada(presion_sistolica=200, presion_diastolica=valor)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert ids(resultado) == ({esperado} if esperado else set())


@pytest.mark.parametrize("campo, valor", [
    ("presion_sistolica", 49), ("presion_sistolica", 301), ("presion_diastolica", 29), ("fc_reposo", 19),
    ("fc_reposo", 251), ("imc", 9.9), ("imc", 80.1),
])
def test_un_valor_fisicamente_imposible_se_descarta_y_baja_la_confianza(campo, valor):
    # Arrange
    datos = entrada(**{campo: valor})
    if campo == "presion_sistolica" and valor > 200:
        datos = entrada(presion_sistolica=valor, presion_diastolica=80)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.confianza == 0.8
    assert any(f.startswith("Dato inválido") for f in resultado.factores)
    assert not any(h.valor == valor for h in resultado.hallazgos)


def test_una_sistolica_menor_o_igual_que_la_diastolica_invalida_ambas_presiones():
    # Arrange
    datos = entrada(presion_sistolica=80, presion_diastolica=90)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.confianza == 0.8
    assert not any(h.id.startswith("PRESION") for h in resultado.hallazgos)
    assert "Dato inválido: La presión sistólica debe ser mayor que la diastólica" in resultado.factores


# ---------------------------------------------------------------------------------- categorías

@pytest.mark.parametrize("cambios, categoria, alerta, nivel", [
    ({}, "A4", None, None),                                                                          # sin hallazgos
    ({"condiciones": ("Asma",)}, "A3", None, None),                                                  # condición: leve
    ({"condiciones": ("Lesión de rodilla", "Diabetes")}, "A3", None, None),
    ({"lesiones_previas": "Esguince de tobillo"}, "A3", None, None),
    ({"lesiones_previas": "   "}, "A4", None, None),                                                 # solo espacios
    ({"imc": 27}, "A2", None, None),                                                                 # IMC: precaución sin alerta
    ({"presion_sistolica": 135}, "A2", "DERIVAR", "riesgo"),
    ({"fc_reposo": 105}, "A2", "DERIVAR", "riesgo"),
    ({"sintomas": ("Medicación permanente",)}, "A2", "DERIVAR", "riesgo"),
    ({"sintomas": ("Mareos",)}, "A2", "DERIVAR", "riesgo"),
    ({"sintomas": ("Dolor de pecho al esforzarte",)}, "A1", "DERIVAR", "critica"),
    ({"sintomas": ("Mareos o pérdida de equilibrio",)}, "A1", "DERIVAR", "critica"),
    ({"condiciones": ("Problema cardíaco",)}, "A1", "DERIVAR", "critica"),
    ({"presion_sistolica": 185, "presion_diastolica": 100}, "A1", "DERIVAR", "critica"),
    ({"fc_reposo": 130}, "A1", "DERIVAR", "critica"),
    ({"fc_reposo": 35}, "A1", "DERIVAR", "critica"),
    ({"sintomas": ("Medicación permanente",), "condiciones": ("Problema cardíaco",)}, "A1", "DERIVAR", "critica"),
])
def test_la_categoria_es_la_del_hallazgo_mas_grave(cambios, categoria, alerta, nivel):
    # Arrange
    datos = entrada(**{"presion_diastolica": 78, **cambios})
    if cambios.get("presion_sistolica") == 135:
        datos = entrada(presion_sistolica=135, presion_diastolica=78)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert (resultado.categoria, resultado.alerta, resultado.nivel_alerta) == (categoria, alerta, nivel)


def test_la_intensidad_y_la_rutina_salen_de_la_configuracion():
    # Arrange
    cfg = copy.deepcopy(CFG)
    cfg["categorias"]["A4"]["intensidad"] = "Intensidad alta supervisada"

    # Act
    resultado = evaluar(entrada(), cfg)

    # Assert
    assert resultado.intensidad == "Intensidad alta supervisada"
    assert resultado.rutina == "Apto. Intensidad alta supervisada."


def test_cambiar_un_umbral_en_la_configuracion_cambia_la_decision():
    # Arrange
    cfg = copy.deepcopy(CFG)
    cfg["signos_vitales"]["imc"]["precaucion_si"]["mayor_o_igual_que"] = 30

    # Act
    resultado = evaluar(entrada(imc=27), cfg)

    # Assert
    assert resultado.categoria == "A4"


def test_el_motor_no_modifica_la_configuracion_ni_la_entrada():
    # Arrange
    cfg = copy.deepcopy(CFG)
    datos = entrada(sintomas=("Mareos",))

    # Act
    evaluar(datos, cfg)

    # Assert
    assert cfg == CFG and datos == entrada(sintomas=("Mareos",))


# ----------------------------------------------------------------------------------- factores (R.101, R.114)

def test_los_factores_listan_todo_lo_que_pesó_en_la_decision():
    # Arrange
    datos = entrada(sintomas=("Medicación permanente",), condiciones=("Asma", "Problema cardíaco"),
                    presion_sistolica=135, imc=27, lesiones_previas="Esguince")

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.factores == (
        "Síntoma declarado: Medicación permanente", "Condición declarada: Asma", "Condición crítica: Problema cardíaco",
        "Lesiones previas declaradas", "Presión sistólica 135 mmHg: fuera del rango normal", "IMC 27 kg/m²: fuera del rango normal",
    )


def test_cada_hallazgo_guarda_su_regla_severidad_y_valor():
    # Arrange
    datos = entrada(presion_sistolica=185, presion_diastolica=100)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    critico = next(h for h in resultado.hallazgos if h.id == "PRESION_SISTOLICA_CRITICA")
    assert (critico.severidad, critico.valor, critico.genera_alerta) == ("critico", 185, True)


# ------------------------------------------------------------------------------- confianza (R.93, R.100)

def test_con_todos_los_datos_y_sin_inconsistencias_la_confianza_es_maxima():
    # Arrange / Act
    resultado = evaluar(entrada(), CFG)

    # Assert
    assert resultado.confianza == 1.0 and not resultado.requiere_revision and resultado.motivo_revision is None


@pytest.mark.parametrize("faltan, confianza, revisar", [
    ({"imc": None}, 0.95, False),
    ({"presion_sistolica": None}, 0.8, False),
    ({"presion_sistolica": None, "presion_diastolica": None}, 0.8, False),   # presión faltante cuenta una sola vez
    ({"fc_reposo": None}, 0.8, False),
    ({"presion_sistolica": None, "presion_diastolica": None, "fc_reposo": None}, 0.6, True),
    ({"presion_sistolica": None, "presion_diastolica": None, "fc_reposo": None, "imc": None}, 0.55, True),
])
def test_los_datos_faltantes_descuentan_confianza(faltan, confianza, revisar):
    # Arrange
    datos = entrada(**faltan)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.confianza == confianza
    assert resultado.requiere_revision is revisar
    assert any(f.startswith("Dato faltante") for f in resultado.factores)


def test_sin_ningun_dato_se_deriva_al_encargado_con_el_motivo():
    # Arrange / Act
    resultado = evaluar(Entrada(), CFG)

    # Assert
    assert resultado.requiere_revision is True and resultado.alerta == "REVISAR" and resultado.nivel_alerta == "riesgo"
    assert resultado.motivo_revision == "Confianza baja (55%): falta la presión arterial; falta la frecuencia cardíaca en reposo"


def test_la_confianza_exactamente_en_el_umbral_no_requiere_revision():
    # Arrange
    cfg = copy.deepcopy(CFG)
    cfg["umbral_baja_confianza"] = 0.8

    # Act
    resultado = evaluar(entrada(fc_reposo=None), cfg)   # 1.0 - 0.2 = 0.8

    # Assert
    assert resultado.confianza == 0.8 and resultado.requiere_revision is False


def test_la_revision_por_baja_confianza_no_pisa_una_alerta_mas_grave():
    # Arrange
    datos = Entrada(sintomas=("Dolor de pecho al esforzarte",))

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.requiere_revision is True
    assert (resultado.alerta, resultado.nivel_alerta) == ("DERIVAR", "critica")


def test_una_alerta_de_riesgo_tampoco_se_reemplaza_por_revisar():
    # Arrange
    datos = Entrada(sintomas=("Medicación permanente",))

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.requiere_revision is True
    assert (resultado.alerta, resultado.nivel_alerta) == ("DERIVAR", "riesgo")


def test_una_presion_elevada_sin_hipertension_declarada_es_una_inconsistencia():
    # Arrange
    datos = entrada(presion_sistolica=145, presion_diastolica=95)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.confianza == 0.85
    assert "Inconsistencia: Presión elevada sin antecedente de hipertensión declarado" in resultado.factores


def test_con_hipertension_declarada_la_presion_elevada_no_es_inconsistencia():
    # Arrange
    datos = entrada(presion_sistolica=145, presion_diastolica=95, condiciones=("Hipertensión",))

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.confianza == 1.0


def test_una_fc_de_recuperacion_menor_que_la_de_reposo_es_una_inconsistencia():
    # Arrange
    datos = entrada(fc_reposo=80, fc_recuperacion=70)

    # Act
    resultado = evaluar(datos, CFG)

    # Assert
    assert resultado.confianza == 0.85
    assert "Inconsistencia: La FC de recuperación es menor que la FC en reposo" in resultado.factores


def test_la_confianza_nunca_baja_del_minimo():
    # Arrange
    cfg = copy.deepcopy(CFG)
    cfg["confianza"]["medicion_invalida"] = 0.5
    datos = Entrada(presion_sistolica=400, presion_diastolica=300, fc_reposo=500, imc=5)

    # Act
    resultado = evaluar(datos, cfg)

    # Assert
    assert resultado.confianza == cfg["confianza"]["minimo"]


# ------------------------------------------------------------------------- modelo de ML (fusionar_prediccion)

def test_si_el_modelo_es_mas_grave_que_las_reglas_manda_el_modelo():
    # Arrange
    reglas = evaluar(entrada(), CFG)   # A4

    # Act
    final = fusionar_prediccion(reglas, CFG, "A2", 0.9, "xgb-2026")

    # Assert
    assert final.categoria == "A2" and final.confianza == 0.9
    assert final.version == "xgb-2026+" + reglas.version
    assert final.factores[-1] == "El modelo de IA sugiere A2 (probabilidad 90%)"
    assert final.rutina.startswith("Apto con precaución")


def test_el_modelo_nunca_puede_declarar_apto_a_quien_las_reglas_marcan_como_riesgo():
    # Arrange
    reglas = evaluar(entrada(sintomas=("Dolor de pecho al esforzarte",)), CFG)   # A1 crítica

    # Act
    final = fusionar_prediccion(reglas, CFG, "A4", 0.99, "xgb-2026")

    # Assert
    assert final.categoria == "A1" and final.nivel_alerta == "critica"


def test_la_confianza_final_es_la_menor_entre_reglas_y_modelo():
    # Arrange
    reglas = evaluar(entrada(fc_reposo=None), CFG)   # 0.8

    # Act
    final = fusionar_prediccion(reglas, CFG, "A4", 0.95, "xgb-2026")

    # Assert
    assert final.confianza == 0.8


def test_un_modelo_poco_seguro_deriva_a_revision_con_motivo():
    # Arrange
    reglas = evaluar(entrada(), CFG)

    # Act
    final = fusionar_prediccion(reglas, CFG, "A4", 0.6, "xgb-2026")

    # Assert
    assert final.requiere_revision is True and final.alerta == "REVISAR"
    assert final.motivo_revision == "Confianza baja (60%): el modelo no está seguro de su clasificación"


def test_si_el_modelo_dice_a1_sin_alerta_critica_de_las_reglas_se_deriva():
    # Arrange
    reglas = evaluar(entrada(), CFG)

    # Act
    final = fusionar_prediccion(reglas, CFG, "A1", 0.9, "xgb-2026")

    # Assert
    assert final.categoria == "A1" and (final.alerta, final.nivel_alerta) == ("DERIVAR", "riesgo")
