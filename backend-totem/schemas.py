from typing import List, Literal, Optional
from pydantic import BaseModel, Field, model_validator


class Estudiante(BaseModel):
    nombre: str
    matricula: str
    edad: str
    carrera: str


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
