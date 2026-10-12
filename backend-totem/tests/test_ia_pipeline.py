"""Pruebas de la MECÁNICA del pipeline de ML (formato, métricas, guardado y carga).

El dataset que usan es sintético y sale de las propias reglas: sirve para verificar el flujo, no dice nada sobre
la calidad clínica de un modelo. Un modelo real se entrena con datos etiquetados por un profesional.
"""
import csv
import json

import numpy as np
import pytest

pytest.importorskip("xgboost")

import inferencia  # noqa: E402
from ia import entrenar as entrenamiento  # noqa: E402
from ia.caracteristicas import COLUMNAS, COLUMNAS_CSV, DatasetInvalido, leer_dataset, vectorizar  # noqa: E402
from ia.entrenar import calcular_metricas, dividir_estratificado, entrenar_y_guardar  # noqa: E402
from ia.modelo import ModeloInvalido, cargar_predictor  # noqa: E402
from motor_aptitud import Entrada, cargar_configuracion, evaluar  # noqa: E402

CFG = cargar_configuracion()
SINTOMAS = ["Dolor de pecho al esforzarte", "Mareos o pérdida de equilibrio", "Lesión articular u ósea", "Medicación permanente"]
CONDICIONES = ["Asma", "Hipertensión", "Diabetes", "Problema cardíaco", "Lesión de rodilla", "Embarazo"]


def escribir_dataset(ruta, filas=240, semilla=7):
    azar = np.random.default_rng(semilla)
    with open(ruta, "w", newline="", encoding="utf-8") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS_CSV)
        escritor.writeheader()
        for _ in range(filas):
            sintomas = [s for s in SINTOMAS if azar.random() < 0.12]
            condiciones = [c for c in CONDICIONES if azar.random() < 0.15]
            entrada = Entrada(
                sintomas=tuple(sintomas), condiciones=tuple(condiciones),
                lesiones_previas="Esguince" if azar.random() < 0.1 else None,
                presion_sistolica=int(azar.normal(120, 22)), presion_diastolica=int(azar.normal(78, 12)),
                fc_reposo=int(azar.normal(75, 18)), fc_recuperacion=int(azar.normal(100, 15)), imc=round(float(azar.normal(25, 4)), 1),
            )
            categoria = evaluar(entrada, CFG).categoria
            escritor.writerow({
                "presion_sistolica": entrada.presion_sistolica, "presion_diastolica": entrada.presion_diastolica,
                "fc_reposo": entrada.fc_reposo, "fc_recuperacion": entrada.fc_recuperacion, "imc": entrada.imc,
                "sintomas": ";".join(sintomas), "condiciones": ";".join(condiciones),
                "lesiones_previas": entrada.lesiones_previas or "", "categoria": categoria,
            })


@pytest.fixture(scope="module")
def dataset(tmp_path_factory):
    ruta = tmp_path_factory.mktemp("datos") / "dataset.csv"
    escribir_dataset(ruta)
    return ruta


@pytest.fixture(scope="module")
def modelo_entrenado(dataset, tmp_path_factory):
    salida = tmp_path_factory.mktemp("modelo")
    meta = entrenar_y_guardar(dataset, salida, rondas=30)
    return salida, meta


# ------------------------------------------------------------------------------------------ características

def test_vectorizar_sigue_el_orden_fijo_de_columnas_y_marca_lo_faltante_como_nan():
    # Arrange
    entrada = Entrada(sintomas=("Dolor de pecho al esforzarte", "Medicación permanente"), condiciones=("Problema cardíaco",),
                      lesiones_previas="Esguince", presion_sistolica=130, fc_reposo=72)

    # Act
    vector = vectorizar(entrada, CFG)

    # Assert
    por_nombre = dict(zip(COLUMNAS, vector))
    assert len(vector) == len(COLUMNAS)
    assert por_nombre["presion_sistolica"] == 130 and por_nombre["fc_reposo"] == 72
    assert np.isnan(por_nombre["presion_diastolica"]) and np.isnan(por_nombre["imc"]) and np.isnan(por_nombre["fc_recuperacion"])
    assert (por_nombre["n_sintomas"], por_nombre["n_sintomas_criticos"]) == (2, 1)
    assert (por_nombre["n_condiciones"], por_nombre["n_condiciones_criticas"], por_nombre["tiene_lesiones"]) == (1, 1, 1)


def test_una_entrada_vacia_se_vectoriza_sin_errores():
    # Arrange / Act
    vector = vectorizar(Entrada(), CFG)

    # Assert
    assert sum(np.isnan(vector)) == 5 and vector[5:] == [0.0] * 5


# ----------------------------------------------------------------------------------------------- dataset

