from pathlib import Path
import json,hashlib,subprocess,shutil
root=Path(__file__).resolve().parent.parent
releases=root/'releases'
manifest=json.loads((releases/'manifest.json').read_text(encoding='utf-8-sig'))
version=manifest['version']
current=releases/f'LEXUS-Setup-{version}.exe'
offline=releases/f'LEXUS-Offline-Setup-{version}.exe'
if current.stat().st_size>1000000:
 shutil.copy2(current,offline)
meta={'url':'/downloads/'+offline.name,'bytes':offline.stat().st_size,'sha256':hashlib.sha256(offline.read_bytes()).hexdigest()}
source=(root/'installer/WebSetup.cs').read_text(encoding='utf-8-sig').replace('__OFFLINE_URL__','https://lexus.vaidya-gpt.com'+meta['url']).replace('__OFFLINE_SHA256__',meta['sha256'])
generated=releases/'build-cache/WebSetup.generated.cs';generated.write_text(source,encoding='utf-8')
subprocess.run(['C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe','/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/out:'+str(current),'/win32icon:'+str(root/'installer/lexus.ico'),'/resource:'+str(root/'app/assets/lexus-logo.jpeg')+',lexus.logo','/resource:'+str(root/'installer/lexus.ico')+',lexus.icon',str(root/'installer/InstallerTheme.cs'),str(generated)],check=True)
manifest['offlineSetup']=meta
manifest['setup']={'url':'/downloads/'+current.name,'bytes':current.stat().st_size,'sha256':hashlib.sha256(current.read_bytes()).hexdigest()}
manifest['distribution']='windows-web-installer'
(releases/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Web installer bytes:',current.stat().st_size)
