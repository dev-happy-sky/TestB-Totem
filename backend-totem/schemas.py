import datetime
from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from identidad import (
    MENSAJE_MATRICULA, fecha_nacimiento_valida, matricula_valida, normalizar_matricula, telefono_valido,
)


def _validar_matricula(valor: str) -> str:
    if not matricula_valida(valor):
        raise ValueError(MENSAJE_MATRICULA)
    return normalizar_matricula(valor)


class Estudiante(BaseModel):
    """Datos del socio que acompañan a la evaluación (solo se usan si el socio aún no existe)."""
    matricula: str
    nombre: str
    apellido: str = ""
    fecha_nacimiento: Optional[datetime.date] = None
    telefono: Optional[str] = None
    plan_membresia: Optional[str] = None

    _matricula = field_validator("matricula")(lambda cls, v: _validar_matricula(v))


class Mediciones(BaseModel):
    """Mediciones del tótem. Todas son opcionales: si un sensor falla, el motor lo trata como dato faltante (R.93)."""
    presionSys: Optional[int] = None
    presionDia: Optional[int] = None
    fcReposo: Optional[int] = None
    fcRecup: Optional[int] = None
    peso: Optional[str] = None
    imc: Optional[str] = None
    estatura: Optional[str] = None   # cm, escrita a mano en el tótem
    grasa: Optional[str] = None
    vo2Max: Optional[str] = None
    masaMuscular: Optional[str] = None
    spo2: Optional[int] = None   # saturación de oxígeno (%), del oxímetro


    @field_validator("estatura")
    @classmethod
    def _estatura_plausible(cls, valor):
        if valor is None or not str(valor).strip():
            return None
        try:
            cm = float(valor)
        except ValueError:
            raise ValueError("La estatura debe ser un número en centímetros")
        if not 100 <= cm <= 250:
            raise ValueError("La estatura debe estar entre 100 y 250 cm")
        return str(valor).strip()


class Entrenamiento(BaseModel):
    objetivo: str
    experiencia: str
    duracion: int
    diasSemana: Optional[int] = Field(default=None, ge=1, le=7)


# `banda_pecho` se conserva para evaluaciones antiguas: hoy la FC la mide el oxímetro.
SENSORES = ("tensiometro", "oximetro", "oximetro_recuperacion", "balanza", "prueba_esfuerzo", "banda_pecho")
CODIGOS_ERROR = ("desconectado", "timeout", "movimiento", "lectura_invalida", "error")


class Dispositivo(BaseModel):
    """Sensor que tomó las mediciones de un grupo (R.59) y su estado de calibración (R.60)."""
    id: str = Field(min_length=1, max_length=80)
    calibracion: Literal["vigente", "vencida", "desconocida"] = "desconocida"
    capturado_en: Optional[datetime.datetime] = None   # cuándo se tomó esa medición (R.58)


class ErrorMedicion(BaseModel):
    """Problema ocurrido durante una medición (R.65): sensor desconectado, lectura inválida, etc."""
    sensor: Literal["tensiometro", "oximetro", "oximetro_recuperacion", "balanza", "prueba_esfuerzo", "banda_pecho"]
    codigo: Literal["desconectado", "timeout", "movimiento", "lectura_invalida", "error"]
    mensaje: str = Field(max_length=200)
    ocurrido_en: Optional[datetime.datetime] = None


class Salud(BaseModel):
    sintomas: List[str]
    condiciones: List[str]
    lesionesPrevias: Optional[str] = Field(default=None, max_length=500)


class EvaluacionPayload(BaseModel):
    consentimiento: bool
    estudiante: Estudiante
    mediciones: Mediciones
    entrenamiento: Entrenamiento
    salud: Salud
    dispositivos: Dict[str, Dispositivo] = Field(default_factory=dict)
    errores_medicion: List[ErrorMedicion] = Field(default_factory=list, max_length=50)
    totem_serial: Optional[str] = None
    totem_sucursal: Optional[str] = None
    inicio: Optional[datetime.datetime] = None  # cuándo empezó la evaluación en el tótem (R.16)


    @field_validator("dispositivos")
    @classmethod
    def _sensores_conocidos(cls, valor):
        desconocidos = [clave for clave in valor if clave not in SENSORES]
        if desconocidos:
            raise ValueError(f"Sensor desconocido: {', '.join(desconocidos)}")
        return valor


