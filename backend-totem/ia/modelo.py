"""Carga de un modelo XGBoost entrenado con `ia/entrenar.py` y predicción para una evaluación."""
import json
from pathlib import Path

import numpy as np
import xgboost as xgb

from ia.caracteristicas import CATEGORIAS, COLUMNAS, vectorizar
from motor_aptitud import Entrada, cargar_configuracion


class ModeloInvalido(Exception):
    pass


class Predictor:
    def __init__(self, booster, meta: dict, cfg: dict):
        self._booster = booster
        self._cfg = cfg
        self.meta = meta
        self.version = meta["version"]

    def predecir(self, entrada: Entrada):
        """Devuelve (categoría, probabilidad de esa categoría)."""
        vector = np.array([vectorizar(entrada, self._cfg)], dtype=float)
        datos = xgb.DMatrix(vector, feature_names=list(COLUMNAS), missing=np.nan)
        probabilidades = self._booster.predict(datos)[0]
        indice = int(np.argmax(probabilidades))
        return CATEGORIAS[indice], float(probabilidades[indice])


def cargar_predictor(directorio, cfg=None) -> Predictor:
    carpeta = Path(directorio)
    try:
        meta = json.loads((carpeta / "meta.json").read_text(encoding="utf-8"))
        booster = xgb.Booster()
        booster.load_model(str(carpeta / "modelo.json"))
    except (OSError, ValueError, xgb.core.XGBoostError) as error:
        raise ModeloInvalido(f"No se pudo cargar el modelo de {carpeta}: {error}") from error
    if meta.get("columnas") != list(COLUMNAS) or meta.get("categorias") != list(CATEGORIAS):
        raise ModeloInvalido("El modelo se entrenó con otras columnas o categorías: hay que reentrenarlo")
    return Predictor(booster, meta, cfg or cargar_configuracion())
