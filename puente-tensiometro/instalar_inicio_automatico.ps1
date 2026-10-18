# Registra una tarea de Windows que arranca el puente al iniciar sesión y lo reinicia si falla.
# Debe correr en la sesión del usuario (no como servicio): Bluetooth no está disponible para los servicios de Windows.
# Uso:  .\instalar_inicio_automatico.ps1
$nombre = 'PuenteTensiometro'
$script = Join-Path $PSScriptRoot 'iniciar_puente.ps1'
if (-not (Test-Path (Join-Path $PSScriptRoot 'puente.env'))) {
    Write-Host "Primero crea puente.env (copia puente.env.example)." -ForegroundColor Red
    exit 1
}

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $PSScriptRoot `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$disparador = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$ajustes = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes `
    -Description 'Puente Bluetooth del tensiómetro para el tótem' -Force | Out-Null
Start-ScheduledTask -TaskName $nombre
Write-Host "Listo: '$nombre' arranca al iniciar sesión y se reinicia solo. Para quitarlo: .\quitar_inicio_automatico.ps1"
