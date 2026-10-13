"""Modelo de datos (diagrama drawSQL). Las columnas marcadas EXT no están en el diagrama original
y se agregaron para no perder datos que ya envía el tótem."""
import datetime
import uuid

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Text, Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

JSONType = JSON().with_variant(JSONB(), "postgresql")


def _uuid():
    return uuid.uuid4()


def _ahora():
    return datetime.datetime.now(datetime.timezone.utc)


def _ts():
    return DateTime(timezone=True)


class Socio(Base):
    __tablename__ = "socios"

    id = Column(Uuid, primary_key=True, default=_uuid)
    # Identificador del socio. Este gimnasio es universitario: en esta columna se guarda la MATRÍCULA (normalizada).
    rut = Column(String(20), unique=True, nullable=False)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False, default="")
    fecha_nacimiento = Column(Date, nullable=True)  # EXT: nullable porque los registros antiguos solo tienen la edad
    edad_declarada = Column(Integer, nullable=True)  # EXT: solo de registros antiguos; la edad se calcula de fecha_nacimiento
    telefono = Column(String(30), nullable=True)
    plan_membresia = Column(String(80), nullable=True)
    created_at = Column(_ts(), default=_ahora, nullable=False)

    sesiones = relationship("SesionTotem", back_populates="socio")


class Totem(Base):
    __tablename__ = "totems"

    id = Column(Uuid, primary_key=True, default=_uuid)
    codigo_serial = Column(String(80), unique=True, nullable=False)
    ubicacion = Column(String(160), nullable=True)
    sucursal = Column(String(100), nullable=True)
    version_firmware = Column(String(50), nullable=True)
    activo = Column(Boolean, default=True, nullable=False)
    ultimo_heartbeat = Column(_ts(), nullable=True)


class PersonalGimnasio(Base):
    __tablename__ = "personal_gimnasio"

    id = Column(Uuid, primary_key=True, default=_uuid)
    nombre = Column(String(100), nullable=False)
    apellido = Column(String(100), nullable=False, default="")
    rol = Column(Enum("admin", "encargado", name="rol_personal"), nullable=False)
    sucursal = Column(String(100), nullable=True)
    email = Column(String(255), unique=True, nullable=False)  # también es el nombre de usuario del login
    activo = Column(Boolean, default=True, nullable=False)
    password_hash = Column(String, nullable=False)  # EXT: autenticación del dashboard


class SesionTotem(Base):
    __tablename__ = "sesiones_totem"

    id = Column(Uuid, primary_key=True, default=_uuid)
    socio_id = Column(Uuid, ForeignKey("socios.id"), nullable=False, index=True)
    totem_id = Column(Uuid, ForeignKey("totems.id"), nullable=False)
    personal_id = Column(Uuid, ForeignKey("personal_gimnasio.id"), nullable=True)
    inicio_sesion = Column(_ts(), default=_ahora, nullable=False)
    fin_sesion = Column(_ts(), nullable=True)
    estado = Column(String(40), default="pendiente", nullable=False)  # pendiente | validada
    ip_totem = Column(String(45), nullable=True)
    consentimiento = Column(Boolean, default=False, nullable=False)  # EXT (R.183)
    consentimiento_en = Column(_ts(), nullable=True)  # EXT

    socio = relationship("Socio", back_populates="sesiones")
    totem = relationship("Totem")
    mediciones = relationship("MedicionCorporal", back_populates="sesion", order_by="MedicionCorporal.capturado_en")
    cuestionario = relationship("CuestionarioObjetivo", back_populates="sesion", uselist=False)
    inferencia = relationship("InferenciaIA", back_populates="sesion", uselist=False)
    resultado = relationship("ResultadoRutina", back_populates="sesion", uselist=False)


class MedicionCorporal(Base):
    __tablename__ = "mediciones_corporales"

    id = Column(Uuid, primary_key=True, default=_uuid)
    sesion_id = Column(Uuid, ForeignKey("sesiones_totem.id"), nullable=False, index=True)
    peso_kg = Column(Float, nullable=True)
    porcentaje_grasa = Column(Float, nullable=True)
    masa_muscular_kg = Column(Float, nullable=True)
    frecuencia_cardiaca = Column(Float, nullable=True)
    presion_sistolica = Column(Float, nullable=True)
    presion_diastolica = Column(Float, nullable=True)
    capturado_en = Column(_ts(), default=_ahora, nullable=False)
    validado = Column(Boolean, default=False, nullable=False)
    fc_recuperacion = Column(Float, nullable=True)  # EXT
    imc = Column(Float, nullable=True)  # EXT
    vo2_max = Column(Float, nullable=True)  # EXT
    temperatura_c = Column(Float, nullable=True)  # EXT (R.43, aún sin sensor)
    saturacion_oxigeno = Column(Float, nullable=True)  # EXT (R.44, aún sin sensor)
    dispositivos = Column(JSONType, nullable=True)  # EXT: sensor, calibración y hora de cada grupo de mediciones (R.58-R.60)
    errores_medicion = Column(JSONType, nullable=True)  # EXT: problemas ocurridos al medir (R.65)

    sesion = relationship("SesionTotem", back_populates="mediciones")


