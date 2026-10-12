"""Migración aditiva mínima (no hay Alembic): agrega a tablas ya existentes las columnas nuevas del modelo.

Solo agrega columnas nullable o con valor por defecto; nunca borra ni modifica columnas existentes.
Solo corre en PostgreSQL (en pruebas con SQLite las tablas se crean desde cero).
"""
import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from models import Base

logger = logging.getLogger("totem")


def agregar_columnas_faltantes(engine: Engine) -> list:
    if engine.dialect.name != "postgresql":
        return []
    agregadas = []
    insp = inspect(engine)
    existentes = set(insp.get_table_names())
    with engine.begin() as conn:
        for tabla in Base.metadata.sorted_tables:
            if tabla.name not in existentes:
                continue  # create_all la crea completa
            actuales = {c["name"] for c in insp.get_columns(tabla.name)}
            for col in tabla.columns:
                if col.name in actuales:
                    continue
                if not col.nullable and col.default is None and col.server_default is None:
                    raise RuntimeError(f"{tabla.name}.{col.name} es NOT NULL sin valor por defecto: requiere migración manual")
                ddl = f'ALTER TABLE "{tabla.name}" ADD COLUMN IF NOT EXISTS "{col.name}" {col.type.compile(engine.dialect)}'
                for fk in col.foreign_keys:
                    ddl += f' REFERENCES "{fk.column.table.name}"("{fk.column.name}")'
                conn.execute(text(ddl))
                agregadas.append(f"{tabla.name}.{col.name}")
    if agregadas:
        logger.warning("Columnas agregadas: %s", ", ".join(agregadas))
    return agregadas
