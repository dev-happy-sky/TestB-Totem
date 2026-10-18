"""Conexión BLE con el tensiómetro (bleak). Intenta conectarse siempre y recibe cada medición que el aparato entrega.

El tensiómetro se "duerme": solo acepta conexión un rato después de medir. Por eso no estar conectado es lo normal y el bucle
sigue intentando para recoger la medición cuando el aparato la ofrece.
"""
import asyncio
import datetime
import logging
import time
from typing import Awaitable, Callable, Optional

from puente.captura import Captura
from puente.protocolo import CARACTERISTICA_PRESION, parsear_medicion

logger = logging.getLogger("puente")

REINTENTO_CONEXION_S = 3.0
ANTIGUEDAD_MAXIMA_S = 600.0    # una medición con fecha más vieja que esto es una almacenada, de otra persona o de otro día


def cliente_bleak(direccion: str):
    """Cliente real. `bleak` se importa aquí para poder probar el resto sin Bluetooth ni la librería."""
    from bleak import BleakClient
    return BleakClient(direccion)


class LectorTensiometro:
    def __init__(self, direccion: str, cliente_factory: Callable[[str], object] = cliente_bleak, emparejar: bool = False,
                 antiguedad_maxima_s: float = ANTIGUEDAD_MAXIMA_S, ahora: Callable[[], datetime.datetime] = datetime.datetime.now,
                 reloj: Callable[[], float] = time.monotonic, dormir: Callable[[float], Awaitable] = asyncio.sleep):
        self.direccion = direccion
        self._factory = cliente_factory
        self._emparejar = emparejar
        self._antiguedad_maxima_s = antiguedad_maxima_s
        self._ahora = ahora
        self._reloj = reloj
        self._dormir = dormir
        self.captura = Captura(reloj)
        self._cliente: Optional[object] = None
        self._tarea: Optional[asyncio.Task] = None

    @property
    def activo(self) -> bool:
        """El puente está intentando conectarse al tensiómetro."""
        return self._tarea is not None and not self._tarea.done()

    @property
    def conectado(self) -> bool:
        return bool(self._cliente is not None and getattr(self._cliente, "is_connected", False))

    def _es_antigua(self, fecha: Optional[datetime.datetime]) -> bool:
        if fecha is None or self._antiguedad_maxima_s <= 0:
            return False
        return abs((self._ahora() - fecha).total_seconds()) > self._antiguedad_maxima_s

    def _al_recibir(self, _emisor, datos: bytearray):
        muestra = parsear_medicion(bytes(datos))
        if muestra is None:
            return
        if self._es_antigua(muestra.fecha):
            logger.warning("Se ignoró una medición almacenada en el tensiómetro (fecha antigua)")
            return
        self.captura.agregar(muestra)

    async def _conectar_una_vez(self) -> bool:
        cliente = self._factory(self.direccion)
        try:
            await cliente.connect()
            if self._emparejar:
                await cliente.pair()
            await cliente.start_notify(CARACTERISTICA_PRESION, self._al_recibir)
        except Exception as error:   # el tensiómetro duerme: lo normal es no poder conectar
            logger.info("No se pudo conectar con el tensiómetro: %s", error)
            try:
                await cliente.disconnect()
            except Exception:
                pass
            return False
        self._cliente = cliente
        logger.warning("Tensiómetro conectado")
        return True

    async def _mantener_conexion(self):
        while True:
            try:
                if not self.conectado:
                    self._cliente = None
                    await self._conectar_una_vez()
            except asyncio.CancelledError:
                raise
            except Exception as error:   # nada debe matar el bucle: tiene que seguir intentando siempre
                logger.warning("Error inesperado al conectar con el tensiómetro: %s", error)
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