class CuestionarioObjetivo(Base):
    __tablename__ = "cuestionarios_objetivos"

    id = Column(Uuid, primary_key=True, default=_uuid)
    sesion_id = Column(Uuid, ForeignKey("sesiones_totem.id"), nullable=False, unique=True)
    objetivo_principal = Column(String(100), nullable=True)
    nivel_experiencia = Column(String(50), nullable=True)
    dias_disponibles_semana = Column(Integer, nullable=True)  # el tótem aún no lo pregunta
    lesiones_previas = Column(Text, nullable=True)
    antecedentes_cronicos = Column(Boolean, default=False, nullable=False)
    respondido_en = Column(_ts(), default=_ahora, nullable=False)
    duracion_sesion_min = Column(Integer, nullable=True)  # EXT
    sintomas = Column(JSONType, nullable=True)  # EXT
    condiciones = Column(JSONType, nullable=True)  # EXT

    sesion = relationship("SesionTotem", back_populates="cuestionario")


class InferenciaIA(Base):
    __tablename__ = "inferencias_ia"

    id = Column(Uuid, primary_key=True, default=_uuid)
    sesion_id = Column(Uuid, ForeignKey("sesiones_totem.id"), nullable=False, unique=True)
    rutina_sugerida = Column(Text, nullable=False)
    confianza_modelo = Column(Float, nullable=True)  # EXT: nullable, las reglas actuales no calculan confianza
    version_modelo = Column(String(80), nullable=False)
    features_entrada = Column(JSONType, nullable=True)
    latencia_ms = Column(Float, nullable=True)
    generado_en = Column(_ts(), default=_ahora, nullable=False)
    categoria_aptitud = Column(String(10), nullable=True)  # EXT: A1..A4
    alerta = Column(String(40), nullable=True)  # EXT
    alerta_nivel = Column(String(10), nullable=True)  # EXT: "critica" | "riesgo" (R.125)
    reglas_aplicadas = Column(JSONType, nullable=True)  # EXT: reglas que dispararon la decisión (R.115)
    requiere_revision = Column(Boolean, default=False)  # EXT: baja confianza o información insuficiente (R.102, R.113)
    motivo_revision = Column(String(300), nullable=True)  # EXT
    alerta_revisada_por = Column(Uuid, ForeignKey("personal_gimnasio.id"), nullable=True)  # EXT (R.140)
    alerta_revisada_en = Column(_ts(), nullable=True)  # EXT (R.140)

    sesion = relationship("SesionTotem", back_populates="inferencia")
    revisor_alerta = relationship("PersonalGimnasio", foreign_keys=[alerta_revisada_por])


class ResultadoRutina(Base):
    __tablename__ = "resultados_rutina"

    id = Column(Uuid, primary_key=True, default=_uuid)
    sesion_id = Column(Uuid, ForeignKey("sesiones_totem.id"), nullable=False, unique=True)
    inferencia_id = Column(Uuid, ForeignKey("inferencias_ia.id"), nullable=False)
    personal_id = Column(Uuid, ForeignKey("personal_gimnasio.id"), nullable=True)
    rutina_final = Column(Text, nullable=False)
    decision_personal = Column(String(60), nullable=False)  # confirmada | modificada
    observaciones = Column(Text, nullable=True)
    asignado_en = Column(_ts(), default=_ahora, nullable=False)
    nivel_final = Column(String(10), nullable=True)  # EXT: A1..A4
    motivo_derivacion = Column(Text, nullable=True)  # EXT (R.107)

    sesion = relationship("SesionTotem", back_populates="resultado")
    personal = relationship("PersonalGimnasio", foreign_keys=[personal_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Uuid, primary_key=True, default=_uuid)
    sesion_id = Column(Uuid, ForeignKey("sesiones_totem.id"), nullable=True)  # EXT: nullable (login, accesos)
    personal_id = Column(Uuid, ForeignKey("personal_gimnasio.id"), nullable=True)
    accion = Column(String(100), nullable=False)
    detalle = Column(JSONType, nullable=True)
    ocurrido_en = Column(_ts(), default=_ahora, nullable=False, index=True)
