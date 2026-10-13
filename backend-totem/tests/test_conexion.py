import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

import main
from conexion import normalizar_url


@pytest.mark.parametrize("entrada, esperada", [
    ("postgres://u:p@host/db", "postgresql+psycopg2://u:p@host/db"),
    ("postgresql://u:p@host/db", "postgresql+psycopg2://u:p@host/db"),
    ("postgresql+psycopg2://u:p@host/db", "postgresql+psycopg2://u:p@host/db"),
    ("  postgresql://u:p@host/db  ", "postgresql+psycopg2://u:p@host/db"),
    ("postgresql://u:p@ep-abc.neon.tech/neondb?sslmode=require&channel_binding=require",
     "postgresql+psycopg2://u:p@ep-abc.neon.tech/neondb?sslmode=require&channel_binding=require"),
    ("postgresql://usuario:cl%40ve%2Fraro@host:5432/db", "postgresql+psycopg2://usuario:cl%40ve%2Fraro@host:5432/db"),
])
def test_las_urls_de_postgresql_quedan_con_el_driver_psycopg2(entrada, esperada):
    # Arrange / Act
    resultado = normalizar_url(entrada)

    # Assert
    assert resultado == esperada


@pytest.mark.parametrize("url", [
    "sqlite:///prueba.db",
    "postgresql+psycopg://u:p@host/db",      # quien pide psycopg 3 de forma explícita lo conserva
    "mysql://u:p@host/db",
])
def test_otras_urls_no_se_modifican(url):
    # Arrange / Act / Assert
    assert normalizar_url(url) == url


def test_normalizar_es_idempotente():
    # Arrange
    una_vez = normalizar_url("postgres://u:p@host/db")

    # Act / Assert
    assert normalizar_url(una_vez) == una_vez


def test_la_url_normalizada_conserva_servidor_base_y_credenciales():
    # Arrange / Act
    url = make_url(normalizar_url("postgresql://usuario:cl%40ve@ep-abc.neon.tech:5432/neondb?sslmode=require"))

    # Assert
    assert (url.drivername, url.host, url.port, url.database, url.username, url.password) == (
        "postgresql+psycopg2", "ep-abc.neon.tech", 5432, "neondb", "usuario", "cl@ve")
    assert url.query == {"sslmode": "require"}


def test_el_motor_de_una_url_postgresql_usa_psycopg2_sin_importar_la_version_de_sqlalchemy():
    # Arrange / Act: crear el motor no se conecta; basta para detectar un driver que no esté instalado
    motor = create_engine(normalizar_url("postgresql://u:p@localhost/x"))

    # Assert
    assert motor.dialect.driver == "psycopg2"


@pytest.mark.skipif(main.engine.dialect.name != "postgresql", reason="requiere TEST_DATABASE_URL de PostgreSQL")
def test_el_backend_usa_el_driver_de_la_url_y_psycopg2_si_no_se_indica_ninguno():
    # Arrange: sin "+driver" en la URL manda psycopg2; con "+psycopg" se respeta psycopg 3
    explicito = "+psycopg://" in os.environ["DATABASE_URL"]

    # Act / Assert
    assert main.engine.dialect.driver == ("psycopg" if explicito else "psycopg2")
    assert main.engine.pool._pre_ping is True
