"""Perfil estándar de presión arterial de Bluetooth (servicio 0x1810, característica "Blood Pressure Measurement" 0x2A35).

El Beurer BM 54 anuncia el servicio 0x1810, así que se espera este formato (especificación GATT del Bluetooth SIG). **Aún no se
ha verificado con una medición real del aparato**: cuando se conecte, comparar con la pantalla del tensiómetro.

    byte 0       banderas: bit0 unidades (0 mmHg, 1 kPa), bit1 fecha y hora, bit2 pulso, bit3 id de usuario, bit4 estado
    bytes 1-6    sistólica, diastólica y presión arterial media, cada una un SFLOAT de 16 bits
    [7 bytes]    fecha y hora (año u16, mes, día, hora, minuto, segundo) si bit1
    [2 bytes]    pulso (SFLOAT) si bit2
    [1 byte]     id de usuario si bit3
    [2 bytes]    estado de la medición (u16) si bit4: bit0 movimiento, bit1 manguito flojo, bit2 pulso irregular,
                 bit5 posición incorrecta

El aparato entrega la medición por *indicación* al terminar, normalmente tras emparejarse.
"""
import datetime
from dataclasses import dataclass
from typing import Optional

SERVICIO_PRESION = "00001810-0000-1000-8000-00805f9b34fb"
CARACTERISTICA_PRESION = "00002a35-0000-1000-8000-00805f9b34fb"

KPA_A_MMHG = 7.50062
SISTOLICA_RANGO = (50, 300)    # mismos límites de lo físicamente posible que usa la app del tótem
DIASTOLICA_RANGO = (30, 200)
PULSO_RANGO = (20, 250)

_ESPECIALES = {0x07FF, 0x0800, 0x0801, 0x07FE, 0x0802}   # NaN, NRes, reservado, ±infinito


@dataclass(frozen=True)
class Muestra:
    sistolica: Optional[int]
    diastolica: Optional[int]
    pulso: Optional[int]
    valida: bool
    motivo: Optional[str] = None
    codigo: Optional[str] = None            # código de error de la app si no es válida: lectura_invalida | movimiento
    fecha: Optional[datetime.datetime] = None   # reloj del tensiómetro, si la envía


def sfloat(bruto: int) -> Optional[float]:
    """SFLOAT de 16 bits (IEEE-11073): mantisa de 12 bits con signo y exponente de 4 bits con signo. None si es un valor especial."""
    if bruto in _ESPECIALES:
        return None
    mantisa = bruto & 0x0FFF
    if mantisa >= 0x0800:
        mantisa -= 0x1000
    exponente = bruto >> 12
    if exponente >= 0x8:
        exponente -= 0x10
    return mantisa * (10 ** exponente)


def _u16(datos: bytes, i: int) -> int:
    return int.from_bytes(datos[i:i + 2], "little")


def parsear_medicion(datos: bytes) -> Optional[Muestra]:
    """Convierte la característica 0x2A35 en una muestra. None si el paquete está truncado."""
    if len(datos) < 7:
        return None
    banderas = datos[0]
    en_kpa, hay_fecha, hay_pulso, hay_usuario, hay_estado = (bool(banderas & (1 << b)) for b in range(5))
    posicion = 7
    fecha = None
    if hay_fecha:
        if len(datos) < posicion + 7:
            return None
        try:
            fecha = datetime.datetime(_u16(datos, posicion), datos[posicion + 2], datos[posicion + 3],
                                      datos[posicion + 4], datos[posicion + 5], datos[posicion + 6])
        except ValueError:
            fecha = None   # el reloj del aparato no está configurado
        posicion += 7
    pulso_bruto = None
    if hay_pulso:
        if len(datos) < posicion + 2:
            return None
        pulso_bruto = sfloat(_u16(datos, posicion))
        posicion += 2
    if hay_usuario:
        posicion += 1
    estado = 0
    if hay_estado:
        if len(datos) < posicion + 2:
            return None
        estado = _u16(datos, posicion)

    factor = KPA_A_MMHG if en_kpa else 1
    sistolica, diastolica = (sfloat(_u16(datos, i)) for i in (1, 3))
    if sistolica is None or diastolica is None:
        return Muestra(None, None, None, False, "El tensiómetro no entregó la presión", "lectura_invalida", fecha)
    sistolica, diastolica = round(sistolica * factor), round(diastolica * factor)
    pulso = round(pulso_bruto) if pulso_bruto is not None and PULSO_RANGO[0] <= pulso_bruto <= PULSO_RANGO[1] else None

    def invalida(motivo: str, codigo: str = "lectura_invalida") -> Muestra:
        return Muestra(sistolica, diastolica, pulso, False, motivo, codigo, fecha)

    if estado & 0x01:
        return invalida("Te moviste durante la medición. Repite sin mover el brazo ni hablar.", "movimiento")
    if estado & 0x02:
        return invalida("El brazalete quedó flojo. Ajústalo y repite la medición.")
    if estado & 0x20:
        return invalida("Posición incorrecta. Apoya el brazo a la altura del corazón y repite.")
    if not SISTOLICA_RANGO[0] <= sistolica <= SISTOLICA_RANGO[1] or not DIASTOLICA_RANGO[0] <= diastolica <= DIASTOLICA_RANGO[1]:
        return invalida("Presión fuera de lo posible. Repite la medición.")
    if sistolica <= diastolica:
        return invalida("La sistólica debe ser mayor que la diastólica. Repite la medición.")
    return Muestra(sistolica, diastolica, pulso, True, None, None, fecha)
