const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto'),vm=require('node:vm');
const {validateManifest,compareVersions,downloadVerified}=require('./app/lexus-update-core');
test('updater only accepts bounded same-origin releases with mandatory hash',()=>{const valid={version:'0.1.2',updater:{url:'/downloads/LEXUS-Updater-0.1.2.zip',bytes:123,sha256:'a'.repeat(64)}};assert.equal(validateManifest(valid,'https://lexus.vaidya-gpt.com').url,'https://lexus.vaidya-gpt.com/downloads/LEXUS-Updater-0.1.2.zip');assert.equal(compareVersions('0.1.2','0.1.1'),1);assert.equal(compareVersions('0.1.2','0.1.2'),0);for(const overrides of [{url:'https://example.invalid/downloads/LEXUS-Updater-0.1.2.zip'},{url:'/downloads/LEXUS-Updater-0.1.2.zip?key=x'},{sha256:''},{bytes:300*1024*1024}])assert.throws(()=>validateManifest({...valid,updater:{...valid.updater,...overrides}},'https://lexus.vaidya-gpt.com'));});
test('download verifies bytes and digest, removing a mismatched file',async()=>{const body=Buffer.from('synthetic update archive'),server=http.createServer((q,r)=>r.end(body));await new Promise(r=>server.listen(0,'127.0.0.1',r));const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lexus-download-')),dest=path.join(directory,'update.zip'),meta={url:'http://127.0.0.1:'+server.address().port,bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex')};try{await downloadVerified(meta,dest);assert.deepEqual(fs.readFileSync(dest),body);await assert.rejects(downloadVerified({...meta,sha256:'0'.repeat(64)},dest),/verification/);assert(!fs.existsSync(dest));await assert.rejects(downloadVerified({...meta,bytes:body.length-1},dest),/size/);assert(!fs.existsSync(dest));}finally{await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}});
test('Chrome preference respects explicit override, then stable system Chrome, then bundled fallback',()=>{const source=fs.readFileSync('app/chrome-finder.js','utf8');function finder(files,env){const ctx={require:n=>n==='fs'?{existsSync:p=>files.includes(p)}:n==='child_process'?{}:require(n),process:{env},module:{exports:{}}};vm.runInNewContext(source,ctx);return ctx.module.exports.findChromePath();}const stable=path.join('C:/PF','Google','Chrome','Application','chrome.exe'),bundled='C:/LEXUS/browsers/chrome/chrome.exe',explicit='C:/custom/chrome.exe',env={PROGRAMFILES:'C:/PF',LOCALAPPDATA:'C:/Local',LEXUS_BUNDLED_CHROME_PATH:bundled};assert.equal(finder([stable,bundled],env),stable);assert.equal(finder([bundled],env),bundled);assert.equal(finder([stable,bundled,explicit],{...env,OCEAN_CHROME_PATH:explicit}),explicit);});
test('in-app update offers honor Later and block active or scheduled bookings', async () => {
 const handlers = {}, source = fs.readFileSync('app/ocean-updater.js','utf8');
 let runs = [], offers = 0, scheduled = true;
 const context = {require: name => {
  if(name === 'electron') return {app:{}, BrowserWindow:function(){throw Error('Unexpected download after Later');}, ipcMain:{handle:(name,fn)=>handlers[name]=fn}, dialog:{showMessageBox:async()=>{offers++;return {response:1};}}};
  if(name === '../distribution-config.cjs') return {installed:true,licenseUrl:'https://lexus.vaidya-gpt.com'};
  if(name === '../package.json') return {version:'0.1.1'};
  if(name === './lexus-update-core') return {...require('./app/lexus-update-core'),fetchManifest:async()=>({version:'0.1.2'})};
  if(name === './session-manager') return {listRuns:()=>runs};
  return require(name);
 },process:{platform:'win32'},module:{exports:{}},setTimeout};
 vm.runInNewContext(source,context);
 context.module.exports.registerUpdaterIpc({canUpdate:()=>scheduled === false});
 let result=await handlers['updater:check-offer']();assert.match(result.error,/scheduled/);assert.equal(offers,0);
 scheduled=false;runs=[{}];result=await handlers['updater:check-offer']();assert.match(result.error,/active booking/);assert.equal(offers,0);
 runs=[];result=await handlers['updater:check-offer']();assert.equal(result.update,true);assert.equal(offers,1);assert.equal(result.started,undefined);
});
test('mandatory startup update failure exits instead of allowing the old app to open',async()=>{
 let quit=0,windows=0;const source=fs.readFileSync('app/ocean-updater.js','utf8');
 const context={require:name=>{
  if(name==='electron')return{app:{quit:()=>quit++},BrowserWindow:function(){windows++},ipcMain:{},dialog:{showMessageBox:async()=>({response:2})},shell:{}};
  if(name==='../distribution-config.cjs')return{installed:true,licenseUrl:'https://lexus.vaidya-gpt.com'};
  if(name==='../package.json')return{version:'0.1.4'};
  if(name==='./lexus-update-core')return{...require('./app/lexus-update-core'),fetchManifest:async()=>{throw Error('Offline fixture')}};
  return require(name);
 },process:{platform:'win32'},module:{exports:{}},setTimeout};
 vm.runInNewContext(source,context);const result=await context.module.exports.enforceRequiredUpdate();assert.equal(result.required,true);assert.equal(result.started,false);assert.equal(quit,1);assert.equal(windows,0);
});
