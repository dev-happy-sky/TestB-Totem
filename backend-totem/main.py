from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import json
import datetime

# --- IMPORTACIONES DE BASE DE DATOS ---
from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime
from sqlalchemy.orm import sessionmaker, declarative_base, Session

app = FastAPI(title="API Tótem de Aptitud Física")

# --- 1. CONFIGURACIÓN DE POSTGRESQL ---
# REEMPLAZA 'tu_usuario' y 'tu_contraseña' por las credenciales de tu PostgreSQL local
DATABASE_URL = "postgresql://postgres:admin@localhost:5432/totem_db"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- 2. MODELO DE TABLA (SQLAlchemy) ---
class EvaluacionDB(Base):
    __tablename__ = "evaluaciones"
    
    id = Column(Integer, primary_key=True, index=True)
    matricula = Column(String, index=True)
    nombre = Column(String)
    carrera = Column(String)
    ia_sugerida = Column(String)
    alerta = Column(String, nullable=True)
    
    # Guardaremos las métricas y síntomas en formato JSON para mayor flexibilidad
    mediciones = Column(JSON) 
    salud = Column(JSON)
    entrenamiento = Column(JSON)
    fecha = Column(DateTime, default=datetime.datetime.utcnow)

# Crea las tablas en la base de datos automáticamente si no existen
Base.metadata.create_all(bind=engine)

# Dependencia para inyectar la sesión de la base de datos en las rutas
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


# --- 5. MODELOS DE DATOS (Pydantic para validar la entrada) ---
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


# --- 6. RUTAS Y ENDPOINTS ---
@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# Añadimos `db: Session = Depends(get_db)` para poder usar la base de datos
@app.post("/api/evaluaciones")
async def recibir_evaluacion_totem(payload: EvaluacionPayload, db: Session = Depends(get_db)):
    """Endpoint para recibir datos, GUARDAR EN POSTGRESQL y emitir por WebSocket"""
    
    # Lógica de inferencia IA (Simulada por ahora)
    tiene_riesgos = len(payload.salud.sintomas) > 0
    ia_sugerida = "A2" if tiene_riesgos else "A3"
    alerta_ia = "DERIVAR" if tiene_riesgos else None

    # --- NUEVO: GUARDAR EN LA BASE DE DATOS ---
    nueva_evaluacion = EvaluacionDB(
        matricula=payload.estudiante.matricula,
        nombre=payload.estudiante.nombre,
        carrera=payload.estudiante.carrera,
        ia_sugerida=ia_sugerida,
        alerta=alerta_ia,
        mediciones=payload.mediciones.dict(),
        salud=payload.salud.dict(),
        entrenamiento=payload.entrenamiento.dict()
    )
    
    db.add(nueva_evaluacion)
    db.commit()              # Guardamos los cambios
    db.refresh(nueva_evaluacion) # Obtenemos el ID generado por PostgreSQL
    # ------------------------------------------

    # Formateamos los datos para enviarlos al dashboard en tiempo real
    nuevo_estudiante_dashboard = {
        "id": payload.estudiante.matricula,
        "nombre": payload.estudiante.nombre,
        "carrera": payload.estudiante.carrera,
        "edad": payload.estudiante.edad,
        "objetivo": payload.entrenamiento.objetivo,
        "tiempoEspera": "hace 0m",
        "iaSugerida": ia_sugerida,
        "alerta": alerta_ia,
        "mediciones": payload.mediciones.dict(),
        "salud": payload.salud.dict()
    }

    # Emitimos el nuevo estudiante al dashboard de Next.js
    await manager.broadcast(json.dumps(nuevo_estudiante_dashboard))

    return {"status": "success", "message": "Guardado en PostgreSQL y enviado a la cola"}