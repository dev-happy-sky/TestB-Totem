import asyncio

import pytest

from puente.captura import Captura, ErrorMedicion, Medicion, consolidar, esperar_medicion, explicar_fallo
from puente.protocolo import Muestra


class Reloj:
    def __init__(self):
        self.t = 0.0
        self.al_dormir = None

    def __call__(self):
        return self.t

    async def dormir(self, segundos):
        self.t += segundos
        await asyncio.sleep(0)
        if self.al_dormir:
            self.al_dormir(self.t)


def con_peso(kg):
    return Muestra(kg, True)


VACIA = Muestra(0.0, False, "Sin carga")


def lista(*muestras):
    return [(float(i), m) for i, m in enumerate(muestras)]


# ------------------------------------------------------------------------------------------- consolidar

def test_dos_muestras_iguales_dan_una_medicion_estable():
    # Arrange / Act
    medicion = consolidar(lista(con_peso(53.4), con_peso(53.4)))

    # Assert
    assert medicion == Medicion(53.4, 2)


def test_una_sola_muestra_no_basta():
    # Arrange / Act / Assert
    assert consolidar(lista(con_peso(53.4))) is None


def test_el_peso_se_redondea_a_un_decimal():
    # Arrange / Act
    medicion = consolidar(lista(con_peso(53.44), con_peso(53.42)))

    # Assert
    assert medicion.peso_kg == 53.4


def test_muestras_que_difieren_mas_de_la_tolerancia_no_son_estables():
    # Arrange / Act / Assert
    assert consolidar(lista(con_peso(53.0), con_peso(53.5))) is None


def test_se_usan_solo_las_ultimas_muestras_validas():
    # Arrange: el usuario se acomodó (49,9) y luego quedó en 53,4
    muestras = lista(con_peso(49.9), VACIA, con_peso(53.4), con_peso(53.4))

    # Act / Assert
    assert consolidar(muestras).peso_kg == 53.4


def test_las_muestras_vacias_no_cuentan():
    # Arrange / Act / Assert
    assert consolidar(lista(VACIA, VACIA, VACIA)) is None


# ----------------------------------------------------------------------------------------- explicar_fallo

def test_sin_ningun_anuncio_es_timeout():
    # Arrange / Act
    error = explicar_fallo([])

    # Assert
    assert error.codigo == "timeout" and "báscula" in error.mensaje


def test_solo_anuncios_vacios_es_lectura_invalida():
    # Arrange / Act
    error = explicar_fallo(lista(VACIA))

    # Assert
    assert error.codigo == "lectura_invalida" and "peso" in error.mensaje


def test_una_sola_muestra_valida_es_lectura_incompleta():
    # Arrange / Act
    error = explicar_fallo(lista(con_peso(53.4)))

    # Assert
    assert error.codigo == "lectura_invalida" and "incompleta" in error.mensaje


def test_muestras_validas_que_no_coinciden_es_movimiento():
    # Arrange / Act
    error = explicar_fallo(lista(con_peso(50.0), con_peso(53.0)))

    # Assert
    assert error.codigo == "movimiento"


# --------------------------------------------------------------------------------------- esperar_medicion

async def test_espera_hasta_que_llegan_muestras_estables():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)
    reloj.al_dormir = lambda t: captura.agregar(con_peso(53.4)) if t >= 1.0 else None

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=30)

    # Assert
    assert medicion.peso_kg == 53.4


async def test_ignora_las_muestras_anteriores_a_la_espera():
    # Arrange: el peso de la persona anterior sigue en memoria
    reloj = Reloj()
    captura = Captura(reloj)
    captura.agregar(con_peso(80.0))
    captura.agregar(con_peso(80.0))
    reloj.t = 10.0
    reloj.al_dormir = lambda t: captura.agregar(con_peso(53.4))

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=30)

    # Assert
    assert medicion.peso_kg == 53.4


async def test_si_no_llega_nada_en_el_tiempo_maximo_falla_con_timeout():
    # Arrange
    reloj = Reloj()

    # Act
    with pytest.raises(ErrorMedicion) as error:
        await esperar_medicion(Captura(reloj), reloj, reloj.dormir, timeout_s=5)

    # Assert
    assert error.value.codigo == "timeout"


# ------------------------------------------------------------------------------------------ ultima_valida

def test_ultima_valida_salta_los_anuncios_vacios_posteriores():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)
    captura.agregar(con_peso(53.4))
    reloj.t = 2.0
    captura.agregar(VACIA)

    # Act
    instante, muestra = captura.ultima_valida()

    # Assert
    assert instante == 0.0 and muestra.peso_kg == 53.4 and captura.ultima()[1] is VACIA


def test_ultima_valida_es_none_si_solo_hay_anuncios_vacios_o_nada():
    # Arrange
    captura = Captura(Reloj())

    # Act / Assert
    assert captura.ultima_valida() is None
    captura.agregar(VACIA)
    assert captura.ultima_valida() is None
