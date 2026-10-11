$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$lexusExpectedRoot=Join-Path $env:LOCALAPPDATA 'Programs\LEXUS'
$lexusUninstallRoot=[IO.Path]::GetFullPath($PSScriptRoot)
if($lexusUninstallRoot -ne [IO.Path]::GetFullPath($lexusExpectedRoot)){throw 'Uninstall location does not match LEXUS installation'}
foreach($lexusProcess in (Get-Process electron -ErrorAction SilentlyContinue)){if($lexusProcess.Path -and $lexusProcess.Path.StartsWith($lexusUninstallRoot+'\')){[System.Windows.Forms.MessageBox]::Show('Close LEXUS before uninstalling.','LEXUS');exit 1}}
if([System.Windows.Forms.MessageBox]::Show('Uninstall LEXUS? Your profiles and activation data will be preserved.','LEXUS','YesNo') -ne 'Yes'){exit 0}
$lexusStartMenu=Join-Path ([Environment]::GetFolderPath('Programs')) 'LEXUS'
if(Test-Path -LiteralPath $lexusStartMenu){Remove-Item -LiteralPath $lexusStartMenu -Recurse -Force}
$lexusDesktopLink=Join-Path ([Environment]::GetFolderPath('Desktop')) 'LEXUS.lnk'
if(Test-Path -LiteralPath $lexusDesktopLink){Remove-Item -LiteralPath $lexusDesktopLink -Force}
Remove-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LEXUS' -Recurse -Force -ErrorAction SilentlyContinue
Set-Location -LiteralPath $env:TEMP
Remove-Item -LiteralPath $lexusUninstallRoot -Recurse -Force
[System.Windows.Forms.MessageBox]::Show('LEXUS uninstalled. Your data is preserved.','LEXUS') | Out-Null
