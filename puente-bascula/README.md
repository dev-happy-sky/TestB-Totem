# Puente de la báscula (Bluetooth → tótem)

La app del tótem (Expo / React Native) no habla Bluetooth. Este servicio corre **junto a la báscula** (en el PC del tótem),
escucha lo que la báscula emite por Bluetooth y entrega a la app **un peso estable** por HTTP.

```
báscula ──anuncio BLE──▶ puente (Python, este servicio) ──HTTP──▶ app del tótem ──▶ backend
```

Es el hermano de `puente-oximetro/`, con una diferencia importante: **la báscula no acepta conexiones**. Manda el peso dentro
del propio anuncio Bluetooth (como una baliza), así que el puente no se conecta: solo escucha. Además la báscula **se
duerme** y solo anuncia cuando alguien se sube; no verla no es un fallo.

## Instalar y correr

```powershell
cd puente-bascula
pip install -r requirements.txt
$env:BASCULA_ID = "E0:D3:8E:62:51:3D"
python -m puente
```

| Variable | Por defecto | Qué hace |
|---|---|---|
| `BASCULA_ID` | — (obligatoria) | Dirección MAC de la báscula (en macOS, el UUID que entrega el sistema) |
| `PUENTE_HOST` | `127.0.0.1` | Interfaz donde escucha |
| `PUENTE_PORT` | `8766` | Puerto (el del oxímetro es 8765, pueden correr a la vez) |
| `PUENTE_TOKEN` | — | Clave que la app envía en `X-Puente-Key`. **Obligatoria si `PUENTE_HOST` no es localhost** |
| `PUENTE_ORIGENES` | — | Orígenes CORS permitidos (solo si la app corre como web), separados por coma |
| `PUENTE_TIMEOUT_S` | `30` | Tiempo máximo de una medición |

## Dejarlo siempre encendido (Windows)

1. Copia `puente.env.example` a `puente.env` (no se sube a git) y pon el `BASCULA_ID`.
2. Comprueba: `.\iniciar_puente.ps1 -Verificar`.
3. Instala el inicio automático: `.\instalar_inicio_automatico.ps1` (tarea `PuenteBascula`, arranca al iniciar sesión y se
   reinicia si falla; corre en la sesión del usuario porque los servicios de Windows no tienen Bluetooth).
   Para quitarla: `.\quitar_inicio_automatico.ps1`.

## Endpoints

- `GET /estado` → `{ "escuchando": true, "dispositivo": "...", "ultimo_anuncio_hace_s": 4.2 }` (`null` si aún no se ha visto la báscula).
- `GET /lectura` → último peso emitido, para mostrarlo en vivo: `{ "escuchando", "valida", "peso_kg", "motivo" }`. `motivo` es
  `desconectado` (el escaneo no está activo), `sin_senal` (sin anuncios en los últimos 20 s) o `sin_carga` (nadie encima).
- `POST /medir` → espera un peso estable y responde `{ "peso_kg", "muestras", "dispositivo": {"id", "calibracion"}, "capturado_en" }`.
  Si falla, `{ "codigo", "mensaje" }`:

| Situación | HTTP | `codigo` |
|---|---|---|
| El escaneo Bluetooth no está activo | 503 | `desconectado` |
| No llega ningún anuncio en el tiempo máximo (nadie se subió) | 504 | `timeout` |
| Solo llegan anuncios sin carga, o muy pocas muestras | 422 | `lectura_invalida` |
| Hay muestras pero el peso no se estabiliza | 422 | `movimiento` |
| Ya hay otra medición en curso | 409 | `error` |

El peso es un dato de salud: **no se guarda en disco ni se escribe en el log**.

## Formato del anuncio (deducido con la báscula "Yoda1")

Capturas reales; el peso en pantalla coincidía (53,4 kg ↔ `14 DC`). Detalle en `puente/protocolo.py`.

```
dato (13 bytes):  14 DC | 13 88 | 00 00 | 25 | E0 D3 8E 62 51 3D
                  peso    ¿?      fijo    estado  MAC
```

- Peso: 2 bytes big-endian en centésimas de kg (`0x14DC` = 5340 = 53,40 kg). Vacía: `00 00`.
- Estado: `25` con carga, `24` en vacío. Los 2 bytes `13 88` valen `00 00` en vacío y `13 88` con carga, sin relación con el peso;
  no se usan (su significado es desconocido).
- Lo que bleak llama "id de fabricante" mezcla un byte fijo (`C0`) y un contador que cambia por ráfaga.
- Los anuncios llegan en **ráfagas de 1-2 paquetes cada varios segundos**, por eso una medición pide solo 2 muestras
  consecutivas dentro de ±0,1 kg.

**Sin verificar:** pesos por encima de ~55 kg, báscula configurada en libras o stones, y si `13 88` cambia con otra persona o
con impedancia. Con la tuya, la báscula solo entrega el **peso**: IMC, grasa y masa muscular no vienen en el anuncio.

## Descubrir qué más trae el anuncio

```powershell
$env:BASCULA_ID = "E0:D3:8E:62:51:3D"
python -m puente.capturar 30
```

Imprime cada anuncio en bruto, el peso deducido y, al final, qué posiciones de bytes cambiaron. Súbete descalzo y espera a que la
pantalla termine de medir. Con tu báscula solo cambian el contador, el peso y el estado (vacía/con carga): **el anuncio no trae
grasa ni impedancia**, y la báscula tampoco acepta conexiones (`BleakDeviceNotFoundError`), así que no hay otra vía. No guarda nada en disco.

## Conectarlo a la app

En `totem-app/.env` (ver `.env.example`):

```
EXPO_PUBLIC_SENSORES=bascula_puente              # o: oximetro_puente,bascula_puente
EXPO_PUBLIC_PUENTE_BASCULA_URL=http://localhost:8766
EXPO_PUBLIC_PUENTE_BASCULA_KEY=                  # igual a PUENTE_TOKEN, si lo definiste
```

En un celular o tablet `localhost` apunta al propio aparato: usa la IP del PC, arranca el puente con `PUENTE_HOST=0.0.0.0` y
`PUENTE_TOKEN`, y abre el puerto 8766 en el firewall de Windows.
