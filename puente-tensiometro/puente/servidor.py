"""API local que expone el tensiómetro a la app del tótem.

Por defecto escucha solo en 127.0.0.1. Si se expone en la red, define PUENTE_TOKEN: la app debe enviarlo en
`X-Puente-Key`. La medición es un dato de salud: no se guarda en disco ni se escribe en el log.
"""
import asyncio
import datetime
import hmac
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from puente.captura import ErrorMedicion, TIMEOUT_POR_DEFECTO_S, esperar_medicion

ESTADO_HTTP = {"desconectado": 503, "timeout": 504, "lectura_invalida": 422, "movimiento": 422, "error": 500}


def crear_app(lector, token: Optional[str] = None, origenes: Optional[list] = None,
              timeout_s: float = TIMEOUT_POR_DEFECTO_S, reloj=None, dormir=None) -> FastAPI:
    reloj = reloj or lector._reloj
    dormir = dormir or lector._dormir
    bloqueo = asyncio.Lock()

    @asynccontextmanager
    async def ciclo(_app):
        await lector.iniciar()
        yield
        await lector.detener()

    app = FastAPI(title="Puente del tensiómetro", lifespan=ciclo)
    if origenes:
        app.add_middleware(CORSMiddleware, allow_origins=origenes, allow_methods=["GET", "POST"],
                           allow_headers=["Content-Type", "X-Puente-Key"])

    def verificar(x_puente_key: Optional[str] = Header(default=None)):
        if token and not (x_puente_key and hmac.compare_digest(x_puente_key, token)):
            raise HTTPException(status_code=401, detail="No autorizado")

    @app.get("/estado", dependencies=[Depends(verificar)])
    def estado():
        ultima = lector.captura.ultima_medicion
        return {
            "activo": lector.activo, "conectado": lector.conectado, "dispositivo": lector.direccion,
            "ultima_medicion_hace_s": None if ultima is None else round(reloj() - ultima, 1),
        }

    @app.post("/medir", dependencies=[Depends(verificar)])
    async def medir():
        """Espera la próxima medición que entregue el tensiómetro (la persona pulsa Start en el brazalete)."""
        if not lector.activo:
            return _error(ErrorMedicion("desconectado", "El puente del tensiómetro no está activo. Revisa el Bluetooth del equipo."))
        if bloqueo.locked():
            return _error(ErrorMedicion("error", "Ya hay una medición en curso."), 409)
        async with bloqueo:
            try:
                medicion = await esperar_medicion(lector.captura, reloj, dormir, timeout_s)
            except ErrorMedicion as error:
                return _error(error)
        return {
            "sistolica": medicion.sistolica, "diastolica": medicion.diastolica, "pulso": medicion.pulso,
            "dispositivo": {"id": lector.direccion, "calibracion": "desconocida"},
            "capturado_en": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    return app


def _error(error: ErrorMedicion, estado: Optional[int] = None) -> JSONResponse:
    return JSONResponse(status_code=estado or ESTADO_HTTP.get(error.codigo, 500),
                        content={"codigo": error.codigo, "mensaje": error.mensaje})
