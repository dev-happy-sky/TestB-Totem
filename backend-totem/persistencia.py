"""Guardado y lectura de evaluaciones sobre el modelo de datos (socios, sesiones, mediciones, ...)."""
import datetime
import os
import time
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from models import (
    AuditLog, CuestionarioObjetivo, InferenciaIA, MedicionCorporal, ResultadoRutina,
    SesionTotem, Socio, Totem,
)
from schemas import EvaluacionPayload

VERSION_MODELO = "reglas-v1"
TOTEM_SERIAL_DEFAULT = os.getenv("TOTEM_SERIAL_DEFAULT", "TOTEM-001")
CONDICIONES_CRONICAS = {"Asma", "Hipertensión", "Diabetes", "Problema cardíaco"}

RUTINAS = {
    "A2": "Entrenamiento con precaución; derivar a evaluación profesional antes de intensidad alta",
    "A3": "Apto para entrenar con normalidad",
}


def _ahora():
    return datetime.datetime.now(datetime.timezone.utc)


def _a_float(valor) -> Optional[float]:
    try:
        return float(valor)
    except (TypeError, ValueError):
        return None


def _a_int(valor) -> Optional[int]:
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def evaluar_reglas(payload: EvaluacionPayload):
    """Regla provisional (mientras no exista el modelo de IA): síntomas declarados => precaución."""
    tiene_riesgos = len(payload.salud.sintomas) > 0
    categoria = "A2" if tiene_riesgos else "A3"
    alerta = "DERIVAR" if tiene_riesgos else None
    return categoria, alerta, RUTINAS[categoria]


def _obtener_o_crear_socio(db: Session, payload: EvaluacionPayload) -> Socio:
    est = payload.estudiante
    rut = est.matricula.strip()
    partes = est.nombre.strip().split(" ", 1)
    nombre, apellido = partes[0], (partes[1] if len(partes) > 1 else "")
    socio = db.query(Socio).filter(Socio.rut == rut).first()
    if not socio:
        socio = Socio(rut=rut, nombre=nombre, apellido=apellido)
        db.add(socio)
    socio.nombre, socio.apellido = nombre, apellido
    socio.edad_declarada = _a_int(est.edad)
    socio.plan_membresia = est.carrera
    db.flush()
    return socio


def _obtener_o_crear_totem(db: Session, serial: Optional[str]) -> Totem:
    serial = (serial or TOTEM_SERIAL_DEFAULT).strip()
    totem = db.query(Totem).filter(Totem.codigo_serial == serial).first()
    if not totem:
        totem = Totem(codigo_serial=serial)
        db.add(totem)
    totem.ultimo_heartbeat = _ahora()
    db.flush()
    return totem


def guardar_evaluacion(db: Session, payload: EvaluacionPayload, ip: Optional[str] = None,
                       fecha: Optional[datetime.datetime] = None) -> SesionTotem:
    """Persiste una evaluación completa en una sola transacción y devuelve la sesión creada."""
    inicio = time.perf_counter()
    fecha = fecha or _ahora()
    socio = _obtener_o_crear_socio(db, payload)
    totem = _obtener_o_crear_totem(db, payload.totem_serial)

    sesion = SesionTotem(
        socio_id=socio.id, totem_id=totem.id, inicio_sesion=fecha, fin_sesion=fecha, estado="pendiente",
        ip_totem=ip, consentimiento=payload.consentimiento,
        consentimiento_en=fecha if payload.consentimiento else None,
    )
    db.add(sesion)
    db.flush()

    m = payload.mediciones
    db.add(MedicionCorporal(
        sesion_id=sesion.id, capturado_en=fecha,
        peso_kg=_a_float(m.peso), porcentaje_grasa=_a_float(m.grasa), imc=_a_float(m.imc),
        vo2_max=_a_float(m.vo2Max), frecuencia_cardiaca=m.fcReposo, fc_recuperacion=m.fcRecup,
        presion_sistolica=m.presionSys, presion_diastolica=m.presionDia,
    ))

    ent, salud = payload.entrenamiento, payload.salud
    db.add(CuestionarioObjetivo(
        sesion_id=sesion.id, respondido_en=fecha,
        objetivo_principal=ent.objetivo, nivel_experiencia=ent.experiencia, duracion_sesion_min=ent.duracion,
        lesiones_previas=", ".join(c for c in salud.condiciones if "esión" in c) or None,
        antecedentes_cronicos=any(c in CONDICIONES_CRONICAS for c in salud.condiciones),
        sintomas=salud.sintomas, condiciones=salud.condiciones,
    ))

    categoria, alerta, rutina = evaluar_reglas(payload)
    db.add(InferenciaIA(
        sesion_id=sesion.id, rutina_sugerida=rutina, version_modelo=VERSION_MODELO, generado_en=fecha,
        features_entrada={"mediciones": m.model_dump(), "salud": salud.model_dump(), "entrenamiento": ent.model_dump()},
        latencia_ms=round((time.perf_counter() - inicio) * 1000, 2),
        categoria_aptitud=categoria, alerta=alerta,
    ))
    db.commit()
    return cargar_sesion(db, sesion.id)


