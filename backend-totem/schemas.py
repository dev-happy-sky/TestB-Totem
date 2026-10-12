from typing import List, Optional
from pydantic import BaseModel


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
    nivel_final: str


class LoginPayload(BaseModel):
    username: str
    password: str
