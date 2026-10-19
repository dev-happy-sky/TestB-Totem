# Puente del tensiómetro (Bluetooth → tótem)

Tensiómetro de brazo **Beurer BM 54** (MAC `0C:7F:ED:74:07:54`). La app del tótem no habla Bluetooth: este servicio corre en el PC
del tótem, se conecta al tensiómetro con `bleak` y entrega a la app la medición (sistólica, diastólica y pulso) por HTTP.

```
tensiómetro ──BLE (presión arterial 0x1810)──▶ puente (Python) ──HTTP──▶ app del tótem ──▶ backend
```

> **Estado: la lógica está escrita y probada con paquetes construidos según la especificación, pero el puente todavía NO se ha
> conectado al aparato real.** Lo único medido: el BM 54 se ve por Bluetooth con el nombre `BM54` y anuncia el servicio estándar
> de presión arterial (`0x1810`); la conexión desde el PC se agotó por tiempo, probablemente porque falta emparejarlo (ver más abajo).

## Cómo funciona (distinto del oxímetro y la báscula)

Esos dos envían datos continuos. El tensiómetro **mide una vez y entrega la medición al terminar**, y se duerme: no estar conectado es
lo normal. Por eso `POST /medir` espera hasta 2 minutos a que llegue la próxima medición: la persona pulsa **Start** en el brazalete,
el aparato mide unos 30 s y el puente recibe el resultado. Las mediciones guardadas de antes se descartan (por su fecha, si el aparato
la envía, y porque `/medir` solo acepta las posteriores al pedido).

## Instalar y correr

```powershell
cd puente-tensiometro
pip install -r requirements.txt
$env:TENSIOMETRO_ID = "0C:7F:ED:74:07:54"
python -m puente
```

| Variable | Por defecto | Qué hace |
|---|---|---|
| `TENSIOMETRO_ID` | — (obligatoria) | Dirección MAC del tensiómetro |
| `PUENTE_HOST` | `127.0.0.1` | Interfaz donde escucha |
| `PUENTE_PORT` | `8767` | Puerto (oxímetro 8765, báscula 8766: pueden correr a la vez) |
| `PUENTE_TOKEN` | — | Clave que la app envía en `X-Puente-Key`. **Obligatoria si `PUENTE_HOST` no es localhost** |
| `PUENTE_ORIGENES` | — | Orígenes CORS permitidos (solo si la app corre como web) |
| `PUENTE_TIMEOUT_S` | `120` | Tiempo máximo que `/medir` espera la medición |
| `PUENTE_EMPAREJAR` | desactivado | `true` para intentar emparejar en cada conexión. Mejor emparejar una vez con `python -m puente.emparejar` |
| `PUENTE_ANTIGUEDAD_MAX_MIN` | `10` | Descarta mediciones con fecha más vieja que esto; `0` no descarta por fecha |

Arranque automático en Windows: copia `puente.env.example` a `puente.env`, comprueba con `.\iniciar_puente.ps1 -Verificar` e instala con
`.\instalar_inicio_automatico.ps1` (tarea `PuenteTensiometro`). Quitar: `.\quitar_inicio_automatico.ps1`. (Ya existe un `puente.env`
local con la MAC; no se sube a git.)

## Endpoints

- `GET /estado` → `{ "activo", "conectado", "dispositivo", "ultima_medicion_hace_s" }`. `activo` = el puente está intentando conectarse.
- `POST /medir` → `{ "sistolica", "diastolica", "pulso", "dispositivo": {"id", "calibracion"}, "capturado_en" }`. Errores `{ "codigo", "mensaje" }`:

| Situación | HTTP | `codigo` |
|---|---|---|
| El puente no está activo | 503 | `desconectado` |
| No llegó ninguna medición en el tiempo máximo | 504 | `timeout` |
| El aparato indicó brazalete flojo / posición incorrecta, presión imposible o sistólica ≤ diastólica | 422 | `lectura_invalida` |
| El aparato detectó movimiento | 422 | `movimiento` |
| Ya hay otra medición en curso | 409 | `error` |

No se guarda nada en disco ni en el log.

## Formato (perfil estándar, sin verificar con el aparato)

Característica `0x2A35` *Blood Pressure Measurement* (indicaciones): banderas, sistólica, diastólica y presión media como SFLOAT de 16 bits,
y opcionales fecha/hora, pulso, id de usuario y estado de la medición (movimiento, manguito flojo, pulso irregular, posición). Detalle en
`puente/protocolo.py`. Soporta kPa (convierte a mmHg).

## Emparejar el aparato con el PC (una sola vez)

Probado con el BM 54 real: conecta, pero **rechaza leer las mediciones** (`Insufficient Authentication`) si no hay un vínculo cifrado
con el PC, y solo acepta crearlo en su **modo de emparejamiento**. Además, Windows guarda el vínculo aunque el aparato ya lo haya
olvidado, y entonces `bleak` se salta el emparejamiento. La herramienta se encarga de todo:

```powershell
cd puente-tensiometro
$env:TENSIOMETRO_ID = "0C:7F:ED:74:07:54"
python -m puente.emparejar          # espera 90 s (o: python -m puente.emparejar 180)
```

1. Detén antes el puente si está corriendo (compite por la conexión).
2. Ejecuta el comando y **pon el tensiómetro en modo de emparejamiento** (símbolo de Bluetooth parpadeando).
3. Borra el vínculo viejo, empareja y comprueba que ya se puede leer; termina con `LISTO: tensiómetro emparejado`.
   Si dice que el aparato rechaza la lectura, no estaba en modo de emparejamiento: vuélvelo a poner y espera el siguiente intento.

**Si dice que el vínculo quedó «solo CIFRADO»:** es lo que pasó con el BM 54 real. Windows lo guardó con nivel *Encryption* (sin
autenticación) y el aparato exige uno *autenticado* (código o confirmación en pantalla); `bleak` solo sabe hacer el primero. Hay que
emparejar desde **Configuración de Windows → Bluetooth y dispositivos → Agregar dispositivo** (antes, quita «BM54» de la lista) con el
aparato en modo de emparejamiento, y seguir lo que pida Windows. Para comprobar el resultado, el nivel debe ser 3:

```powershell
python -c "import asyncio; from puente.emparejar import nivel_de_vinculo_windows as n; print(asyncio.run(n('0C:7F:ED:74:07:54')))"
```

Después arranca el puente **sin** `PUENTE_EMPAREJAR`. Si más adelante vuelve el error de autenticación (el aparato perdió el vínculo,
por ejemplo al enlazarlo con el celular), repite este paso.

## Diagnóstico

El puente registra con marca de hora cada paso (no los valores): `Escuchando`, `Tensiómetro visible: conectando`, `Tensiómetro conectado`,
`Suscrito a las mediciones`, `Medición recibida`. Conectar y suscribirse tienen un tope de 12 s; el aparato solo es visible un par de
segundos tras pulsar su botón, por eso el escáner queda encendido siempre y se conecta en cuanto lo ve.

## Conectarlo a la app

En `totem-app/.env`: `EXPO_PUBLIC_SENSORES=tensiometro_puente` (combinable con coma), `EXPO_PUBLIC_PUENTE_TENSIOMETRO_URL=http://localhost:8767`
y `EXPO_PUBLIC_PUENTE_TENSIOMETRO_KEY` si definiste `PUENTE_TOKEN`. Desde un celular usa la IP del PC y abre el puerto 8767 en el firewall.
El pulso que mide el tensiómetro **no** reemplaza la FC en reposo del oxímetro.