def _consulta_sesiones(db: Session):
    return db.query(SesionTotem).options(
        joinedload(SesionTotem.socio), joinedload(SesionTotem.mediciones), joinedload(SesionTotem.cuestionario),
        joinedload(SesionTotem.inferencia), joinedload(SesionTotem.resultado),
    )


def cargar_sesion(db: Session, sesion_id) -> Optional[SesionTotem]:
    return _consulta_sesiones(db).filter(SesionTotem.id == sesion_id).first()


def listar_sesiones(db: Session, limite: int = 100):
    return _consulta_sesiones(db).order_by(SesionTotem.inicio_sesion.desc()).limit(limite).all()


def validar_sesion(db: Session, sesion: SesionTotem, nivel_final: str, personal_id=None) -> ResultadoRutina:
    """El encargado confirma (mismo nivel que la IA) o modifica la categoría sugerida."""
    inf = sesion.inferencia
    decision = "confirmada" if nivel_final == inf.categoria_aptitud else "modificada"
    res = sesion.resultado
    if not res:
        res = ResultadoRutina(sesion_id=sesion.id, inferencia_id=inf.id, rutina_final="", decision_personal=decision)
        db.add(res)
    res.personal_id = personal_id
    res.nivel_final = nivel_final
    res.decision_personal = decision
    res.rutina_final = RUTINAS.get(nivel_final, f"Categoría de aptitud {nivel_final}")
    res.asignado_en = _ahora()
    sesion.estado = "validada"
    sesion.personal_id = personal_id
    db.commit()
    return res


def serializar_sesion(sesion: SesionTotem) -> dict:
    """Formato que consume el dashboard (se mantiene el contrato anterior)."""
    socio, inf, res = sesion.socio, sesion.inferencia, sesion.resultado
    med = sesion.mediciones[-1] if sesion.mediciones else None
    cues = sesion.cuestionario

    def fmt(v):
        return "" if v is None else str(round(v, 1))

    return {
        "idBaseDatos": str(sesion.id),
        "idUnico": f"db_{sesion.id}",
        "id": socio.rut,
        "nombre": f"{socio.nombre} {socio.apellido}".strip(),
        "carrera": socio.plan_membresia or "",
        "edad": "" if socio.edad_declarada is None else str(socio.edad_declarada),
        "objetivo": cues.objetivo_principal if cues else "",
        "iaSugerida": inf.categoria_aptitud if inf else None,
        "alerta": inf.alerta if inf else None,
        "mediciones": {
            "presionSys": int(med.presion_sistolica) if med and med.presion_sistolica is not None else None,
            "presionDia": int(med.presion_diastolica) if med and med.presion_diastolica is not None else None,
            "fcReposo": int(med.frecuencia_cardiaca) if med and med.frecuencia_cardiaca is not None else None,
            "fcRecup": int(med.fc_recuperacion) if med and med.fc_recuperacion is not None else None,
            "peso": fmt(med.peso_kg) if med else "",
            "imc": fmt(med.imc) if med else "",
            "grasa": fmt(med.porcentaje_grasa) if med else "",
            "vo2Max": fmt(med.vo2_max) if med else "",
        },
        "salud": {"sintomas": (cues.sintomas or []) if cues else [], "condiciones": (cues.condiciones or []) if cues else []},
        "estado": "validado" if sesion.estado == "validada" else "pendiente",
        "nivelFinal": res.nivel_final if res else None,
        "tiempoEspera": "Registrado",
    }


def registrar_auditoria(db: Session, accion: str, usuario=None, rol=None, recurso=None, ip=None,
                        personal_id=None, sesion_id=None):
    db.add(AuditLog(
        accion=accion, personal_id=personal_id, sesion_id=sesion_id,
        detalle={"usuario": usuario, "rol": rol, "recurso": recurso, "ip": ip},
    ))
    db.commit()
