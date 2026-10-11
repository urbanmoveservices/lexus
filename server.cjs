const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const root = path.resolve(__dirname, 'app');
const port = Number(process.env.LEXUS_WEB_PORT || 8081);
const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`,
  ...String(process.env.LEXUS_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
const licenseService = require('./licensing.cjs').createLicensing({directory:process.env.LEXUS_LICENSE_DATA || path.join(__dirname,'license-data'),adminPassword:process.env.LEXUS_ADMIN_PASSWORD,port});
setInterval(()=>licenseService.pollPayments().catch(()=>{}),30000).unref();
const storeFile = path.join(root, 'profile-store.js');
const workspaceRoot=path.resolve(process.env.LEXUS_WEB_DATA || path.join(__dirname,'web-data'));
const stores=new Map();
async function clientStore(licenseId){
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(String(licenseId)))throw Error('Invalid workspace identity');
  if(!stores.has(licenseId)){
    const directory=path.join(workspaceRoot,'clients',licenseId),storeModule=new Module(storeFile,module);
    storeModule.filename=storeFile;storeModule.paths=Module._nodeModulePaths(root);
    storeModule._compile(fs.readFileSync(storeFile,'utf8').replace("const { app } = require('electron');",`const app = {isPackaged:false,getPath:()=>${JSON.stringify(directory)}};`),storeFile);
    const initializing=storeModule.exports.init().then(()=>storeModule.exports).catch(error=>{stores.delete(licenseId);throw error;});stores.set(licenseId,initializing);
  }
  return stores.get(licenseId);
}
function invoke(store, channel, args) {
  const p = args[0] || {};
  const direct = {
    'profiles:list':'listSummaries', 'profiles:saveJourney':'saveJourney',
    'profiles:saveCredential':'saveCredential', 'profiles:savePayment':'savePayment',
    'profiles:getUiState':'getUiState', 'profiles:setUiState':'setUiState',
    'profiles:getTrueCaptcha':'getTrueCaptchaCredentials', 'profiles:setTrueCaptcha':'setTrueCaptchaCredentials',
    'profiles:getProxy':'getProxyConfig', 'profiles:setProxy':'setProxyConfig',
    'history:clear':'clearBookingHistory',
  };
  if(direct[channel]) return store[direct[channel]](...args);
  switch(channel) {
    case 'history:list': return {items:store.listBookingHistory()};
    case 'web:export': return {version:1,journeys:store.listSummaries('journeys').map(x=>store.getJourney(x.id)),payments:store.listSummaries('payments').map(x=>store.getPayment(x.id,{includeSecrets:false})),credentials:store.listSummaries('credentials').map(x=>store.getCredential(x.id,{includeSecrets:false}))};
    case 'web:import': {
      if(p.version!==1 || !['journeys','credentials','payments'].every(k=>Array.isArray(p[k])))throw Error('Invalid LEXUS backup');
      if(['journeys','credentials','payments'].some(k=>p[k].length>1000))throw Error('Backup exceeds 1000 profiles per type');
      for(const [kind,method] of [['journeys','saveJourney'],['credentials','saveCredential'],['payments','savePayment']])for(const item of p[kind]){const copy={...item};delete copy.id;store[method](copy);}
      return {ok:true};
    }
    case 'profiles:get': return p.kind.startsWith('journey') ? store.getJourney(p.id) : p.kind.startsWith('credential') ? store.getCredential(p.id, {includeSecrets:!!p.includeSecrets}) : store.getPayment(p.id,{includeSecrets:!!p.includeSecrets});
    case 'profiles:setCredentialStatus': return store.setCredentialStatus(p.id,p.status);
    case 'profiles:delete': return store.deleteProfile(p.kind,p.id);
    case 'profiles:rename': return store.renameProfile(p.kind,p.id,p.name);
    case 'profiles:listProxies': return {proxies:store.listProxies()};
    case 'profiles:addProxy': { const proxies=store.addProxyFromString(p.host); return {ok:true,proxies,count:proxies.length}; }
    case 'profiles:deleteProxies': { const proxies=store.deleteProxiesByIds(p.ids||[]); return {ok:true,proxies,count:proxies.length}; }
    case 'app:get-info': return {name:'LEXUS',version:'1.1.1',maxParallelRuns:4};
    case 'license:get-about': case 'license:refresh-about': return {appVersion:'1.1.1',subtitle:'Local browser workspace; license service not connected'};
    case 'runs:list': return {runs:[]};
    case 'irctc:get-status': return {open:false,runs:[]};
    default: throw Error('This action needs the original desktop or external service: '+channel);
  }
}
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg','.ico':'image/x-icon'};
Promise.resolve().then(()=>http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,`http://127.0.0.1:${port}`);
    res.setHeader('Cache-Control','no-store');
    if(req.headers.origin && !allowedOrigins.has(req.headers.origin)){res.writeHead(403,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'This origin is not allowed'}));}
    const downloadManifestPath=path.join(__dirname,'releases','manifest.json');
    if(req.method==='GET'&&(url.pathname==='/api/portal/downloads'||url.pathname.startsWith('/downloads/'))){
      const manifest=fs.existsSync(downloadManifestPath)?JSON.parse(fs.readFileSync(downloadManifestPath,'utf8')):{version:'0.1.0'};
      if(url.pathname==='/api/portal/downloads'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(manifest));}
      const item=[manifest.setup,manifest.updater].filter(Boolean).find(item=>item.url===url.pathname);
      if(!item){res.writeHead(404);return res.end('Download not found');}
      const name=path.basename(item.url);const archive=path.join(__dirname,'releases',name);
      if(!fs.existsSync(archive)){res.writeHead(404);return res.end('Package unavailable');}
      res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition',`attachment; filename="${name}"`);res.setHeader('Content-Length',fs.statSync(archive).size);fs.createReadStream(archive).on('error',()=>res.destroy()).pipe(res);return;
    }
    if(await licenseService.handle(req,res,url))return;
    const adminFiles={'/portal':['portal.html','text/html'],'/signup':['signup.html','text/html'],'/downloads':['downloads.html','text/html'],'/public/portal.css':['public.css','text/css'],'/public/portal.js':['public.js','application/javascript'],'/seller':['seller.html','text/html'],'/seller/':['seller.html','text/html'],'/admin/usdt.js':['usdt.js','application/javascript'],'/admin/portal.js':['portal.js','application/javascript'],'/admin':['index.html','text/html'],'/admin/':['index.html','text/html'],'/admin/admin.js':['admin.js','application/javascript'],'/admin/style.css':['style.css','text/css'],'/client':['client.html','text/html'],'/client/':['client.html','text/html'],'/client/client.js':['client.js','application/javascript']};
    for(const page of ['usdt','signup-requests','overview','create-seller','sellers','create-key','keys','connections','ledger','activity'])adminFiles['/admin/'+page]=['index.html','text/html'];
    for(const page of ['usdt','overview','create-key','keys','connections','ledger','activity'])adminFiles['/seller/'+page]=['seller.html','text/html'];
    if(req.method==='GET'&&adminFiles[url.pathname]){const [file,type]=adminFiles[url.pathname];res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");res.setHeader('Content-Type',type);return res.end(fs.readFileSync(path.join(__dirname,'admin',file)));}
    if(req.method==='POST' && url.pathname==='/api/invoke') {
      if(!licenseService.licensedRequest(req)){res.writeHead(401,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Activate a valid LEXUS key to use the workspace'}));}
      if(req.headers.origin && req.headers.origin!==`http://127.0.0.1:${port}` && req.headers.origin!==`http://localhost:${port}`) {res.writeHead(403);return res.end();}
      let body=''; for await(const chunk of req) {body+=chunk;if(body.length>1024*1024)throw Error('Request too large');}
      const {channel,args=[]}=JSON.parse(body);
      const license=licenseService.requestLicense(req);if(!license){res.writeHead(401);return res.end();}
      if(req.headers['x-lexus-workspace']&&req.headers['x-lexus-workspace']!==license.id){res.writeHead(409,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Activation user changed; reload this workspace'}));}
      const store=await clientStore(license.id);
      const data=await invoke(store,channel,args);
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:data??null}));
    }
    if(req.method!=='GET'){res.writeHead(405);return res.end();}
    if(url.pathname==='/web-bridge.js') {res.setHeader('Content-Type','application/javascript');return res.end(fs.readFileSync(path.join(__dirname,'bridge.js'))+'\n'+fs.readFileSync(path.join(root,'preload-ui.js'),'utf8').replace("const { contextBridge, ipcRenderer } = require('electron');",''));}
    const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=path.resolve(root,'.'+relative);
    if(!file.startsWith(root+path.sep) || !mime[path.extname(file)] || relative.includes('/node_modules/') || relative.endsWith('/RECOVERY-REPORT.json')) {res.writeHead(404);return res.end();}
    let content=fs.readFileSync(file);
    if(path.extname(file)==='.html') content=content.toString().replace('<script src="./stations.js">','<script src="/web-bridge.js"></script><script src="./stations.js">');
    if(relative==='/renderer.js') content=content.toString().replace("toast('Export/Import — baad me');", "await window.ocean.webBackup(action); refreshLists();").replace("toast('Cleanup stub');", "if(action==='cleanup-forms'){clearJourneyEditor();clearCredentialEditor();clearPaymentEditor();toast('Editor forms cleared; saved profiles retained');}else if(action==='cleanup-cache'){location.reload();}else{toast('No desktop runs active in this browser workspace');}");
    res.setHeader('Content-Type',mime[path.extname(file)]);res.end(content);
  }catch(e){res.writeHead(e.code==='ENOENT'?404:400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
}).listen(port,process.env.LEXUS_WEB_HOST || '127.0.0.1',()=>console.log(`LEXUS web ready at http://127.0.0.1:${port}`))).catch(e=>{console.error(e.message);process.exit(1)});
