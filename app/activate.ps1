# One-shot activator: fixes ExecutionPolicy for this process, then activates venv
# Usage:  . .\activate.ps1

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. (Join-Path $PSScriptRoot 'venv\Activate.ps1')
