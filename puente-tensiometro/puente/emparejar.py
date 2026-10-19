"""Herramienta de una sola vez: python -m puente.emparejar [segundos]   (usa TENSIOMETRO_ID)

Empareja el tensiómetro con este PC. El BM 54 rechaza leer las mediciones ("Insufficient Authentication") si no hay un vínculo
cifrado, y solo acepta crearlo en su modo de emparejamiento. Windows además guarda el vínculo aunque el aparato ya lo haya olvidado:
`pair()` de bleak se salta el emparejamiento si cree que ya está emparejado. Por eso esta herramienta borra primero el vínculo
viejo, empareja de nuevo y COMPRUEBA que ya se puede suscribir a las mediciones.

Con el vínculo hecho, el puente conecta solo (sin PUENTE_EMPAREJAR). No se registra ningún dato de salud.
"""
import asyncio
import os
import sys
import time
from typing import Awaitable, Callable, Optional

from puente.protocolo import CARACTERISTICA_PRESION

ESPERA_CONEXION_S = 20.0
ESPERA_EMPAREJAR_S = 30.0
ESCANEO_S = 4.0


async def buscar_bleak(direccion: str):
    from bleak import BleakScanner
    return await BleakScanner.find_device_by_address(direccion, timeout=ESCANEO_S)


def cliente_bleak(dispositivo):
    from bleak import BleakClient
    try:
        return BleakClient(dispositivo, winrt={"use_cached_services": False})
    except TypeError:
        return BleakClient(dispositivo)


NIVEL_SOLO_CIFRADO = 2          # DevicePairingProtectionLevel.ENCRYPTION de Windows
NIVEL_AUTENTICADO = 3           # ENCRYPTION_AND_AUTHENTICATION


async def nivel_de_vinculo_windows(direccion: str) -> Optional[int]:
    """Nivel de seguridad con el que Windows guardó el vínculo (2 = solo cifrado, 3 = autenticado); None si no se puede consultar."""
    try:
        from winrt.windows.devices.bluetooth import BluetoothLEDevice
        dispositivo = await BluetoothLEDevice.from_bluetooth_address_async(int(direccion.replace(":", ""), 16))
        if dispositivo is None or not dispositivo.device_information.pairing.is_paired:
            return None
        return int(dispositivo.device_information.pairing.protection_level)
    except Exception:
        return None


MENSAJE_SOLO_CIFRADO = (
    "El vínculo quedó solo CIFRADO, sin autenticación, y este aparato exige uno AUTENTICADO (con código o confirmación en pantalla). "
    "El emparejamiento automático no puede hacerlo: empareja desde Configuración de Windows -> Bluetooth y dispositivos -> Agregar "
    "dispositivo (antes quita 'BM54' de la lista) con el aparato en modo de emparejamiento, y sigue lo que pida Windows."
)


def _ignorar(_emisor, _datos):
    """Durante la comprobación basta con poder suscribirse; la medición real la recoge el puente."""


async def _cerrar(cliente):
    try:
        await cliente.disconnect()
    except Exception:
        pass


async def _conectar(cliente_factory, dispositivo, imprimir):
    cliente = cliente_factory(dispositivo)
    try:
        await asyncio.wait_for(cliente.connect(), ESPERA_CONEXION_S)
    except BaseException:
        await _cerrar(cliente)
        raise
    imprimir("  Conectado.")
    return cliente


async def _leer(cliente):
    """Comprueba que ya se puede leer: suscribirse a las mediciones falla con 'Insufficient Authentication' sin vínculo."""
    await cliente.start_notify(CARACTERISTICA_PRESION, _ignorar)
    try:
        await cliente.stop_notify(CARACTERISTICA_PRESION)
    except Exception:
        pass


