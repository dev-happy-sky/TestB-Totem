"""Motor de reglas de aptitud física.

Python puro: no importa FastAPI ni SQLAlchemy, así que se prueba sin base de datos. Todos los rangos y umbrales
viven en `reglas_aptitud.json` (versionado, provisional hasta que lo revise un profesional). El motor es una
herramienta de apoyo para el encargado del gimnasio; no reemplaza el criterio de un profesional.

Categorías: A1 requiere evaluación médica · A2 apto con precaución · A3 apto con intensidad moderada · A4 apto.
"""
import json
import os
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Optional

RUTA_POR_DEFECTO = Path(__file__).with_name("reglas_aptitud.json")
GRAVEDAD = {"leve": 1, "precaucion": 2, "critico": 3}
CATEGORIA_POR_GRAVEDAD = {0: "A4", 1: "A3", 2: "A2", 3: "A1"}
GRAVEDAD_POR_CATEGORIA = {c: g for g, c in CATEGORIA_POR_GRAVEDAD.items()}
VITALES = ("presion_sistolica", "presion_diastolica", "fc_reposo", "imc")


class ConfiguracionInvalida(Exception):
    pass


@dataclass(frozen=True)
class Entrada:
    """Datos de una evaluación, ya preparados: lo que no se midió o es inválido es None."""
    sintomas: tuple = ()
    condiciones: tuple = ()
    lesiones_previas: Optional[str] = None
    presion_sistolica: Optional[float] = None
    presion_diastolica: Optional[float] = None
    fc_reposo: Optional[float] = None
    fc_recuperacion: Optional[float] = None
    imc: Optional[float] = None
    calibracion_vencida: tuple = ()   # sensores (claves de `dispositivos`) con la calibración vencida


@dataclass(frozen=True)
class Hallazgo:
    id: str
    descripcion: str
    severidad: str          # leve | precaucion | critico
    genera_alerta: bool = False
    valor: Optional[float] = None


@dataclass(frozen=True)
class Resultado:
    categoria: str
    intensidad: str
    rutina: str
    confianza: float
    alerta: Optional[str]
    nivel_alerta: Optional[str]
    factores: tuple
    hallazgos: tuple
    requiere_revision: bool
    motivo_revision: Optional[str]
    version: str


# ------------------------------------------------------------------------------------ configuración

def _exigir(condicion: bool, mensaje: str):
    if not condicion:
        raise ConfiguracionInvalida(mensaje)


def validar_configuracion(cfg: dict) -> dict:
    _exigir(isinstance(cfg.get("version"), str) and cfg["version"], "Falta 'version'")
    umbral = cfg.get("umbral_baja_confianza")
    _exigir(isinstance(umbral, (int, float)) and 0 < umbral <= 1, "'umbral_baja_confianza' debe estar entre 0 y 1")
    for categoria in GRAVEDAD_POR_CATEGORIA:
        info = cfg.get("categorias", {}).get(categoria, {})
        _exigir(info.get("nombre") and info.get("intensidad"), f"La categoría {categoria} necesita 'nombre' e 'intensidad'")
    for clave in VITALES:
        vital = cfg.get("signos_vitales", {}).get(clave)
        _exigir(vital is not None, f"Falta el signo vital '{clave}'")
        _exigir(vital.get("etiqueta") and vital.get("unidad"), f"'{clave}' necesita 'etiqueta' y 'unidad'")
        validos = vital.get("validos", {})
        _exigir(validos.get("min") is not None and validos.get("max") is not None and validos["min"] < validos["max"],
                f"'{clave}': 'validos' necesita min < max")
        _validar_umbrales(clave, vital)
    cuestionario = cfg.get("cuestionario", {})
    _exigir(isinstance(cuestionario.get("sintomas_criticos"), list), "Falta 'cuestionario.sintomas_criticos'")
    _exigir(isinstance(cuestionario.get("condiciones_criticas"), list), "Falta 'cuestionario.condiciones_criticas'")
    dispositivos = cfg.get("dispositivos")
    _exigir(isinstance(dispositivos, dict) and dispositivos and all(isinstance(v, str) for v in dispositivos.values()),
            "Falta 'dispositivos' (nombre legible de cada sensor)")
    for clave in ("base", "falta_presion", "falta_fc", "falta_imc", "medicion_invalida", "inconsistencia", "calibracion_vencida", "minimo"):
        valor = cfg.get("confianza", {}).get(clave)
        _exigir(isinstance(valor, (int, float)) and valor >= 0, f"'confianza.{clave}' debe ser un número >= 0")
    return cfg


