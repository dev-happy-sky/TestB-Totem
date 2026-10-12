from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List, Optional
import asyncio
import datetime
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid

import jwt

# --- IMPORTACIONES DE BASE DE DATOS ---
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker, Session

from models import AuditLog, Base, PersonalGimnasio, SesionTotem
from persistencia import (
    cargar_sesion, guardar_evaluacion, listar_sesiones, registrar_auditoria, serializar_sesion, validar_sesion,
)
from schemas import EvaluacionPayload, LoginPayload, ValidacionPayload

app = FastAPI(title="API Tótem de Aptitud Física")
logger = logging.getLogger("totem")

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

# --- 2. TABLAS ---
# El esquema vive en models.py (socios, totems, personal_gimnasio, sesiones_totem, mediciones_corporales,
# cuestionarios_objetivos, inferencias_ia, resultados_rutina, audit_logs).
Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- 3. CONFIGURACIÓN CORS ---
# Solo los orígenes del dashboard (R.184). Se define con ALLOWED_ORIGINS separados por coma.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Totem-Key"],
)


# --- 3b. AUTENTICACIÓN, ROLES Y AUDITORÍA (R.171-R.174, R.179, R.180, R.184, R.185) ---
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    JWT_SECRET = secrets.token_urlsafe(48)
    logger.warning("JWT_SECRET no definido: se usa un secreto temporal (las sesiones se pierden al reiniciar).")
JWT_HORAS = int(os.getenv("JWT_HORAS", "8"))
TOTEM_API_KEY = os.getenv("TOTEM_API_KEY")
if not TOTEM_API_KEY:
    logger.warning("TOTEM_API_KEY no definido: el endpoint del tótem queda sin clave.")

ROLES_DASHBOARD = ("admin", "encargado")
bearer = HTTPBearer(auto_error=False)


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, almacenado: str) -> bool:
    try:
        salt_hex, digest_hex = almacenado.split("$")
        esperado = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 200_000)
        return hmac.compare_digest(esperado.hex(), digest_hex)
    except ValueError:
        return False


def registrar_acceso(db: Session, accion: str, usuario=None, rol=None, recurso=None, ip=None,
                     personal_id=None, sesion_id=None):
    registrar_auditoria(db, accion, usuario=usuario, rol=rol, recurso=recurso, ip=ip,
                        personal_id=personal_id, sesion_id=sesion_id)


def sembrar_usuarios():
    """Crea/actualiza el personal del dashboard desde variables de entorno (sin contraseñas en el código)."""
    db = SessionLocal()
    try:
        for username_env, pass_env, rol, defecto in [
            ("ADMIN_USER", "ADMIN_PASSWORD", "admin", "admin"),
            ("ENCARGADO_USER", "ENCARGADO_PASSWORD", "encargado", "encargado"),
        ]:
            password = os.getenv(pass_env)
            if not password:
                continue
            username = os.getenv(username_env, defecto)
            u = db.query(PersonalGimnasio).filter(PersonalGimnasio.email == username).first()
            if u:
                u.password_hash = hash_password(password)
                u.rol = rol
            else:
                db.add(PersonalGimnasio(nombre=username, apellido="", email=username, rol=rol,
                                        password_hash=hash_password(password)))
        db.commit()
    finally:
        db.close()


sembrar_usuarios()


# Migración única: pasa las filas de la tabla antigua `evaluaciones_v2` al modelo nuevo (no la borra).
def migrar_evaluaciones_v2():
    if "evaluaciones_v2" not in inspect(engine).get_table_names():
        return
    db = SessionLocal()
    try:
        if db.query(SesionTotem).first():
            return
        filas = db.execute(text(
            "SELECT matricula, nombre, carrera, edad, mediciones, salud, entrenamiento, fecha, estado, nivel_final "
            "FROM evaluaciones_v2 ORDER BY id"
        )).mappings().all()
        for f in filas:
            try:
                def j(v):
                    return json.loads(v) if isinstance(v, str) else v
                payload = EvaluacionPayload(
                    consentimiento=False,  # anterior a la solicitud de consentimiento
                    estudiante={"nombre": f["nombre"] or "", "matricula": f["matricula"] or "", "edad": f["edad"] or "",
                                "carrera": f["carrera"] or ""},
                    mediciones=j(f["mediciones"]), salud=j(f["salud"]), entrenamiento=j(f["entrenamiento"]),
                )
                fecha = f["fecha"].replace(tzinfo=datetime.timezone.utc) if f["fecha"] else None
                sesion = guardar_evaluacion(db, payload, fecha=fecha)
                if f["estado"] == "validado" and f["nivel_final"]:
                    validar_sesion(db, sesion, f["nivel_final"])
            except Exception as exc:  # una fila corrupta no debe impedir el arranque
                db.rollback()
                logger.warning("No se pudo migrar una evaluación antigua: %s", exc)
    finally:
        db.close()


migrar_evaluaciones_v2()

# Límite de intentos de login por IP+usuario (R.184): 5 fallos en 15 minutos.
_intentos: dict = {}
MAX_INTENTOS, VENTANA_SEG = 5, 15 * 60


def _bloqueado(clave: str) -> bool:
    ahora = time.time()
    _intentos[clave] = [t for t in _intentos.get(clave, []) if ahora - t < VENTANA_SEG]
    return len(_intentos[clave]) >= MAX_INTENTOS


def crear_token(username: str, rol: str, uid: str) -> str:
    ahora = datetime.datetime.now(datetime.timezone.utc)
    return jwt.encode(
        {"sub": username, "rol": rol, "uid": uid, "iat": ahora, "exp": ahora + datetime.timedelta(hours=JWT_HORAS)},
        JWT_SECRET, algorithm="HS256",
    )


