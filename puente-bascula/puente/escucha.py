"""Escucha los anuncios Bluetooth de la báscula (bleak). No se conecta: solo lee lo que la báscula emite.

La báscula se "duerme" y solo anuncia cuando alguien se sube, así que no verla no es un fallo: el escáner sigue activo
y la medición espera a que aparezca.
"""
import asyncio
import logging
import time
from typing import Awaitable, Callable, Optional

from puente.captura import Captura
from puente.protocolo import parsear_anuncio

logger = logging.getLogger("puente")

REINTENTO_ESCANEO_S = 3.0


def escaner_bleak(al_detectar):
    """Escáner real. `bleak` se importa aquí para poder probar el resto sin Bluetooth ni la librería."""
    from bleak import BleakScanner
    return BleakScanner(detection_callback=al_detectar)


class EscuchaBascula:
    def __init__(self, direccion: str, escaner_factory: Callable = escaner_bleak,
                 reloj: Callable[[], float] = time.monotonic, dormir: Callable[[float], Awaitable] = asyncio.sleep):
        self.direccion = direccion
        self._factory = escaner_factory
        self._reloj = reloj
        self._dormir = dormir
        self.captura = Captura(reloj)
        self._escaner: Optional[object] = None
        self._escuchando = False
        self._tarea: Optional[asyncio.Task] = None

    @property
    def escuchando(self) -> bool:
        return self._escuchando

    def _al_detectar(self, dispositivo, anuncio):
        if str(getattr(dispositivo, "address", "")).upper() != self.direccion.upper():
            return
        muestra = parsear_anuncio(getattr(anuncio, "manufacturer_data", {}) or {}, self.direccion)
        if muestra is not None:
            self.captura.agregar(muestra)

    async def _empezar_a_escuchar(self) -> bool:
        escaner = self._factory(self._al_detectar)
        try:
            await escaner.start()
        except Exception as error:   # Bluetooth apagado o sin permiso
            logger.warning("No se pudo iniciar el escaneo Bluetooth: %s", error)
            return False
        self._escaner = escaner
        self._escuchando = True
        logger.warning("Escuchando la báscula")
        return True

    async def _mantener_escucha(self):
        while True:
            try:
                if not self._escuchando:
                    await self._empezar_a_escuchar()
            except asyncio.CancelledError:
                raise
            except Exception as error:   # nada debe matar el bucle: tiene que seguir intentando siempre
                logger.warning("Error inesperado al escuchar la báscula: %s", error)
            await self._dormir(REINTENTO_ESCANEO_S)

    async def iniciar(self):
        if self._tarea is None:
            self._tarea = asyncio.create_task(self._mantener_escucha())

    async def detener(self):
        if self._tarea is not None:
            self._tarea.cancel()
            try:
                await self._tarea
            except asyncio.CancelledError:
                pass
            self._tarea = None
        if self._escaner is not None:
            try:
                await self._escaner.stop()
            except Exception:
                pass
            self._escaner = None
        self._escuchando = False
