"""python -m puente  (variables: BASCULA_ID, PUENTE_HOST, PUENTE_PORT, PUENTE_TOKEN, PUENTE_ORIGENES, PUENTE_TIMEOUT_S)"""
import os
import sys

import uvicorn

from puente.escucha import EscuchaBascula
from puente.servidor import crear_app


def main() -> int:
    direccion = os.getenv("BASCULA_ID")
    if not direccion:
        print("Error: define BASCULA_ID con la dirección (MAC) de la báscula.", file=sys.stderr)
        return 1
    host = os.getenv("PUENTE_HOST", "127.0.0.1")
    token = os.getenv("PUENTE_TOKEN")
    if host not in ("127.0.0.1", "localhost", "::1") and not token:
        print("Error: si el puente escucha fuera de localhost, define PUENTE_TOKEN.", file=sys.stderr)
        return 1
    origenes = [o.strip() for o in os.getenv("PUENTE_ORIGENES", "").split(",") if o.strip()]
    app = crear_app(EscuchaBascula(direccion), token=token, origenes=origenes or None,
                    timeout_s=float(os.getenv("PUENTE_TIMEOUT_S", "30")))
    uvicorn.run(app, host=host, port=int(os.getenv("PUENTE_PORT", "8766")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
