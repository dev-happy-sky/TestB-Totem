"""Conexión BLE con el tensiómetro (bleak). Escucha SIEMPRE y se conecta en cuanto el aparato aparece.

El BM 54 solo es visible un par de segundos (después de medir y pulsar su botón): un escaneo periódico con pausas lo pierde. Por eso
el escáner queda encendido de forma continua y la conexión se intenta en el instante en que se ve al aparato, sin esperar a un ciclo.
No estar conectado es lo normal: el aparato duerme entre mediciones.

En el log solo se registran eventos (visto, conectado, suscrito, medición recibida), nunca los valores: son datos de salud.
"""
import asyncio
import datetime
import logging
import time
from typing import Awaitable, Callable, Optional

from puente.captura import Captura
from puente.protocolo import CARACTERISTICA_PRESION, parsear_medicion

logger = logging.getLogger("puente")

ESPERA_AVISTAMIENTO_S = 0.1       # cada cuánto se revisa si el aparato apareció (define la latencia de reacción)
PAUSA_TRAS_FALLO_S = 1.0          # mínimo entre dos intentos de conexión
REINTENTO_ESCANER_S = 3.0         # si el escáner no arranca (Bluetooth apagado)
ESPERA_CONEXION_S = 12.0          # tope para conectar o suscribirse: si el aparato se durmió, no se queda colgado casi un minuto
ESPERA_EMPAREJAR_S = 30.0
INTENTOS_SUSCRIPCION = 4            # intentos de suscribirse en una misma conexión
PAUSA_SUSCRIPCION_S = 0.6
ANTIGUEDAD_MAXIMA_S = 600.0       # una medición con fecha más vieja que esto es una almacenada, de otra persona o de otro día


def escaner_bleak(al_detectar):
    """Escáner real. `bleak` se importa aquí para poder probar el resto sin Bluetooth ni la librería."""
    from bleak import BleakScanner
    return BleakScanner(detection_callback=al_detectar)


def cliente_bleak(dispositivo, usar_cache: bool = True):
    """Cliente real. En Windows hay que pasarle el dispositivo que vio el escaneo (por dirección sola da "Device not found").
    Con el vínculo hecho, lo normal es usar la caché de servicios (así lo probó el BM 54 real); sin caché solo se pide el
    descubrimiento completo si la caché quedó sin el servicio de presión arterial (ver `LectorTensiometro._conectar`)."""
    from bleak import BleakClient
    if usar_cache:
        return BleakClient(dispositivo)
    try:
        return BleakClient(dispositivo, winrt={"use_cached_services": False})
    except TypeError:   # otros sistemas operativos no aceptan la opción de Windows
        return BleakClient(dispositivo)


