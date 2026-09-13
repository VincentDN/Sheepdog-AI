<#
  Makes Sheepdog start with Windows, and opens its port to your own network
  so your phone can reach the control panel.

  Run it:      powershell -ExecutionPolicy Bypass -File install-autostart.ps1
  Undo it:     powershell -ExecutionPolicy Bypass -File install-autostart.ps1 -Remove
#>

param(
  [switch]$Remove,
  [int]$Port = 8787
)

$here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs        = Join-Path $here 'sheepdog-hidden.vbs'
$startup    = [Environment]::GetFolderPath('Startup')
$shortcut   = Join-Path $startup 'Sheepdog.lnk'
$ruleName   = 'Sheepdog control panel'

if ($Remove) {
  if (Test-Path $shortcut) { Remove-Item $shortcut; Write-Host "Removed the Startup shortcut." }
  else { Write-Host "There was no Startup shortcut to remove." }

  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -DisplayName $ruleName
    Write-Host "Removed the firewall rule."
  }
  Write-Host "Sheepdog will no longer start on its own. Any running copy keeps going until you close it."
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is not installed. Get it from https://nodejs.org, then run this again." -ForegroundColor Yellow
  exit 1
}

if (-not (Test-Path (Join-Path $here '..\service\node_modules'))) {
  Write-Host "Installing dependencies..."
  Push-Location (Join-Path $here '..\service')
  npm install --no-audit --no-fund | Out-Null
  Pop-Location
}

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = 'wscript.exe'
$link.Arguments = '"' + $vbs + '"'
$link.WorkingDirectory = $here
$link.Description = 'Sheepdog — nudges AI agents on a schedule'
$link.Save()
Write-Host "Sheepdog will now start when you sign in."

try {
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
      -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
    Write-Host "Opened port $Port on your private network so your phone can connect."
  } else {
    Write-Host "The firewall rule was already in place."
  }
} catch {
  Write-Host "Could not add the firewall rule. Re-run this as administrator if your phone cannot connect." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Start it now with windows\start-sheepdog.cmd to see your access code."