def _csv(ruta, filas, columnas=COLUMNAS_CSV):
    with open(ruta, "w", newline="", encoding="utf-8") as archivo:
        escritor = csv.writer(archivo)
        escritor.writerow(columnas)
        escritor.writerows(filas)
    return ruta


FILA_OK = ["118", "78", "70", "100", "22.0", "", "", "", "A4"]


def test_leer_dataset_acepta_filas_con_datos_faltantes_y_listas_con_punto_y_coma(tmp_path):
    # Arrange
    ruta = _csv(tmp_path / "d.csv", [
        FILA_OK, ["", "", "", "", "", "Mareos o pérdida de equilibrio;Medicación permanente", "Asma", "Esguince", "a1"]])

    # Act
    filas, etiquetas = leer_dataset(ruta, CFG)

    # Assert
    assert etiquetas == ["A4", "A1"]
    assert dict(zip(COLUMNAS, filas[1]))["n_sintomas"] == 2 and np.isnan(filas[1][0])


@pytest.mark.parametrize("fila, mensaje", [
    (["118", "78", "70", "100", "22.0", "", "", "", "A5"], "Línea 2: la categoría"),
    (["118", "78", "70", "100", "22.0", "", "", "", ""], "Línea 2: la categoría"),
    (["abc", "78", "70", "100", "22.0", "", "", "", "A4"], "Línea 2: 'presion_sistolica' no es un número"),
    (["118", "78", "70", "100", "nan", "", "", "", "A4"], "Línea 2: 'imc' no es un número válido"),
    (["118", "78", "70", "100", "inf", "", "", "", "A4"], "Línea 2: 'imc' no es un número válido"),
])
def test_leer_dataset_informa_la_linea_con_el_problema(tmp_path, fila, mensaje):
    # Arrange
    ruta = _csv(tmp_path / "d.csv", [fila])

    # Act
    with pytest.raises(DatasetInvalido) as error:
        leer_dataset(ruta, CFG)

    # Assert
    assert mensaje in str(error.value)


def test_leer_dataset_rechaza_un_csv_sin_las_columnas_esperadas(tmp_path):
    # Arrange
    ruta = _csv(tmp_path / "d.csv", [["1", "2"]], columnas=["a", "b"])

    # Act
    with pytest.raises(DatasetInvalido) as error:
        leer_dataset(ruta, CFG)

    # Assert
    assert "Faltan columnas" in str(error.value) and "categoria" in str(error.value)


def test_leer_dataset_rechaza_un_archivo_vacio_o_inexistente(tmp_path):
    # Arrange
    vacio = _csv(tmp_path / "vacio.csv", [])

    # Act / Assert
    with pytest.raises(DatasetInvalido, match="no tiene filas"):
        leer_dataset(vacio, CFG)
    with pytest.raises(DatasetInvalido, match="No se pudo leer"):
        leer_dataset(tmp_path / "no-existe.csv", CFG)


# --------------------------------------------------------------------------------------------- partición

def test_la_particion_es_estratificada_disjunta_y_reproducible():
    # Arrange
    etiquetas = ["A1"] * 10 + ["A2"] * 20 + ["A3"] * 30 + ["A4"] * 40

    # Act
    entrenamiento_idx, prueba_idx = dividir_estratificado(etiquetas, 0.2, semilla=1)

    # Assert
    assert not set(entrenamiento_idx) & set(prueba_idx)
    assert sorted(entrenamiento_idx + prueba_idx) == list(range(100))
    assert [sum(etiquetas[i] == c for i in prueba_idx) for c in ("A1", "A2", "A3", "A4")] == [2, 4, 6, 8]
    assert (entrenamiento_idx, prueba_idx) == dividir_estratificado(etiquetas, 0.2, semilla=1)
    assert prueba_idx != dividir_estratificado(etiquetas, 0.2, semilla=2)[1]


def test_una_categoria_con_un_solo_ejemplo_va_a_entrenamiento():
    # Arrange
    etiquetas = ["A1"] + ["A4"] * 9

    # Act
    entrenamiento_idx, prueba_idx = dividir_estratificado(etiquetas, 0.2)

    # Assert
    assert 0 in entrenamiento_idx and len(prueba_idx) == 2


# ------------------------------------------------------------------------------------------------ métricas

