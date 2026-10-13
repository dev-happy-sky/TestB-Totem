from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import List, Optional
import asyncio
import datetime
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

from conexion import normalizar_url
from credenciales import hash_password, verify_password
from migraciones import agregar_columnas_faltantes, consolidar_identidad
from models import AuditLog, Base, PersonalGimnasio, SesionTotem
from persistencia import (
    PosibleDuplicado, SesionCerrada, SinAlerta, SocioExistente, actualizar_socio, buscar_socio, cargar_sesion,
    guardar_evaluacion, listar_historial_socio, listar_sesiones, registrar_auditoria, registrar_socio,
    resumen_identificacion, revisar_alerta, serializar_sesion, validar_mediciones, validar_sesion,
)
from identidad import normalizar_matricula, matricula_valida, MENSAJE_MATRICULA
from schemas import (
    EvaluacionPayload, IdentificarPayload, LoginPayload, SocioActualizacion, SocioRegistro, ValidacionPayload,
    ValidarMedicionesPayload,
)

app = FastAPI(title="API Tótem de Aptitud Física")
logger = logging.getLogger("totem")

# --- 1. CONFIGURACIÓN DE POSTGRESQL ---
# Usa la variable de entorno en Render, y el string local si estás en tu PC
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:admin@localhost:5432/totem_db"
)

# Neon/Render entregan 'postgres://' o 'postgresql://': se fija el driver psycopg2 (SQLAlchemy 2.1 usaría psycopg v3).
DATABASE_URL = normalizar_url(DATABASE_URL)

# pool_pre_ping: en Neon el cómputo se suspende por inactividad y cierra las conexiones; así se reconecta solo
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# --- 2. TABLAS ---
# El esquema vive en models.py (socios, totems, personal_gimnasio, sesiones_totem, mediciones_corporales,
# cuestionarios_objetivos, inferencias_ia, resultados_rutina, audit_logs).
Base.metadata.create_all(bind=engine)
agregar_columnas_faltantes(engine)  # tablas ya existentes en PostgreSQL: agrega las columnas nuevas


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --- 3. INTERRUPTOR DE SEGURIDAD ---
# SEGURIDAD_ACTIVA=true activa: login y roles del dashboard (JWT), clave del tótem, CORS restringido y límites de
# intentos. Apagado (valor por defecto) el backend queda ABIERTO: cualquiera con la URL puede leer y modificar
# evaluaciones (datos de salud). Es una medida temporal de desarrollo.
VALORES_VERDADEROS = ("1", "true", "t", "si", "sí", "yes", "y", "on")


def _a_booleano(valor, defecto: bool = False) -> bool:
    if valor is None or not str(valor).strip():
        return defecto
    return str(valor).strip().lower() in VALORES_VERDADEROS


SEGURIDAD_ACTIVA = _a_booleano(os.getenv("SEGURIDAD_ACTIVA"), False)

# Usuario con el que se registran las acciones cuando la seguridad está apagada (no hay login).
USUARIO_ABIERTO = {"sub": "acceso-libre", "rol": "admin", "uid": None}


def avisos_de_arranque(seguridad: bool, jwt_definido: bool, clave_totem_definida: bool) -> list:
    if not seguridad:
        return ["SEGURIDAD DESACTIVADA (SEGURIDAD_ACTIVA no es true): sin login, sin clave del tótem y con CORS abierto. "
                "No uses esto con datos reales de socios."]
    avisos = []
    if not jwt_definido:
        avisos.append("JWT_SECRET no definido: se usa un secreto temporal (las sesiones se pierden al reiniciar).")
    if not clave_totem_definida:
        avisos.append("TOTEM_API_KEY no definido: el endpoint del tótem queda sin clave.")
    return avisos


# --- 3a. CONFIGURACIÓN CORS ---
# Con seguridad: solo los orígenes del dashboard (R.184), definidos en ALLOWED_ORIGINS separados por coma.
# Sin seguridad: cualquier origen.
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]


def configurar_cors(aplicacion: FastAPI, seguridad: bool, origenes: list):
    if seguridad:
        aplicacion.add_middleware(
            CORSMiddleware, allow_origins=origenes, allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "X-Totem-Key"],
        )
    else:
        aplicacion.add_middleware(
            CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
        )


configurar_cors(app, SEGURIDAD_ACTIVA, ALLOWED_ORIGINS)


# --- 3b. AUTENTICACIÓN, ROLES Y AUDITORÍA (R.171-R.174, R.179, R.180, R.184, R.185) ---
JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    JWT_SECRET = secrets.token_urlsafe(48)
JWT_HORAS = int(os.getenv("JWT_HORAS", "8"))
TOTEM_API_KEY = os.getenv("TOTEM_API_KEY")
for _aviso in avisos_de_arranque(SEGURIDAD_ACTIVA, bool(os.getenv("JWT_SECRET")), bool(TOTEM_API_KEY)):
    logger.warning(_aviso)

