# Quita la tarea de inicio automático del quiosco.
$nombre = 'TotemQuiosco'
if (Get-ScheduledTask -TaskName $nombre -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $nombre -Confirm:$false
    Write-Host "Tarea '$nombre' eliminada."
} else {
    Write-Host "La tarea '$nombre' no existe."
}