async def _intentar(cliente_factory, dispositivo, imprimir, dormir) -> bool:
    # 1) Borrar el vínculo viejo. Esa conexión ya no sirve para emparejar (bleak pierde su sesión), así que se cierra.
    cliente = await _conectar(cliente_factory, dispositivo, imprimir)
    try:
        await cliente.unpair()
        imprimir("  Vínculo anterior eliminado.")
    except Exception as error:   # no había vínculo, o el sistema no lo permite
        imprimir(f"  (sin vínculo anterior que borrar: {type(error).__name__})")
    finally:
        await _cerrar(cliente)
    await dormir(1.0)

    # 2) Emparejar en una conexión nueva.
    cliente = await _conectar(cliente_factory, dispositivo, imprimir)
    try:
        await asyncio.wait_for(cliente.pair(), ESPERA_EMPAREJAR_S)
        imprimir("  Emparejamiento hecho; comprobando que se pueden leer las mediciones...")
        # 3) Comprobar. El vínculo nuevo suele activarse recién en una conexión nueva: si la lectura se rechaza, se reconecta una vez.
        try:
            await _leer(cliente)
            return True
        except Exception as error:
            if "Insufficient Authentication" not in str(error):
                raise
            imprimir("  Aún rechaza la lectura; se reconecta para activar el vínculo...")
    finally:
        await _cerrar(cliente)
    await dormir(1.0)
    cliente = await _conectar(cliente_factory, dispositivo, imprimir)
    try:
        await _leer(cliente)
        return True
    finally:
        await _cerrar(cliente)


async def emparejar(direccion: str, espera_s: float = 90.0, buscador: Callable[[str], Awaitable] = buscar_bleak,
                    cliente_factory: Callable[[object], object] = cliente_bleak, imprimir: Callable[[str], None] = print,
                    reloj: Callable[[], float] = time.monotonic,
                    dormir: Callable[[float], Awaitable] = asyncio.sleep,
                    consultar_nivel: Callable[[str], Awaitable] = nivel_de_vinculo_windows) -> bool:
    imprimir(f"Pon el tensiómetro en modo de emparejamiento (símbolo de Bluetooth parpadeando). Esperándolo {espera_s:.0f} s...")
    fin = reloj() + espera_s
    intento = 0
    while reloj() < fin:
        dispositivo = await buscador(direccion)
        if dispositivo is None:
            continue
        intento += 1
        imprimir(f"Tensiómetro visible (intento {intento}).")
        try:
            if await _intentar(cliente_factory, dispositivo, imprimir, dormir):
                imprimir("LISTO: tensiómetro emparejado. Ya puedes arrancar el puente (sin PUENTE_EMPAREJAR).")
                return True
        except Exception as error:
            texto = str(error)
            if "Insufficient Authentication" in texto:
                if await consultar_nivel(direccion) == NIVEL_SOLO_CIFRADO:
                    imprimir("  " + MENSAJE_SOLO_CIFRADO)
                    return False
                imprimir("  El aparato sigue rechazando la lectura: no está en modo de emparejamiento. Vuelve a ponerlo en ese modo.")
            elif isinstance(error, asyncio.TimeoutError):
                imprimir("  Se agotó el tiempo: el aparato se durmió. Vuelve a ponerlo en modo de emparejamiento.")
            else:
                imprimir(f"  No se completó ({type(error).__name__}: {texto[:100] or 'sin detalle'}). Se reintenta cuando vuelva a aparecer.")
    imprimir("No se logró emparejar: el tensiómetro no apareció en modo de emparejamiento a tiempo.")
    return False


def main() -> int:
    direccion = os.getenv("TENSIOMETRO_ID")
    if not direccion:
        print("Error: define TENSIOMETRO_ID con la dirección (MAC) del tensiómetro.", file=sys.stderr)
        return 1
    espera = float(sys.argv[1]) if len(sys.argv) > 1 else 90.0
    return 0 if asyncio.run(emparejar(direccion, espera)) else 2


if __name__ == "__main__":
    sys.exit(main())
