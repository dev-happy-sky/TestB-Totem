# Detiene los puentes y el servidor de la app que arrancó iniciar_quiosco.ps1 (el navegador se cierra con Alt+F4).
$archivo = Join-Path $env:TEMP 'quiosco.pids'
if (-not (Test-Path $archivo)) { Write-Host "No hay un quiosco en marcha."; exit 0 }
foreach ($id in Get-Content $archivo) {
    # Cada puente corre dentro de un powershell que a su vez lanza python: se detiene todo el árbol.
    taskkill /PID $id /T /F | Out-Null
}
Remove-Item $archivo -Force
Write-Host "Quiosco detenido."
