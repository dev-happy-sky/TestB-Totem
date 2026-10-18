# Arranca todo el tótem en este equipo: los puentes de los sensores, la app (compilada para web) y el navegador a pantalla completa.
# Uso:  .\iniciar_quiosco.ps1                (arranca todo)
#       .\iniciar_quiosco.ps1 -SinNavegador  (arranca los servicios sin abrir el navegador)
#       .\iniciar_quiosco.ps1 -Verificar     (solo muestra qué haría)
# Configuración opcional en quiosco.env (ver quiosco.env.example). Antes, una vez: .\construir_app.ps1
param([switch]$SinNavegador, [switch]$Verificar)

$raiz = Split-Path $PSScriptRoot -Parent
$config = @{ PUERTO_APP = '8081'; PUENTES = 'oximetro,bascula'; NAVEGADOR = '' }
$archivo = Join-Path $PSScriptRoot 'quiosco.env'
if (Test-Path $archivo) {
    foreach ($linea in Get-Content $archivo) {
        $texto = $linea.Trim()
        if (-not $texto -or $texto.StartsWith('#')) { continue }
        $i = $texto.IndexOf('=')
        if ($i -lt 1) { continue }
        $config[$texto.Substring(0, $i).Trim()] = $texto.Substring($i + 1).Trim().Trim('"')
    }
}

$puerto = $config.PUERTO_APP
$carpetaApp = Join-Path $PSScriptRoot 'app-web'
$python = if ($env:PUENTE_PYTHON) { $env:PUENTE_PYTHON } else { 'python' }
$url = "http://localhost:$puerto"

if (-not (Test-Path (Join-Path $carpetaApp 'index.html'))) {
    Write-Host "Falta la app compilada. Ejecuta primero: .\construir_app.ps1" -ForegroundColor Red
    exit 1
}

# Los puentes solo aceptan llamadas del navegador desde el origen de la app.
$env:PUENTE_ORIGENES = $url

$carpetasPuente = @{ oximetro = 'puente-oximetro'; bascula = 'puente-bascula'; tensiometro = 'puente-tensiometro' }
$puentes = @()
foreach ($nombre in ($config.PUENTES -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })) {
    if (-not $carpetasPuente.ContainsKey($nombre)) { Write-Host "Puente desconocido en PUENTES: $nombre" -ForegroundColor Red; exit 1 }
    $carpeta = Join-Path $raiz $carpetasPuente[$nombre]
    if (-not (Test-Path (Join-Path $carpeta 'puente.env'))) {
        Write-Host "Se omite '$nombre': falta $($carpetasPuente[$nombre])\puente.env" -ForegroundColor Yellow
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
    Write-Host "App:        $url  (sirve $carpetaApp)"
    Write-Host "Puentes:    $(if ($puentes) { ($puentes | ForEach-Object Nombre) -join ', ' } else { '(ninguno)' })"
    Write-Host "Navegador:  $(if ($navegador) { $navegador } else { '(no encontrado)' })"
    Write-Host "PUENTE_ORIGENES = $env:PUENTE_ORIGENES"
    exit 0
}

$pids = @()
foreach ($puente in $puentes) {
    $proceso = Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$($puente.Script)`""
    $pids += $proceso.Id
    Write-Host "Puente $($puente.Nombre) iniciado."
}
$servidor = Start-Process $python -WindowStyle Hidden -PassThru -ArgumentList '-m', 'http.server', $puerto, '--bind', '127.0.0.1', '--directory', "`"$carpetaApp`""
$pids += $servidor.Id
$pids | Set-Content (Join-Path $env:TEMP 'quiosco.pids')

# Espera a que la app responda antes de abrir el navegador.
$listo = $false
for ($i = 0; $i -lt 30 -and -not $listo; $i++) {
    try { $listo = (Invoke-WebRequest "http://127.0.0.1:$puerto" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { Start-Sleep -Seconds 1 }
}
if (-not $listo) { Write-Host "La app no respondió en $url" -ForegroundColor Red; exit 1 }
Write-Host "App lista en $url"

if ($SinNavegador) { exit 0 }
if (-not $navegador) { Write-Host "No se encontró Chrome ni Edge: abre $url a mano." -ForegroundColor Yellow; exit 0 }

$perfil = Join-Path $env:LOCALAPPDATA 'TotemQuiosco'
$argumentos = if ($navegador -like '*msedge.exe') {
    @('--kiosk', $url, '--edge-kiosk-type=fullscreen', "--user-data-dir=$perfil", '--no-first-run')
} else {
    @('--kiosk', $url, "--user-data-dir=$perfil", '--no-first-run', '--disable-pinch', '--overscroll-history-navigation=0', '--noerrdialogs')
}
Start-Process $navegador -ArgumentList $argumentos
