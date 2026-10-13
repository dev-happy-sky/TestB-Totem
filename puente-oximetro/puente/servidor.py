"""API local que expone el oxímetro a la app del tótem.

Por defecto escucha solo en 127.0.0.1. Si se expone en la red, define PUENTE_TOKEN: la app debe enviarlo en
`X-Puente-Key`. Las mediciones son datos de salud: no se guardan en disco ni se escriben en el log.
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

    app = FastAPI(title="Puente del oxímetro", lifespan=ciclo)
    if origenes:
        app.add_middleware(CORSMiddleware, allow_origins=origenes, allow_methods=["GET", "POST"],
                           allow_headers=["Content-Type", "X-Puente-Key"])

    def verificar(x_puente_key: Optional[str] = Header(default=None)):
        if token and not (x_puente_key and hmac.compare_digest(x_puente_key, token)):
            raise HTTPException(status_code=401, detail="No autorizado")

    @app.get("/estado", dependencies=[Depends(verificar)])
    def estado():
        ultimo = lector.captura.ultimo_paquete
        return {
            "conectado": lector.conectado, "dispositivo": lector.direccion,
            "ultimo_paquete_hace_s": None if ultimo is None else round(reloj() - ultimo, 1),
        }

    @app.post("/medir", dependencies=[Depends(verificar)])
    async def medir():
        if not lector.conectado:
            return _error(ErrorMedicion("desconectado", "El oxímetro no está conectado. Enciéndelo y acércalo al tótem."))
        if bloqueo.locked():
            return _error(ErrorMedicion("error", "Ya hay una medición en curso."), 409)
        async with bloqueo:
            try:
                medicion = await esperar_medicion(lector.captura, reloj, dormir, timeout_s)
            except ErrorMedicion as error:
                return _error(error)
        return {
            "spo2": medicion.spo2, "fc": medicion.fc, "indice_perfusion": medicion.indice_perfusion,
            "muestras": medicion.muestras,
            "dispositivo": {"id": lector.direccion, "calibracion": "desconocida"},
            "capturado_en": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    return app


def _error(error: ErrorMedicion, estado: Optional[int] = None) -> JSONResponse:
    return JSONResponse(status_code=estado or ESTADO_HTTP.get(error.codigo, 500),
                        content={"codigo": error.codigo, "mensaje": error.mensaje})
