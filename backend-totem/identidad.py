"""Reglas puras de identificación de socios (sin base de datos ni FastAPI).

El gimnasio es universitario: el identificador es la matrícula. El formato exacto se puede ajustar con la
variable de entorno MATRICULA_REGEX (se aplica sobre la matrícula ya normalizada).
"""
import os
import re
import unicodedata

PATRON_MATRICULA = re.compile(os.getenv("MATRICULA_REGEX", r"^[A-Z0-9]{6,15}$"))
MENSAJE_MATRICULA = "Matrícula inválida: usa entre 6 y 15 letras o números"


def normalizar_matricula(valor) -> str:
    """Quita espacios, puntos y guiones y pasa a mayúsculas: '20.231-234 a' == '20231234A'."""
    return re.sub(r"[\s.\-]", "", valor or "").upper()


def matricula_valida(valor) -> bool:
    return bool(PATRON_MATRICULA.match(normalizar_matricula(valor)))


def normalizar_nombre(nombre) -> str:
    """Para comparar nombres: sin tildes, en minúsculas y con espacios simples."""
    sin_tildes = "".join(c for c in unicodedata.normalize("NFD", nombre or "") if unicodedata.category(c) != "Mn")
    return " ".join(sin_tildes.casefold().split())


def enmascarar_matricula(matricula: str) -> str:
    """Deja visibles solo los últimos 3 caracteres, para no exponer la matrícula de otra persona."""
    if len(matricula) <= 3:
        return "*" * len(matricula)
    return "*" * (len(matricula) - 3) + matricula[-3:]


def partir_nombre(nombre_completo: str):
    """'Ana Pérez Soto' -> ('Ana', 'Pérez Soto')."""
    partes = (nombre_completo or "").strip().split(" ", 1)
    return partes[0], (partes[1].strip() if len(partes) > 1 else "")
