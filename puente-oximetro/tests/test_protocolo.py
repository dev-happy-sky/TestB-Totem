import pytest

from puente.protocolo import CABECERA, Muestra, parsear_paquete


def paquete(spo2=97, fc=72, pi=41, cabecera=CABECERA, largo=9):
    datos = bytearray(largo)
    datos[0] = cabecera
    if largo >= 9:
        datos[6], datos[7], datos[8] = spo2, fc, pi
    return bytes(datos)


def test_un_paquete_valido_se_convierte_en_una_muestra():
    # Arrange
    datos = paquete(spo2=97, fc=72, pi=41)

    # Act
    muestra = parsear_paquete(datos)

    # Assert
    assert muestra == Muestra(spo2=97, fc=72, indice_perfusion=4.1, valida=True)


def test_las_posiciones_de_los_bytes_son_las_del_script_original():
    # Arrange: SpO₂ en el byte 7 (índice 6), FC en el 8 (índice 7) y perfusión en el 9 (índice 8)
    datos = bytes([0xA7, 1, 2, 3, 4, 5, 98, 61, 25])

    # Act
    muestra = parsear_paquete(datos)

    # Assert
    assert (muestra.spo2, muestra.fc, muestra.indice_perfusion) == (98, 61, 2.5)


def test_los_bytes_extra_al_final_se_ignoran():
    # Arrange
    datos = paquete() + bytes([0xFF, 0xFF, 0x12])

    # Act
    muestra = parsear_paquete(datos)

    # Assert
    assert muestra.valida and muestra.spo2 == 97


@pytest.mark.parametrize("datos", [
    b"", bytes([0xA7]), bytes([0xA7] * 8),                  # más cortos que 9 bytes
    paquete(cabecera=0xA6), paquete(cabecera=0x00), paquete(cabecera=0xFF),   # otra cabecera
])
def test_lo_que_no_es_un_paquete_de_mediciones_se_ignora(datos):
    # Arrange / Act
    muestra = parsear_paquete(datos)

    # Assert
    assert muestra is None


@pytest.mark.parametrize("spo2, valida", [
    (0, False), (1, True), (35, True), (90, True), (100, True), (101, False), (127, False), (255, False),
])
def test_limites_de_spo2(spo2, valida):
    # Arrange
    datos = paquete(spo2=spo2)

    # Act
    muestra = parsear_paquete(datos)

    # Assert
    assert muestra.valida is valida
    assert (muestra.motivo is None) is valida


@pytest.mark.parametrize("fc, valida", [
    (0, False), (1, True), (60, True), (180, True), (254, True), (255, False),
])
def test_limites_de_frecuencia_cardiaca(fc, valida):
    # Arrange
    datos = paquete(fc=fc)

    # Act
    muestra = parsear_paquete(datos)

    # Assert
    assert muestra.valida is valida


def test_sin_dedo_el_motivo_lo_explica_y_se_conservan_los_valores_crudos():
    # Arrange
    datos = paquete(spo2=0, fc=0, pi=0)

    # Act
    muestra = parsear_paquete(datos)

    # Assert
    assert muestra.valida is False and "sin dedo" in muestra.motivo
    assert (muestra.spo2, muestra.fc, muestra.indice_perfusion) == (0, 0, 0.0)


@pytest.mark.parametrize("pi_crudo, esperado", [(0, 0.0), (5, 0.5), (41, 4.1), (255, 25.5)])
def test_el_indice_de_perfusion_viene_en_decimas(pi_crudo, esperado):
    # Arrange / Act
    muestra = parsear_paquete(paquete(pi=pi_crudo))

    # Assert
    assert muestra.indice_perfusion == esperado
