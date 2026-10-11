param([Parameter(Mandatory=$true)][string]$Package,[Parameter(Mandatory=$true)][string]$ExpectedHash,[Parameter(Mandatory=$true)][string]$InstallRoot,[int]$WaitPid=0,[switch]$NoRestart)
$ErrorActionPreference='Stop'
$lexusUpdateRoot=[IO.Path]::GetFullPath($InstallRoot)
$lexusTempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$lexusWorkRoot=[IO.Path]::GetFullPath((Split-Path -Parent $Package))
$lexusStage=Join-Path $lexusWorkRoot 'stage'
$lexusBackup=Join-Path $lexusWorkRoot 'backup'
$lexusChanged=New-Object System.Collections.Generic.List[string]
try {
 if(!$lexusWorkRoot.StartsWith($lexusTempRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Update must be downloaded into the temporary folder'}
 $lexusExpectedRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\LEXUS'))
 if($NoRestart){if(!$lexusUpdateRoot.StartsWith($lexusTempRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Test update target must be temporary'}}elseif($lexusUpdateRoot -ne $lexusExpectedRoot){throw 'Unexpected LEXUS installation directory'}
 if(!(Test-Path -LiteralPath (Join-Path $lexusUpdateRoot 'LEXUS.exe'))){throw 'LEXUS installation was not found'}
 if((Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash -ne $ExpectedHash){throw 'Update checksum does not match'}
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 New-Item -ItemType Directory -Path $lexusStage,$lexusBackup -Force | Out-Null
 $lexusStagePrefix=[IO.Path]::GetFullPath($lexusStage)+[IO.Path]::DirectorySeparatorChar
 $lexusArchive=[IO.Compression.ZipFile]::OpenRead($Package)
 try{foreach($lexusEntry in $lexusArchive.Entries){$lexusDest=[IO.Path]::GetFullPath((Join-Path $lexusStage $lexusEntry.FullName));if(!$lexusDest.StartsWith($lexusStagePrefix,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid update path'};if($lexusEntry.FullName.EndsWith('/')){continue};if($lexusEntry.FullName -match '^(runtime|browsers|desktop-data|license-data|web-data)/'){throw 'Update cannot replace runtime or user data'};New-Item -ItemType Directory -Path (Split-Path -Parent $lexusDest) -Force | Out-Null;[IO.Compression.ZipFileExtensions]::ExtractToFile($lexusEntry,$lexusDest,$true)}}finally{$lexusArchive.Dispose()}
 if(!(Test-Path -LiteralPath (Join-Path $lexusStage 'package.json'))){throw 'Update package is incomplete'}
 if($WaitPid -gt 0){Wait-Process -Id $WaitPid -Timeout 90 -ErrorAction SilentlyContinue;if(Get-Process -Id $WaitPid -ErrorAction SilentlyContinue){throw 'LEXUS did not close; update cancelled'}}
 foreach($lexusFile in (Get-ChildItem -LiteralPath $lexusStage -File -Recurse)){
  $lexusRelative=$lexusFile.FullName.Substring($lexusStagePrefix.Length)
  $lexusDest=Join-Path $lexusUpdateRoot $lexusRelative
  $lexusSaved=Join-Path $lexusBackup $lexusRelative
  if(Test-Path -LiteralPath $lexusDest){New-Item -ItemType Directory -Path (Split-Path -Parent $lexusSaved) -Force|Out-Null;Copy-Item -LiteralPath $lexusDest -Destination $lexusSaved -Force}
  $lexusChanged.Add($lexusRelative)
  New-Item -ItemType Directory -Path (Split-Path -Parent $lexusDest) -Force|Out-Null
  Copy-Item -LiteralPath $lexusFile.FullName -Destination $lexusDest -Force
 }
 & (Join-Path $lexusUpdateRoot 'install-integration.ps1')
 if(!$NoRestart){Start-Process -FilePath (Join-Path $lexusUpdateRoot 'LEXUS.exe') -WorkingDirectory $lexusUpdateRoot -WindowStyle Hidden}
 'Update applied successfully' | Set-Content -LiteralPath (Join-Path $lexusWorkRoot 'update-result.txt')
} catch {
 foreach($lexusRelative in $lexusChanged){$lexusDest=Join-Path $lexusUpdateRoot $lexusRelative;$lexusSaved=Join-Path $lexusBackup $lexusRelative;if(Test-Path -LiteralPath $lexusSaved){Copy-Item -LiteralPath $lexusSaved -Destination $lexusDest -Force}else{Remove-Item -LiteralPath $lexusDest -Force -ErrorAction SilentlyContinue}}
 $_.Exception.Message | Set-Content -LiteralPath (Join-Path $lexusWorkRoot 'update-error.txt')
 if(!$NoRestart){Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.MessageBox]::Show('Update failed. Your previous files were restored. '+$_.Exception.Message,'LEXUS Update')|Out-Null}
 exit 1
}
