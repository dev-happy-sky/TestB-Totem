"""Punto de entrada de la inferencia: reglas siempre, y un modelo de ML entrenado si está configurado.

El modelo es opcional: se activa con la variable MODELO_IA_PATH (carpeta generada por `ia/entrenar.py`). Si no
está o no se puede cargar, el sistema sigue funcionando solo con las reglas: una evaluación nunca falla por el modelo.
"""
import logging
import os
from typing import Optional

from motor_aptitud import Entrada, Resultado, evaluar, fusionar_prediccion

logger = logging.getLogger("totem")

_predictor = None
_predictor_cargado = False


def obtener_predictor():
    """Carga el modelo una sola vez. Devuelve None si no hay modelo configurado o falla su carga."""
    global _predictor, _predictor_cargado
    if _predictor_cargado:
        return _predictor
    _predictor_cargado = True
    ruta = os.getenv("MODELO_IA_PATH")
    if not ruta:
        return None
    try:
        from ia.modelo import cargar_predictor
        _predictor = cargar_predictor(ruta)
        logger.warning("Modelo de IA cargado: %s", _predictor.version)
    except Exception as error:  # el modelo es opcional: se registra el problema y se usan solo las reglas
        logger.error("No se pudo cargar el modelo de IA (%s): se usan solo las reglas", error)
        _predictor = None
    return _predictor


def evaluar_entrada(entrada: Entrada, cfg: dict, predictor: Optional[object] = None) -> Resultado:
    """Reglas + (opcional) modelo. `predictor` permite inyectar uno en pruebas."""
    resultado = evaluar(entrada, cfg)
    predictor = predictor or obtener_predictor()
    if predictor is None:
        return resultado
    try:
        categoria, probabilidad = predictor.predecir(entrada)
    except Exception as error:
        logger.error("Falló la predicción del modelo de IA (%s): se usan solo las reglas", error)
        return resultado
    return fusionar_prediccion(resultado, cfg, categoria, probabilidad, predictor.version)
