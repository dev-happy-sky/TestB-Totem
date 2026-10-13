import pytest

from puente.captura import (
    Captura, ErrorMedicion, MAXIMO_RETENIDO, MUESTRAS_ESTABLES, TOLERANCIA_FC, TOLERANCIA_SPO2, consolidar, esperar_medicion,
    explicar_fallo,
)
from puente.protocolo import Muestra


def buena(spo2=97, fc=72, pi=4.1):
    return Muestra(spo2, fc, pi, True)


def sin_dedo():
    return Muestra(0, 0, 0.0, False, "sin dedo")


def serie(*muestras, t0=0.0):
    return [(t0 + i, m) for i, m in enumerate(muestras)]


class Reloj:
    """Reloj falso: `dormir` avanza el tiempo sin esperar y deja que una función inyecte muestras."""

    def __init__(self, al_dormir=None):
        self.t = 0.0
        self.al_dormir = al_dormir
        self.pasos = 0

    def __call__(self):
        return self.t

    async def dormir(self, segundos):
        self.t += segundos
        self.pasos += 1
        if self.al_dormir:
            self.al_dormir(self.t)


# ---------------------------------------------------------------------------------------- consolidar

def test_cinco_muestras_validas_y_estables_dan_una_medicion_con_la_mediana():
    # Arrange
    muestras = serie(buena(96, 70, 4.0), buena(97, 72, 4.2), buena(97, 71, 4.1), buena(98, 73, 4.3), buena(97, 72, 4.0))

    # Act
    medicion = consolidar(muestras)

    # Assert
    assert (medicion.spo2, medicion.fc, medicion.indice_perfusion, medicion.muestras) == (97, 72, 4.1, MUESTRAS_ESTABLES)


def test_con_menos_de_cinco_muestras_validas_aun_no_hay_medicion():
    # Arrange
    muestras = serie(*[buena()] * (MUESTRAS_ESTABLES - 1))

    # Act / Assert
    assert consolidar(muestras) is None
    assert consolidar([]) is None


def test_las_muestras_sin_dedo_no_cuentan():
    # Arrange
    muestras = serie(buena(), sin_dedo(), buena(), sin_dedo(), buena(), buena(), buena())

    # Act
    medicion = consolidar(muestras)

    # Assert
    assert medicion is not None and medicion.muestras == 5


def test_solo_cuentan_las_ultimas_cinco_validas():
    # Arrange: las primeras son inestables pero las últimas cinco son estables
    muestras = serie(buena(80, 150), buena(99, 50), *[buena(97, 72)] * 5)

    # Act
    medicion = consolidar(muestras)

    # Assert
    assert (medicion.spo2, medicion.fc) == (97, 72)


@pytest.mark.parametrize("variacion_spo2, estable", [
    (0, True), (TOLERANCIA_SPO2, True), (TOLERANCIA_SPO2 + 1, False),
])
def test_tolerancia_de_spo2(variacion_spo2, estable):
    # Arrange
    muestras = serie(buena(95), buena(95), buena(95), buena(95), buena(95 + variacion_spo2))

    # Act
    medicion = consolidar(muestras)

    # Assert
    assert (medicion is not None) is estable


@pytest.mark.parametrize("variacion_fc, estable", [
    (0, True), (TOLERANCIA_FC, True), (TOLERANCIA_FC + 1, False),
])
def test_tolerancia_de_frecuencia_cardiaca(variacion_fc, estable):
    # Arrange
    muestras = serie(buena(fc=70), buena(fc=70), buena(fc=70), buena(fc=70), buena(fc=70 + variacion_fc))

    # Act
    medicion = consolidar(muestras)

    # Assert
    assert (medicion is not None) is estable


# ------------------------------------------------------------------------------------- explicar_fallo

def test_sin_ningun_paquete_el_fallo_es_timeout():
    # Arrange / Act
    error = explicar_fallo([])

    # Assert
    assert (error.codigo, "no está enviando datos" in error.mensaje) == ("timeout", True)


def test_si_todos_los_paquetes_son_sin_dedo_el_fallo_es_lectura_invalida():
    # Arrange
    muestras = serie(sin_dedo(), sin_dedo())

    # Act
    error = explicar_fallo(muestras)

    # Assert
    assert error.codigo == "lectura_invalida" and "No se detecta el dedo" in error.mensaje