class ValidacionPayload(BaseModel):
    """Decisión del encargado: confirma/ajusta la categoría o deriva a evaluación médica externa."""
    nivel_final: Literal["A1", "A2", "A3", "A4"]
    observaciones: Optional[str] = Field(default=None, max_length=2000)
    derivar: bool = False
    motivo: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _motivo_obligatorio_al_derivar(self):
        if self.derivar and not (self.motivo and self.motivo.strip()):
            raise ValueError("Debes indicar el motivo de la derivación")
        return self


class LoginPayload(BaseModel):
    username: str
    password: str


class PerfilActualizacion(BaseModel):
    """Datos que el propio personal puede cambiar. El correo (usuario) y el rol los define un administrador."""
    nombre: str
    apellido: str = ""
    sucursal: Optional[str] = None
    password_actual: Optional[str] = None
    password_nueva: Optional[str] = None

    @field_validator("nombre")
    @classmethod
    def _nombre(cls, v):
        v = v.strip()
        if not v or len(v) > 100:
            raise ValueError("El nombre es obligatorio (máximo 100 caracteres)")
        return v

    @field_validator("apellido")
    @classmethod
    def _apellido(cls, v):
        v = v.strip()
        if len(v) > 100:
            raise ValueError("El apellido admite hasta 100 caracteres")
        return v

    @field_validator("sucursal")
    @classmethod
    def _sucursal(cls, v):
        v = (v or "").strip()
        if len(v) > 100:
            raise ValueError("La sucursal admite hasta 100 caracteres")
        return v or None

    @model_validator(mode="after")
    def _cambio_de_contrasena(self):
        if self.password_nueva:
            if len(self.password_nueva) < 8:
                raise ValueError("La contraseña nueva debe tener al menos 8 caracteres")
            if not self.password_actual:
                raise ValueError("Indica tu contraseña actual para cambiarla")
        return self


class IdentificarPayload(BaseModel):
    matricula: str

    _matricula = field_validator("matricula")(lambda cls, v: _validar_matricula(v))


def _validar_fecha_nacimiento(valor):
    if valor is not None and not fecha_nacimiento_valida(valor, datetime.date.today()):
        raise ValueError("Fecha de nacimiento inválida")
    return valor


def _validar_telefono(valor):
    if valor is not None and valor.strip() and not telefono_valido(valor):
        raise ValueError("Teléfono inválido: usa solo números, espacios, + o guiones (6 a 29 caracteres)")
    return valor


class SocioRegistro(BaseModel):
    """Alta de un socio nuevo desde el tótem (R.3). Campos de la tabla `socios`."""
    model_config = ConfigDict(str_strip_whitespace=True)

    matricula: str
    nombre: str = Field(min_length=2, max_length=100)
    apellido: str = Field(min_length=2, max_length=100)
    fecha_nacimiento: datetime.date
    telefono: Optional[str] = None
    plan_membresia: str = Field(min_length=2, max_length=80)
    confirmar_duplicado: bool = False

    _matricula = field_validator("matricula")(lambda cls, v: _validar_matricula(v))
    _fecha = field_validator("fecha_nacimiento")(lambda cls, v: _validar_fecha_nacimiento(v))
    _telefono = field_validator("telefono")(lambda cls, v: _validar_telefono(v))


class SocioActualizacion(BaseModel):
    """Actualización de datos personales desactualizados (R.5). Un teléfono vacío lo borra."""
    model_config = ConfigDict(str_strip_whitespace=True)

    nombre: Optional[str] = Field(default=None, min_length=2, max_length=100)
    apellido: Optional[str] = Field(default=None, min_length=2, max_length=100)
    fecha_nacimiento: Optional[datetime.date] = None
    telefono: Optional[str] = None
    plan_membresia: Optional[str] = Field(default=None, min_length=2, max_length=80)

    _fecha = field_validator("fecha_nacimiento")(lambda cls, v: _validar_fecha_nacimiento(v))
    _telefono = field_validator("telefono")(lambda cls, v: _validar_telefono(v))

    @model_validator(mode="after")
    def _al_menos_un_dato(self):
        if all(getattr(self, c) is None for c in ("nombre", "apellido", "fecha_nacimiento", "telefono", "plan_membresia")):
            raise ValueError("Indica al menos un dato para actualizar")
        return self


class ValidarMedicionesPayload(BaseModel):
    validado: bool = True
