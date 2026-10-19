# Funciones y tablas compartidas por los scripts del quiosco (se cargan con: . (Join-Path $PSScriptRoot 'comun.ps1')).

$script:Raiz = Split-Path $PSScriptRoot -Parent
$script:ArchivoConfig = Join-Path $PSScriptRoot 'quiosco.env'

$script:CarpetasPuente = @{ oximetro = 'puente-oximetro'; bascula = 'puente-bascula'; tensiometro = 'puente-tensiometro' }
$script:PuertosPuente = @{ oximetro = 8765; bascula = 8766; tensiometro = 8767 }
$script:ModosSensor = @{ oximetro = 'oximetro_puente'; bascula = 'bascula_puente'; tensiometro = 'tensiometro_puente' }
$script:SufijoVariable = @{ oximetro = 'OXIMETRO'; bascula = 'BASCULA'; tensiometro = 'TENSIOMETRO' }

function Leer-Config {
    $config = @{ PUERTO_APP = '8081'; PUENTES = 'oximetro,bascula'; NAVEGADOR = ''; IP_PC = ''; PUENTE_TOKEN = '' }
    if (Test-Path $script:ArchivoConfig) {
        foreach ($linea in Get-Content $script:ArchivoConfig) {
            $texto = $linea.Trim()
            if (-not $texto -or $texto.StartsWith('#')) { continue }
            $i = $texto.IndexOf('=')
            if ($i -lt 1) { continue }
            $config[$texto.Substring(0, $i).Trim()] = $texto.Substring($i + 1).Trim().Trim('"')
        }
    }
    return $config
}

function Nombres-Puentes($config) {
    $nombres = @($config.PUENTES -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    foreach ($nombre in $nombres) {
        if (-not $script:CarpetasPuente.ContainsKey($nombre)) { throw "Puente desconocido en PUENTES: $nombre" }
    }
    return $nombres
}

function Guardar-Config([string]$clave, [string]$valor) {
    $lineas = @()
    if (Test-Path $script:ArchivoConfig) { $lineas = @(Get-Content $script:ArchivoConfig) }
    $nueva = "$clave=$valor"
    $encontrada = $false
    for ($i = 0; $i -lt $lineas.Count; $i++) {
        if ($lineas[$i] -match "^\s*$clave\s*=") { $lineas[$i] = $nueva; $encontrada = $true }
    }
    if (-not $encontrada) { $lineas += $nueva }
    Set-Content -Path $script:ArchivoConfig -Value $lineas -Encoding UTF8
}

# IPv4 de la red local de este equipo (la de la interfaz con puerta de enlace). Se puede fijar con IP_PC en quiosco.env.
function Obtener-IP($config) {
    if ($config.IP_PC) { return $config.IP_PC }
    $ip = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
        ForEach-Object { $_.IPv4Address.IPAddress } | Select-Object -First 1
    if (-not $ip) { throw "No se pudo detectar la IP de la red local. Defínela en quiosco.env: IP_PC=192.168.x.x" }
    return $ip
}

# Clave que la app envía a los puentes cuando escuchan en la red. Se genera una vez y se guarda en quiosco.env (git la ignora).
function Obtener-Token($config) {
    if ($config.PUENTE_TOKEN) { return $config.PUENTE_TOKEN }
    $bytes = New-Object byte[] 18
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_')
    Guardar-Config 'PUENTE_TOKEN' $token
    $config.PUENTE_TOKEN = $token
    return $token
}
