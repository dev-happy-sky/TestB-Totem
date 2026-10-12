# Pipeline del modelo de IA (XGBoost)

Hoy la decisión de aptitud la toma el **motor de reglas** (`motor_aptitud.py` + `reglas_aptitud.json`). Este
pipeline permite entrenar un modelo XGBoost cuando exista un dataset real, y activarlo sin tocar el resto del
sistema. **Mientras no haya un dataset etiquetado por un profesional, no hay ningún modelo entrenado ni ninguna
precisión que reportar.**

## Cómo funciona la decisión

1. Las **reglas** siempre se evalúan: categoría A1–A4, alertas, factores, confianza y versión.
2. Si hay un **modelo** configurado (`MODELO_IA_PATH`), se combina con las reglas de forma segura: la categoría final
   es la **más grave** entre la de las reglas y la del modelo. El modelo nunca puede declarar apto a quien las reglas
   marcan en riesgo. La confianza es la menor de las dos.
3. Si el modelo no existe, está dañado o falla, el sistema sigue solo con las reglas (queda un aviso en el log).

## Dataset (CSV)

Una fila por evaluación. La columna `categoria` es la etiqueta (A1–A4) puesta por un profesional.

| columna | contenido |
|---|---|
| `presion_sistolica`, `presion_diastolica` | mmHg (vacío si no se midió) |
| `fc_reposo`, `fc_recuperacion` | latidos por minuto (vacío si no se midió) |
| `imc` | kg/m² (vacío si no se midió) |
| `sintomas`, `condiciones` | textos exactos de la app separados por `;` |
| `lesiones_previas` | texto libre (vacío si no hay) |
| `categoria` | `A1`, `A2`, `A3` o `A4` |

Ejemplo (cabecera y dos filas):

```csv
presion_sistolica,presion_diastolica,fc_reposo,fc_recuperacion,imc,sintomas,condiciones,lesiones_previas,categoria
118,78,70,100,22.0,,,,A4
150,95,88,110,29.5,Medicación permanente,Hipertensión,,A2
```

Los datos deben estar **anonimizados** (sin nombre, matrícula ni teléfono).

## Entrenar y evaluar

```bash
pip install -r requirements-ia.txt
python -m ia.entrenar --datos dataset.csv --salida modelos/xgb-actual
```

Guarda `modelo.json` (formato JSON de XGBoost, no ejecuta código al cargarse) y `meta.json` con la versión, la
huella del dataset, las columnas, las métricas, las advertencias y las limitaciones. Las métricas se calculan sobre un
20 % de filas que el modelo no vio (partición estratificada y reproducible):

- exactitud y matriz de confusión;
- recall y precisión por categoría;
- **falsos negativos**: casos A1/A2 que el modelo dejó como aptos (A3/A4) — el objetivo del proyecto es que sea lo más
  cercano posible a 0 %;
- derivaciones innecesarias: casos aptos que el modelo marcó como graves.

El script compara la exactitud con el objetivo del proyecto (> 90 %) y avisa si **no** se cumple. Se niega a entrenar con
menos de 100 filas (`--permitir-pocos` solo sirve para probar el flujo).

## Activar el modelo

```bash
MODELO_IA_PATH=modelos/xgb-actual uvicorn main:app
```

La versión del modelo queda en cada evaluación (`inferencias_ia.version_modelo`, por ejemplo
`xgb-20261012-1a2b3c4d+reglas-v2`). Antes de activarlo en producción, el modelo y sus categorías deben ser revisados por
una persona con formación en ciencias del ejercicio (R.222).

## Cambiar las reglas

Todos los rangos, umbrales de confianza y textos de intensidad están en `reglas_aptitud.json`
(o en otro archivo con `REGLAS_APTITUD_PATH`). Al arrancar se valida; si es inconsistente, el backend no inicia y dice qué
falta. Cualquier cambio debe subir `version`, que queda registrada en cada evaluación.
