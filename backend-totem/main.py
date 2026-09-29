from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import json
import datetime
import os

# --- IMPORTACIONES DE BASE DE DATOS ---
from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, Session

app = FastAPI(title="API Tótem de Aptitud Física")

# --- 1. CONFIGURACIÓN DE POSTGRESQL ---
# Usa la variable de entorno en Render, y el string local si estás en tu PC
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:admin@localhost:5432/totem_db"
)

# Render a veces usa URL 'postgres://' que SQLAlchemy 1.4+ no acepta. Este reemplazo lo previene:
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- 2. MODELO DE TABLA (V2 - CON ESTADOS) ---
class EvaluacionDB(Base):
    __tablename__ = "evaluaciones_v2" # Cambiamos el nombre para que cree una tabla nueva con las nuevas columnas
    
    id = Column(Integer, primary_key=True, index=True)
    matricula = Column(String, index=True)
    nombre = Column(String)
    carrera = Column(String)
    edad = Column(String)
    ia_sugerida = Column(String)
    alerta = Column(String, nullable=True)
    
    mediciones = Column(JSON) 
    salud = Column(JSON)
    entrenamiento = Column(JSON)
    fecha = Column(DateTime, default=datetime.datetime.utcnow)
    
    # NUEVOS CAMPOS PARA EL DASHBOARD
    estado = Column(String, default="pendiente")
    nivel_final = Column(String, nullable=True)

# Crea las tablas automáticamente si no existen
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- 3. CONFIGURACIÓN CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 4. GESTOR DE WEBSOCKETS ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()


# --- 5. MODELOS DE DATOS ---
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
    estudiante: Estudiante
    mediciones: Mediciones
    entrenamiento: Entrenamiento
    salud: Salud

class ValidacionPayload(BaseModel):
    nivel_final: str


# --- 6. RUTAS Y ENDPOINTS ---

@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# NUEVO: Traer historial al recargar la página web
@app.get("/api/evaluaciones")
def obtener_historial(db: Session = Depends(get_db)):
    evaluaciones = db.query(EvaluacionDB).order_by(EvaluacionDB.id.desc()).limit(100).all()
    resultado = []
    for ev in evaluaciones:
        resultado.append({
            "idBaseDatos": ev.id,
            "idUnico": f"db_{ev.id}",
            "id": ev.matricula,
            "nombre": ev.nombre,
            "carrera": ev.carrera,
            "edad": ev.edad,
            "objetivo": ev.entrenamiento.get("objetivo", "") if ev.entrenamiento else "",
            "iaSugerida": ev.ia_sugerida,
            "alerta": ev.alerta,
            "mediciones": ev.mediciones,
            "salud": ev.salud,
            "estado": ev.estado,
            "nivelFinal": ev.nivel_final,
            "tiempoEspera": "Registrado"
        })
    return resultado


# NUEVO: Guardar la validación del profesor
@app.put("/api/evaluaciones/{eval_id}")
def guardar_validacion(eval_id: int, payload: ValidacionPayload, db: Session = Depends(get_db)):
    ev = db.query(EvaluacionDB).filter(EvaluacionDB.id == eval_id).first()
    if ev:
        ev.estado = "validado"
        ev.nivel_final = payload.nivel_final
        db.commit()
        return {"status": "success"}
    return {"status": "error", "message": "Evaluación no encontrada"}


# ACTUALIZADO: Guardar desde la app móvil y avisar por WebSocket
@app.post("/api/evaluaciones")
async def recibir_evaluacion_totem(payload: EvaluacionPayload, db: Session = Depends(get_db)):
    tiene_riesgos = len(payload.salud.sintomas) > 0
    ia_sugerida = "A2" if tiene_riesgos else "A3"
    alerta_ia = "DERIVAR" if tiene_riesgos else None

    # Guardar en Base de Datos
    nueva_evaluacion = EvaluacionDB(
        matricula=payload.estudiante.matricula,
        nombre=payload.estudiante.nombre,
        carrera=payload.estudiante.carrera,
        edad=payload.estudiante.edad,
        ia_sugerida=ia_sugerida,
        alerta=alerta_ia,
        mediciones=payload.mediciones.dict(),
        salud=payload.salud.dict(),
        entrenamiento=payload.entrenamiento.dict()
    )
    
    db.add(nueva_evaluacion)
    db.commit()              
    db.refresh(nueva_evaluacion) 

    # Enviar al Dashboard (ahora incluye ID de la DB y Estado Pendiente)
    nuevo_estudiante_dashboard = {
        "idBaseDatos": nueva_evaluacion.id,
        "idUnico": f"db_{nueva_evaluacion.id}",
        "id": payload.estudiante.matricula,
        "nombre": payload.estudiante.nombre,
        "carrera": payload.estudiante.carrera,
        "edad": payload.estudiante.edad,
        "objetivo": payload.entrenamiento.objetivo,
        "tiempoEspera": "hace 0m",
        "iaSugerida": ia_sugerida,
        "alerta": alerta_ia,
        "mediciones": payload.mediciones.dict(),
        "salud": payload.salud.dict(),
        "estado": "pendiente",
        "nivelFinal": None
    }

    await manager.broadcast(json.dumps(nuevo_estudiante_dashboard))
    return {"status": "success", "message": "Guardado exitosamente"}