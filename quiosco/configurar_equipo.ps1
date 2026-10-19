# Deja ESTE equipo como el que conecta los sensores: lo ejecutas una vez al mover el tótem a otro PC.
#
# Qué hace, en orden:
#   1. Comprueba los requisitos (Python, Node, adaptador Bluetooth).
#   2. Instala las dependencias de los puentes y de la app.
#   3. Crea los puente.env de cada puente con las direcciones de dispositivos.json.
#   4. Fija en quiosco.env la IP de ESTE equipo (descarta la del PC anterior) y la clave de los puentes.
#   5. Abre el firewall de Windows (pide permisos de administrador una sola vez).
#   6. Compila la app apuntando a ESTE equipo (modo red, para la tablet).
#   7. Arranca los puentes y la app, y comprueba que respondan.
#
# Uso:  .\configurar_equipo.ps1                 (todo)
#       .\configurar_equipo.ps1 -SoloVerificar  (solo muestra qué haría y qué falta; no cambia nada)
#       .\configurar_equipo.ps1 -IP 192.168.1.50   (si la IP detectada no es la de la red de la tablet)
#       Omitir pasos: -SinDependencias  -SinFirewall  -SinCompilar  -SinIniciar
param(
    [switch]$SoloVerificar, [switch]$SinDependencias, [switch]$SinFirewall, [switch]$SinCompilar, [switch]$SinIniciar,
    [string]$IP = ''
)

. (Join-Path $PSScriptRoot 'comun.ps1')
$ErrorActionPreference = 'Stop'
$python = if ($env:PUENTE_PYTHON) { $env:PUENTE_PYTHON } else { 'python' }
$problemas = New-Object System.Collections.ArrayList
$avisos = New-Object System.Collections.ArrayList
$numeroPaso = 0

function Paso([string]$texto) { $script:numeroPaso++; Write-Host "`n[$script:numeroPaso] $texto" -ForegroundColor Cyan }
function Bien([string]$texto) { Write-Host "    OK  $texto" -ForegroundColor Green }
function Aviso([string]$texto) { Write-Host "    !   $texto" -ForegroundColor Yellow; [void]$script:avisos.Add($texto) }
function Falla([string]$texto) { Write-Host "    X   $texto" -ForegroundColor Red; [void]$script:problemas.Add($texto) }
function Haria([string]$texto) { Write-Host "    ->  $texto" -ForegroundColor DarkGray }
function Cambia([string]$texto) { if ($SoloVerificar) { Haria "haría: $texto" } else { Write-Host "    ..  $texto" } }

function Sensores-Activos {
    $archivo = Join-Path $PSScriptRoot 'dispositivos.json'
    if (-not (Test-Path $archivo)) { throw "Falta $archivo (direcciones Bluetooth de los sensores)." }
    $datos = Get-Content $archivo -Raw | ConvertFrom-Json
    $lista = @()
    foreach ($nombre in $script:CarpetasPuente.Keys | Sort-Object) {
        $d = $datos.$nombre
        if ($null -eq $d) { continue }
        $lista += [pscustomobject]@{ Nombre = $nombre; Id = [string]$d.id; Activo = [bool]$d.activo; Nota = [string]$d.nota }
    }
    return $lista
}

Write-Host "Configurar este equipo como centro de los sensores del tótem" -ForegroundColor White
if ($SoloVerificar) { Write-Host "(modo verificación: no se cambia nada)" -ForegroundColor DarkGray }

# ----------------------------------------------------------------------------------------------- 1. requisitos
Paso 'Requisitos'
try { Bien "Python: $((& $python --version) 2>&1)" } catch { Falla "No hay Python en el PATH (https://www.python.org/downloads/, marca «Add to PATH»)." }
try { Bien "Node: $((& node --version) 2>&1)" } catch { Falla "No hay Node.js en el PATH (https://nodejs.org/)." }

