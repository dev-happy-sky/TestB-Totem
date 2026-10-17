"""Anuncio Bluetooth de la báscula ("Yoda1"). La báscula NO acepta conexiones: manda el peso dentro del anuncio.

Formato deducido con capturas reales (peso en pantalla 53,4 kg ↔ `14 DC`). El "id de fabricante" que entrega bleak mezcla dos
bytes: el bajo es fijo (0xC0) y el alto es un contador que cambia en cada ráfaga. El dato que sigue mide 13 bytes:

    bytes 0-1   peso en centésimas de kg, big-endian (0x14DC = 5340 → 53,40 kg); 0 si no hay nadie encima
    bytes 2-3   0x1388 siempre (5000): no se usa
    bytes 4-5   0x0000: no se usa
    byte 6      0x25 con carga, 0x24 en vacío
    bytes 7-12  dirección MAC de la báscula

Sin verificar con la báscula: unidad distinta de kg configurada en el aparato, pesos por encima de ~100 kg.
"""
from dataclasses import dataclass
from typing import Mapping, Optional

BYTE_FABRICANTE = 0xC0
LARGO_DATOS = 13
ESTADO_CON_CARGA = 0x25
ESTADO_VACIA = 0x24
PESO_MINIMO_KG = 2.0     # por debajo es ruido o una báscula vacía
PESO_MAXIMO_KG = 300.0


@dataclass(frozen=True)
class Muestra:
    peso_kg: float
    valida: bool
    motivo: Optional[str] = None
    contador: int = 0


def _mac_en_bytes(direccion: str) -> Optional[bytes]:
    limpia = direccion.replace(":", "").replace("-", "")
    if len(limpia) != 12:
        return None   # en macOS la "dirección" es un UUID: ahí se confía en el filtro del escáner
    try:
        return bytes.fromhex(limpia)
    except ValueError:
        return None


def parsear_anuncio(datos_fabricante: Mapping[int, bytes], direccion: str) -> Optional[Muestra]:
    """Convierte el anuncio en una muestra. Devuelve None si no es un anuncio de pesaje de esta báscula."""
    mac = _mac_en_bytes(direccion)
    for id_fabricante, datos in datos_fabricante.items():
        if (id_fabricante & 0xFF) != BYTE_FABRICANTE or len(datos) != LARGO_DATOS:
            continue
        if mac is not None and bytes(datos[7:13]) != mac:
            continue
        contador = (id_fabricante >> 8) & 0xFF
        peso = int.from_bytes(datos[0:2], "big") / 100
        if peso == 0:
            return Muestra(0.0, False, "Sin carga: nadie está sobre la báscula", contador)
        if not PESO_MINIMO_KG <= peso <= PESO_MAXIMO_KG:
            return Muestra(peso, False, "Peso fuera de rango", contador)
        return Muestra(peso, True, None, contador)
    return None
