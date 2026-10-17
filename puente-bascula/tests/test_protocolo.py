import pytest

from puente.protocolo import Muestra, parsear_anuncio

MAC = "E0:D3:8E:62:51:3D"
# Paquetes reales capturados de la báscula (clave = "id de fabricante" que entrega bleak, valor = dato).
CON_53_4 = {0x18C0: bytes.fromhex("14dc1388000025e0d38e62513d")}      # la pantalla marcaba 53,4 kg
VACIA = {0x16C0: bytes.fromhex("00000000000024e0d38e62513d")}
CON_49_9 = {0x10C0: bytes.fromhex("137e1388000025e0d38e62513d")}
CON_50_25 = {0x11C0: bytes.fromhex("13a11388000025e0d38e62513d")}


def test_el_peso_viene_en_centesimas_de_kilo_y_coincide_con_la_pantalla():
    # Arrange / Act
    muestra = parsear_anuncio(CON_53_4, MAC)

    # Assert
    assert muestra == Muestra(53.4, True, None, 0x18)


@pytest.mark.parametrize("anuncio, peso", [(CON_49_9, 49.9), (CON_50_25, 50.25), (CON_53_4, 53.4)])
def test_otros_anuncios_reales(anuncio, peso):
    # Arrange / Act / Assert
    assert parsear_anuncio(anuncio, MAC).peso_kg == pytest.approx(peso)


def test_el_contador_del_anuncio_se_lee_del_byte_alto_del_id():
    # Arrange / Act / Assert
    assert parsear_anuncio(CON_49_9, MAC).contador == 0x10
    assert parsear_anuncio(CON_50_25, MAC).contador == 0x11


def test_con_la_bascula_vacia_la_muestra_no_es_valida():
    # Arrange / Act
    muestra = parsear_anuncio(VACIA, MAC)

    # Assert
    assert muestra.valida is False and muestra.peso_kg == 0.0
    assert "Sin carga" in muestra.motivo


@pytest.mark.parametrize("centesimas, valida", [(199, False), (200, True), (30000, True), (30001, False)])
def test_limites_de_peso_posible(centesimas, valida):
    # Arrange
    datos = centesimas.to_bytes(2, "big") + bytes.fromhex("1388000025e0d38e62513d")

    # Act
    muestra = parsear_anuncio({0x10C0: datos}, MAC)

    # Assert
    assert muestra.valida is valida


def test_un_anuncio_de_otra_bascula_o_dispositivo_se_ignora():
    # Arrange
    otra_mac = {0x18C0: bytes.fromhex("14dc1388000025aabbccddeeff")}
    otro_fabricante = {0x004C: bytes.fromhex("14dc1388000025e0d38e62513d")}
    corto = {0x18C0: bytes.fromhex("14dc1388")}

    # Act / Assert
    assert parsear_anuncio(otra_mac, MAC) is None
    assert parsear_anuncio(otro_fabricante, MAC) is None
    assert parsear_anuncio(corto, MAC) is None
    assert parsear_anuncio({}, MAC) is None


def test_con_una_direccion_que_no_es_mac_se_confia_en_el_filtro_del_escaner():
    # Arrange: en macOS bleak entrega un UUID en vez de la MAC
    uuid_macos = "49535343-FE7D-4AE5-8FA9-9FAFD205E455"

    # Act / Assert
    assert parsear_anuncio(CON_53_4, uuid_macos).peso_kg == 53.4


def test_acepta_la_mac_con_guiones_o_en_minusculas():
    # Arrange / Act / Assert
    assert parsear_anuncio(CON_53_4, "e0-d3-8e-62-51-3d").peso_kg == 53.4
