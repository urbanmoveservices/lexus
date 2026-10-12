param([string]$TestRoot='')
$ErrorActionPreference='Stop'
$lexusTesting=![string]::IsNullOrWhiteSpace($TestRoot)
$lexusUninstallRoot=[IO.Path]::GetFullPath($PSScriptRoot)
$lexusExpectedRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\LEXUS'))
if($lexusTesting){
 $lexusTestBase=[IO.Path]::GetFullPath($TestRoot)
 if(!$lexusTestBase.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath (Join-Path $lexusTestBase '.lexus-uninstall-fixture'))){throw 'Invalid uninstall test directory'}
 $lexusExpectedRoot=[IO.Path]::GetFullPath((Join-Path $lexusTestBase 'Programs\LEXUS'))
 $lexusDesktopLink=Join-Path $lexusTestBase 'Desktop\LEXUS.lnk'
 $lexusStartMenu=Join-Path $lexusTestBase 'StartMenu\LEXUS'
 $lexusUninstallKey='HKCU:\Software\LEXUS-Uninstall-QA\'+(Split-Path $lexusTestBase -Leaf)
}else{
 Add-Type -AssemblyName System.Windows.Forms
 $lexusDesktopLink=Join-Path ([Environment]::GetFolderPath('Desktop')) 'LEXUS.lnk'
 $lexusStartMenu=Join-Path ([Environment]::GetFolderPath('Programs')) 'LEXUS'
 $lexusUninstallKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\LEXUS'
}
try{
 if($lexusUninstallRoot -ne $lexusExpectedRoot){throw 'Uninstall location does not match LEXUS installation'}
 if((Get-Item -LiteralPath $lexusUninstallRoot).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Uninstall cannot target a redirected directory'}
 $lexusPrefix=$lexusUninstallRoot+[IO.Path]::DirectorySeparatorChar
 $lexusActive=@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($lexusPrefix,[StringComparison]::OrdinalIgnoreCase) })
 if($lexusActive.Count){throw ('Close LEXUS and its booking browser before uninstalling ('+($lexusActive.Name -join ', ')+').')}
 if(!$lexusTesting -and [System.Windows.Forms.MessageBox]::Show('Uninstall LEXUS? Your profiles and activation data will be preserved.','LEXUS','YesNo') -ne 'Yes'){exit 0}
 # Set-Location changes PowerShell's provider location only. Release the native
 # current-directory handle before deleting the folder containing this script.
 $lexusTemp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
 Set-Location -LiteralPath $lexusTemp
 [Environment]::CurrentDirectory=$lexusTemp
 if([IO.Path]::GetFullPath($lexusUninstallRoot) -ne $lexusExpectedRoot){throw 'Uninstall target changed'}
 Remove-Item -LiteralPath $lexusUninstallRoot -Recurse -Force
 foreach($lexusLink in @($lexusDesktopLink,(Join-Path $lexusStartMenu 'LEXUS.lnk'))){if(Test-Path -LiteralPath $lexusLink){Remove-Item -LiteralPath $lexusLink -Force}}
 if((Test-Path -LiteralPath $lexusStartMenu) -and !(Get-ChildItem -LiteralPath $lexusStartMenu -Force)){Remove-Item -LiteralPath $lexusStartMenu -Force}
 Remove-Item -LiteralPath $lexusUninstallKey -Recurse -Force -ErrorAction SilentlyContinue
 if(!$lexusTesting){[System.Windows.Forms.MessageBox]::Show('LEXUS uninstalled. Your profiles and activation data are preserved.','LEXUS')|Out-Null}
 'LEXUS uninstall completed'
}catch{
 if(!$lexusTesting){[System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'LEXUS uninstall failed')|Out-Null}
 Write-Error $_.Exception.Message
 exit 1
}