class LectorTensiometro:
    def __init__(self, direccion: str, cliente_factory: Callable[[object], object] = cliente_bleak,
                 escaner_factory: Callable[[Callable], object] = escaner_bleak, emparejar: bool = False,
                 antiguedad_maxima_s: float = ANTIGUEDAD_MAXIMA_S, espera_conexion_s: float = ESPERA_CONEXION_S, ahora: Callable[[], datetime.datetime] = datetime.datetime.now,
                 reloj: Callable[[], float] = time.monotonic, dormir: Callable[[float], Awaitable] = asyncio.sleep):
        self.direccion = direccion
        self._factory = cliente_factory
        self._escaner_factory = escaner_factory
        self._emparejar = emparejar
        self._antiguedad_maxima_s = antiguedad_maxima_s
        self._espera_conexion_s = espera_conexion_s
        self._ahora = ahora
        self._reloj = reloj
        self._dormir = dormir
        self.captura = Captura(reloj)
        self._cliente: Optional[object] = None
        self._escaner: Optional[object] = None
        self._escuchando = False
        self._avistado: Optional[object] = None      # último dispositivo visto, pendiente de atender
        self._sin_cache = False                      # tras un «característica no encontrada», el próximo intento redescubre los servicios
        self._tarea: Optional[asyncio.Task] = None

    @property
    def activo(self) -> bool:
        """El puente está escuchando para conectarse al tensiómetro."""
        return self._tarea is not None and not self._tarea.done()

    @property
    def conectado(self) -> bool:
        return bool(self._cliente is not None and getattr(self._cliente, "is_connected", False))

    def _al_detectar(self, dispositivo, _anuncio=None):
        if str(getattr(dispositivo, "address", "")).upper() == self.direccion.upper():
            self._avistado = dispositivo

    def _es_antigua(self, fecha: Optional[datetime.datetime]) -> bool:
        if fecha is None or self._antiguedad_maxima_s <= 0:
            return False
        return abs((self._ahora() - fecha).total_seconds()) > self._antiguedad_maxima_s

    def _al_recibir(self, _emisor, datos: bytearray):
        muestra = parsear_medicion(bytes(datos))
        if muestra is None:
            logger.warning("Llegó una indicación que no es una medición de presión (%d bytes)", len(datos))
            return
        if self._es_antigua(muestra.fecha):
            logger.warning("Se ignoró una medición almacenada en el tensiómetro (fecha antigua)")
            return
        logger.warning("Medición recibida del tensiómetro (%s)", "válida" if muestra.valida else "inválida")
        self.captura.agregar(muestra)

    async def _iniciar_escaner(self) -> bool:
        escaner = self._escaner_factory(self._al_detectar)
        try:
            await escaner.start()
        except Exception as error:   # Bluetooth apagado o sin permiso
            logger.warning("No se pudo iniciar el escaneo Bluetooth: %s", error)
            return False
        self._escaner = escaner
        self._escuchando = True
        logger.warning("Escuchando al tensiómetro")
        return True

    async def _pausar_escaner(self):
        escaner, self._escaner, self._escuchando = self._escaner, None, False
        if escaner is not None:
            try:
                await escaner.stop()
            except Exception:
                pass

    async def _suscribir(self, cliente):
        """Suscribe a las mediciones. El aparato solo es visible un par de segundos, así que si Windows aún no listó el servicio de
        presión arterial se reintenta sobre la MISMA conexión en vez de esperar a que vuelva a aparecer."""
        for intento in range(INTENTOS_SUSCRIPCION):
            try:
                await asyncio.wait_for(cliente.start_notify(CARACTERISTICA_PRESION, self._al_recibir), self._espera_conexion_s)
                return
            except Exception as error:
                if intento == INTENTOS_SUSCRIPCION - 1 or not getattr(cliente, "is_connected", True):
                    raise
                logger.warning("Suscripción pendiente, se reintenta (%s)", error or type(error).__name__)
                await self._dormir(PAUSA_SUSCRIPCION_S)

    async def _conectar(self, dispositivo) -> bool:
        logger.warning("Tensiómetro visible: conectando")
        await self._pausar_escaner()   # en Windows, escanear mientras se conecta deja la lista de servicios sin la presión arterial
        sin_cache = self._sin_cache
        cliente = self._factory(dispositivo, usar_cache=False) if sin_cache else self._factory(dispositivo)
        try:
            await asyncio.wait_for(cliente.connect(), self._espera_conexion_s)
            logger.warning("Tensiómetro conectado")
            if self._emparejar:
                await asyncio.wait_for(cliente.pair(), ESPERA_EMPAREJAR_S)
            await self._suscribir(cliente)
        except Exception as error:   # incluye TimeoutError   # visible un par de segundos: puede cerrarse antes de terminar
            logger.warning("No se pudo completar la conexión con el tensiómetro: %s", error or type(error).__name__)
            # Caché de servicios incompleta: el próximo intento la renueva; si ya se renovó y sigue sin aparecer, se vuelve a la caché.
            self._sin_cache = "not found" in str(error).lower() and not sin_cache
            try:
                await cliente.disconnect()
            except Exception:
                pass
            return False
        self._sin_cache = False
        self._cliente = cliente
        logger.warning("Suscrito a las mediciones: pulsa Start y espera el resultado")
        return True

    async def _mantener_conexion(self):
        while True:
            try:
                if not self._escuchando:
                    if not await self._iniciar_escaner():
                        await self._dormir(REINTENTO_ESCANER_S)
                    continue
                if self.conectado:
                    self._avistado = None
                    await self._dormir(ESPERA_AVISTAMIENTO_S)
                    continue
                dispositivo, self._avistado = self._avistado, None
                if dispositivo is None:
                    await self._dormir(ESPERA_AVISTAMIENTO_S)
                    continue
                self._cliente = None
                if not await self._conectar(dispositivo):
                    await self._dormir(PAUSA_TRAS_FALLO_S)
            except asyncio.CancelledError:
                raise
            except Exception as error:   # nada debe matar el bucle: tiene que seguir escuchando siempre
                logger.warning("Error inesperado con el tensiómetro: %s", error)
                await self._dormir(PAUSA_TRAS_FALLO_S)

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
        for cierre in (self._cliente, self._escaner):
            if cierre is None:
                continue
            try:
                await (cierre.disconnect() if cierre is self._cliente else cierre.stop())
            except Exception:
                pass
        self._cliente = self._escaner = None
        self._escuchando = False