def decodificar_token(token: str) -> dict:
    datos = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    if datos.get("rol") not in ROLES_DASHBOARD:
        raise jwt.InvalidTokenError("rol no permitido")
    return datos


def usuario_actual(
    request: Request,
    cred: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    db: Session = Depends(get_db),
) -> dict:
    ip = request.client.host if request.client else None
    if not cred:
        registrar_acceso(db, "acceso_sin_token", recurso=request.url.path, ip=ip)
        raise HTTPException(status_code=401, detail="Autenticación requerida")
    try:
        return decodificar_token(cred.credentials)
    except jwt.PyJWTError:
        registrar_acceso(db, "token_invalido", recurso=request.url.path, ip=ip)
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada")


def requiere_rol(*roles: str):
    def dep(user: dict = Depends(usuario_actual)) -> dict:
        if user["rol"] not in roles:
            raise HTTPException(status_code=403, detail="Permisos insuficientes")
        return user
    return dep


def verificar_totem(x_totem_key: Optional[str] = Header(default=None)):
    if TOTEM_API_KEY and not (x_totem_key and hmac.compare_digest(x_totem_key, TOTEM_API_KEY)):
        raise HTTPException(status_code=401, detail="Tótem no autorizado")


def _uuid_o_none(valor) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(valor))
    except ValueError:
        return None


# --- 4. GESTOR DE WEBSOCKETS ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    def add(self, websocket: WebSocket):
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in list(self.active_connections):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()


# --- 6. RUTAS Y ENDPOINTS ---

@app.post("/api/auth/login")
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else None
    clave = f"{ip}:{payload.username}"
    if _bloqueado(clave):
        registrar_acceso(db, "login_bloqueado", usuario=payload.username, ip=ip)
        raise HTTPException(status_code=429, detail="Demasiados intentos. Intenta más tarde.")
    u = db.query(PersonalGimnasio).filter(PersonalGimnasio.email == payload.username, PersonalGimnasio.activo == True).first()  # noqa: E712
    if not u or not verify_password(payload.password, u.password_hash):
        _intentos.setdefault(clave, []).append(time.time())
        registrar_acceso(db, "login_fallido", usuario=payload.username, ip=ip)
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    _intentos.pop(clave, None)
    registrar_acceso(db, "login", usuario=u.email, rol=u.rol, ip=ip, personal_id=u.id)
    return {"token": crear_token(u.email, u.rol, str(u.id)), "rol": u.rol, "usuario": u.email, "expira_horas": JWT_HORAS}


@app.websocket("/ws/dashboard")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    # El token viaja en el primer mensaje (no en la URL, para que no quede en logs).
    try:
        primer = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        decodificar_token(json.loads(primer).get("token", ""))
    except Exception:
        db = SessionLocal()
        try:
            registrar_acceso(db, "ws_no_autorizado", ip=websocket.client.host if websocket.client else None)
        finally:
            db.close()
        await websocket.close(code=4401)
        return
    manager.add(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@app.get("/api/auditoria")
def obtener_auditoria(user: dict = Depends(requiere_rol("admin")), db: Session = Depends(get_db)):
    logs = db.query(AuditLog).order_by(AuditLog.ocurrido_en.desc()).limit(200).all()
    return [
        {"fecha": l.ocurrido_en.isoformat(), "usuario": (l.detalle or {}).get("usuario"), "rol": (l.detalle or {}).get("rol"),
         "accion": l.accion, "recurso": (l.detalle or {}).get("recurso"), "ip": (l.detalle or {}).get("ip")}
        for l in logs
    ]


# Traer historial al recargar la página web
@app.get("/api/evaluaciones")
def obtener_historial(request: Request, user: dict = Depends(requiere_rol(*ROLES_DASHBOARD)), db: Session = Depends(get_db)):
    registrar_acceso(db, "lectura_evaluaciones", usuario=user["sub"], rol=user["rol"], recurso="/api/evaluaciones",
                     ip=request.client.host if request.client else None, personal_id=_uuid_o_none(user.get("uid")))
    return [serializar_sesion(s) for s in listar_sesiones(db)]


# Guardar la validación del encargado (queda registrado quién y cuándo, R.180)
@app.put("/api/evaluaciones/{eval_id}")
def guardar_validacion(eval_id: uuid.UUID, request: Request, payload: ValidacionPayload,
                       user: dict = Depends(requiere_rol(*ROLES_DASHBOARD)), db: Session = Depends(get_db)):
    sesion = cargar_sesion(db, eval_id)
    if not sesion:
        raise HTTPException(status_code=404, detail="Evaluación no encontrada")
    personal_id = _uuid_o_none(user.get("uid"))
    validar_sesion(db, sesion, payload.nivel_final, personal_id=personal_id)
    registrar_acceso(db, f"validacion:{payload.nivel_final}", usuario=user["sub"], rol=user["rol"],
                     recurso=f"evaluacion/{eval_id}", ip=request.client.host if request.client else None,
                     personal_id=personal_id, sesion_id=sesion.id)
    return {"status": "success"}


# Guardar desde la app móvil y avisar por WebSocket
@app.post("/api/evaluaciones", dependencies=[Depends(verificar_totem)])
async def recibir_evaluacion_totem(payload: EvaluacionPayload, request: Request, db: Session = Depends(get_db)):
    if not payload.consentimiento:
        raise HTTPException(status_code=400, detail="Se requiere el consentimiento del usuario para registrar sus datos de salud")

    sesion = guardar_evaluacion(db, payload, ip=request.client.host if request.client else None)

    nuevo = serializar_sesion(sesion)
    nuevo["tiempoEspera"] = "hace 0m"
    await manager.broadcast(json.dumps(nuevo))
    return {"status": "success", "message": "Guardado exitosamente", "sesion_id": str(sesion.id)}