ROLES_DASHBOARD = ("admin", "encargado")
bearer = HTTPBearer(auto_error=False)


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


consolidar_identidad(engine)  # bases de la versión intermedia: matrícula -> rut, carrera -> plan_membresia
migrar_evaluaciones_v2()

# Límite de intentos de login por IP+usuario (R.184): 5 fallos en 15 minutos.
_intentos: dict = {}
MAX_INTENTOS, VENTANA_SEG = 5, 15 * 60


def _bloqueado(clave: str) -> bool:
    if not SEGURIDAD_ACTIVA:
        return False
    ahora = time.time()
    _intentos[clave] = [t for t in _intentos.get(clave, []) if ahora - t < VENTANA_SEG]
    return len(_intentos[clave]) >= MAX_INTENTOS


# Límite de consultas de identificación por IP (el tótem es público): evita recorrer matrículas ajenas.
_consultas: dict = {}
MAX_CONSULTAS, VENTANA_CONSULTAS_SEG = int(os.getenv("MAX_CONSULTAS_IDENTIDAD", "30")), 5 * 60


def _consulta_permitida(ip: Optional[str]) -> bool:
    if not SEGURIDAD_ACTIVA:
        return True
    ahora = time.time()
    recientes = [t for t in _consultas.get(ip, []) if ahora - t < VENTANA_CONSULTAS_SEG]
    if len(recientes) >= MAX_CONSULTAS:
        _consultas[ip] = recientes
        return False
    recientes.append(ahora)
    _consultas[ip] = recientes
    return True


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
    if not SEGURIDAD_ACTIVA:
        return USUARIO_ABIERTO
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
    if SEGURIDAD_ACTIVA and TOTEM_API_KEY and not (x_totem_key and hmac.compare_digest(x_totem_key, TOTEM_API_KEY)):
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

# Lo consulta el dashboard para saber si debe pedir login. No expone nada sensible.
@app.get("/api/configuracion")
def obtener_configuracion():
    return {"seguridad": SEGURIDAD_ACTIVA}


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
        if SEGURIDAD_ACTIVA:
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


def _ip(request: Request) -> Optional[str]:
    return request.client.host if request.client else None


# Historial de evaluaciones de un socio para comparar mediciones entre visitas (R.130, R.131)
@app.get("/api/socios/{matricula}/evaluaciones")
def obtener_historial_socio(matricula: str, request: Request, user: dict = Depends(requiere_rol(*ROLES_DASHBOARD)),
                            db: Session = Depends(get_db)):
    registrar_acceso(db, "lectura_historial_socio", usuario=user["sub"], rol=user["rol"], recurso="/api/socios/*/evaluaciones",
                     ip=_ip(request), personal_id=_uuid_o_none(user.get("uid")))
    return [serializar_sesion(s) for s in listar_historial_socio(db, matricula)]


# --- Identificación de socios desde el tótem (R.1-R.5, R.7, R.11) ---

# Identifica por matrícula: si está registrado devuelve sus datos y si tiene una evaluación vigente; si no, indica
# que debe registrarse. Solo devuelve datos básicos y fechas (nunca categorías ni datos de salud).
@app.post("/api/socios/identificar", dependencies=[Depends(verificar_totem)])
def identificar_socio(payload: IdentificarPayload, request: Request, db: Session = Depends(get_db)):
    ip = _ip(request)
    if not _consulta_permitida(ip):
        registrar_acceso(db, "identificacion_bloqueada", recurso="/api/socios/identificar", ip=ip)
        raise HTTPException(status_code=429, detail="Demasiadas consultas. Intenta en unos minutos.")
    socio = buscar_socio(db, payload.matricula)
    if not socio:
        return {"registrado": False, "matricula": payload.matricula}
    return {**resumen_identificacion(db, socio), "matricula": socio.rut}


# Registra a un socio nuevo (R.3). Si ya existe la matrícula responde 409; si hay otro socio con el mismo nombre,
# responde 409 `posible_duplicado` y el tótem debe reenviar con `confirmar_duplicado` (R.11).
@app.post("/api/socios", status_code=201, dependencies=[Depends(verificar_totem)])
def crear_socio(payload: SocioRegistro, request: Request, db: Session = Depends(get_db)):
    try:
        socio = registrar_socio(db, payload)
    except SocioExistente:
        raise HTTPException(status_code=409, detail={"code": "matricula_registrada",
                                                     "message": "Esa matrícula ya está registrada"})
    except PosibleDuplicado as dup:
        registrar_acceso(db, "posible_duplicado", recurso="/api/socios", ip=_ip(request))
        raise HTTPException(status_code=409, detail={
            "code": "posible_duplicado",
            "message": "Ya existe un socio con ese nombre. Si eres una persona distinta, confirma el registro.",
            "coincidencias": dup.coincidencias})
    registrar_acceso(db, "socio_registrado", recurso=f"socio/{socio.id}", ip=_ip(request))
    return {"status": "success", "socio": resumen_identificacion(db, socio)["socio"], "matricula": socio.rut}