def _validar_umbrales(clave: str, vital: dict):
    precaucion, critico = vital.get("precaucion_si", {}), vital.get("critico_si", {})
    _exigir(isinstance(precaucion, dict) and isinstance(critico, dict), f"'{clave}': faltan los umbrales")
    if "menor_que" in critico and "menor_que" in precaucion:
        _exigir(critico["menor_que"] <= precaucion["menor_que"], f"'{clave}': el umbral crítico bajo debe ser <= al de precaución")
    if "mayor_o_igual_que" in critico and "mayor_o_igual_que" in precaucion:
        _exigir(critico["mayor_o_igual_que"] >= precaucion["mayor_o_igual_que"], f"'{clave}': el umbral crítico alto debe ser >= al de precaución")


def cargar_configuracion(ruta=None) -> dict:
    """Lee y valida el archivo de reglas (por defecto `REGLAS_APTITUD_PATH` o el que viene con el código)."""
    ruta = Path(ruta or os.getenv("REGLAS_APTITUD_PATH") or RUTA_POR_DEFECTO)
    try:
        cfg = json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ConfiguracionInvalida(f"No se pudo leer {ruta}: {error}") from error
    return validar_configuracion(cfg)


# ------------------------------------------------------------------------------------ signos vitales

def _fuera_de(valor: float, umbrales: dict) -> bool:
    bajo, alto = umbrales.get("menor_que"), umbrales.get("mayor_o_igual_que")
    return (bajo is not None and valor < bajo) or (alto is not None and valor >= alto)


def _prepara_vitales(entrada: Entrada, cfg: dict):
    """Devuelve (valores usables, faltantes, inválidos). Un valor fuera de lo físicamente posible se descarta."""
    valores, faltantes, invalidos = {}, [], []
    for clave in VITALES:
        crudo = getattr(entrada, clave)
        etiqueta = cfg["signos_vitales"][clave]["etiqueta"]
        validos = cfg["signos_vitales"][clave]["validos"]
        if crudo is None:
            faltantes.append(clave)
        elif not validos["min"] <= crudo <= validos["max"]:
            invalidos.append((clave, f"{etiqueta} {crudo} fuera de lo posible"))
        else:
            valores[clave] = crudo
    sistolica, diastolica = valores.get("presion_sistolica"), valores.get("presion_diastolica")
    if sistolica is not None and diastolica is not None and sistolica <= diastolica:
        for clave in ("presion_sistolica", "presion_diastolica"):
            valores.pop(clave)
        invalidos.append(("presion_sistolica", "La presión sistólica debe ser mayor que la diastólica"))
    return valores, faltantes, invalidos


def _hallazgos_vitales(valores: dict, cfg: dict) -> list:
    hallazgos = []
    for clave, valor in valores.items():
        vital = cfg["signos_vitales"][clave]
        texto = f"{vital['etiqueta']} {valor:g} {vital['unidad']}"
        if vital["critico_si"] and _fuera_de(valor, vital["critico_si"]):
            hallazgos.append(Hallazgo(f"{clave.upper()}_CRITICA", f"{texto}: en rango crítico", "critico", True, valor))
        elif _fuera_de(valor, vital["precaucion_si"]):
            hallazgos.append(Hallazgo(f"{clave.upper()}_FUERA_DE_RANGO", f"{texto}: fuera del rango normal", "precaucion",
                                      bool(vital.get("genera_alerta")), valor))
    return hallazgos


