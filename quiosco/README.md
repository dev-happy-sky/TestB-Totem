# Quiosco del tótem (Windows)

Arranca todo lo que necesita la pantalla del tótem **en un solo paso**: los puentes Bluetooth de los sensores, la app (compilada para
web) y el navegador a pantalla completa.

```
sensores ──BLE──▶ puentes (localhost) ──HTTP──▶ app del tótem (navegador en quiosco) ──HTTPS──▶ backend (Render) ──▶ dashboard (Vercel)
```

Va todo en el mismo equipo porque un navegador solo puede llamar a los puentes por `localhost` (una página web no puede llamar a un
puente `http` de otra máquina). La app se sirve en `http://localhost:8081` y los puentes solo aceptan llamadas de ese origen.

## Una sola vez

1. En `totem-app/.env` define el backend y los sensores reales (ver `totem-app/.env.example`):
   ```
   EXPO_PUBLIC_API_URL=https://<tu-backend>.onrender.com
   EXPO_PUBLIC_SENSORES=oximetro_puente,bascula_puente
   EXPO_PUBLIC_PUENTE_OXIMETRO_URL=http://localhost:8765
   EXPO_PUBLIC_PUENTE_BASCULA_URL=http://localhost:8766
   EXPO_PUBLIC_TOTEM_KEY=<igual a TOTEM_API_KEY del backend, si activaste la seguridad>
   ```
   Deja `localhost`, no la IP del equipo. No pongas `PUENTE_TOKEN` en los puentes ni `*_KEY` en la app: no hacen falta con `localhost`
   (y una clave dentro de una app web es visible para quien la abra).
2. Cada puente necesita su `puente.env` (copia `puente.env.example` en `puente-oximetro/`, `puente-bascula/`...).
3. Instala las dependencias de los puentes (`pip install -r requirements.txt` en cada carpeta) y de la app (`npm install` en `totem-app/`).
4. Compila la app: `.\construir_app.ps1` (40 s aprox.). **Hay que repetirlo cada vez que cambie el código o el `.env`**, porque las variables
   `EXPO_PUBLIC_*` se incrustan al compilar.

## Uso

```powershell
.\iniciar_quiosco.ps1                 # puentes + app + navegador a pantalla completa
.\iniciar_quiosco.ps1 -SinNavegador   # solo los servicios (para probar)
.\iniciar_quiosco.ps1 -Verificar      # muestra qué haría, sin arrancar nada
.\detener_quiosco.ps1                 # detiene puentes y servidor (el navegador se cierra con Alt+F4)
```

Para que arranque solo al encender el equipo: `.\instalar_inicio_automatico.ps1` (tarea `TotemQuiosco`; quitar con
`.\quitar_inicio_automatico.ps1`). Corre en la sesión del usuario, así que el equipo debe iniciar sesión solo. Si PowerShell bloquea
scripts: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Configuración opcional en `quiosco.env` (copia `quiosco.env.example`): `PUERTO_APP` (8081), `PUENTES` (`oximetro,bascula`; también
`tensiometro`) y `NAVEGADOR` (ruta de Chrome o Edge si no se detecta). Un puente sin `puente.env` se omite con un aviso.

## Tablet (Samsung Galaxy Tab A7)

La tablet muestra la app; **los sensores siguen conectados por Bluetooth al PC** (los puentes) y la tablet los llama por Wi-Fi, así que el
PC y la tablet deben estar en la misma red y el PC encendido. Como los puentes ahora escuchan en la red local, exigen una **clave**
(se genera sola en `quiosco.env`, que git ignora) y solo aceptan llamadas de la app.

Pasos comunes (una vez):
1. En `quiosco.env` deja la lista de sensores en `PUENTES=` (por ejemplo `oximetro,bascula`; `IP_PC=` solo si la detección automática elige mal).
   Conviene **reservar una IP fija** para el PC en el router: la IP queda incrustada en la app.
2. En una PowerShell **como administrador**: `.\abrir_firewall.ps1` (abre 8081 y 8765-8767 solo para redes privadas; avisa si tu red está
   marcada como Pública y cómo cambiarla). Para cerrarlos: `.\abrir_firewall.ps1 -Quitar`.

**Vía A: navegador de la tablet (inmediata, sin cuentas)**
```powershell
.\construir_app.ps1 -Red        # compila con la IP del PC y la clave de los puentes (carpeta app-web-red)
.\iniciar_quiosco.ps1 -Red      # puentes + app escuchando en la red; no abre navegador en el PC
```
En la tablet abre Chrome en la dirección que imprime el script (`http://<IP del PC>:8081`). Para pantalla completa: menú de Chrome →
*Agregar a la pantalla principal*. Es un atajo a una página `http`: Chrome la abre con su barra. Para quitarla del todo, usa la vía B.

**Vía B: app instalada (APK, pantalla completa de verdad)**
El APK se compila en la nube con EAS (proyecto ya configurado en `app.json`). La app permite `http://` hacia los puentes
(`usesCleartextTraffic`, en el plugin `expo-build-properties`).
```powershell
cd ..\totem-app
npx eas-cli login                                  # una vez
..\quiosco\variables_eas.ps1 -Ejecutar            # carga en EAS la IP, los sensores y la clave (la nube no lee tu .env)
npx eas-cli build --platform android --profile tablet
```
Al terminar, EAS da un enlace/QR al `.apk`: ábrelo en la tablet, permite instalar desde esa fuente y listo. Si cambia la IP del PC, los
sensores o la clave, hay que repetir `variables_eas.ps1` y volver a compilar. En ambas vías hay que tener corriendo `.\iniciar_quiosco.ps1 -Red`.

Ajustes de la tablet para que sirva de tótem: *Ajustes → Pantalla → Tiempo de espera* al máximo (o *Opciones de desarrollador → Permanecer
activa* mientras carga), y el brillo y el volumen fijos. La app se bloquea en vertical (`orientation: portrait` en `app.json`); cámbialo a
`default` si la montas en horizontal.

## Cosas a saber

- Se usa Chrome o Edge en modo `--kiosk` con un perfil propio (`%LOCALAPPDATA%\TotemQuiosco`), sin barras ni pestañas. La app ya no tiene
  la barra de navegación de la plantilla de Expo.
- La app necesita internet para hablar con el backend; los puentes funcionan sin él. Render gratuito tarda ~30 s en despertar tras un rato inactivo.
- Si cambias de PC, hay que repetir los pasos de «Una sola vez» (los `.env` y `puente.env` no se suben a git).
- El dashboard de Vercel no se toca: recibe las evaluaciones del backend. Su `NEXT_PUBLIC_BACKEND_URL` debe apuntar al mismo backend que
  `EXPO_PUBLIC_API_URL`.
