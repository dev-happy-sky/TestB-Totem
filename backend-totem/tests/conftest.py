import os
import tempfile

# Debe definirse antes de importar main (crea el engine al importarse).
# TEST_DATABASE_URL apunta a una base PostgreSQL DESECHABLE (los tests hacen drop_all); sin ella se usa SQLite.
_db = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ.update(
    DATABASE_URL=os.getenv("TEST_DATABASE_URL", f"sqlite:///{_db}"), JWT_SECRET="s" * 40, TOTEM_API_KEY="clave-totem",
    ADMIN_PASSWORD="admin-pass", ENCARGADO_PASSWORD="enc-pass", ALLOWED_ORIGINS="http://dash.test", SEGURIDAD_ACTIVA="true",
)

import pytest
from fastapi.testclient import TestClient

import main
from models import Base


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=main.engine)
    Base.metadata.create_all(bind=main.engine)
    main._intentos.clear()
    main.sembrar_usuarios()
    return TestClient(main.app)


@pytest.fixture()
def payload():
    return {
        "consentimiento": True,
        "estudiante": {"nombre": "Ana", "apellido": "Pérez Soto", "matricula": "20231234A", "fecha_nacimiento": "2002-03-15",
                       "telefono": "+56 9 1234 5678", "plan_membresia": "Plan Estudiante"},
        "mediciones": {"presionSys": 118, "presionDia": 78, "fcReposo": 70, "fcRecup": 100,
                       "peso": "70.5", "imc": "24.1", "grasa": "20.2", "vo2Max": "40.0", "masaMuscular": "30.5"},
        "entrenamiento": {"objetivo": "Fuerza", "experiencia": "Intermedio", "duracion": 60, "diasSemana": 3},
        "salud": {"sintomas": [], "condiciones": ["Asma", "Lesión de rodilla"]},
    }


@pytest.fixture()
def totem_headers():
    return {"X-Totem-Key": "clave-totem"}


@pytest.fixture()
def auth(client):
    def _login(user="encargado", password="enc-pass"):
        r = client.post("/api/auth/login", json={"username": user, "password": password})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['token']}"}
    return _login
