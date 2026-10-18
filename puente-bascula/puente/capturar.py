"""Herramienta de diagnóstico: python -m puente.capturar [segundos]   (usa BASCULA_ID)

Imprime cada anuncio de la báscula en bruto (hexadecimal), el peso que se deduce de él y, al final, qué posiciones de bytes
cambiaron durante la captura. Sirve para descubrir si el anuncio trae más datos que el peso (grasa, impedancia...): súbete
descalzo, espera a que la pantalla termine de medir y mira qué bytes se movieron. No guarda nada en disco.
"""
import asyncio
import sys
import time
from typing import Mapping

from puente.protocolo import LARGO_DATOS, parsear_anuncio


def trama_completa(id_fabricante: int, datos: bytes) -> bytes:
    """Los bytes tal como salen por radio: el id de fabricante va primero, en little-endian."""
    return bytes([id_fabricante & 0xFF, (id_fabricante >> 8) & 0xFF]) + bytes(datos)


def resumir(tramas: list) -> dict:
    """{posición: valores distintos} de las posiciones cuyo valor cambió entre tramas del mismo largo."""
    if not tramas:
        return {}
    largo = len(tramas[0])
    iguales = [t for t in tramas if len(t) == largo]
    cambiaron = {}
    for posicion in range(largo):
        valores = sorted({t[posicion] for t in iguales})
        if len(valores) > 1:
            cambiaron[posicion] = valores
    return cambiaron


def describir(trama: bytes, muestra) -> str:
    peso = "sin peso" if muestra is None or not muestra.valida else f"{muestra.peso_kg:.2f} kg"
    return f"{trama.hex(' ').upper()}   -> {peso}"


async def capturar(direccion: str, segundos: float, imprimir=print) -> list:
    from bleak import BleakScanner

    inicio = time.monotonic()
    tramas = []

    def al_detectar(dispositivo, anuncio):
        if dispositivo.address.upper() != direccion.upper():
            return
        datos_fabricante: Mapping[int, bytes] = anuncio.manufacturer_data or {}
        for id_fabricante, datos in datos_fabricante.items():
            if len(datos) != LARGO_DATOS:
                continue
            trama = trama_completa(id_fabricante, datos)
            tramas.append(trama)
            muestra = parsear_anuncio({id_fabricante: datos}, direccion)
            imprimir(f"{time.monotonic() - inicio:5.1f}s  rssi {anuncio.rssi:>4}   {describir(trama, muestra)}")

    async with BleakScanner(al_detectar):
        await asyncio.sleep(segundos)
    return tramas


def main() -> int:
    import os
    direccion = os.getenv("BASCULA_ID")
    if not direccion:
        print("Error: define BASCULA_ID con la dirección (MAC) de la báscula.", file=sys.stderr)
        return 1
    segundos = float(sys.argv[1]) if len(sys.argv) > 1 else 30
    print(f"Escuchando {direccion} durante {segundos:.0f} s. Súbete a la báscula (descalzo) y espera a que termine de medir...")
    tramas = asyncio.run(capturar(direccion, segundos))
    print(f"\n{len(tramas)} anuncios recibidos.")
    cambios = resumir(tramas)
    if not cambios:
        print("Ningún byte cambió (¿te subiste a la báscula?).")
    else:
        print("Posiciones que cambiaron (0 = primer byte; las 0-1 son el id de fabricante: la 1 es un contador):")
        for posicion, valores in cambios.items():
            print(f"  byte {posicion:>2}: " + " ".join(f"{v:02X}" for v in valores))
    return 0


if __name__ == "__main__":
    sys.exit(main())
