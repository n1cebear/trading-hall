# Save a version: syntax-check, bump the service-worker cache, commit. Add -Push for a major step (pushes to main, GitHub Pages deploys).
# Usage: powershell -File tools/push.ps1 "Commit message" [-Push]
param([Parameter(Mandatory = $true)][string]$Message, [switch]$Push)
Set-Location (Split-Path $PSScriptRoot)
$bad = $false
Get-ChildItem js -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch 'vendor' } | ForEach-Object {
  node --check $_.FullName; if ($LASTEXITCODE) { $bad = $true }
}
if ($bad) { Write-Error 'Syntax error, aborting.'; exit 1 }
$sw = Get-Content sw.js -Raw
if ($sw -match "toolbox-app-v(\d+)") {
  $n = [int]$Matches[1] + 1
  $sw = $sw -replace "toolbox-app-v\d+", "toolbox-app-v$n"
  Set-Content sw.js $sw -NoNewline
  Write-Host "Service worker cache -> v$n"
}
git add -A
git commit -m $Message
if ($Push) { git push origin main }
