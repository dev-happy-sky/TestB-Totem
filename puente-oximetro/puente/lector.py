"""Conexión BLE con el oxímetro (bleak). Mantiene la conexión, se reconecta y alimenta a `Captura`."""
import asyncio
import logging
import time
from typing import Awaitable, Callable, Optional

from puente.captura import Captura
from puente.protocolo import NOTIFY_UUID, parsear_paquete

logger = logging.getLogger("puente")

REINTENTO_CONEXION_S = 3.0


def cliente_bleak(direccion: str):
    """Cliente real. `bleak` se importa aquí para poder probar el resto sin Bluetooth ni la librería."""
    from bleak import BleakClient
    return BleakClient(direccion)


class LectorOximetro:
    def __init__(self, direccion: str, cliente_factory: Callable[[str], object] = cliente_bleak,
                 reloj: Callable[[], float] = time.monotonic, dormir: Callable[[float], Awaitable] = asyncio.sleep):
        self.direccion = direccion
        self._factory = cliente_factory
        self._reloj = reloj
        self._dormir = dormir
        self.captura = Captura(reloj)
        self._cliente: Optional[object] = None
        self._tarea: Optional[asyncio.Task] = None

    @property
    def conectado(self) -> bool:
        return bool(self._cliente is not None and getattr(self._cliente, "is_connected", False))

    def _al_recibir(self, _emisor, datos: bytearray):
        muestra = parsear_paquete(bytes(datos))
        if muestra is not None:
            self.captura.agregar(muestra)

    async def _conectar_una_vez(self) -> bool:
        cliente = self._factory(self.direccion)
        try:
            await cliente.connect()
            await cliente.start_notify(NOTIFY_UUID, self._al_recibir)
        except Exception as error:  # el dispositivo puede estar apagado o fuera de alcance
            logger.warning("No se pudo conectar con el oxímetro: %s", error)
            try:
                await cliente.disconnect()
            except Exception:
                pass
            return False
        self._cliente = cliente
        logger.warning("Oxímetro conectado")
        return True

    async def _mantener_conexion(self):
        while True:
            try:
                if not self.conectado:
                    self.captura.limpiar()
                    self._cliente = None
                    await self._conectar_una_vez()
            except asyncio.CancelledError:
                raise
            except Exception as error:   # nada debe matar el bucle: el puente tiene que seguir intentando siempre
                logger.warning("Error inesperado al conectar con el oxímetro: %s", error)
            await self._dormir(REINTENTO_CONEXION_S)

    async def iniciar(self):
        if self._tarea is None:
            self._tarea = asyncio.create_task(self._mantener_conexion())

    async def detener(self):
        if self._tarea is not None:
            self._tarea.cancel()
            try:
                await self._tarea
            except asyncio.CancelledError:
                pass
            self._tarea = None
        if self._cliente is not None:
            try:
                await self._cliente.disconnect()
            except Exception:
                pass
            self._cliente = None
