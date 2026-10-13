# Arranca el puente del oxímetro y lo vuelve a levantar si se cae. Lee la configuración de puente.env.
# Uso:  .\iniciar_puente.ps1            (queda corriendo)
#       .\iniciar_puente.ps1 -Verificar (solo muestra la configuración leída y termina)
param([switch]$Verificar)

Set-Location $PSScriptRoot
$archivo = Join-Path $PSScriptRoot 'puente.env'
if (-not (Test-Path $archivo)) {
    Write-Host "Falta puente.env. Copia puente.env.example a puente.env y pon la dirección de tu oxímetro." -ForegroundColor Red
    exit 1
}

foreach ($linea in Get-Content $archivo) {
    $texto = $linea.Trim()
    if (-not $texto -or $texto.StartsWith('#')) { continue }
    $i = $texto.IndexOf('=')
    if ($i -lt 1) { continue }
    $valor = $texto.Substring($i + 1).Trim().Trim('"')
    [Environment]::SetEnvironmentVariable($texto.Substring(0, $i).Trim(), $valor, 'Process')
}

if (-not $env:OXIMETRO_ID) {
    Write-Host "puente.env no define OXIMETRO_ID (la dirección MAC del oxímetro)." -ForegroundColor Red
    exit 1
}

$python = if ($env:PUENTE_PYTHON) { $env:PUENTE_PYTHON } else { 'python' }

if ($Verificar) {
    Write-Host "OXIMETRO_ID = $($env:OXIMETRO_ID)"
    Write-Host "PUENTE_HOST = $(if ($env:PUENTE_HOST) { $env:PUENTE_HOST } else { '127.0.0.1 (por defecto)' })"
    Write-Host "PUENTE_PORT = $(if ($env:PUENTE_PORT) { $env:PUENTE_PORT } else { '8765 (por defecto)' })"
    Write-Host "Python      = $python"
    exit 0
}

while ($true) {
    & $python -m puente
    Write-Host "El puente terminó (código $LASTEXITCODE). Reiniciando en 5 segundos..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
}
