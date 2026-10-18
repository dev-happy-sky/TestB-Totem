# Compila la app del tótem para web en quiosco\app-web (lee totem-app\.env). Hay que repetirlo cada vez que cambie el código o el .env,
# porque las variables EXPO_PUBLIC_* se incrustan al compilar.
$raiz = Split-Path $PSScriptRoot -Parent
$salida = Join-Path $PSScriptRoot 'app-web'

Push-Location (Join-Path $raiz 'totem-app')
try {
    if (Test-Path $salida) { Remove-Item $salida -Recurse -Force }
    # --clear: Metro no invalida su caché cuando solo cambia el .env y se compilaría con las direcciones viejas.
    npx expo export --platform web --clear --output-dir $salida
    if ($LASTEXITCODE -ne 0) { Write-Host "La compilación falló." -ForegroundColor Red; exit 1 }
} finally {
    Pop-Location
}
Write-Host "Listo: $salida. Arranca el quiosco con .\iniciar_quiosco.ps1"
