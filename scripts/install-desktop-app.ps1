# Installe BubuPost comme application de bureau.
#
# Pas d'Electron ni de Tauri : l'application est deja en ligne et se met a jour
# toute seule a chaque deploiement. On ouvre simplement Chrome en mode
# application, ce qui donne une vraie fenetre, sans onglets ni barre d'adresse,
# avec sa propre icone dans la barre des taches.
#
# Relancer ce script est sans risque, il ecrase les raccourcis existants.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-desktop-app.ps1

$ErrorActionPreference = 'Stop'

$url  = 'https://bubu-post.vercel.app/'
$nom  = 'BubuPost'
$repo = Split-Path -Parent $PSScriptRoot
$icon = Join-Path $repo 'desktop\BubuPost.ico'

# L'icone est generee par un script Node, sans aucune dependance a installer.
if (-not (Test-Path $icon)) {
  Write-Host "Icone absente, generation..."
  Push-Location $repo
  node scripts/make-icon.cjs
  Pop-Location
}

# Chrome de preference, Edge en secours : les deux gerent le mode application.
$navigateurs = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$navigateur = $navigateurs | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $navigateur) {
  throw "Ni Chrome ni Edge n'a ete trouve. Installe l'un des deux, puis relance ce script."
}
Write-Host "Navigateur utilise : $navigateur"

$shell = New-Object -ComObject WScript.Shell

function New-Raccourci {
  param([string]$Chemin)

  $s = $shell.CreateShortcut($Chemin)
  $s.TargetPath       = $navigateur
  $s.Arguments        = "--app=$url"
  $s.WorkingDirectory = Split-Path -Parent $navigateur
  $s.IconLocation     = "$icon,0"
  $s.Description      = 'BubuPost, publication automatisee de videos courtes'
  $s.WindowStyle      = 1
  $s.Save()
  Write-Host "  cree : $Chemin"
}

Write-Host "Raccourcis :"

# Sur le bureau.
New-Raccourci (Join-Path ([Environment]::GetFolderPath('Desktop')) "$nom.lnk")

# Dans le menu Demarrer, pour le trouver en tapant son nom.
$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Raccourci (Join-Path $menu "$nom.lnk")

Write-Host ""
Write-Host "Termine. Pour l'epingler a la barre des taches : ouvre l'application,"
Write-Host "clic droit sur son icone dans la barre, puis 'Epingler a la barre des taches'."
