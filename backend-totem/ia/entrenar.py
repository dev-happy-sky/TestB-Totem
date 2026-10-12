"""Entrenamiento y evaluación del modelo XGBoost de aptitud física.

    python -m ia.entrenar --datos dataset.csv --salida modelos/xgb-actual

Necesita un dataset REAL con etiquetas (A1–A4) puestas por un profesional (ver ia/README.md). El script mide el
desempeño en datos que el modelo no vio y lo informa tal cual: no promete ninguna precisión. Los objetivos del
proyecto (exactitud > 90 %, falsos negativos cercanos a 0 %) se comparan, pero no se dan por cumplidos.
"""
import argparse
import datetime
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

from ia.caracteristicas import CATEGORIAS, COLUMNAS, DatasetInvalido, leer_dataset
from motor_aptitud import cargar_configuracion

MINIMO_FILAS = 100
OBJETIVO_EXACTITUD = 0.90
GRAVES = ("A1", "A2")      # "no debería entrenar con normalidad"
APTOS = ("A3", "A4")
LIMITACIONES = [
    "Modelo de apoyo a la decisión del encargado; no es un dispositivo médico ni reemplaza a un profesional.",
    "Solo conoce los datos del tótem y del cuestionario (no signos vitales como SpO₂ o temperatura).",
    "Su desempeño solo es válido para poblaciones parecidas a las del dataset de entrenamiento.",
    "Las reglas de seguridad siempre prevalecen: el modelo nunca puede dejar más apto a quien las reglas marcan en riesgo.",
]


def dividir_estratificado(etiquetas, proporcion_prueba=0.2, semilla=42):
    """Reparte los índices en entrenamiento y prueba manteniendo la proporción de cada categoría."""
    azar = np.random.default_rng(semilla)
    entrenamiento, prueba = [], []
    for categoria in sorted(set(etiquetas)):
        indices = np.array([i for i, e in enumerate(etiquetas) if e == categoria])
        azar.shuffle(indices)
        n_prueba = int(round(len(indices) * proporcion_prueba)) if len(indices) > 1 else 0
        prueba.extend(indices[:n_prueba].tolist())
        entrenamiento.extend(indices[n_prueba:].tolist())
    return sorted(entrenamiento), sorted(prueba)


def _matriz(filas, indices):
    return np.array([filas[i] for i in indices], dtype=float)


def entrenar(filas, etiquetas, indices, rondas=100, semilla=42):
    y = np.array([CATEGORIAS.index(etiquetas[i]) for i in indices])
    datos = xgb.DMatrix(_matriz(filas, indices), label=y, feature_names=list(COLUMNAS), missing=np.nan)
    parametros = {"objective": "multi:softprob", "num_class": len(CATEGORIAS), "max_depth": 4, "eta": 0.1,
                  "seed": semilla, "nthread": 1, "eval_metric": "mlogloss"}
    return xgb.train(parametros, datos, num_boost_round=rondas)


def predecir(modelo, filas, indices):
    datos = xgb.DMatrix(_matriz(filas, indices), feature_names=list(COLUMNAS), missing=np.nan)
    return modelo.predict(datos)


def calcular_metricas(reales, predichas) -> dict:
    """Métricas sobre datos de prueba. `reales` y `predichas` son listas de categorías ('A1'..'A4')."""
    n = len(reales)
    matriz = {r: {p: 0 for p in CATEGORIAS} for r in CATEGORIAS}
    for real, predicha in zip(reales, predichas):
        matriz[real][predicha] += 1

    def razon(parte, total):
        return None if total == 0 else round(parte / total, 4)

    graves = sum(1 for r in reales if r in GRAVES)
    aptos = sum(1 for r in reales if r in APTOS)
    falsos_negativos = sum(1 for r, p in zip(reales, predichas) if r in GRAVES and p in APTOS)
    falsos_negativos_a1 = sum(1 for r, p in zip(reales, predichas) if r == "A1" and p in APTOS)
    innecesarias = sum(1 for r, p in zip(reales, predichas) if r in APTOS and p in GRAVES)
    return {
        "filas_prueba": n,
        "exactitud": razon(sum(1 for r, p in zip(reales, predichas) if r == p), n),
        "matriz_confusion": matriz,
        "recall_por_categoria": {c: razon(matriz[c][c], sum(matriz[c].values())) for c in CATEGORIAS},
        "precision_por_categoria": {c: razon(matriz[c][c], sum(matriz[r][c] for r in CATEGORIAS)) for c in CATEGORIAS},
        # R.224-R.227: casos que debían derivarse y el modelo dejó como aptos, y derivaciones innecesarias
        "tasa_falsos_negativos": razon(falsos_negativos, graves),
        "tasa_falsos_negativos_a1": razon(falsos_negativos_a1, sum(1 for r in reales if r == "A1")),
        "tasa_derivaciones_innecesarias": razon(innecesarias, aptos),
    }


