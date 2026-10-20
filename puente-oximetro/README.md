# Puente del oxímetro (Bluetooth → tótem)

La app del tótem (Expo / React Native) no habla Bluetooth. Este servicio corre **junto al oxímetro** (en el PC o
Raspberry del tótem), se conecta por BLE con `bleak` y entrega a la app **una medición estable** por HTTP.

```
oxímetro ──BLE──▶ puente (Python, este servicio) ──HTTP──▶ app del tótem ──▶ backend
```

Basado en el script original de captura continua. Lo que cambió:

- En vez de imprimir/guardar cada muestra, el puente espera **5 muestras válidas y estables** y entrega su mediana.
- **No guarda nada en disco** (el script escribía `oximetro_log.csv` con cada lectura): son datos de salud.
- Se reconecta solo si el oxímetro se apaga o sale de alcance.

## Instalar y correr

```bash
cd puente-oximetro
pip install -r requirements.txt
OXIMETRO_ID="<dirección MAC o UUID del oxímetro>" python -m puente
```

En Windows (PowerShell): `$env:OXIMETRO_ID="..."; python -m puente`.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `OXIMETRO_ID` | — (obligatoria) | Dirección MAC (Windows/Linux) o UUID (macOS) del oxímetro |
| `PUENTE_HOST` | `127.0.0.1` | Interfaz donde escucha |
| `PUENTE_PORT` | `8765` | Puerto |
| `PUENTE_TOKEN` | — | Clave que la app envía en `X-Puente-Key`. **Obligatoria si `PUENTE_HOST` no es localhost** |
| `PUENTE_ORIGENES` | — | Orígenes CORS permitidos (solo si la app corre como web), separados por coma |
| `PUENTE_TIMEOUT_S` | `60` | Tiempo máximo de una medición |

## Endpoints

- `GET /estado` → `{ "conectado": true, "dispositivo": "...", "ultimo_paquete_hace_s": 0.4 }`
- `GET /lectura` → lo último que envía el oxímetro, para mostrarlo en vivo: `{ "conectado", "valida", "spo2", "fc", "indice_perfusion", "motivo" }`. `motivo` es `desconectado`, `sin_senal` (no llegan datos hace más de 3 s) o `sin_dedo` cuando `valida` es `false`. No es una medición: no se estabiliza ni se guarda.
- `POST /medir` → espera una medición estable y responde `{ "spo2", "fc", "indice_perfusion", "muestras", "dispositivo": {"id", "calibracion"}, "capturado_en" }`.
  Si falla, responde `{ "codigo", "mensaje" }` con los mismos códigos que entiende la app:

| Situación | HTTP | `codigo` |
|---|---|---|
| El oxímetro no está conectado | 503 | `desconectado` |
| No llega ningún paquete en el tiempo máximo | 504 | `timeout` |
| Todo lo que llega es "sin dedo", o hay muy pocas muestras válidas | 422 | `lectura_invalida` |
| Hay muestras válidas pero no se estabilizan | 422 | `movimiento` |
| Ya hay otra medición en curso | 409 | `error` |

## Dejarlo siempre encendido (Windows)

El puente se reconecta solo si el oxímetro se apaga o sale de alcance. Para que además arranque con el PC y se levante si se cae:

1. Copia `puente.env.example` a `puente.env` (no se sube a git) y pon el `OXIMETRO_ID`.
2. Comprueba la configuración: `.\iniciar_puente.ps1 -Verificar`.
3. Instala el inicio automático (PowerShell, en esta carpeta): `.\instalar_inicio_automatico.ps1`.

Crea la tarea `PuenteOximetro`, que arranca al iniciar sesión y se reinicia si falla. Corre en la sesión del usuario (no como servicio de Windows) porque los servicios no tienen acceso a Bluetooth: el PC del tótem debe iniciar sesión solo al encender. Para quitarla: `.\quitar_inicio_automatico.ps1`. Si PowerShell bloquea los scripts: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Conectarlo a la app

En `totem-app` (variables `EXPO_PUBLIC_*`, ver `.env.example`):

```
EXPO_PUBLIC_SENSORES=oximetro_puente
EXPO_PUBLIC_PUENTE_OXIMETRO_URL=http://localhost:8765
EXPO_PUBLIC_PUENTE_OXIMETRO_KEY=            # igual a PUENTE_TOKEN, si lo definiste
```

El oxímetro cubre **dos mediciones**: en reposo (SpO₂ y FC en reposo) y de recuperación (FC justo después del ejercicio).
Los demás sensores siguen simulados hasta que tengan su propio adaptador.

Ten en cuenta:

- `localhost` solo sirve si la app y el puente están en el mismo equipo. Si la app corre en una tablet o celular, usa la IP
  del equipo del puente (`PUENTE_HOST=0.0.0.0`, `PUENTE_TOKEN=...` y la URL con esa IP).
- Android bloquea por defecto las peticiones `http://` en compilaciones de producción: para una URL de red local hay que
  permitir tráfico no cifrado en la configuración nativa de la app o poner el puente detrás de HTTPS.
- Expone el puente solo en una red de confianza: entrega datos de salud.

## Protocolo y parámetros

El formato de los paquetes (cabecera `0xA7`, SpO₂ en el byte 7, FC en el 8, perfusión en el 9) se dedujo con nRF Connect y
está aislado en `puente/protocolo.py`. No hay checksum conocido: SpO₂ en 0 o sobre 100, y FC en 0 o 255, se tratan como
"sin dedo". Los umbrales de estabilidad (`puente/captura.py`: 5 muestras, ±2 puntos de SpO₂, ±5 lpm) son **provisionales**.

### Para validar con tu oxímetro

1. Con el dedo puesto y quieto, `POST /medir` devuelve valores razonables en pocos segundos.
2. Sin dedo, devuelve `lectura_invalida` ("No se detecta el dedo"), no valores falsos. Si tu modelo envía otro valor para
   "sin dedo" (por ejemplo SpO₂ 127), agrégalo en `protocolo.py`.
3. Moviendo el dedo, devuelve `movimiento`; si pasa con el dedo quieto, sube las tolerancias en `captura.py`.
4. Apagando el oxímetro, `GET /estado` pasa a `conectado: false` y al encenderlo se reconecta solo.
5. Compara SpO₂ y FC con la pantalla del oxímetro.

## Pruebas

```bash
pip install -r requirements-dev.txt
python -m pytest
```

Las pruebas usan un cliente BLE falso: no necesitan Bluetooth ni el dispositivo.
