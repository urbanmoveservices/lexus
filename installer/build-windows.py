from pathlib import Path
import shutil,zipfile,json,subprocess,hashlib
root=Path(__file__).resolve().parent.parent
releases=root/'releases'; stage=releases/'windows-package'; stage.mkdir(parents=True,exist_ok=True)
version=json.loads((root/'package.json').read_text(encoding='utf-8-sig'))['version']
for name in ['package.json','desktop.cjs','launch.cjs','licensing-client.cjs','distribution-config.cjs','Launch LEXUS.cmd','start-desktop.ps1']:
 shutil.copy2(root/name,stage/name)
for name in ['app','runtime','node_modules']:
 shutil.copytree(root/name,stage/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('_pdf_cmp','.npm-cache','*.log','*.sqlite','*.db','desktop-data','license-data','web-data','.env'))
shutil.copytree(releases/'build-cache/chrome/chrome-win64',stage/'browsers/chrome',dirs_exist_ok=True)
(stage/'lexus-config.json').write_text(json.dumps({'licenseUrl':'https://lexus.vaidya-gpt.com','installed':True,'bundledChrome':True}),encoding='utf-8')
for name in ['install-integration.ps1','uninstall.ps1']:
 shutil.copy2(root/'installer'/name,stage/name)
csc=Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
subprocess.run([str(csc),'/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/win32icon:'+str(root/'installer/lexus.ico'),'/out:'+str(stage/'LEXUS.exe'),str(root/'installer/Launcher.cs')],check=True)
zip_path=releases/'build-cache'/'payload.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=1) as z:
 for file in stage.rglob('*'):
  if file.is_file(): z.write(file,file.relative_to(stage).as_posix())
print('Bundled package created:',zip_path.stat().st_size,flush=True)
setup=releases/f'LEXUS-Setup-{version}.exe'
subprocess.run([str(csc),'/nologo','/target:winexe','/platform:x64','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/resource:'+str(zip_path)+',payload.zip','/out:'+str(setup),'/win32icon:'+str(root/'installer/lexus.ico'),'/resource:'+str(root/'app/assets/lexus-logo.jpeg')+',lexus.logo','/resource:'+str(root/'installer/lexus.ico')+',lexus.icon',str(root/'installer/InstallerTheme.cs'),str(root/'installer/Setup.cs')],check=True)
updater=releases/f'LEXUS-Updater-{version}.zip'
with zipfile.ZipFile(updater,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for file in stage.rglob('*'):
  if file.is_file() and file.relative_to(stage).parts[0] not in {'runtime','browsers'}: z.write(file,file.relative_to(stage).as_posix())
manifest={'version':version,'distribution':'windows-installer'}
for name,file in [('setup',setup),('updater',updater)]:
 h=hashlib.sha256()
 with file.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 manifest[name]={'url':'/downloads/'+file.name,'bytes':file.stat().st_size,'sha256':h.hexdigest()}
(releases/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Setup EXE and manifest ready',flush=True)

