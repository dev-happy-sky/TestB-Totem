import pytest

import main
from credenciales import hash_password, verify_password
from crear_usuario import UsuarioInvalido, crear_o_actualizar_usuario, url_es_local
from models import PersonalGimnasio


def _crear(usuario="dev-admin", password="admin", rol="encargado", local=True):
    db = main.SessionLocal()
    try:
        return crear_o_actualizar_usuario(db, usuario, password, rol, local)
    finally:
        db.close()


def _usuario(nombre):
    db = main.SessionLocal()
    try:
        u = db.query(PersonalGimnasio).filter(PersonalGimnasio.email == nombre).first()
        return None if u is None else (u.rol, u.activo, u.password_hash)
    finally:
        db.close()


# ----------------------------------------------------------------------------------- contraseñas

def test_verify_password_acepta_la_contrasena_correcta():
    # Arrange
    almacenado = hash_password("admin")

    # Act / Assert
    assert verify_password("admin", almacenado) is True


@pytest.mark.parametrize("intento", ["Admin", "admin ", "", "otra"])
def test_verify_password_rechaza_otras_contrasenas(intento):
    # Arrange
    almacenado = hash_password("admin")

    # Act / Assert
    assert verify_password(intento, almacenado) is False


@pytest.mark.parametrize("almacenado", ["", "sin-separador", "zz$zz", "a$b$c"])
def test_verify_password_rechaza_hashes_mal_formados(almacenado):
    # Arrange / Act / Assert
    assert verify_password("admin", almacenado) is False


def test_dos_hashes_de_la_misma_contrasena_son_distintos():
    # Arrange / Act
    a, b = hash_password("admin"), hash_password("admin")

    # Assert
    assert a != b and verify_password("admin", a) and verify_password("admin", b)


# ---------------------------------------------------------------------------------- crear usuario

def test_crea_el_usuario_admin_con_vision_de_encargado(client):
    # Arrange / Act
    resultado = _crear("dev-admin", "admin", "encargado")

    # Assert
    rol, activo, hash_guardado = _usuario("dev-admin")
    assert resultado == "creado" and (rol, activo) == ("encargado", True)
    assert hash_guardado != "admin" and verify_password("admin", hash_guardado)


def test_el_usuario_creado_puede_iniciar_sesion_y_ver_las_evaluaciones(client):
    # Arrange
    _crear("dev-admin", "admin", "encargado")

    # Act
    login = client.post("/api/auth/login", json={"username": "dev-admin", "password": "admin"})
    token = login.json()["token"]
    evaluaciones = client.get("/api/evaluaciones", headers={"Authorization": f"Bearer {token}"})

    # Assert
    assert login.status_code == 200 and login.json()["rol"] == "encargado"
    assert evaluaciones.status_code == 200


def test_el_encargado_no_accede_a_la_auditoria_pero_el_admin_si(client):
    # Arrange
    _crear("encargado2", "clave-larga-1", "encargado")
    _crear("admin2", "clave-larga-2", "admin")

    # Act
    def auditoria(usuario, password):
        token = client.post("/api/auth/login", json={"username": usuario, "password": password}).json()["token"]
        return client.get("/api/auditoria", headers={"Authorization": f"Bearer {token}"}).status_code

    # Assert
    assert auditoria("encargado2", "clave-larga-1") == 403
    assert auditoria("admin2", "clave-larga-2") == 200


def test_una_contrasena_incorrecta_no_inicia_sesion(client):
    # Arrange
    _crear("dev-admin", "admin", "encargado")

    # Act
    r = client.post("/api/auth/login", json={"username": "dev-admin", "password": "otra"})

    # Assert
    assert r.status_code == 401


def test_crear_un_usuario_existente_actualiza_contrasena_rol_y_reactiva(client):
    # Arrange
    _crear("dev-admin", "admin", "encargado")
    db = main.SessionLocal()
    try:
        db.query(PersonalGimnasio).filter(PersonalGimnasio.email == "dev-admin").one().activo = False
        db.commit()
    finally:
        db.close()

    # Act
    resultado = _crear("dev-admin", "nueva-clave", "admin")

    # Assert
    rol, activo, hash_guardado = _usuario("dev-admin")
    assert resultado == "actualizado" and (rol, activo) == ("admin", True)
    assert verify_password("nueva-clave", hash_guardado) and not verify_password("admin", hash_guardado)


def test_no_duplica_usuarios(client):
    # Arrange
    _crear("dev-admin", "admin", "encargado")

    # Act
    _crear("dev-admin", "admin", "encargado")

    # Assert
    db = main.SessionLocal()
    try:
        assert db.query(PersonalGimnasio).filter(PersonalGimnasio.email == "dev-admin").count() == 1
    finally:
        db.close()


@pytest.mark.parametrize("usuario, password, rol, mensaje", [
    ("", "admin", "encargado", "usuario"),
    ("   ", "admin", "encargado", "usuario"),
    ("dev-admin", "", "encargado", "contraseña"),
    ("dev-admin", "admin", "superusuario", "Rol inválido"),
])
def test_rechaza_datos_invalidos(client, usuario, password, rol, mensaje):
    # Arrange / Act
    with pytest.raises(UsuarioInvalido) as error:
        _crear(usuario, password, rol)

    # Assert
    assert mensaje in str(error.value)
    assert _usuario("dev-admin") is None


def test_una_contrasena_corta_se_rechaza_en_una_base_que_no_es_local(client):
    # Arrange / Act
    with pytest.raises(UsuarioInvalido) as error:
        _crear("dev-admin", "admin", "encargado", local=False)

    # Assert
    assert "no es local" in str(error.value)
    assert _usuario("dev-admin") is None


def test_una_contrasena_larga_se_acepta_en_una_base_remota(client):
    # Arrange / Act
    resultado = _crear("dev-admin", "una-clave-segura", "encargado", local=False)

    # Assert
    assert resultado == "creado"


@pytest.mark.parametrize("url, local", [
    ("postgresql://postgres:x@localhost:5432/totem_db", True),
    ("postgresql://postgres:x@127.0.0.1/totem_db", True),
    ("sqlite:///prueba.db", True),
    ("postgresql://u:p@dpg-abc123.oregon-postgres.render.com/totem", False),
    ("postgresql://u:p@db.ejemplo.com:5432/totem", False),
])
def test_url_es_local(url, local):
    # Arrange / Act / Assert
    assert url_es_local(url) is local
