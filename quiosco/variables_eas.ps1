# Muestra los comandos para cargar en EAS las variables de la app (las compilaciones de EAS se hacen en la nube y NO leen totem-app\.env).
# Deben coincidir con lo que usa la versión de red: IP de este PC, puertos y clave de los puentes (quiosco.env).
# Uso:  .\variables_eas.ps1              (solo muestra los comandos; cópialos y ejecútalos desde totem-app\, con la sesión de EAS iniciada)
#       .\variables_eas.ps1 -Ejecutar    (los ejecuta, desde totem-app\)
# Las variables EXPO_PUBLIC_* quedan dentro de la app: no son secretas (la clave de los puentes viaja en el APK).
param([switch]$Ejecutar)

. (Join-Path $PSScriptRoot 'comun.ps1')
$config = Leer-Config
$ip = Obtener-IP $config
$token = Obtener-Token $config
$nombres = Nombres-Puentes $config

# Lo que ya define totem-app\.env (backend, serial del tótem...), salvo lo de los puentes, que se calcula aquí.
$variables = [ordered]@{}
$archivoEnv = Join-Path $script:Raiz 'totem-app\.env'
if (Test-Path $archivoEnv) {
    foreach ($linea in Get-Content $archivoEnv) {
        $texto = ($linea -replace '\s+#.*$', '').Trim()
        if ($texto -notmatch '^EXPO_PUBLIC_[A-Z0-9_]+=.+$') { continue }
        $i = $texto.IndexOf('=')
        $clave = $texto.Substring(0, $i)
        if ($clave -match '^EXPO_PUBLIC_(SENSORES|PUENTE_)') { continue }
        $variables[$clave] = $texto.Substring($i + 1).Trim('"')
    }
}
$variables['EXPO_PUBLIC_SENSORES'] = ($nombres | ForEach-Object { $script:ModosSensor[$_] }) -join ','
foreach ($nombre in $nombres) {
    $sufijo = $script:SufijoVariable[$nombre]
    $variables["EXPO_PUBLIC_PUENTE_${sufijo}_URL"] = "http://${ip}:$($script:PuertosPuente[$nombre])"
    $variables["EXPO_PUBLIC_PUENTE_${sufijo}_KEY"] = $token
}

$comandos = foreach ($clave in $variables.Keys) {
    "npx eas-cli env:create --environment preview --name $clave --value `"$($variables[$clave])`" --visibility plaintext --force --non-interactive"
}

if (-not $Ejecutar) {
    Write-Host "Ejecuta estos comandos desde totem-app\ (una vez, o cuando cambie la IP, los sensores o la clave):`n"
    $comandos | ForEach-Object { Write-Host $_ }
    exit 0
}

Push-Location (Join-Path $script:Raiz 'totem-app')
try {
    foreach ($comando in $comandos) {
        Write-Host $comando.Replace($token, '***')
        Invoke-Expression $comando
        if ($LASTEXITCODE -ne 0) { Write-Host "Falló. ¿Iniciaste sesión? (npx eas-cli login)" -ForegroundColor Red; exit 1 }
    }
} finally {
    Pop-Location
}
Write-Host "Variables cargadas en el entorno 'preview' de EAS."
