import datetime
from typing import List, Literal, Optional
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
    grasa: Optional[str] = None
    vo2Max: Optional[str] = None
    masaMuscular: Optional[str] = None


class Entrenamiento(BaseModel):
    objetivo: str
    experiencia: str
    duracion: int
    diasSemana: Optional[int] = Field(default=None, ge=1, le=7)


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
    totem_serial: Optional[str] = None
    totem_sucursal: Optional[str] = None
    inicio: Optional[datetime.datetime] = None  # cuándo empezó la evaluación en el tótem (R.16)


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
