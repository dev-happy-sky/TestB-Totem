"""Hash y verificación de contraseñas (PBKDF2-SHA256 con sal). Sin dependencias de FastAPI ni de la base de datos."""
import hashlib
import hmac
import secrets
from typing import Optional

ITERACIONES = 200_000


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERACIONES)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, almacenado: str) -> bool:
    try:
        salt_hex, digest_hex = almacenado.split("$")
        esperado = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), ITERACIONES)
        return hmac.compare_digest(esperado.hex(), digest_hex)
    except ValueError:
        return False
