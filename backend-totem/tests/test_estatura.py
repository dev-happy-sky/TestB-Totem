import json

import pytest

import main
from models import MedicionCorporal


def _enviar(client, payload, headers):
    return client.post("/api/evaluaciones", json=payload, headers=headers)


def _primera(client, headers):
    return client.get("/api/evaluaciones", headers=headers).json()[0]


def test_la_estatura_se_guarda_en_centimetros_y_se_entrega_al_dashboard(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["estatura"] = "172.5"

    # Act
    assert _enviar(client, payload, totem_headers).status_code == 200

    # Assert
    assert _primera(client, auth())["mediciones"]["estatura"] == "172.5"
    db = main.SessionLocal()
    try:
        assert db.query(MedicionCorporal).one().estatura_cm == 172.5
    finally:
        db.close()


def test_sin_estatura_el_campo_queda_vacio_y_la_evaluacion_se_guarda(client, payload, totem_headers, auth):
    # Arrange: el payload base no trae estatura

    # Act
    assert _enviar(client, payload, totem_headers).status_code == 200

    # Assert
    assert _primera(client, auth())["mediciones"]["estatura"] == ""


@pytest.mark.parametrize("valor", ["abc", "99.9", "250.1", "1.72", "-170", "0"])
def test_una_estatura_imposible_se_rechaza(client, payload, totem_headers, valor):
    # Arrange
    payload["mediciones"]["estatura"] = valor

    # Act
    r = _enviar(client, payload, totem_headers)

    # Assert
    assert r.status_code == 422
    assert "estatura" in json.dumps(r.json()).lower()


@pytest.mark.parametrize("valor", ["100", "250", " 170 "])
def test_los_limites_de_la_estatura_son_validos(client, payload, totem_headers, valor):
    # Arrange
    payload["mediciones"]["estatura"] = valor

    # Act / Assert
    assert _enviar(client, payload, totem_headers).status_code == 200


def test_una_estatura_vacia_se_trata_como_ausente(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["estatura"] = "  "

    # Act
    assert _enviar(client, payload, totem_headers).status_code == 200

    # Assert
    assert _primera(client, auth())["mediciones"]["estatura"] == ""


def test_la_estatura_tambien_llega_por_websocket_al_dashboard(client, payload, totem_headers, auth):
    # Arrange
    payload["mediciones"]["estatura"] = "168.0"

    # Act
    with client.websocket_connect("/ws/dashboard") as ws:
        ws.send_text(json.dumps({"token": auth()["Authorization"].split()[1]}))
        _enviar(client, payload, totem_headers)
        recibido = json.loads(ws.receive_text())

    # Assert
    assert recibido["mediciones"]["estatura"] == "168.0"
