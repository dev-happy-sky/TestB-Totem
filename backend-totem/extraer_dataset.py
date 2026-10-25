import csv
import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, joinedload

from conexion import normalizar_url
from models import SesionTotem, ResultadoRutina, MedicionCorporal, CuestionarioObjetivo

COLUMNAS_CSV = [
    "presion_sistolica", "presion_diastolica", "fc_reposo", "fc_recuperacion", "imc",
    "sintomas", "condiciones", "lesiones_previas", "categoria"
]
CATEGORIAS_VALIDAS = {"A1", "A2", "A3", "A4"}

def extraer_datos_a_csv(ruta_salida="dataset_real.csv", minimo_filas=100):
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("ERROR: La variable de entorno DATABASE_URL no está definida.", file=sys.stderr)
        sys.exit(1)

    database_url = normalizar_url(database_url)
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        # Garantiza que el registro fue revisado por un profesional (personal_id IS NOT NULL)
        # y que la categoría asignada sea válida.
        sesiones = (
            db.query(SesionTotem)
            .join(ResultadoRutina, SesionTotem.id == ResultadoRutina.sesion_id)
            .options(
                joinedload(SesionTotem.mediciones),
                joinedload(SesionTotem.cuestionario),
                joinedload(SesionTotem.resultado)
            )
            .filter(
                ResultadoRutina.personal_id.isnot(None),
                ResultadoRutina.nivel_final.in_(CATEGORIAS_VALIDAS)
            )
            .all()
        )

        filas = []
        for s in sesiones:
            res = s.resultado
            
            # Obtiene la medición más reciente basada explícitamente en la marca temporal
            med = None
            if s.mediciones:
                med = max(s.mediciones, key=lambda m: m.capturado_en or m.id)

            cues = s.cuestionario

            # Sanitización de listas a string para prevenir TypeError
            sintomas_list = cues.sintomas if cues and isinstance(cues.sintomas, list) else []
            condiciones_list = cues.condiciones if cues and isinstance(cues.condiciones, list) else []
            
            sintomas_str = ";".join(str(x).strip() for x in sintomas_list if x is not None)
            condiciones_str = ";".join(str(x).strip() for x in condiciones_list if x is not None)
            
            # Limpieza de saltos de línea en campos de texto libre
            lesiones_str = ""
            if cues and cues.lesiones_previas:
                lesiones_str = cues.lesiones_previas.replace("\n", " ").replace("\r", " ").strip()

            fila = {
                "presion_sistolica": med.presion_sistolica if med and med.presion_sistolica is not None else "",
                "presion_diastolica": med.presion_diastolica if med and med.presion_diastolica is not None else "",
                "fc_reposo": med.frecuencia_cardiaca if med and med.frecuencia_cardiaca is not None else "",
                "fc_recuperacion": med.fc_recuperacion if med and med.fc_recuperacion is not None else "",
                "imc": round(med.imc, 1) if med and med.imc is not None else "",
                "sintomas": sintomas_str,
                "condiciones": condiciones_str,
                "lesiones_previas": lesiones_str,
                "categoria": res.nivel_final
            }
            filas.append(fila)

        # Si no se alcanza el umbral mínimo exigido por la regla clínica, detiene el proceso
        if len(filas) < minimo_filas:
            print(f"ERROR: Se encontraron solo {len(filas)} filas validadas por personal clínico.", file=sys.stderr)
            print(f"Se requieren al menos {minimo_filas} filas para reentrenar el modelo.", file=sys.stderr)
            sys.exit(1)

        with open(ruta_salida, mode="w", newline="", encoding="utf-8") as archivo:
            escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS_CSV)
            escritor.writeheader()
            escritor.writerows(filas)

        print(f"Extracción exitosa: {len(filas)} registros validados exportados a '{ruta_salida}'.")

    finally:
        db.close()
        engine.dispose()

if __name__ == "__main__":
    extraer_datos_a_csv()