# ------------------------------------------------------------------------------------ cuestionario

def _hallazgos_cuestionario(entrada: Entrada, cfg: dict) -> list:
    cuestionario = cfg["cuestionario"]
    hallazgos = []
    for sintoma in entrada.sintomas:
        critico = sintoma in cuestionario["sintomas_criticos"]
        hallazgos.append(Hallazgo("SINTOMA_CRITICO" if critico else "SINTOMA_DECLARADO", f"Síntoma declarado: {sintoma}",
                                  "critico" if critico else "precaucion", True))
    for condicion in entrada.condiciones:
        if condicion in cuestionario["condiciones_criticas"]:
            hallazgos.append(Hallazgo("CONDICION_CRITICA", f"Condición crítica: {condicion}", "critico", True))
        else:
            hallazgos.append(Hallazgo("CONDICION_DECLARADA", f"Condición declarada: {condicion}", "leve"))
    if (entrada.lesiones_previas or "").strip():
        hallazgos.append(Hallazgo("LESIONES_PREVIAS", "Lesiones previas declaradas", "leve"))
    return hallazgos


def _inconsistencias(entrada: Entrada, valores: dict, cfg: dict) -> list:
    """R.117: diferencias entre las mediciones y lo que respondió el usuario."""
    problemas = []
    limite = cfg["consistencia"]["presion_elevada_sin_antecedente"]
    sistolica, diastolica = valores.get("presion_sistolica"), valores.get("presion_diastolica")
    elevada = (sistolica is not None and sistolica >= limite["sistolica"]) or (diastolica is not None and diastolica >= limite["diastolica"])
    if elevada and cfg["consistencia"]["antecedente_hipertension"] not in entrada.condiciones:
        problemas.append("Presión elevada sin antecedente de hipertensión declarado")
    if entrada.fc_recuperacion is not None and valores.get("fc_reposo") is not None and entrada.fc_recuperacion < valores["fc_reposo"]:
        problemas.append("La FC de recuperación es menor que la FC en reposo")
    return problemas


# ------------------------------------------------------------------------------------ confianza y decisión

def _confianza(faltantes: list, invalidos: list, inconsistencias: list, vencidos: tuple, cfg: dict) -> float:
    c = cfg["confianza"]
    descuento = (len(invalidos) * c["medicion_invalida"] + len(inconsistencias) * c["inconsistencia"]
                 + len(vencidos) * c["calibracion_vencida"])
    invalidas = {clave for clave, _ in invalidos}
    if {"presion_sistolica", "presion_diastolica"} & set(faltantes) and not {"presion_sistolica", "presion_diastolica"} & invalidas:
        descuento += c["falta_presion"]
    if "fc_reposo" in faltantes:
        descuento += c["falta_fc"]
    if "imc" in faltantes:
        descuento += c["falta_imc"]
    return round(max(c["minimo"], c["base"] - descuento), 2)


def _alerta(hallazgos: list, requiere_revision: bool):
    if any(h.severidad == "critico" for h in hallazgos):
        return "DERIVAR", "critica"
    if any(h.severidad == "precaucion" and h.genera_alerta for h in hallazgos):
        return "DERIVAR", "riesgo"
    if requiere_revision:
        return "REVISAR", "riesgo"
    return None, None


def rutina_para(categoria: str, cfg: dict) -> str:
    info = cfg["categorias"].get(categoria)
    return f"{info['nombre']}. {info['intensidad']}." if info else f"Categoría de aptitud {categoria}"


def _factores(hallazgos: list, faltantes: list, invalidos: list, inconsistencias: list, vencidos: tuple, cfg: dict) -> tuple:
    etiquetas = cfg["signos_vitales"]
    factores = [h.descripcion for h in hallazgos]
    factores += [f"Calibración vencida: {cfg['dispositivos'].get(clave, clave)}" for clave in vencidos]
    factores += [f"Inconsistencia: {texto}" for texto in inconsistencias]
    factores += [f"Dato inválido: {texto}" for _, texto in invalidos]
    factores += [f"Dato faltante: {etiquetas[clave]['etiqueta']}" for clave in faltantes]
    return tuple(factores)