# ----------------------------------------------------------------------------------------------- 2. dependencias
Paso 'Dependencias'
if ($SinDependencias) { Haria 'omitido (-SinDependencias)' }
elseif ($problemas.Count -gt 0) { Haria 'se omite: faltan requisitos' }
else {
    foreach ($nombre in ($script:CarpetasPuente.Keys | Sort-Object)) {
        $requisitos = Join-Path $script:Raiz "$($script:CarpetasPuente[$nombre])\requirements.txt"
        if (-not (Test-Path $requisitos)) { Aviso "Sin requirements.txt en $($script:CarpetasPuente[$nombre])"; continue }
        if ($SoloVerificar) { Haria "pip install -r $($script:CarpetasPuente[$nombre])\requirements.txt"; continue }
        & $python -m pip install --quiet -r $requisitos 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Bien "puente $nombre" } else { Falla "pip falló en $($script:CarpetasPuente[$nombre])" }
    }
    $moduloApp = Join-Path $script:Raiz 'totem-app\node_modules'
    if (Test-Path $moduloApp) { Bien 'totem-app: node_modules ya está' }
    elseif ($SoloVerificar) { Haria 'npm install en totem-app (tarda unos minutos)' }
    else {
        Cambia 'npm install en totem-app (tarda unos minutos)'
        Push-Location (Join-Path $script:Raiz 'totem-app')
        try { npm install --no-audit --no-fund 2>&1 | Out-Null; if ($LASTEXITCODE -eq 0) { Bien 'totem-app' } else { Falla 'npm install falló en totem-app' } }
        finally { Pop-Location }
    }
}

# ----------------------------------------------------------------------------------------------- Bluetooth
Paso 'Adaptador Bluetooth'
if ($SinDependencias -or $problemas.Count -gt 0 -or $SoloVerificar) {
    Haria 'se comprueba al instalar las dependencias (necesita la librería bleak)'
} else {
    & $python -c "import asyncio; from bleak import BleakScanner; asyncio.run(BleakScanner.discover(timeout=2))" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Bien 'Bluetooth disponible y encendido' }
    else { Falla 'Este equipo no tiene Bluetooth LE o está apagado (Configuración -> Bluetooth y dispositivos).' }
}

# ----------------------------------------------------------------------------------------------- 3. dispositivos
Paso 'Sensores (puente.env de cada puente)'
$sensores = Sensores-Activos
foreach ($s in $sensores) {
    $variable = "$($script:SufijoVariable[$s.Nombre])_ID"
    $archivo = Join-Path $script:Raiz "$($script:CarpetasPuente[$s.Nombre])\puente.env"
    $estado = if ($s.Activo) { 'activo' } else { 'desactivado' }
    if ($s.Id -notmatch '^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$') { Falla "$($s.Nombre): la dirección '$($s.Id)' de dispositivos.json no es una MAC válida."; continue }
    Cambia "$($script:CarpetasPuente[$s.Nombre])\puente.env  $variable=$($s.Id)  ($estado)"
    if (-not $SoloVerificar) { Guardar-EnEnv $archivo $variable $s.Id }
    if (-not $s.Activo -and $s.Nota) { Haria "$($s.Nombre): $($s.Nota)" }
}
$activos = @($sensores | Where-Object { $_.Activo } | ForEach-Object { $_.Nombre })
if ($activos.Count -eq 0) { Falla 'Ningún sensor está activo en dispositivos.json.' }
else { Bien "Sensores activos: $($activos -join ', ')" }

# ----------------------------------------------------------------------------------------------- 4. IP y clave
Paso 'IP de este equipo y clave de los puentes'
$config = Leer-Config
$ipAnterior = $config.IP_PC
$archivoUltimaIp = Join-Path $PSScriptRoot '.ultima_ip'
$ipCompilada = if (Test-Path $archivoUltimaIp) { (Get-Content $archivoUltimaIp -Raw).Trim() } else { '' }
try { $ipNueva = if ($IP) { $IP } else { Detectar-IP } }
catch { Falla $_.Exception.Message; $ipNueva = '' }
if ($ipNueva) {
    Bien "IP de este equipo: $ipNueva"
    if ($ipAnterior -and $ipAnterior -ne $ipNueva) { Aviso "quiosco.env tenía otra IP fijada ($ipAnterior), de otro equipo: se reemplaza." }
    Cambia "quiosco.env: IP_PC=$ipNueva, PUENTES=$($activos -join ',')"
    if (-not $SoloVerificar) {
        Guardar-Config 'IP_PC' $ipNueva
        Guardar-Config 'PUENTES' ($activos -join ',')
    }
}
if ($config.PUENTE_TOKEN) { Bien 'Clave de los puentes: ya existe en quiosco.env (se conserva)' }
elseif ($SoloVerificar) { Haria 'se generaría una clave nueva para los puentes' }
else { [void](Obtener-Token $config); Bien 'Clave de los puentes: generada' }