def test_con_pocas_muestras_validas_el_fallo_pide_mantener_el_dedo_quieto():
    # Arrange
    muestras = serie(buena(), sin_dedo(), buena())

    # Act
    error = explicar_fallo(muestras)

    # Assert
    assert error.codigo == "lectura_invalida" and "incompleta" in error.mensaje


def test_si_hay_suficientes_muestras_pero_no_son_estables_el_fallo_es_movimiento():
    # Arrange
    muestras = serie(buena(90, 60), buena(99, 80), buena(91, 62), buena(98, 79), buena(92, 61))

    # Act
    error = explicar_fallo(muestras)

    # Assert
    assert error.codigo == "movimiento"


# ----------------------------------------------------------------------------------------- Captura

def test_captura_guarda_solo_las_muestras_recientes_y_ordena_por_llegada():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)

    # Act
    for t in (1.0, 2.0, 3.0):
        reloj.t = t
        captura.agregar(buena(fc=int(t)))

    # Assert
    assert [m.fc for _, m in captura.desde(2.0)] == [2, 3]
    assert captura.ultimo_paquete == 3.0
    assert captura.desde(10.0) == []


def test_captura_limita_la_memoria_y_se_puede_limpiar():
    # Arrange
    captura = Captura(Reloj())

    # Act
    for _ in range(MAXIMO_RETENIDO + 50):
        captura.agregar(buena())

    # Assert
    assert len(captura.desde(-1)) == MAXIMO_RETENIDO
    captura.limpiar()
    assert captura.desde(-1) == []


# ---------------------------------------------------------------------------------- esperar_medicion

async def test_devuelve_la_medicion_en_cuanto_es_estable_sin_esperar_el_timeout():
    # Arrange
    captura = Captura(None)
    reloj = Reloj(al_dormir=lambda t: captura.agregar(buena()))
    captura._reloj = reloj

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=20)

    # Assert
    assert medicion.muestras == MUESTRAS_ESTABLES
    assert reloj.t < 5   # llegaron 5 muestras en ~5 pasos de 0,25 s: no esperó los 20 s


async def test_ignora_las_muestras_anteriores_al_inicio_de_la_medicion():
    # Arrange: llegaron datos "viejos" antes de pedir la medición y después no llega nada
    reloj = Reloj()
    captura = Captura(reloj)
    for _ in range(10):
        captura.agregar(buena())
    reloj.t = 100.0

    # Act
    with pytest.raises(ErrorMedicion) as error:
        await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=3)

    # Assert
    assert error.value.codigo == "timeout"


async def test_si_el_dedo_no_se_detecta_falla_al_cumplirse_el_tiempo():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)
    reloj.al_dormir = lambda t: captura.agregar(sin_dedo())

    # Act
    with pytest.raises(ErrorMedicion) as error:
        await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=5)

    # Assert
    assert error.value.codigo == "lectura_invalida"
    assert reloj.t >= 5


async def test_si_la_lectura_nunca_se_estabiliza_el_fallo_es_movimiento():
    # Arrange
    reloj = Reloj()
    captura = Captura(reloj)
    valores = iter([(90, 60), (99, 82)] * 100)
    reloj.al_dormir = lambda t: captura.agregar(buena(*next(valores)))

    # Act
    with pytest.raises(ErrorMedicion) as error:
        await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=5)

    # Assert
    assert error.value.codigo == "movimiento"


async def test_el_dedo_que_se_coloca_tarde_igual_logra_medir_dentro_del_tiempo():
    # Arrange: primero sin dedo, luego lecturas buenas
    reloj = Reloj()
    captura = Captura(reloj)
    reloj.al_dormir = lambda t: captura.agregar(sin_dedo() if t < 3 else buena(98, 65))

    # Act
    medicion = await esperar_medicion(captura, reloj, reloj.dormir, timeout_s=20)

    # Assert
    assert (medicion.spo2, medicion.fc) == (98, 65)
    assert reloj.t < 10


def test_los_parametros_provisionales_son_los_documentados_en_el_readme():
    # Arrange / Act: cambiarlos debe ser una decisión explícita (y actualizar el README y esta prueba)
    from puente import captura

    # Assert
    assert (captura.MUESTRAS_ESTABLES, captura.TOLERANCIA_SPO2, captura.TOLERANCIA_FC, captura.TIMEOUT_POR_DEFECTO_S) == (5, 2, 5, 20.0)
