"""Convierte los anuncios de la báscula en UNA medición de peso estable (o en un error claro).

No se guarda nada en disco: el peso es un dato de salud y vive solo en memoria hasta que la app lo recoge.
"""
import statistics
from collections import deque
from dataclasses import dataclass
from typing import Callable, Optional

from puente.protocolo import Muestra

# Parámetros provisionales: la báscula anuncia en ráfagas de 1-2 paquetes cada varios segundos, por eso se piden pocas muestras.
MUESTRAS_ESTABLES = 2       # muestras válidas consecutivas que se necesitan
TOLERANCIA_KG = 0.1         # variación máxima entre esas muestras
TIMEOUT_POR_DEFECTO_S = 30.0
MAXIMO_RETENIDO = 100


class ErrorMedicion(Exception):
    """Falla de una medición. `codigo` coincide con los códigos que entiende la app del tótem."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo, self.mensaje = codigo, mensaje


@dataclass(frozen=True)
class Medicion:
    peso_kg: float
    muestras: int


class Captura:
    """Guarda las muestras recientes con su instante de llegada."""

    def __init__(self, reloj: Callable[[], float]):
        self._reloj = reloj
        self._muestras: deque = deque(maxlen=MAXIMO_RETENIDO)
        self.ultimo_anuncio: Optional[float] = None

    def agregar(self, muestra: Muestra):
        ahora = self._reloj()
        self.ultimo_anuncio = ahora
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
    if len(ultimas) < MUESTRAS_ESTABLES:
        return None
    pesos = [m.peso_kg for m in ultimas]
    if max(pesos) - min(pesos) > TOLERANCIA_KG:
        return None
    return Medicion(peso_kg=round(statistics.median(pesos), 1), muestras=len(ultimas))


def explicar_fallo(muestras: list) -> ErrorMedicion:
    """Por qué no se pudo medir, según lo que llegó durante la espera."""
    if not muestras:
        return ErrorMedicion("timeout", "No se detecta la báscula. Súbete descalzo y espera a que el peso se fije.")
    validas = [m for _, m in muestras if m.valida]
    if not validas:
        return ErrorMedicion("lectura_invalida", "No se detecta peso. Súbete a la báscula y quédate quieto.")
    if len(validas) < MUESTRAS_ESTABLES:
        return ErrorMedicion("lectura_invalida", "Lectura incompleta. Quédate quieto sobre la báscula.")
    return ErrorMedicion("movimiento", "El peso no se estabilizó. Quédate quieto sobre la báscula.")


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