$envApp = Join-Path $script:Raiz 'totem-app\.env'
if (Test-Path $envApp) { Bien 'totem-app\.env ya existe (no se toca)' }
elseif ($SoloVerificar) { Haria 'se crearía totem-app\.env a partir de .env.example' }
else { Copy-Item (Join-Path $script:Raiz 'totem-app\.env.example') $envApp; Bien 'totem-app\.env creado desde .env.example (revisa EXPO_PUBLIC_API_URL y la clave del tótem)' }

# ----------------------------------------------------------------------------------------------- 5. firewall
Paso 'Firewall de Windows'
$reglaExiste = [bool](Get-NetFirewallRule -DisplayName 'Totem quiosco (tablet)' -ErrorAction SilentlyContinue)
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($SinFirewall) { Haria 'omitido (-SinFirewall)' }
elseif ($reglaExiste) { Bien 'La regla ya existe (puertos 8081, 8765-8767)' }
elseif ($SoloVerificar) { Haria 'se abrirían los puertos 8081 y 8765-8767 (pide permisos de administrador)' }
else {
    Cambia 'abriendo los puertos 8081 y 8765-8767 (aparecerá la ventana de permisos de administrador)'
    $comando = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'abrir_firewall.ps1')`""
    try {
        if ($esAdmin) { & (Join-Path $PSScriptRoot 'abrir_firewall.ps1') }
        else { Start-Process powershell -Verb RunAs -Wait -ArgumentList $comando }
    } catch { Aviso "No se pudo abrir el firewall (¿cancelaste los permisos?). Ejecuta .\abrir_firewall.ps1 como administrador." }
    if (Get-NetFirewallRule -DisplayName 'Totem quiosco (tablet)' -ErrorAction SilentlyContinue) { Bien 'Firewall abierto' }
    else { Aviso 'La regla de firewall no quedó creada: la tablet no podrá conectarse hasta ejecutar .\abrir_firewall.ps1 como administrador.' }
}
# Solo importa la red que usa la tablet: la del adaptador que tiene la IP de este equipo (no una VPN u otro adaptador).
$indiceRed = if ($ipNueva) { (Get-NetIPAddress -IPAddress $ipNueva -ErrorAction SilentlyContinue | Select-Object -First 1).InterfaceIndex } else { $null }
foreach ($red in @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' -and $_.InterfaceIndex -eq $indiceRed })) {
    Aviso "La red '$($red.Name)' está marcada como Pública y bloquea a la tablet. Como administrador: Set-NetConnectionProfile -InterfaceIndex $($red.InterfaceIndex) -NetworkCategory Private"
}

# ----------------------------------------------------------------------------------------------- 6. compilar
Paso 'App para la tablet (compilada con la IP de este equipo)'
$compilada = Test-Path (Join-Path $PSScriptRoot 'app-web-red\index.html')
$cambioIp = $ipNueva -and $ipCompilada -ne $ipNueva
if ($SinCompilar) { Haria 'omitido (-SinCompilar)' }
elseif ($problemas.Count -gt 0) { Haria 'se omite: hay problemas pendientes (arriba)' }
elseif ($compilada -and -not $cambioIp) { Bien 'Ya está compilada para esta IP' }
elseif ($SoloVerificar) { Haria "se compilaría la app (modo red) $(if (-not $compilada) { 'porque no hay compilación' } elseif ($ipCompilada) { "porque la IP cambió ($ipCompilada -> $ipNueva)" } else { 'porque no se sabe con qué IP se compiló' })" }
else {
    Cambia 'compilando (≈1 minuto)'
    & (Join-Path $PSScriptRoot 'construir_app.ps1') -Red
    if ($LASTEXITCODE -eq 0 -and (Test-Path (Join-Path $PSScriptRoot 'app-web-red\index.html'))) {
        Set-Content $archivoUltimaIp $ipNueva
        Bien 'App compilada'
    } else { Falla 'La compilación de la app falló.' }
}

# ----------------------------------------------------------------------------------------------- 7. arrancar y comprobar
Paso 'Arrancar puentes y app'
if ($SinIniciar) { Haria 'omitido (-SinIniciar)' }
elseif ($problemas.Count -gt 0) { Haria 'se omite: hay problemas pendientes (arriba)' }
elseif ($SoloVerificar) { Haria "se detendría lo anterior y se ejecutaría .\iniciar_quiosco.ps1 -Red (puentes: $($activos -join ', '))" }
else {
    if (Test-Path (Join-Path $env:TEMP 'quiosco.pids')) { & (Join-Path $PSScriptRoot 'detener_quiosco.ps1') | Out-Null }
    & (Join-Path $PSScriptRoot 'iniciar_quiosco.ps1') -Red -SinNavegador | Out-Null
    Start-Sleep -Seconds 6
    $config = Leer-Config
    try {
        $respuesta = Invoke-WebRequest "http://127.0.0.1:$($config.PUERTO_APP)" -UseBasicParsing -TimeoutSec 5
        Bien "App servida en el puerto $($config.PUERTO_APP)"
    } catch { Falla "La app no responde en el puerto $($config.PUERTO_APP)." }
    foreach ($nombre in $activos) {
        $puerto = $script:PuertosPuente[$nombre]
        try {
            $r = Invoke-RestMethod "http://127.0.0.1:$puerto/estado" -Headers @{ 'X-Puente-Key' = $config.PUENTE_TOKEN } -TimeoutSec 5
            $conexion = if ($null -ne $r.conectado) { if ($r.conectado) { 'conectado al aparato' } else { 'esperando al aparato' } } else { 'escuchando' }
            Bien "puente $nombre (puerto $puerto): $conexion"
        } catch { Falla "El puente $nombre no responde en el puerto $puerto (¿el adaptador Bluetooth está encendido?)." }
    }
}

# ----------------------------------------------------------------------------------------------- resumen
Write-Host "`n==================== Resumen ====================" -ForegroundColor White
if ($ipNueva) { Write-Host "Este equipo:   $ipNueva" }
Write-Host "Sensores:      $($activos -join ', ')"
if ($ipNueva) { Write-Host "Tablet (web):  http://${ipNueva}:$($config.PUERTO_APP)" -ForegroundColor Green }
if ($ipNueva -and $ipCompilada -ne $ipNueva) {
    Write-Host "`nLa IP de este equipo ($ipNueva) $(if ($ipCompilada) { "cambió desde la última compilación ($ipCompilada)" } else { 'es nueva para la app' }). Si la tablet usa el APK, tiene la IP vieja grabada: actualízalo con" -ForegroundColor Yellow
    Write-Host "  .\variables_eas.ps1 -Ejecutar   y luego   cd ..\totem-app; npx eas-cli build --platform android --profile tablet" -ForegroundColor Yellow
    Write-Host "(Con la versión web de la tablet basta abrir la dirección nueva.) Para no repetirlo, reserva una IP fija para este PC en el router." -ForegroundColor Yellow
}
$tensio = $sensores | Where-Object { $_.Nombre -eq 'tensiometro' }
if ($tensio -and $activos -contains 'tensiometro') { Write-Host "`nTensiómetro: el emparejamiento Bluetooth es por equipo; en este PC hay que repetirlo (puente-tensiometro\README.md)." -ForegroundColor Yellow }
foreach ($a in $avisos) { Write-Host "  ! $a" -ForegroundColor Yellow }
if ($problemas.Count -gt 0) {
    Write-Host "`nPendiente de resolver:" -ForegroundColor Red
    foreach ($p in $problemas) { Write-Host "  X $p" -ForegroundColor Red }
    exit 1
}
Write-Host $(if ($SoloVerificar) { "`nVerificación terminada (no se cambió nada)." } else { "`nListo. Para detener todo: .\detener_quiosco.ps1" }) -ForegroundColor Green
exit 0
