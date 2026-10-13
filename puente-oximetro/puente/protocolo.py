"""Protocolo del oxímetro BLE (paquetes de la característica de notificación).

Formato deducido con nRF Connect (cabecera 0xA7): byte 7 = SpO₂ (%), byte 8 = frecuencia cardíaca (lpm),
byte 9 = índice de perfusión en décimas de %. No hay checksum conocido: un valor imposible se trata como
"sin dedo". Si el fabricante entrega otro formato, este es el único archivo que hay que ajustar.
"""
from dataclasses import dataclass
from typing import Optional

NOTIFY_UUID = "0000ffe2-0000-1000-8000-00805f9b34fb"
CABECERA = 0xA7
LARGO_MINIMO = 9

SPO2_MAXIMA = 100
FC_SIN_DEDO = (0, 255)   # el oxímetro envía 0 o 255 cuando no detecta el dedo


@dataclass(frozen=True)
class Muestra:
    spo2: int
    fc: int
    indice_perfusion: float
    valida: bool
    motivo: Optional[str] = None


def parsear_paquete(datos: bytes) -> Optional[Muestra]:
    """Convierte un paquete en una muestra. Devuelve None si no es un paquete de mediciones (otra cabecera o muy corto)."""
    if len(datos) < LARGO_MINIMO or datos[0] != CABECERA:
        return None
    spo2, fc, indice_perfusion = datos[6], datos[7], datos[8] / 10.0
    if spo2 == 0 or spo2 > SPO2_MAXIMA:
        return Muestra(spo2, fc, indice_perfusion, False, "SpO₂ fuera de rango (¿sin dedo?)")
    if fc in FC_SIN_DEDO:
        return Muestra(spo2, fc, indice_perfusion, False, "Frecuencia cardíaca no detectada (¿sin dedo?)")
    return Muestra(spo2, fc, indice_perfusion, True)
