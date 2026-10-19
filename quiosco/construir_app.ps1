# Compila la app del tótem para web (lee totem-app\.env). Hay que repetirlo cada vez que cambie el código o el .env,
# porque las variables EXPO_PUBLIC_* se incrustan al compilar.
# Uso:  .\construir_app.ps1         -> quiosco\app-web      (para abrirla en este PC, con los puentes en localhost)
#       .\construir_app.ps1 -Red    -> quiosco\app-web-red  (para otro equipo, por ejemplo una tablet: los puentes se
#                                      llaman por la IP de este PC y con su clave)
param([switch]$Red)

. (Join-Path $PSScriptRoot 'comun.ps1')
$salida = Join-Path $PSScriptRoot $(if ($Red) { 'app-web-red' } else { 'app-web' })

if ($Red) {
    $config = Leer-Config
    $ip = Obtener-IP $config
    $token = Obtener-Token $config
    $nombres = Nombres-Puentes $config
    # Lo que se define aquí tiene prioridad sobre totem-app\.env.
    $env:EXPO_PUBLIC_SENSORES = ($nombres | ForEach-Object { $script:ModosSensor[$_] }) -join ','
    foreach ($nombre in $nombres) {
        $sufijo = $script:SufijoVariable[$nombre]
        Set-Item "env:EXPO_PUBLIC_PUENTE_${sufijo}_URL" "http://${ip}:$($script:PuertosPuente[$nombre])"
        Set-Item "env:EXPO_PUBLIC_PUENTE_${sufijo}_KEY" $token
    }
    Write-Host "Modo red: sensores = $env:EXPO_PUBLIC_SENSORES ; puentes en http://${ip}:<puerto>"
}

Push-Location (Join-Path $script:Raiz 'totem-app')
try {
    if (Test-Path $salida) { Remove-Item $salida -Recurse -Force }
    # --clear: Metro no invalida su caché cuando solo cambia el .env y se compilaría con las direcciones viejas.
    npx expo export --platform web --clear --output-dir $salida
    if ($LASTEXITCODE -ne 0) { Write-Host "La compilación falló." -ForegroundColor Red; exit 1 }
} finally {
    Pop-Location
}
Write-Host "Listo: $salida."
Write-Host $(if ($Red) { "Arranca el servicio con .\iniciar_quiosco.ps1 -Red" } else { "Arranca el quiosco con .\iniciar_quiosco.ps1" })
