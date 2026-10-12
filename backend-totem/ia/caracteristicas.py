"""Características del modelo de ML y lectura del dataset CSV. Sin dependencias de FastAPI ni de la base de datos."""
import csv
import math
from typing import Optional

from motor_aptitud import Entrada

CATEGORIAS = ("A1", "A2", "A3", "A4")

# Orden fijo de las columnas del modelo. Si cambia, hay que reentrenar: el predictor lo verifica al cargar.
COLUMNAS = (
    "presion_sistolica", "presion_diastolica", "fc_reposo", "fc_recuperacion", "imc",
    "n_sintomas", "n_sintomas_criticos", "n_condiciones", "n_condiciones_criticas", "tiene_lesiones",
)

COLUMNAS_CSV = ("presion_sistolica", "presion_diastolica", "fc_reposo", "fc_recuperacion", "imc",
                "sintomas", "condiciones", "lesiones_previas", "categoria")


class DatasetInvalido(Exception):
    pass


def vectorizar(entrada: Entrada, cfg: dict) -> list:
    """Vector de características de una evaluación. Lo que falta es NaN: XGBoost lo maneja de forma nativa."""
    def numero(valor):
        return float("nan") if valor is None else float(valor)

    criticos = cfg["cuestionario"]
    return [
        numero(entrada.presion_sistolica), numero(entrada.presion_diastolica), numero(entrada.fc_reposo),
        numero(entrada.fc_recuperacion), numero(entrada.imc),
        float(len(entrada.sintomas)), float(sum(s in criticos["sintomas_criticos"] for s in entrada.sintomas)),
        float(len(entrada.condiciones)), float(sum(c in criticos["condiciones_criticas"] for c in entrada.condiciones)),
        1.0 if (entrada.lesiones_previas or "").strip() else 0.0,
    ]


def _numero_csv(valor: str, columna: str, linea: int) -> Optional[float]:
    valor = (valor or "").strip()
    if valor == "":
        return None
    try:
        numero = float(valor)
    except ValueError as error:
        raise DatasetInvalido(f"Línea {linea}: '{columna}' no es un número: {valor!r}") from error
    if math.isnan(numero) or math.isinf(numero):
        raise DatasetInvalido(f"Línea {linea}: '{columna}' no es un número válido")
    return numero


def _lista(valor: str) -> tuple:
    return tuple(p.strip() for p in (valor or "").split(";") if p.strip())


def leer_dataset(ruta, cfg: dict):
    """Lee un CSV con las columnas de COLUMNAS_CSV. `categoria` es la etiqueta A1–A4 puesta por un profesional.

    Devuelve (matriz de características, lista de etiquetas). Un dato mal formado se informa con su línea.
    """
    filas, etiquetas = [], []
    try:
        with open(ruta, newline="", encoding="utf-8-sig") as archivo:
            lector = csv.DictReader(archivo)
            faltan = [c for c in COLUMNAS_CSV if c not in (lector.fieldnames or [])]
            if faltan:
                raise DatasetInvalido(f"Faltan columnas en el CSV: {', '.join(faltan)}")
            for linea, fila in enumerate(lector, start=2):
                categoria = (fila["categoria"] or "").strip().upper()
                if categoria not in CATEGORIAS:
                    raise DatasetInvalido(f"Línea {linea}: la categoría debe ser una de {', '.join(CATEGORIAS)} (llegó {categoria!r})")
                entrada = Entrada(
                    sintomas=_lista(fila["sintomas"]), condiciones=_lista(fila["condiciones"]),
                    lesiones_previas=(fila["lesiones_previas"] or "").strip() or None,
                    presion_sistolica=_numero_csv(fila["presion_sistolica"], "presion_sistolica", linea),
                    presion_diastolica=_numero_csv(fila["presion_diastolica"], "presion_diastolica", linea),
                    fc_reposo=_numero_csv(fila["fc_reposo"], "fc_reposo", linea),
                    fc_recuperacion=_numero_csv(fila["fc_recuperacion"], "fc_recuperacion", linea),
                    imc=_numero_csv(fila["imc"], "imc", linea),
                )
                filas.append(vectorizar(entrada, cfg))
                etiquetas.append(categoria)
    except OSError as error:
        raise DatasetInvalido(f"No se pudo leer el dataset: {error}") from error
    if not filas:
        raise DatasetInvalido("El dataset no tiene filas")
    return filas, etiquetas
