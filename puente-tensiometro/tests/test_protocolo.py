import datetime

import pytest

from puente.protocolo import Muestra, parsear_medicion, sfloat


def sf(mantisa: int, exponente: int = 0) -> bytes:
    """Codifica un SFLOAT de 16 bits (little-endian) como lo hace un tensiómetro."""
    return (((exponente & 0xF) << 12) | (mantisa & 0xFFF)).to_bytes(2, "little")


NAN = bytes.fromhex("ff07")


def paquete(banderas=0x04, sistolica=118, diastolica=78, media=91, extra=b""):
    return bytes([banderas]) + sf(sistolica) + sf(diastolica) + sf(media) + extra


FECHA = (2026).to_bytes(2, "little") + bytes([10, 17, 22, 30, 5])


# ------------------------------------------------------------------------------------------------- SFLOAT

@pytest.mark.parametrize("bruto, esperado", [
    (0x0076, 118), (0x0000, 0), (0x0FFF, -1), (0x1000 | 1203, 1203 * 10), (0xF000 | 1203, 120.3), (0xF000 | 0xFFF, -0.1),
])
def test_sfloat_decodifica_mantisa_y_exponente_con_signo(bruto, esperado):
    # Arrange / Act / Assert
    assert sfloat(bruto) == pytest.approx(esperado)


@pytest.mark.parametrize("bruto", [0x07FF, 0x0800, 0x0801, 0x07FE, 0x0802])
def test_sfloat_valores_especiales_son_none(bruto):
    # Arrange / Act / Assert
    assert sfloat(bruto) is None


# ----------------------------------------------------------------------------------------------- medición

def test_una_medicion_en_mmhg_con_pulso():
    # Arrange
    datos = paquete(0x04, extra=sf(72))

    # Act
    muestra = parsear_medicion(datos)

    # Assert
    assert muestra == Muestra(118, 78, 72, True, None, None, None)


def test_sin_pulso_en_el_paquete_el_pulso_es_none():
    # Arrange / Act
    muestra = parsear_medicion(paquete(0x00))

    # Assert
    assert muestra.valida and muestra.pulso is None


def test_la_fecha_del_tensiometro_se_lee_y_el_pulso_viene_despues():
    # Arrange: banderas con fecha (bit1) y pulso (bit2)
    datos = paquete(0x06, extra=FECHA + sf(64))

    # Act
    muestra = parsear_medicion(datos)

    # Assert
    assert muestra.fecha == datetime.datetime(2026, 10, 17, 22, 30, 5) and muestra.pulso == 64 and muestra.valida


def test_una_fecha_sin_configurar_se_trata_como_ausente():
    # Arrange: mes 0
    fecha_mala = (2000).to_bytes(2, "little") + bytes([0, 0, 0, 0, 0])

    # Act
    muestra = parsear_medicion(paquete(0x02, extra=fecha_mala))

    # Assert
    assert muestra.fecha is None and muestra.valida


def test_en_kilopascales_se_convierte_a_mmhg():
    # Arrange: 15,7 kPa / 10,4 kPa ≈ 118 / 78 mmHg
    datos = bytes([0x01]) + sf(157, -1) + sf(104, -1) + sf(0)

    # Act
    muestra = parsear_medicion(datos)

    # Assert
    assert (muestra.sistolica, muestra.diastolica) == (118, 78)


def test_el_id_de_usuario_se_salta_para_llegar_al_estado():
    # Arrange: banderas con id de usuario (bit3) y estado (bit4); estado = movimiento
    datos = paquete(0x18, extra=bytes([1]) + (0x0001).to_bytes(2, "little"))

    # Act
    muestra = parsear_medicion(datos)

    # Assert
    assert muestra.valida is False and muestra.codigo == "movimiento"


@pytest.mark.parametrize("estado, codigo, texto", [
    (0x0001, "movimiento", "moviste"),
    (0x0002, "lectura_invalida", "flojo"),
    (0x0020, "lectura_invalida", "Posición"),
])
def test_los_estados_de_error_del_aparato_hacen_invalida_la_medicion(estado, codigo, texto):
    # Arrange
    datos = paquete(0x10, extra=estado.to_bytes(2, "little"))

    # Act
    muestra = parsear_medicion(datos)

    # Assert
    assert muestra.valida is False and muestra.codigo == codigo and texto in muestra.motivo


def test_un_pulso_irregular_no_invalida_la_medicion():
    # Arrange: bit2 del estado
    datos = paquete(0x10, extra=(0x0004).to_bytes(2, "little"))

    # Act / Assert
    assert parsear_medicion(datos).valida is True


def test_presion_no_numerica_es_lectura_invalida():
    # Arrange
    datos = bytes([0x00]) + NAN + sf(78) + sf(91)

    # Act
    muestra = parsear_medicion(datos)

    # Assert
    assert muestra.valida is False and muestra.codigo == "lectura_invalida" and muestra.sistolica is None


@pytest.mark.parametrize("sistolica, diastolica", [(49, 40), (301, 80), (120, 29), (120, 201), (80, 80), (70, 90)])
def test_presiones_imposibles_o_incoherentes_se_rechazan(sistolica, diastolica):
    # Arrange / Act
    muestra = parsear_medicion(paquete(0x00, sistolica, diastolica))

    # Assert
    assert muestra.valida is False and muestra.codigo == "lectura_invalida"


def test_un_pulso_fuera_de_rango_se_descarta_sin_invalidar_la_presion():
    # Arrange
    muestra = parsear_medicion(paquete(0x04, extra=sf(5)))

    # Assert
    assert muestra.valida is True and muestra.pulso is None


@pytest.mark.parametrize("datos", [b"", b"\x00\x76\x00", paquete(0x02, extra=b"\x01\x02"), paquete(0x04), paquete(0x10)])
def test_paquetes_truncados_se_ignoran(datos):
    # Arrange / Act / Assert
    assert parsear_medicion(datos) is None