def evaluar(entrada: Entrada, cfg: dict) -> Resultado:
    valores, faltantes, invalidos = _prepara_vitales(entrada, cfg)
    hallazgos = _hallazgos_cuestionario(entrada, cfg) + _hallazgos_vitales(valores, cfg)
    inconsistencias = _inconsistencias(entrada, valores, cfg)
    vencidos = tuple(sorted(set(entrada.calibracion_vencida)))
    confianza = _confianza(faltantes, invalidos, inconsistencias, vencidos, cfg)
    factores = _factores(hallazgos, faltantes, invalidos, inconsistencias, vencidos, cfg)

    gravedad = max((GRAVEDAD[h.severidad] for h in hallazgos), default=0)
    categoria = CATEGORIA_POR_GRAVEDAD[gravedad]
    requiere_revision = confianza < cfg["umbral_baja_confianza"]
    motivo = None
    if requiere_revision:
        causas = []
        if {"presion_sistolica", "presion_diastolica"} & set(faltantes):
            causas.append("falta la presión arterial")
        if "fc_reposo" in faltantes:
            causas.append("falta la frecuencia cardíaca en reposo")
        causas += [texto.lower() for _, texto in invalidos] + [texto.lower() for texto in inconsistencias]
        causas += [f"calibración vencida de {cfg['dispositivos'].get(clave, clave).lower()}" for clave in vencidos]
        motivo = f"Confianza baja ({round(confianza * 100)}%): " + ("; ".join(causas) or "datos incompletos")
    alerta, nivel = _alerta(hallazgos, requiere_revision)
    return Resultado(
        categoria=categoria, intensidad=cfg["categorias"][categoria]["intensidad"], rutina=rutina_para(categoria, cfg),
        confianza=confianza, alerta=alerta, nivel_alerta=nivel, factores=factores, hallazgos=tuple(hallazgos),
        requiere_revision=requiere_revision, motivo_revision=motivo, version=cfg["version"],
    )


# ------------------------------------------------------------------------------------ modelo de ML (opcional)

def fusionar_prediccion(resultado: Resultado, cfg: dict, categoria_modelo: str, probabilidad: float, version_modelo: str) -> Resultado:
    """Combina las reglas con un modelo de ML ya entrenado.

    Seguridad primero: la categoría final es la MÁS GRAVE entre la de las reglas y la del modelo, de modo que el
    modelo nunca puede declarar apto a quien las reglas marcan como riesgo. La confianza es la menor de las dos.
    """
    gravedad = max(GRAVEDAD_POR_CATEGORIA[resultado.categoria], GRAVEDAD_POR_CATEGORIA[categoria_modelo])
    categoria = CATEGORIA_POR_GRAVEDAD[gravedad]
    confianza = round(min(resultado.confianza, probabilidad), 2)
    requiere_revision = confianza < cfg["umbral_baja_confianza"]
    motivo = resultado.motivo_revision
    if requiere_revision and not motivo:
        motivo = f"Confianza baja ({round(confianza * 100)}%): el modelo no está seguro de su clasificación"
    alerta, nivel = resultado.alerta, resultado.nivel_alerta
    if categoria == "A1" and nivel != "critica":
        alerta, nivel = "DERIVAR", "riesgo"
    elif alerta is None and requiere_revision:
        alerta, nivel = "REVISAR", "riesgo"
    factores = resultado.factores + (f"El modelo de IA sugiere {categoria_modelo} (probabilidad {round(probabilidad * 100)}%)",)
    return replace(
        resultado, categoria=categoria, intensidad=cfg["categorias"][categoria]["intensidad"],
        rutina=rutina_para(categoria, cfg), confianza=confianza, alerta=alerta, nivel_alerta=nivel, factores=factores,
        requiere_revision=requiere_revision, motivo_revision=motivo, version=f"{version_modelo}+{resultado.version}",
    )
