"""API local que expone la báscula a la app del tótem.

Por defecto escucha solo en 127.0.0.1. Si se expone en la red, define PUENTE_TOKEN: la app debe enviarlo en
`X-Puente-Key`. El peso es un dato de salud: no se guarda en disco ni se escribe en el log.
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

# La báscula anuncia en ráfagas separadas por varios segundos, e intercala anuncios "vacíos" (00 00) aunque haya alguien
# encima: un peso sigue siendo "en vivo" este tiempo, y solo si no llega ninguno nuevo se da por vacía.
VIGENCIA_EN_VIVO_S = 20.0
VIGENCIA_PESO_S = 15.0

ESTADO_HTTP = {"desconectado": 503, "timeout": 504, "lectura_invalida": 422, "movimiento": 422, "error": 500}


def crear_app(escucha, token: Optional[str] = None, origenes: Optional[list] = None,
              timeout_s: float = TIMEOUT_POR_DEFECTO_S, reloj=None, dormir=None) -> FastAPI:
    reloj = reloj or escucha._reloj
    dormir = dormir or escucha._dormir
    bloqueo = asyncio.Lock()

    @asynccontextmanager
    async def ciclo(_app):
        await escucha.iniciar()
        yield
        await escucha.detener()

    app = FastAPI(title="Puente de la báscula", lifespan=ciclo)
    if origenes:
        app.add_middleware(CORSMiddleware, allow_origins=origenes, allow_methods=["GET", "POST"],
                           allow_headers=["Content-Type", "X-Puente-Key"])

    def verificar(x_puente_key: Optional[str] = Header(default=None)):
        if token and not (x_puente_key and hmac.compare_digest(x_puente_key, token)):
            raise HTTPException(status_code=401, detail="No autorizado")

    @app.get("/estado", dependencies=[Depends(verificar)])
    def estado():
        ultimo = escucha.captura.ultimo_anuncio
        return {
            "escuchando": escucha.escuchando, "dispositivo": escucha.direccion,
            "ultimo_anuncio_hace_s": None if ultimo is None else round(reloj() - ultimo, 1),
        }

    @app.get("/lectura", dependencies=[Depends(verificar)])
    def lectura():
        """Último peso que emitió la báscula, para mostrarlo en vivo. No es una medición: no se estabiliza ni se guarda."""
        vacia = {"valida": False, "peso_kg": None}
        if not escucha.escuchando:
            return {**vacia, "escuchando": False, "motivo": "desconectado"}
        ultima = escucha.captura.ultima()
        if ultima is None or reloj() - ultima[0] > VIGENCIA_EN_VIVO_S:
            return {**vacia, "escuchando": True, "motivo": "sin_senal"}
        con_peso = escucha.captura.ultima_valida()
        if con_peso is None or reloj() - con_peso[0] > VIGENCIA_PESO_S:
            return {**vacia, "escuchando": True, "motivo": "sin_carga"}
        return {"escuchando": True, "valida": True, "peso_kg": con_peso[1].peso_kg, "motivo": None}

    @app.post("/medir", dependencies=[Depends(verificar)])
    async def medir():
        if not escucha.escuchando:
            return _error(ErrorMedicion("desconectado", "No se puede escuchar la báscula. Revisa el Bluetooth del equipo."))
        if bloqueo.locked():
            return _error(ErrorMedicion("error", "Ya hay una medición en curso."), 409)
        async with bloqueo:
            try:
                medicion = await esperar_medicion(escucha.captura, reloj, dormir, timeout_s)
            except ErrorMedicion as error:
                return _error(error)
        return {
            "peso_kg": medicion.peso_kg, "muestras": medicion.muestras,
            "dispositivo": {"id": escucha.direccion, "calibracion": "desconocida"},
            "capturado_en": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

    return app


def _error(error: ErrorMedicion, estado: Optional[int] = None) -> JSONResponse:
    return JSONResponse(status_code=estado or ESTADO_HTTP.get(error.codigo, 500),
                        content={"codigo": error.codigo, "mensaje": error.mensaje})
