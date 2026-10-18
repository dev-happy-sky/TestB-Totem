"""Guarda las mediciones del tensiómetro recién recibidas y espera la siguiente.

A diferencia del oxímetro y la báscula, el tensiómetro mide UNA vez y la entrega al terminar (de 30 s a un minuto después de
que la persona pulse Start). No se guarda nada en disco: es un dato de salud y vive solo en memoria.
"""
from collections import deque
from dataclasses import dataclass
from typing import Callable, Optional

from puente.protocolo import Muestra

TIMEOUT_POR_DEFECTO_S = 120.0
MAXIMO_RETENIDO = 20


class ErrorMedicion(Exception):
    """Falla de una medición. `codigo` coincide con los códigos que entiende la app del tótem."""

    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo, self.mensaje = codigo, mensaje


@dataclass(frozen=True)
class Medicion:
    sistolica: int
    diastolica: int
    pulso: Optional[int]


class Captura:
    def __init__(self, reloj: Callable[[], float]):
        self._reloj = reloj
        self._muestras: deque = deque(maxlen=MAXIMO_RETENIDO)
        self.ultima_medicion: Optional[float] = None

    def agregar(self, muestra: Muestra):
        ahora = self._reloj()
        self.ultima_medicion = ahora
        self._muestras.append((ahora, muestra))

    def desde(self, instante: float) -> list:
        return [(t, m) for t, m in self._muestras if t >= instante]

    def limpiar(self):
        self._muestras.clear()


async def esperar_medicion(captura: Captura, reloj: Callable[[], float], dormir, timeout_s: float = TIMEOUT_POR_DEFECTO_S,
                           paso_s: float = 0.5) -> Medicion:
    """Espera hasta `timeout_s` una medición posterior al inicio de la espera (las anteriores son de otra persona)."""
    inicio = reloj()
    while True:
        recibidas = captura.desde(inicio)
        if recibidas:
            muestra = recibidas[-1][1]
            if not muestra.valida:
                raise ErrorMedicion(muestra.codigo or "lectura_invalida", muestra.motivo or "Lectura inválida. Repite la medición.")
            return Medicion(muestra.sistolica, muestra.diastolica, muestra.pulso)
        if reloj() - inicio >= timeout_s:
            raise ErrorMedicion("timeout", "No llegó ninguna medición. Pulsa Start en el tensiómetro y espera el resultado.")
        await dormir(paso_s)
