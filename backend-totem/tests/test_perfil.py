import main
from models import AuditLog


def _acciones():
    db = main.SessionLocal()
    try:
        return [a.accion for a in db.query(AuditLog).all()]
    finally:
        db.close()


def test_el_perfil_requiere_sesion(client):
    # Arrange / Act / Assert
    assert client.get("/api/perfil").status_code == 401
    assert client.put("/api/perfil", json={"nombre": "X"}).status_code == 401


def test_ver_perfil_devuelve_los_datos_del_usuario_sin_la_contrasena(client, auth):
    # Arrange / Act
    r = client.get("/api/perfil", headers=auth("admin", "admin-pass"))

    # Assert
    assert r.status_code == 200
    assert r.json()["email"] == "admin" and r.json()["rol"] == "admin"
    assert "password_hash" not in r.json()


def test_modificar_perfil_guarda_nombre_apellido_y_sucursal(client, auth):
    # Arrange
    headers = auth()

    # Act
    r = client.put("/api/perfil", headers=headers, json={"nombre": " Marta ", "apellido": "Rojas", "sucursal": "Campus Norte"})

    # Assert
    assert r.status_code == 200
    assert client.get("/api/perfil", headers=headers).json() | {} == {
        "nombre": "Marta", "apellido": "Rojas", "email": "encargado", "rol": "encargado", "sucursal": "Campus Norte"}
    assert "perfil_actualizado" in _acciones()


def test_no_se_puede_cambiar_el_correo_ni_el_rol(client, auth):
    # Arrange
    headers = auth()

    # Act
    client.put("/api/perfil", headers=headers, json={"nombre": "Marta", "email": "otro", "rol": "admin"})

    # Assert
    perfil = client.get("/api/perfil", headers=headers).json()
    assert perfil["email"] == "encargado" and perfil["rol"] == "encargado"


def test_el_nombre_es_obligatorio(client, auth):
    # Arrange / Act
    r = client.put("/api/perfil", headers=auth(), json={"nombre": "   "})

    # Assert
    assert r.status_code == 422


def test_cambiar_la_contrasena_permite_entrar_con_la_nueva_y_no_con_la_anterior(client, auth):
    # Arrange
    headers = auth()

    # Act
    r = client.put("/api/perfil", headers=headers, json={
        "nombre": "Ana", "password_actual": "enc-pass", "password_nueva": "nueva-clave-1"})

    # Assert
    assert r.status_code == 200
    assert client.post("/api/auth/login", json={"username": "encargado", "password": "nueva-clave-1"}).status_code == 200
    assert client.post("/api/auth/login", json={"username": "encargado", "password": "enc-pass"}).status_code == 401
    assert "cambio_clave" in _acciones()


def test_cambiar_la_contrasena_con_la_actual_incorrecta_se_rechaza_y_no_cambia_nada(client, auth):
    # Arrange
    headers = auth()

    # Act
    r = client.put("/api/perfil", headers=headers, json={
        "nombre": "Cambiado", "password_actual": "mala", "password_nueva": "nueva-clave-1"})

    # Assert
    assert r.status_code == 400
    assert client.get("/api/perfil", headers=headers).json()["nombre"] != "Cambiado"
    assert client.post("/api/auth/login", json={"username": "encargado", "password": "enc-pass"}).status_code == 200
    assert "cambio_clave_fallido" in _acciones()


def test_la_contrasena_nueva_exige_la_actual_y_un_minimo_de_8_caracteres(client, auth):
    # Arrange
    headers = auth()

    # Act
    sin_actual = client.put("/api/perfil", headers=headers, json={"nombre": "Ana", "password_nueva": "nueva-clave-1"})
    corta = client.put("/api/perfil", headers=headers, json={"nombre": "Ana", "password_actual": "enc-pass", "password_nueva": "corta"})

    # Assert
    assert sin_actual.status_code == 422 and corta.status_code == 422


def test_sin_seguridad_no_hay_perfil(client, monkeypatch):
    # Arrange
    monkeypatch.setattr(main, "SEGURIDAD_ACTIVA", False)

    # Act / Assert
    assert client.get("/api/perfil").status_code == 404
    assert client.put("/api/perfil", json={"nombre": "Ana"}).status_code == 404
