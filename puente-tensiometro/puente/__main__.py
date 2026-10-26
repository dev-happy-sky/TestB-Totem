"""python -m puente  (variables: TENSIOMETRO_ID, PUENTE_HOST, PUENTE_PORT, PUENTE_TOKEN, PUENTE_ORIGENES, PUENTE_TIMEOUT_S,
PUENTE_EMPAREJAR, PUENTE_ANTIGUEDAD_MAX_MIN)"""
import logging
import os
import sys

import uvicorn

from puente.lector import LectorTensiometro
from puente.servidor import crear_app


def _verdadero(valor: str) -> bool:
    return valor.strip().lower() in ("1", "true", "si", "sí", "yes", "on")


def main() -> int:
    direccion = os.getenv("TENSIOMETRO_ID")
    if not direccion:
        print("Error: define TENSIOMETRO_ID con la dirección (MAC) del tensiómetro.", file=sys.stderr)
        return 1
    host = os.getenv("PUENTE_HOST", "127.0.0.1")
    token = os.getenv("PUENTE_TOKEN")
    if host not in ("127.0.0.1", "localhost", "::1") and not token:
        print("Error: si el puente escucha fuera de localhost, define PUENTE_TOKEN.", file=sys.stderr)
        return 1
    # Con marcas de hora: la conexión con el tensiómetro dura un par de segundos y el log es la forma de ver en qué paso se corta.
    logging.basicConfig(level=os.getenv("PUENTE_LOG", "WARNING").upper(), format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    origenes = [o.strip() for o in os.getenv("PUENTE_ORIGENES", "").split(",") if o.strip()]
    lector = LectorTensiometro(
        direccion, emparejar=_verdadero(os.getenv("PUENTE_EMPAREJAR", "")),
        antiguedad_maxima_s=float(os.getenv("PUENTE_ANTIGUEDAD_MAX_MIN", "3")) * 60,
    )
    app = crear_app(lector, token=token, origenes=origenes or None, timeout_s=float(os.getenv("PUENTE_TIMEOUT_S", "120")))
    uvicorn.run(app, host=host, port=int(os.getenv("PUENTE_PORT", "8767")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
