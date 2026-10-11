$ErrorActionPreference = 'Stop'
$lexusBundledNode = Join-Path $PSScriptRoot 'runtime\node.exe'
$lexusNode = if (Test-Path -LiteralPath $lexusBundledNode) { $lexusBundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
& $lexusNode (Join-Path $PSScriptRoot 'launch.cjs')
if ($LASTEXITCODE -ne 0) { throw 'LEXUS launch failed. Inspect desktop.stderr.log.' }
