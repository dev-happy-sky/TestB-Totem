import pytest

import main


@pytest.mark.parametrize("metodo", ["get", "head"])
@pytest.mark.parametrize("ruta", ["/", "/salud"])
def test_la_raiz_y_la_salud_responden_200_a_get_y_head(client, ruta, metodo):
    # Arrange / Act
    r = getattr(client, metodo)(ruta)

    # Assert
    assert r.status_code == 200


def test_la_raiz_indica_el_servicio_y_que_esta_arriba(client):
    # Arrange / Act
    r = client.get("/")

    # Assert
    assert r.json() == {"servicio": "API Tótem de Aptitud Física", "estado": "ok"}


def test_salud_confirma_la_conexion_con_la_base_de_datos(client):
    # Arrange / Act
    r = client.get("/salud")

    # Assert
    assert r.json() == {"estado": "ok"}


@pytest.mark.parametrize("seguridad", [True, False])
@pytest.mark.parametrize("ruta", ["/", "/salud"])
def test_son_publicas_con_la_seguridad_activada_o_apagada(client, monkeypatch, ruta, seguridad):
    # Arrange
    monkeypatch.setattr(main, "SEGURIDAD_ACTIVA", seguridad)

    # Act: sin sesión ni clave del tótem
    r = client.get(ruta)

    # Assert
    assert r.status_code == 200


class MotorCaido:
    def connect(self):
        raise RuntimeError("password authentication failed for user 'secreto' at host db.interno:5432")


def test_si_la_base_no_responde_salud_devuelve_503_sin_detalles(client, monkeypatch):
    # Arrange
    monkeypatch.setattr(main, "engine", MotorCaido())

    # Act
    r = client.get("/salud")

    # Assert
    assert r.status_code == 503
    assert r.json() == {"estado": "sin base de datos"}
    assert "secreto" not in r.text and "db.interno" not in r.text


def test_la_raiz_no_depende_de_la_base_de_datos(client, monkeypatch):
    # Arrange
    monkeypatch.setattr(main, "engine", MotorCaido())

    # Act
    r = client.get("/")

    # Assert
    assert r.status_code == 200


def test_las_rutas_de_salud_no_aparecen_en_la_documentacion(client):
    # Arrange / Act
    rutas = client.get("/openapi.json").json()["paths"]

    # Assert
    assert "/" not in rutas and "/salud" not in rutas


def test_una_ruta_inexistente_sigue_dando_404(client):
    # Arrange / Act
    r = client.get("/no-existe")

    # Assert
    assert r.status_code == 404


def test_la_raiz_no_acepta_escrituras(client):
    # Arrange / Act / Assert
    assert client.post("/").status_code == 405
    assert client.put("/salud").status_code == 405
