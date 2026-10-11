from pathlib import Path
import zipfile,os,hashlib,json,urllib.request
root=Path(__file__).resolve().parent
releases=root/'releases';releases.mkdir(exist_ok=True)
version=json.loads((root/'package.json').read_text(encoding='utf-8-sig'))['version']
excluded={'desktop-data','license-data','web-data','qa','releases','.git','__pycache__','runtime'}
files=[]
for folder,dirs,names in os.walk(root):
 dirs[:]=[d for d in dirs if d not in excluded]
 for name in names:
  p=Path(folder)/name
  if name.endswith(('.log','.db','.sqlite','.sqlite3','.tmp')) or name.endswith('-process-id.txt') or name.startswith('.env') or name in ['RECOVERY-REPORT.json','COPY-REPORT.json','web2-timing-result.json','desktop-ready.json']:continue
  files.append(p)
runtime=root/'runtime'
manifest={'version':version,'distribution':'portable','setup':None,'updater':None}
for kind in ['updater','setup']:
 archive=releases/f'LEXUS-{kind.title()}-{version}.zip'
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as z:
  for p in files:
   relative=p.relative_to(root)
   if kind=='updater' and ('runtime' in relative.parts or ('node_modules' in relative.parts and not (relative.parts[0]=='node_modules' and relative.parts[1] in {'jsqr','pngjs','jpeg-js'}))):continue
   z.write(p,'LEXUS/'+relative.as_posix())
  if kind=='setup':
   for folder,dirs,names in os.walk(runtime):
    for name in names:
     p=Path(folder)/name;z.write(p,'LEXUS/runtime/'+p.relative_to(runtime).as_posix())
   # Node runtime is already included in the local runtime directory.
  z.writestr('LEXUS/READ-ME-FIRST.txt','LEXUS portable distribution\nFirst install: extract into a writable folder, open Launch LEXUS.cmd.\nUpdater: close desktop and local server, back up your folder, then extract over your install.\nUser data and credentials are never included in this package.\nLicensing defaults to localhost; other computers need a configured hosted licensing service.\n')
 sha=hashlib.sha256()
 with archive.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):sha.update(block)
 manifest[kind]={'url':'/downloads/'+archive.name,'bytes':archive.stat().st_size,'sha256':sha.hexdigest()}
 print(kind,round(archive.stat().st_size/1048576,1),'MB',flush=True)
(releases/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Manifest published; both packages exclude user data.',flush=True)