def test_las_metricas_calculan_exactitud_matriz_y_falsos_negativos():
    # Arrange
    reales = ["A1", "A1", "A2", "A2", "A3", "A3", "A4", "A4"]
    predichas = ["A1", "A3", "A2", "A1", "A3", "A2", "A4", "A4"]

    # Act
    m = calcular_metricas(reales, predichas)

    # Assert
    assert m["filas_prueba"] == 8 and m["exactitud"] == 0.625
    assert m["matriz_confusion"]["A1"] == {"A1": 1, "A2": 0, "A3": 1, "A4": 0}
    assert m["tasa_falsos_negativos"] == 0.25               # 1 de los 4 casos graves quedó como apto
    assert m["tasa_falsos_negativos_a1"] == 0.5             # 1 de los 2 A1
    assert m["tasa_derivaciones_innecesarias"] == 0.25      # 1 de los 4 aptos quedó como grave
    assert m["recall_por_categoria"]["A4"] == 1.0 and m["precision_por_categoria"]["A1"] == 0.5


def test_si_no_hay_casos_de_una_clase_sus_tasas_son_nulas_y_no_se_dividen_por_cero():
    # Arrange
    reales = ["A3", "A4"]
    predichas = ["A3", "A4"]

    # Act
    m = calcular_metricas(reales, predichas)

    # Assert
    assert m["tasa_falsos_negativos"] is None and m["tasa_falsos_negativos_a1"] is None
    assert m["recall_por_categoria"]["A1"] is None and m["exactitud"] == 1.0


def test_un_modelo_sin_falsos_negativos_tiene_tasa_cero():
    # Arrange
    reales = ["A1", "A2", "A4"]
    predichas = ["A1", "A1", "A4"]

    # Act
    m = calcular_metricas(reales, predichas)

    # Assert
    assert m["tasa_falsos_negativos"] == 0.0


# ------------------------------------------------------------------------------------------ entrenamiento

def test_el_entrenamiento_guarda_el_modelo_y_los_metadatos(modelo_entrenado, dataset):
    # Arrange
    salida, meta = modelo_entrenado

    # Act
    guardado = json.loads((salida / "meta.json").read_text(encoding="utf-8"))

    # Assert
    assert (salida / "modelo.json").stat().st_size > 0
    assert guardado == meta
    assert guardado["version"].startswith("xgb-") and guardado["reglas_version"] == "reglas-v2"
    assert guardado["dataset"]["filas"] == 240 and sum(guardado["dataset"]["por_categoria"].values()) == 240
    assert guardado["columnas"] == list(COLUMNAS)
    assert guardado["objetivos"]["exactitud_minima"] == 0.9 and guardado["limitaciones"]
    assert 0 <= guardado["metricas"]["exactitud"] <= 1


def test_el_entrenamiento_es_reproducible(dataset, tmp_path):
    # Arrange / Act
    a = entrenar_y_guardar(dataset, tmp_path / "a", rondas=15, semilla=3)
    b = entrenar_y_guardar(dataset, tmp_path / "b", rondas=15, semilla=3)

    # Assert
    assert a["metricas"] == b["metricas"]
    assert (tmp_path / "a" / "modelo.json").read_bytes() == (tmp_path / "b" / "modelo.json").read_bytes()


def test_con_pocas_filas_se_rechaza_salvo_que_se_permita(tmp_path):
    # Arrange
    ruta = tmp_path / "chico.csv"
    escribir_dataset(ruta, filas=30)

    # Act / Assert
    with pytest.raises(DatasetInvalido, match="se necesitan al menos 100"):
        entrenar_y_guardar(ruta, tmp_path / "s")
    meta = entrenar_y_guardar(ruta, tmp_path / "s", rondas=5, permitir_pocos=True)
    assert any("Dataset pequeño" in a for a in meta["advertencias"])


def test_las_advertencias_senalan_categorias_con_pocos_ejemplos(tmp_path):
    # Arrange
    ruta = tmp_path / "d.csv"
    escribir_dataset(ruta, filas=120)

    # Act
    meta = entrenar_y_guardar(ruta, tmp_path / "s", rondas=5)

    # Assert
    escasas = [c for c, n in meta["dataset"]["por_categoria"].items() if n < 10]
    for categoria in escasas:
        assert any(f"La categoría {categoria} tiene solo" in a for a in meta["advertencias"])


def test_el_cli_informa_las_metricas_y_devuelve_cero(dataset, tmp_path, capsys):
    # Arrange / Act
    codigo = entrenamiento.main(["--datos", str(dataset), "--salida", str(tmp_path / "s"), "--rondas", "10"])

    # Assert
    salida = capsys.readouterr().out
    assert codigo == 0 and "Exactitud en datos de prueba" in salida and "Falsos negativos" in salida


def test_el_cli_devuelve_uno_si_el_dataset_es_invalido(tmp_path, capsys):
    # Arrange / Act
    codigo = entrenamiento.main(["--datos", str(tmp_path / "no-existe.csv"), "--salida", str(tmp_path / "s")])

    # Assert
    assert codigo == 1 and "Error:" in capsys.readouterr().err


