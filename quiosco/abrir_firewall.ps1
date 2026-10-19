# Permite que la tablet llegue a este PC: abre en el Firewall de Windows los puertos de la app (8081) y de los puentes (8765-8767).
# Hay que ejecutarlo UNA VEZ en una PowerShell como administrador. Solo para redes privadas (no para redes públicas).
# Uso:  .\abrir_firewall.ps1           (abre los puertos)
#       .\abrir_firewall.ps1 -Quitar   (los cierra)
param([switch]$Quitar)

$nombre = 'Totem quiosco (tablet)'
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Write-Host "Ejecútalo en una PowerShell como administrador (clic derecho en PowerShell -> Ejecutar como administrador)." -ForegroundColor Red
    exit 1
}

if ($Quitar) {
    Get-NetFirewallRule -DisplayName $nombre -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host "Regla '$nombre' eliminada."
    exit 0
}

Get-NetFirewallRule -DisplayName $nombre -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $nombre -Direction Inbound -Protocol TCP -LocalPort 8081, 8765, 8766, 8767 -Action Allow -Profile Private, Domain | Out-Null
Write-Host "Listo: puertos 8081, 8765, 8766 y 8767 abiertos para redes privadas."

# Las redes marcadas como «Pública» no reciben conexiones aunque la regla exista.
$publicas = Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' -and $_.IPv4Connectivity -ne 'Disconnected' }
foreach ($red in $publicas) {
    Write-Host "Aviso: la red '$($red.Name)' está marcada como Pública y bloqueará a la tablet." -ForegroundColor Yellow
    Write-Host "       Cámbiala a Privada con: Set-NetConnectionProfile -InterfaceIndex $($red.InterfaceIndex) -NetworkCategory Private" -ForegroundColor Yellow
}
