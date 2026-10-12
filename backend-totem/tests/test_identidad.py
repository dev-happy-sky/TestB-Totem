import pytest

from identidad import (
    enmascarar_matricula, matricula_valida, normalizar_matricula, normalizar_nombre, partir_nombre,
)


@pytest.mark.parametrize("entrada, esperado", [
    ("20231234A", "20231234A"),
    ("  2023-1234 a ", "20231234A"),
    ("20.231.234", "20231234"),
    ("", ""),
    (None, ""),
])
def test_normalizar_matricula_quita_separadores_y_pasa_a_mayusculas(entrada, esperado):
    # Arrange / Act
    resultado = normalizar_matricula(entrada)

    # Assert
    assert resultado == esperado


@pytest.mark.parametrize("matricula, valida", [
    ("20231234A", True),
    ("2023-1234 a", True),
    ("ABC123", True),             # límite inferior: 6 caracteres
    ("ABC12", False),             # 5 caracteres
    ("A" * 15, True),             # límite superior: 15
    ("A" * 16, False),
    ("", False),
    (None, False),
    ("2023$1234", False),
    ("2023_1234", False),
])
def test_matricula_valida_aplica_el_formato(matricula, valida):
    # Arrange / Act
    resultado = matricula_valida(matricula)

    # Assert
    assert resultado is valida


def test_normalizar_nombre_ignora_tildes_mayusculas_y_espacios():
    # Arrange
    a, b = "  María   PÉREZ soto ", "maria perez SOTO"

    # Act / Assert
    assert normalizar_nombre(a) == normalizar_nombre(b) == "maria perez soto"


def test_normalizar_nombre_distingue_nombres_distintos():
    # Arrange / Act / Assert
    assert normalizar_nombre("Ana Pérez") != normalizar_nombre("Ana Pereira")


@pytest.mark.parametrize("matricula, esperado", [
    ("20231234A", "******34A"),
    ("ABC", "***"),
    ("AB", "**"),
    ("", ""),
])
def test_enmascarar_matricula_deja_visibles_solo_los_ultimos_tres(matricula, esperado):
    # Arrange / Act
    resultado = enmascarar_matricula(matricula)

    # Assert
    assert resultado == esperado
    assert len(resultado) == len(matricula)


def test_enmascarar_matricula_no_expone_el_resto():
    # Arrange / Act
    resultado = enmascarar_matricula("20231234A")

    # Assert
    assert resultado == "******34A"
    assert "2023" not in resultado


@pytest.mark.parametrize("completo, esperado", [
    ("Ana Pérez Soto", ("Ana", "Pérez Soto")),
    ("Ana", ("Ana", "")),
    ("  Ana   Pérez ", ("Ana", "Pérez")),
    ("", ("", "")),
])
def test_partir_nombre_separa_nombre_y_apellidos(completo, esperado):
    # Arrange / Act
    resultado = partir_nombre(completo)

    # Assert
    assert resultado == esperado