# -------------------------------------------------------------------------------------------- predictor

def test_el_predictor_devuelve_una_categoria_valida_con_su_probabilidad(modelo_entrenado):
    # Arrange
    salida, meta = modelo_entrenado
    predictor = cargar_predictor(salida)

    # Act
    categoria, probabilidad = predictor.predecir(Entrada(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, imc=22.0))

    # Assert
    assert categoria in ("A1", "A2", "A3", "A4") and 0.25 <= probabilidad <= 1.0
    assert predictor.version == meta["version"]


def test_el_predictor_funciona_con_datos_faltantes(modelo_entrenado):
    # Arrange
    predictor = cargar_predictor(modelo_entrenado[0])

    # Act
    categoria, probabilidad = predictor.predecir(Entrada())

    # Assert
    assert categoria in ("A1", "A2", "A3", "A4") and 0 < probabilidad <= 1


def test_la_prediccion_es_rapida(modelo_entrenado):
    # Arrange
    import time
    predictor = cargar_predictor(modelo_entrenado[0])
    entrada = Entrada(presion_sistolica=118, presion_diastolica=78, fc_reposo=70, imc=22.0)

    # Act
    inicio = time.perf_counter()
    predictor.predecir(entrada)
    milisegundos = (time.perf_counter() - inicio) * 1000

    # Assert
    assert milisegundos < 2500   # objetivo del proyecto para la inferencia


def test_un_modelo_entrenado_con_otras_columnas_se_rechaza(modelo_entrenado, tmp_path):
    # Arrange
    salida, _ = modelo_entrenado
    copia = tmp_path / "copia"
    copia.mkdir()
    (copia / "modelo.json").write_bytes((salida / "modelo.json").read_bytes())
    meta = json.loads((salida / "meta.json").read_text(encoding="utf-8"))
    meta["columnas"] = meta["columnas"][:-1]
    (copia / "meta.json").write_text(json.dumps(meta), encoding="utf-8")

    # Act / Assert
    with pytest.raises(ModeloInvalido, match="reentrenarlo"):
        cargar_predictor(copia)


@pytest.mark.parametrize("dañar", ["sin_carpeta", "modelo_roto", "meta_rota"])
def test_un_modelo_danado_o_inexistente_se_informa(modelo_entrenado, tmp_path, dañar):
    # Arrange
    salida, _ = modelo_entrenado
    destino = tmp_path / "m"
    if dañar != "sin_carpeta":
        destino.mkdir()
        (destino / "modelo.json").write_text("no es un modelo" if dañar == "modelo_roto" else (salida / "modelo.json").read_text())
        (destino / "meta.json").write_text("{roto" if dañar == "meta_rota" else (salida / "meta.json").read_text(encoding="utf-8"), encoding="utf-8")

    # Act / Assert
    with pytest.raises(ModeloInvalido):
        cargar_predictor(destino)


# ---------------------------------------------------------------------- integración con la inferencia

def test_con_modelo_configurado_las_reglas_de_seguridad_siguen_mandando(modelo_entrenado, monkeypatch):
    # Arrange
    monkeypatch.setenv("MODELO_IA_PATH", str(modelo_entrenado[0]))
    monkeypatch.setattr(inferencia, "_predictor_cargado", False)
    monkeypatch.setattr(inferencia, "_predictor", None)
    critica = Entrada(sintomas=("Dolor de pecho al esforzarte",), presion_sistolica=118, presion_diastolica=78, fc_reposo=70, imc=22.0)

    # Act
    resultado = inferencia.evaluar_entrada(critica, CFG)

    # Assert
    assert inferencia.obtener_predictor() is not None
    assert resultado.version.startswith("xgb-") and resultado.version.endswith("+reglas-v2")
    assert resultado.categoria == "A1" and resultado.nivel_alerta == "critica"


def test_una_evaluacion_completa_registra_la_version_del_modelo(client, payload, totem_headers, auth, modelo_entrenado, monkeypatch):
    # Arrange
    monkeypatch.setenv("MODELO_IA_PATH", str(modelo_entrenado[0]))
    monkeypatch.setattr(inferencia, "_predictor_cargado", False)
    monkeypatch.setattr(inferencia, "_predictor", None)

    # Act
    assert client.post("/api/evaluaciones", json=payload, headers=totem_headers).status_code == 200

    # Assert
    fila = client.get("/api/evaluaciones", headers=auth()).json()[0]
    assert fila["versionModelo"] == f"{modelo_entrenado[1]['version']}+reglas-v2"
    assert 0 < fila["confianza"] <= 1
