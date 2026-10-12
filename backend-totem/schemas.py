import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from identidad import MENSAJE_MATRICULA, matricula_valida, normalizar_matricula


def _validar_matricula(valor: str) -> str:
    if not matricula_valida(valor):
        raise ValueError(MENSAJE_MATRICULA)
    return normalizar_matricula(valor)


class Estudiante(BaseModel):
    nombre: str
    matricula: str
    edad: str
    carrera: str

    _matricula = field_validator("matricula")(lambda cls, v: _validar_matricula(v))


class Mediciones(BaseModel):
    presionSys: int
    presionDia: int
    fcReposo: int
    fcRecup: int
    peso: str
    imc: str
    grasa: str
    vo2Max: str


class Entrenamiento(BaseModel):
    objetivo: str
    experiencia: str
    duracion: int


class Salud(BaseModel):
    sintomas: List[str]
    condiciones: List[str]


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


class SocioRegistro(BaseModel):
    """Alta de un socio nuevo desde el tótem (R.3)."""
    model_config = ConfigDict(str_strip_whitespace=True)

    matricula: str
    nombre: str = Field(min_length=2, max_length=200)
    carrera: str = Field(min_length=2, max_length=120)
    edad: int = Field(ge=1, le=120)
    confirmar_duplicado: bool = False

    _matricula = field_validator("matricula")(lambda cls, v: _validar_matricula(v))


class SocioActualizacion(BaseModel):
    """Actualización de datos personales desactualizados (R.5)."""
    model_config = ConfigDict(str_strip_whitespace=True)

    nombre: Optional[str] = Field(default=None, min_length=2, max_length=200)
    carrera: Optional[str] = Field(default=None, min_length=2, max_length=120)
    edad: Optional[int] = Field(default=None, ge=1, le=120)

    @model_validator(mode="after")
    def _al_menos_un_dato(self):
        if self.nombre is None and self.carrera is None and self.edad is None:
            raise ValueError("Indica al menos un dato para actualizar")
        return self
