# Arranca todo el tótem en este equipo: los puentes de los sensores, la app (compilada para web) y, si corresponde, el navegador.
# Uso:  .\iniciar_quiosco.ps1                  (puentes + app + navegador a pantalla completa, todo en este PC)
#       .\iniciar_quiosco.ps1 -SinNavegador    (arranca los servicios sin abrir el navegador)
#       .\iniciar_quiosco.ps1 -Red             (para una tablet: puentes y app escuchan en la red local; no abre navegador aquí)
#       .\iniciar_quiosco.ps1 -Verificar       (solo muestra qué haría)
# Configuración opcional en quiosco.env (ver quiosco.env.example). Antes, una vez: .\construir_app.ps1  (o  -Red)
param([switch]$SinNavegador, [switch]$Red, [switch]$Verificar)

. (Join-Path $PSScriptRoot 'comun.ps1')
$config = Leer-Config
$puerto = $config.PUERTO_APP
$carpetaApp = Join-Path $PSScriptRoot $(if ($Red) { 'app-web-red' } else { 'app-web' })
$python = if ($env:PUENTE_PYTHON) { $env:PUENTE_PYTHON } else { 'python' }

if (-not (Test-Path (Join-Path $carpetaApp 'index.html'))) {
    Write-Host "Falta la app compilada. Ejecuta primero: .\construir_app.ps1$(if ($Red) { ' -Red' })" -ForegroundColor Red
    exit 1
}

if ($Red) {
    $ip = Obtener-IP $config
    $urlTablet = "http://${ip}:$puerto"
    $url = "http://localhost:$puerto"
    # Los puentes escuchan en toda la red local, así que exigen la clave; y solo aceptan llamadas del navegador desde la app.
    $env:PUENTE_HOST = '0.0.0.0'
    $env:PUENTE_TOKEN = Obtener-Token $config
    $env:PUENTE_ORIGENES = "$urlTablet,$url"
    $direccionApp = '0.0.0.0'
} else {
    $url = "http://localhost:$puerto"
    $env:PUENTE_ORIGENES = $url
    # Sin -Red todo es local: borra lo que haya dejado un arranque anterior con -Red en esta misma consola (si no, los puentes
    # seguirían escuchando en toda la red mientras la app solo escucha en localhost).
    Remove-Item Env:PUENTE_HOST, Env:PUENTE_TOKEN -ErrorAction SilentlyContinue
    $direccionApp = '127.0.0.1'
}

$puentes = @()
foreach ($nombre in (Nombres-Puentes $config)) {
    $carpeta = Join-Path $script:Raiz $script:CarpetasPuente[$nombre]
    if (-not (Test-Path (Join-Path $carpeta 'puente.env'))) {
        Write-Host "Se omite '$nombre': falta $($script:CarpetasPuente[$nombre])\puente.env" -ForegroundColor Yellow
        continue
    }
    $puentes += [pscustomobject]@{ Nombre = $nombre; Script = Join-Path $carpeta 'iniciar_puente.ps1' }
}

function Buscar-Navegador {
    if ($config.NAVEGADOR -and (Test-Path $config.NAVEGADOR)) { return $config.NAVEGADOR }
    $candidatos = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    return $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
}
$navegador = Buscar-Navegador

if ($Verificar) {
    Write-Host "Modo:       $(if ($Red) { 'red (tablet)' } else { 'local (este PC)' })"
    Write-Host "App:        $url  (sirve $carpetaApp, escucha en $direccionApp)"
    if ($Red) { Write-Host "Tablet:     $urlTablet" }
    Write-Host "Puentes:    $(if ($puentes) { ($puentes | ForEach-Object Nombre) -join ', ' } else { '(ninguno)' })"
    Write-Host "Navegador:  $(if ($Red) { '(no se abre en modo red)' } elseif ($navegador) { $navegador } else { '(no encontrado)' })"
    Write-Host "PUENTE_ORIGENES = $env:PUENTE_ORIGENES"
    if ($Red) { Write-Host "PUENTE_HOST = $env:PUENTE_HOST  (clave de $($env:PUENTE_TOKEN.Length) caracteres)" }
    exit 0
}

$pids = @()
foreach ($puente in $puentes) {
    $proceso = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($puente.Script)`""
    $pids += $proceso.Id
    Write-Host "Puente $($puente.Nombre) iniciado."
}
$servidor = Start-Process $python -WindowStyle Hidden -PassThru -ArgumentList '-m', 'http.server', $puerto, '--bind', $direccionApp, '--directory', "`"$carpetaApp`""
$pids += $servidor.Id
$pids | Set-Content (Join-Path $env:TEMP 'quiosco.pids')

# Espera a que la app responda.
$listo = $false
for ($i = 0; $i -lt 30 -and -not $listo; $i++) {
    try { $listo = (Invoke-WebRequest "http://127.0.0.1:$puerto" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { Start-Sleep -Seconds 1 }
}
if (-not $listo) { Write-Host "La app no respondió en $url" -ForegroundColor Red; exit 1 }
Write-Host "App lista en $url"
if ($Red) { Write-Host "En la tablet abre: $urlTablet" -ForegroundColor Green }

if ($SinNavegador -or $Red) { exit 0 }
if (-not $navegador) { Write-Host "No se encontró Chrome ni Edge: abre $url a mano." -ForegroundColor Yellow; exit 0 }

$perfil = Join-Path $env:LOCALAPPDATA 'TotemQuiosco'
$argumentos = if ($navegador -like '*msedge.exe') {
    @('--kiosk', $url, '--edge-kiosk-type=fullscreen', "--user-data-dir=$perfil", '--no-first-run')
} else {
    @('--kiosk', $url, "--user-data-dir=$perfil", '--no-first-run', '--disable-pinch', '--overscroll-history-navigation=0', '--noerrdialogs')
}
Start-Process $navegador -ArgumentList $argumentos
