# Registra una tarea de Windows que arranca el quiosco al iniciar sesión. Debe correr en la sesión del usuario (Bluetooth y pantalla).
# Uso:  .\instalar_inicio_automatico.ps1      Para quitarlo: .\quitar_inicio_automatico.ps1
$nombre = 'TotemQuiosco'
$script = Join-Path $PSScriptRoot 'iniciar_quiosco.ps1'
if (-not (Test-Path (Join-Path $PSScriptRoot 'app-web\index.html'))) {
    Write-Host "Primero compila la app: .\construir_app.ps1" -ForegroundColor Red
    exit 1
}
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $PSScriptRoot `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$disparador = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $nombre -Action $accion -Trigger $disparador -Settings $ajustes `
    -Description 'Quiosco del tótem: puentes de sensores, app y navegador a pantalla completa' -Force | Out-Null
Write-Host "Listo: '$nombre' arranca al iniciar sesión. Para quitarlo: .\quitar_inicio_automatico.ps1"
