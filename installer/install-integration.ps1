$ErrorActionPreference='Stop'
$lexusInstallRoot=$PSScriptRoot
$lexusIconPath=Join-Path $lexusInstallRoot 'app\assets\lexus.ico'
if(!(Test-Path -LiteralPath $lexusIconPath)){throw 'LEXUS shortcut icon is missing'}
$lexusShell=New-Object -ComObject WScript.Shell
$lexusStartMenu=Join-Path ([Environment]::GetFolderPath('Programs')) 'LEXUS'
New-Item -ItemType Directory -Force -Path $lexusStartMenu | Out-Null
foreach($lexusShortcutPath in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'LEXUS.lnk'),(Join-Path $lexusStartMenu 'LEXUS.lnk'))){
 $lexusShortcut=$lexusShell.CreateShortcut($lexusShortcutPath)
 $lexusShortcut.TargetPath=Join-Path $lexusInstallRoot 'LEXUS.exe'
 $lexusShortcut.WorkingDirectory=$lexusInstallRoot
 $lexusShortcut.IconLocation=$lexusIconPath+",0"
 $lexusShortcut.Save()
}
$lexusUninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LEXUS'
New-Item -Path $lexusUninstallKey -Force | Out-Null
$lexusUninstallCommand='powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $lexusInstallRoot 'uninstall.ps1')+'"'
$lexusProperties=@{DisplayName='LEXUS';DisplayVersion=((Get-Content -LiteralPath (Join-Path $lexusInstallRoot 'package.json') -Raw | ConvertFrom-Json).version);Publisher='LEXUS';InstallLocation=$lexusInstallRoot;DisplayIcon=($lexusIconPath+",0");UninstallString=$lexusUninstallCommand;URLInfoAbout='https://lexus.vaidya-gpt.com/portal'}
foreach($lexusName in $lexusProperties.Keys){New-ItemProperty -Path $lexusUninstallKey -Name $lexusName -Value $lexusProperties[$lexusName] -PropertyType String -Force | Out-Null}
