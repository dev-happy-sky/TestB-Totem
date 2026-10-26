import asyncio

import pytest

from puente.captura import Captura, ErrorMedicion, Medicion, esperar_medicion
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


VALIDA = Muestra(118, 78, 72, True)
MOVIMIENTO = Muestra(118, 78, 72, False, "Te moviste", "movimiento")


async def test_devuelve_la_medicion_que_llega_mientras_espera():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)
    reloj.al_dormir = lambda t: captura.agregar(VALIDA) if t >= 2.0 else None

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=60)

    # Assert
    assert medicion == Medicion(118, 78, 72)


async def test_ignora_las_mediciones_anteriores_a_la_espera():
    # Arrange: la medición de la persona anterior sigue en memoria
    reloj = Reloj()
    captura = Captura(reloj)
    captura.agregar(Muestra(150, 95, 80, True))
    reloj.t = 10.0
    reloj.al_dormir = lambda t: captura.agregar(VALIDA)

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=60)

    # Assert
    assert (medicion.sistolica, medicion.diastolica) == (118, 78)


async def test_una_medicion_invalida_falla_con_el_codigo_y_el_motivo_del_aparato():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)
    reloj.al_dormir = lambda t: captura.agregar(MOVIMIENTO)

    # Act
    with pytest.raises(ErrorMedicion) as error:
        await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=60)

    # Assert
    assert error.value.codigo == "movimiento" and error.value.mensaje == "Te moviste"


async def test_sin_ninguna_medicion_en_el_tiempo_maximo_es_timeout_con_instruccion():
    # Arrange
    reloj = Reloj()

    # Act
    with pytest.raises(ErrorMedicion) as error:
        await esperar_medicion(Captura(reloj), reloj, reloj.dormir, timeout_s=5)

    # Assert
    assert error.value.codigo == "timeout" and "Start" in error.value.mensaje


async def test_usa_la_ultima_medicion_si_llegaron_varias():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)

    def al_dormir(t):
        captura.agregar(MOVIMIENTO)
        captura.agregar(Muestra(121, 80, 70, True))

    reloj.al_dormir = al_dormir

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=60)

    # Assert
    assert medicion.sistolica == 121


def test_limpiar_vacia_las_mediciones():
    # Arrange
    captura = Captura(Reloj())
    captura.agregar(VALIDA)

    # Act
    captura.limpiar()

    # Assert
    assert captura.desde(-1) == []


async def test_si_llegan_varias_mediciones_entrega_la_mas_reciente_segun_el_reloj_del_aparato():
    # Arrange: el aparato manda primero una guardada más nueva en orden de llegada que la que acaba de medir
    import datetime
    reloj, captura = Reloj(), Captura(Reloj())
    reciente = Muestra(126, 90, 70, True, fecha=datetime.datetime(2026, 10, 25, 4, 16, 30))
    guardada = Muestra(118, 78, 72, True, fecha=datetime.datetime(2026, 10, 25, 4, 11, 0))
    reloj.al_dormir = lambda t: (captura.agregar(reciente), captura.agregar(guardada)) if t == 0.5 else None

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=5)

    # Assert
    assert (medicion.sistolica, medicion.diastolica) == (126, 90)


async def test_sin_fecha_entrega_la_ultima_que_llego():
    # Arrange
    reloj, captura = Reloj(), Captura(Reloj())
    reloj.al_dormir = lambda t: (captura.agregar(Muestra(100, 60, 70, True)), captura.agregar(Muestra(126, 90, 70, True))) if t == 0.5 else None

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=5)

    # Assert
    assert (medicion.sistolica, medicion.diastolica) == (126, 90)