def _advertencias(etiquetas, metricas, minimo_filas):
    avisos = []
    if len(etiquetas) < minimo_filas:
        avisos.append(f"Dataset pequeño ({len(etiquetas)} filas, se recomiendan al menos {minimo_filas}): las métricas son poco fiables.")
    for categoria in CATEGORIAS:
        cantidad = etiquetas.count(categoria)
        if cantidad < 10:
            avisos.append(f"La categoría {categoria} tiene solo {cantidad} ejemplos.")
    if metricas["tasa_falsos_negativos"] not in (None, 0.0):
        avisos.append(f"Falsos negativos: {metricas['tasa_falsos_negativos']:.1%} de los casos graves (A1/A2) quedaron como aptos.")
    return avisos


def entrenar_y_guardar(ruta_datos, directorio_salida, proporcion_prueba=0.2, semilla=42, rondas=100,
                       minimo_filas=MINIMO_FILAS, permitir_pocos=False, ruta_reglas=None) -> dict:
    cfg = cargar_configuracion(ruta_reglas)
    filas, etiquetas = leer_dataset(ruta_datos, cfg)
    if len(filas) < minimo_filas and not permitir_pocos:
        raise DatasetInvalido(f"El dataset tiene {len(filas)} filas; se necesitan al menos {minimo_filas} "
                              "(usa --permitir-pocos solo para pruebas del flujo)")
    indices_entrenamiento, indices_prueba = dividir_estratificado(etiquetas, proporcion_prueba, semilla)
    if not indices_prueba:
        raise DatasetInvalido("No quedaron filas para evaluar el modelo: revisa la proporción de prueba")

    modelo = entrenar(filas, etiquetas, indices_entrenamiento, rondas, semilla)
    probabilidades = predecir(modelo, filas, indices_prueba)
    predichas = [CATEGORIAS[int(i)] for i in np.argmax(probabilidades, axis=1)]
    metricas = calcular_metricas([etiquetas[i] for i in indices_prueba], predichas)

    huella = hashlib.sha256(Path(ruta_datos).read_bytes()).hexdigest()[:8]
    meta = {
        "version": f"xgb-{datetime.date.today():%Y%m%d}-{huella}",
        "entrenado_en": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "dataset": {"archivo": Path(ruta_datos).name, "sha256_8": huella, "filas": len(filas),
                    "por_categoria": {c: etiquetas.count(c) for c in CATEGORIAS}},
        "columnas": list(COLUMNAS), "categorias": list(CATEGORIAS), "semilla": semilla, "rondas": rondas,
        "reglas_version": cfg["version"], "metricas": metricas,
        "objetivos": {"exactitud_minima": OBJETIVO_EXACTITUD, "latencia_maxima_ms": 2500,
                      "falsos_negativos": "lo más cercano posible a 0 %"},
        "cumple_exactitud": bool(metricas["exactitud"] is not None and metricas["exactitud"] > OBJETIVO_EXACTITUD),
        "advertencias": _advertencias(etiquetas, metricas, minimo_filas),
        "limitaciones": LIMITACIONES,
    }
    salida = Path(directorio_salida)
    salida.mkdir(parents=True, exist_ok=True)
    modelo.save_model(str(salida / "modelo.json"))   # formato JSON de XGBoost: no ejecuta código al cargarse
    (salida / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    return meta


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Entrena y evalúa el modelo XGBoost de aptitud física")
    parser.add_argument("--datos", required=True, help="CSV con las columnas indicadas en ia/README.md")
    parser.add_argument("--salida", required=True, help="Carpeta donde se guardan modelo.json y meta.json")
    parser.add_argument("--prueba", type=float, default=0.2, help="Proporción de filas para evaluar (por defecto 0.2)")
    parser.add_argument("--semilla", type=int, default=42)
    parser.add_argument("--rondas", type=int, default=100)
    parser.add_argument("--permitir-pocos", action="store_true", help=f"Permite menos de {MINIMO_FILAS} filas (solo para probar el flujo)")
    args = parser.parse_args(argv)
    try:
        meta = entrenar_y_guardar(args.datos, args.salida, args.prueba, args.semilla, args.rondas, permitir_pocos=args.permitir_pocos)
    except DatasetInvalido as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    m = meta["metricas"]
    print(f"Modelo {meta['version']} guardado en {args.salida}")
    print(f"Exactitud en datos de prueba: {m['exactitud']:.1%} (objetivo > {OBJETIVO_EXACTITUD:.0%}: "
          f"{'se cumple' if meta['cumple_exactitud'] else 'NO se cumple'})")
    print(f"Falsos negativos (A1/A2 clasificados como aptos): {m['tasa_falsos_negativos']}")
    print(f"Derivaciones innecesarias: {m['tasa_derivaciones_innecesarias']}")
    for aviso in meta["advertencias"]:
        print(f"AVISO: {aviso}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
