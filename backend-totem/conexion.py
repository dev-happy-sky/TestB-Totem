"""URL de conexión a PostgreSQL con el driver indicado de forma explícita.

SQLAlchemy 2.1 cambió el driver por defecto de `postgresql://` de psycopg2 a psycopg (versión 3). Este proyecto usa
psycopg2 (ver requirements.txt), así que se escribe en la URL: el resultado no depende de la versión de SQLAlchemy
que instale cada entorno (Render, Neon, tu PC).

Si prefieres psycopg 3 (también está en requirements.txt), escribe `postgresql+psycopg://` en DATABASE_URL: se respeta.
"""

DRIVER = "psycopg2"
PREFIJOS_POSTGRESQL = ("postgres://", "postgresql://")   # `postgres://` lo entregan Heroku/Render/Neon


def normalizar_url(url: str) -> str:
    """postgres:// y postgresql:// pasan a postgresql+psycopg2://; el resto (otro driver explícito, SQLite de pruebas) no cambia."""
    url = url.strip()
    for prefijo in PREFIJOS_POSTGRESQL:
        if url.startswith(prefijo):
            return f"postgresql+{DRIVER}://" + url[len(prefijo):]
    return url