# Actualiza datos personales desactualizados (R.5).
@app.put("/api/socios/{matricula}", dependencies=[Depends(verificar_totem)])
def modificar_socio(matricula: str, payload: SocioActualizacion, request: Request, db: Session = Depends(get_db)):
    if not matricula_valida(matricula):
        raise HTTPException(status_code=422, detail=MENSAJE_MATRICULA)
    socio = buscar_socio(db, normalizar_matricula(matricula))
    if not socio:
        raise HTTPException(status_code=404, detail="Socio no encontrado")
    cambios = actualizar_socio(db, socio, payload)
    if cambios:
        registrar_acceso(db, "socio_actualizado:" + ",".join(cambios), recurso=f"socio/{socio.id}", ip=_ip(request))
    return {"status": "success", "cambios": cambios, "socio": resumen_identificacion(db, socio)["socio"]}


# Decisión del encargado: confirmar/ajustar la categoría o derivar a evaluación médica (queda quién y cuándo, R.180)
@app.put("/api/evaluaciones/{eval_id}")
def guardar_validacion(eval_id: uuid.UUID, request: Request, payload: ValidacionPayload,
                       user: dict = Depends(requiere_rol(*ROLES_DASHBOARD)), db: Session = Depends(get_db)):
    sesion = cargar_sesion(db, eval_id)
    if not sesion:
        raise HTTPException(status_code=404, detail="Evaluación no encontrada")
    personal_id = _uuid_o_none(user.get("uid"))
    try:
        validar_sesion(db, sesion, payload.nivel_final, personal_id=personal_id, observaciones=payload.observaciones,
                       derivar=payload.derivar, motivo=payload.motivo)
    except SesionCerrada:
        raise HTTPException(status_code=409, detail="La evaluación ya fue revisada o derivada")
    accion = "derivacion" if payload.derivar else f"validacion:{payload.nivel_final}"
    registrar_acceso(db, accion, usuario=user["sub"], rol=user["rol"], recurso=f"evaluacion/{eval_id}",
                     ip=_ip(request), personal_id=personal_id, sesion_id=sesion.id)
    return {"status": "success", "evaluacion": serializar_sesion(cargar_sesion(db, eval_id))}


# El encargado confirma (o retira la confirmación de) las mediciones capturadas por el tótem.
@app.post("/api/evaluaciones/{eval_id}/mediciones/validar")
def validar_mediciones_endpoint(eval_id: uuid.UUID, payload: ValidarMedicionesPayload, request: Request,
                                user: dict = Depends(requiere_rol(*ROLES_DASHBOARD)), db: Session = Depends(get_db)):
    sesion = cargar_sesion(db, eval_id)
    if not sesion:
        raise HTTPException(status_code=404, detail="Evaluación no encontrada")
    try:
        validar_mediciones(db, sesion, payload.validado)
    except SesionCerrada:
        raise HTTPException(status_code=409, detail="La evaluación ya fue revisada o derivada")
    registrar_acceso(db, "mediciones_validadas" if payload.validado else "mediciones_sin_validar", usuario=user["sub"],
                     rol=user["rol"], recurso=f"evaluacion/{eval_id}", ip=_ip(request),
                     personal_id=_uuid_o_none(user.get("uid")), sesion_id=sesion.id)
    return {"status": "success", "evaluacion": serializar_sesion(cargar_sesion(db, eval_id))}


# Confirmar que una alerta fue revisada sin cerrar el caso (R.139, R.140)
@app.post("/api/evaluaciones/{eval_id}/alerta/revisar")
def revisar_alerta_endpoint(eval_id: uuid.UUID, request: Request, user: dict = Depends(requiere_rol(*ROLES_DASHBOARD)),
                            db: Session = Depends(get_db)):
    sesion = cargar_sesion(db, eval_id)
    if not sesion:
        raise HTTPException(status_code=404, detail="Evaluación no encontrada")
    personal_id = _uuid_o_none(user.get("uid"))
    try:
        revisar_alerta(db, sesion, personal_id=personal_id)
    except SinAlerta:
        raise HTTPException(status_code=409, detail="La evaluación no tiene alertas")
    registrar_acceso(db, "alerta_revisada", usuario=user["sub"], rol=user["rol"], recurso=f"evaluacion/{eval_id}",
                     ip=_ip(request), personal_id=personal_id, sesion_id=sesion.id)
    return {"status": "success", "evaluacion": serializar_sesion(cargar_sesion(db, eval_id))}


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
