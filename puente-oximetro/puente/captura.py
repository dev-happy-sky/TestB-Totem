"""Convierte el flujo continuo de muestras del oxímetro en UNA medición estable (o en un error claro).

El script original guardaba cada muestra en un CSV; aquí no se persiste nada (son datos de salud): la medición
vive en memoria y solo se entrega a la app del tótem.
"""
import statistics
from collections import deque
from dataclasses import dataclass
from typing import Callable, Optional

from puente.protocolo import Muestra

# Parámetros provisionales de estabilidad: se ajustan con mediciones reales del dispositivo.
MUESTRAS_ESTABLES = 5       # muestras válidas consecutivas que se necesitan
TOLERANCIA_SPO2 = 2         # variación máxima (puntos de %) entre esas muestras
TOLERANCIA_FC = 5           # variación máxima (lpm) entre esas muestras
TIMEOUT_POR_DEFECTO_S = 60.0
MAXIMO_RETENIDO = 200       # muestras en memoria


class ErrorMedicion(Exception):
    """Falla de una medición. `codigo` coincide con los códigos que entiende la app del tótem."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo, self.mensaje = codigo, mensaje


@dataclass(frozen=True)
class Medicion:
    spo2: int
    fc: int
    indice_perfusion: float
    muestras: int


class Captura:
    """Guarda las muestras recientes con su instante de llegada."""

    def __init__(self, reloj: Callable[[], float]):
        self._reloj = reloj
        self._muestras: deque = deque(maxlen=MAXIMO_RETENIDO)
        self.ultimo_paquete: Optional[float] = None

    def agregar(self, muestra: Muestra):
        ahora = self._reloj()
        self.ultimo_paquete = ahora
        self._muestras.append((ahora, muestra))

    def ultima(self) -> Optional[tuple]:
        """(instante, muestra) de lo último que llegó, sea válido o no; None si aún no llegó nada."""
        return self._muestras[-1] if self._muestras else None

    def desde(self, instante: float) -> list:
        return [(t, m) for t, m in self._muestras if t >= instante]

    def limpiar(self):
        self._muestras.clear()


def consolidar(muestras: list) -> Optional[Medicion]:
    """Mediana de las últimas MUESTRAS_ESTABLES muestras válidas si son estables; None si aún no hay suficientes."""
    validas = [m for _, m in muestras if m.valida]
    ultimas = validas[-MUESTRAS_ESTABLES:]
    if len(ultimas) < MUESTRAS_ESTABLES or not _estables(ultimas):
        return None
    return Medicion(
        spo2=round(statistics.median(m.spo2 for m in ultimas)), fc=round(statistics.median(m.fc for m in ultimas)),
        indice_perfusion=round(statistics.mean(m.indice_perfusion for m in ultimas), 1), muestras=len(ultimas),
    )


def _estables(muestras: list) -> bool:
    spo2 = [m.spo2 for m in muestras]
    fc = [m.fc for m in muestras]
    return max(spo2) - min(spo2) <= TOLERANCIA_SPO2 and max(fc) - min(fc) <= TOLERANCIA_FC


def explicar_fallo(muestras: list) -> ErrorMedicion:
    """Por qué no se pudo medir, según lo que llegó durante la espera."""
    if not muestras:
        return ErrorMedicion("timeout", "El oxímetro no está enviando datos. Revisa que esté encendido.")
    validas = [m for _, m in muestras if m.valida]
    if not validas:
        return ErrorMedicion("lectura_invalida", "No se detecta el dedo. Colócalo bien en el oxímetro.")
    if len(validas) < MUESTRAS_ESTABLES:
        return ErrorMedicion("lectura_invalida", "Lectura incompleta. Mantén el dedo quieto en el oxímetro.")
    return ErrorMedicion("movimiento", "La lectura no se estabilizó. Mantén la mano quieta durante la medición.")


async def esperar_medicion(captura: Captura, reloj: Callable[[], float], dormir, timeout_s: float = TIMEOUT_POR_DEFECTO_S,
                           paso_s: float = 0.25) -> Medicion:
    """Espera hasta `timeout_s` una medición estable, usando solo muestras posteriores al inicio de la espera."""
    inicio = reloj()
    while True:
        muestras = captura.desde(inicio)
        medicion = consolidar(muestras)
        if medicion:
            return medicion
        if reloj() - inicio >= timeout_s:
            raise explicar_fallo(muestras)
        await dormir(paso_s)
