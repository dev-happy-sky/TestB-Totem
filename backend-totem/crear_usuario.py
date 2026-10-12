"""Crea o actualiza un usuario del dashboard (tabla `personal_gimnasio`).

Uso (desde backend-totem/):

    python crear_usuario.py --usuario admin --password admin --rol encargado

Usa DATABASE_URL (como el backend); sin ella, la base local de desarrollo. Contraseñas cortas (menos de 8
caracteres) solo se aceptan contra una base local: nunca las uses en producción.
"""
import argparse
import os
import sys
from urllib.parse import urlparse

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from credenciales import hash_password
from models import Base, PersonalGimnasio

ROLES = ("admin", "encargado")
URL_LOCAL_POR_DEFECTO = "postgresql://postgres:admin@localhost:5432/totem_db"
MINIMO_PASSWORD_REMOTO = 8


class UsuarioInvalido(Exception):
    pass


def url_es_local(url: str) -> bool:
    if url.startswith("sqlite"):
        return True
    return (urlparse(url).hostname or "") in ("localhost", "127.0.0.1", "::1")


def crear_o_actualizar_usuario(db: Session, usuario: str, password: str, rol: str, local: bool) -> str:
    """Devuelve "creado" o "actualizado". Si el usuario ya existe se le cambian la contraseña y el rol."""
    usuario = (usuario or "").strip()
    if not usuario:
        raise UsuarioInvalido("El usuario no puede estar vacío")
    if not password:
        raise UsuarioInvalido("La contraseña no puede estar vacía")
    if rol not in ROLES:
        raise UsuarioInvalido(f"Rol inválido: usa {' o '.join(ROLES)}")
    if not local and len(password) < MINIMO_PASSWORD_REMOTO:
        raise UsuarioInvalido(
            f"Contraseña demasiado corta para una base que no es local (mínimo {MINIMO_PASSWORD_REMOTO} caracteres)")
    existente = db.query(PersonalGimnasio).filter(PersonalGimnasio.email == usuario).first()
    if existente:
        existente.password_hash, existente.rol, existente.activo = hash_password(password), rol, True
        resultado = "actualizado"
    else:
        db.add(PersonalGimnasio(nombre=usuario, apellido="", email=usuario, rol=rol,
                                password_hash=hash_password(password)))
        resultado = "creado"
    db.commit()
    return resultado


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Crea o actualiza un usuario del dashboard")
    parser.add_argument("--usuario", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--rol", choices=ROLES, default="encargado")
    args = parser.parse_args(argv)

    url = os.getenv("DATABASE_URL", URL_LOCAL_POR_DEFECTO)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    engine = create_engine(url)
    Base.metadata.create_all(bind=engine)
    with sessionmaker(bind=engine)() as db:
        try:
            resultado = crear_o_actualizar_usuario(db, args.usuario, args.password, args.rol, url_es_local(url))
        except UsuarioInvalido as error:
            print(f"Error: {error}", file=sys.stderr)
            return 1
    print(f"Usuario '{args.usuario}' {resultado} con rol {args.rol} en {urlparse(url).hostname or 'sqlite'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
