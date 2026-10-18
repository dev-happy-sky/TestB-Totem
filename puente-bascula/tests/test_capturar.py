from puente.capturar import describir, resumir, trama_completa
from puente.protocolo import parsear_anuncio

MAC = "E0:D3:8E:62:51:3D"
CON_53_4 = bytes.fromhex("14dc1388000025e0d38e62513d")
VACIA = bytes.fromhex("00000000000024e0d38e62513d")


def test_la_trama_completa_pone_el_id_de_fabricante_primero_en_little_endian():
    # Arrange / Act
    trama = trama_completa(0x18C0, CON_53_4)

    # Assert
    assert trama.hex() == "c018" + CON_53_4.hex()
    assert len(trama) == 15


def test_resumir_marca_solo_los_bytes_que_cambiaron():
    # Arrange
    tramas = [trama_completa(0x10C0, CON_53_4), trama_completa(0x11C0, VACIA), trama_completa(0x12C0, CON_53_4)]

    # Act
    cambios = resumir(tramas)

    # Assert: contador (1), peso (2-3), los bytes 13 88 que solo aparecen con carga (4-5) y el estado (8)
    assert cambios == {1: [0x10, 0x11, 0x12], 2: [0x00, 0x14], 3: [0x00, 0xDC], 4: [0x00, 0x13], 5: [0x00, 0x88], 8: [0x24, 0x25]}


def test_resumir_sin_cambios_o_sin_tramas():
    # Arrange / Act / Assert
    assert resumir([]) == {}
    assert resumir([trama_completa(0x10C0, CON_53_4)] * 3) == {}


def test_resumir_ignora_tramas_de_otro_largo():
    # Arrange
    tramas = [trama_completa(0x10C0, CON_53_4), b"\x01\x02", trama_completa(0x10C0, CON_53_4)]

    # Act / Assert
    assert resumir(tramas) == {}


def test_describir_muestra_los_bytes_y_el_peso_deducido():
    # Arrange
    trama = trama_completa(0x18C0, CON_53_4)

    # Act
    texto = describir(trama, parsear_anuncio({0x18C0: CON_53_4}, MAC))

    # Assert
    assert texto.startswith("C0 18 14 DC") and texto.endswith("-> 53.40 kg")
    assert describir(trama_completa(0x16C0, VACIA), parsear_anuncio({0x16C0: VACIA}, MAC)).endswith("-> sin peso")
