const {spawn}=require('child_process');
const assert=require('assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'lexus-test-'));
const port=18081;
const base=`http://127.0.0.1:${port}`;
let child;
let activationCookie='';
function start(){return new Promise((resolve,reject)=>{child=spawn(process.execPath,[path.join(__dirname,'server.cjs')],{env:{...process.env,LEXUS_WEB_PORT:String(port),LEXUS_WEB_DATA:data,LEXUS_LICENSE_DATA:path.join(data,'licenses'),LEXUS_ADMIN_PASSWORD:'isolated-test-password'},windowsHide:true});child.once('error',reject);child.stderr.on('data',d=>reject(Error(String(d))));child.stdout.once('data',resolve);child.once('exit',code=>{if(code)reject(Error('Server exited '+code));});});}
function stop(){return new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
async function api(channel,...args){const r=await fetch(base+'/api/invoke',{method:'POST',headers:{'Content-Type':'application/json',Cookie:activationCookie},body:JSON.stringify({channel,args})});const out=await r.json();if(out.error)throw Error(out.error);return out.data;}
(async()=>{
  try{
    await start();
    assert.equal((await fetch(base+'/api/admin/keys')).status,401);
    assert.equal((await fetch(base+'/api/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channel:'app:get-info'})})).status,401);
    const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'isolated-test-password'})});assert.equal(login.status,200);assert(login.headers.get('set-cookie').includes('HttpOnly'));
    const adminCookie=login.headers.get('set-cookie').split(';')[0];
    const forbiddenFirstKey=await fetch(base+'/api/license/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer:'UNAUTHORIZED CLIENT',key:'123456'})});assert.equal(forbiddenFirstKey.status,403);
    const personalIssue=await fetch(base+'/api/admin/issue',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:JSON.stringify({customer:'PERSONAL CLIENT',preferredKey:'FirstKey!123',days:7,maxDevices:1})});const personalData=await personalIssue.json();assert.equal(personalIssue.status,200);
    const personalActivation=await fetch(base+'/api/license/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:personalData.key,device:'personal-device'})});assert.equal(personalActivation.status,200);const oldPersonalCookie=personalActivation.headers.get('set-cookie').split(';')[0];
    const changedKey=await fetch(base+'/api/license/change',{method:'POST',headers:{'Content-Type':'application/json',Cookie:oldPersonalCookie},body:JSON.stringify({currentKey:personalData.key,newKey:'client7'})});assert.equal(changedKey.status,200);const changedData=await changedKey.json();assert.equal(changedData.license.expiresAt,personalData.license.expiresAt);assert.equal(changedData.license.maxDevices,1);
    assert.equal((await(await fetch(base+'/api/license/state',{headers:{Cookie:oldPersonalCookie}})).json()).activated,false);
    assert.equal((await(await fetch(base+'/api/license/state',{headers:{Cookie:changedKey.headers.get('set-cookie').split(';')[0]}})).json()).activated,true);
    const issued=await fetch(base+'/api/admin/issue',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:JSON.stringify({customer:'TEST CUSTOMER',days:30,maxDevices:2})});assert.equal(issued.status,200);const issuedData=await issued.json();
    const activation=await fetch(base+'/api/license/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:issuedData.key,device:'isolated-browser-device'})});assert.equal(activation.status,200);activationCookie=activation.headers.get('set-cookie').split(';')[0];
    const payment=await api('profiles:savePayment',{name:'TEST GATEWAY',paymentMethod:'IRCUPIQR'});
    const credential=await api('profiles:saveCredential',{name:'TEST ACCOUNT',username:'test-account',password:'dummy-test-password'});
    const journey=await api('profiles:saveJourney',{name:'TEST JOURNEY',from:'NDLS',to:'BCT',date:'2026-10-11',trainNo:'12952',class:'3A',quota:'GN',passengers:[{name:'TEST',age:30,gender:'M'}]});
    await api('profiles:setUiState',{selectedJourneyId:journey.id,selectedPaymentId:payment.id,selectedCredentialId:credential.id});
    assert.equal((await api('profiles:list','journeys')).length,1);
    assert.equal((await api('profiles:get',{kind:'journeys',id:journey.id})).from,'NDLS');
    assert.equal((await api('profiles:get',{kind:'credentials',id:credential.id,includeSecrets:true})).password,'dummy-test-password');
    assert.equal((await api('profiles:get',{kind:'credentials',id:credential.id})).password,undefined);
    await api('profiles:saveJourney',{id:journey.id,name:'UPDATED TEST',from:'LTT'});
    assert.equal((await api('profiles:get',{kind:'journeys',id:journey.id})).from,'LTT');
    assert.deepEqual(await api('history:list'),{items:[]});
    const exported=await api('web:export');assert(!JSON.stringify(exported).includes('dummy-test-password'));
    await api('web:import',exported);assert.equal((await api('profiles:list','journeys')).length,2);
    const expectedUi=await api('profiles:getUiState');
    const cookieA=activationCookie;
    const issuedB=await fetch(base+'/api/admin/issue',{method:'POST',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:JSON.stringify({customer:'ISOLATION B',preferredKey:'isolateB7',days:30,maxDevices:2})});const licenseB=await issuedB.json();assert.equal(issuedB.status,200);
    const activatedB=await fetch(base+'/api/license/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:licenseB.key,device:'isolation-B'})});activationCookie=activatedB.headers.get('set-cookie').split(';')[0];
    assert.equal((await api('profiles:list','journeys')).length,0);
    const journeyB=await api('profiles:saveJourney',{name:'CLIENT B ONLY',from:'BSB',to:'PRYJ',trainNo:'13251',date:'2026-10-12'});
    assert.equal((await api('profiles:list','journeys')).length,1);
    assert.equal(await api('profiles:get',{kind:'journeys',id:journey.id}),null);
    assert.equal(await api('profiles:get',{kind:'credentials',id:credential.id,includeSecrets:true}),null);
    const stale=await fetch(base+'/api/invoke',{method:'POST',headers:{'Content-Type':'application/json',Cookie:activationCookie,'X-LEXUS-Workspace':issuedData.license.id},body:JSON.stringify({channel:'profiles:saveJourney',args:[{name:'MUST NOT SAVE'}]})});assert.equal(stale.status,409);
    activationCookie=cookieA;assert.equal((await api('profiles:list','journeys')).length,2);assert.equal(await api('profiles:get',{kind:'journeys',id:journeyB.id}),null);

    const personalizedA=await fetch(base+'/api/license/change',{method:'POST',headers:{'Content-Type':'application/json',Cookie:activationCookie},body:JSON.stringify({currentKey:issuedData.key,newKey:'isolationAnew7'})});assert.equal(personalizedA.status,200);activationCookie=personalizedA.headers.get('set-cookie').split(';')[0];assert.equal((await api('profiles:list','journeys')).length,2);
    assert(!fs.readFileSync(path.join(data,'clients',issuedData.license.id,'ocean-data','ocean.sqlite')).includes(Buffer.from('dummy-test-password')));
    const rejected=await fetch(base+'/api/invoke',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'});assert.equal(rejected.status,403);
    const html=await (await fetch(base+'/index.html')).text();assert(html.includes('/web-bridge.js'));
    assert.equal((await fetch(base+'/../ocean-desktop/data')).status,404);
    await stop();await start();
    assert.equal((await api('profiles:get',{kind:'journeys',id:journey.id})).name,'UPDATED TEST');
    assert.equal((await api('profiles:getUiState')).selectedJourneyId,expectedUi.selectedJourneyId);
    await api('profiles:delete',{kind:'journeys',id:journey.id});
    assert.equal(await api('profiles:get',{kind:'journeys',id:journey.id}),null);
    const secondLogin=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'isolated-test-password'})});
    const revoked=await fetch(base+'/api/admin/revoke',{method:'POST',headers:{'Content-Type':'application/json',Cookie:secondLogin.headers.get('set-cookie').split(';')[0]},body:JSON.stringify({id:issuedData.license.id})});assert.equal(revoked.status,200);
    assert.equal((await fetch(base+'/api/invoke',{method:'POST',headers:{'Content-Type':'application/json',Cookie:activationCookie},body:JSON.stringify({channel:'app:get-info'})})).status,401);
    for(let attempt=0;attempt<8;attempt++)await fetch(base+'/api/license/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'wrong-test-key',device:'isolated-browser-device'})});
    const throttled=await fetch(base+'/api/license/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'wrong-test-key',device:'isolated-browser-device'})});assert.match((await throttled.json()).error,/Too many/);
    console.log('PASS: separate A=2/B=1 workspaces, cross-user read/write blocking, personalization retains workspace, activation/revocation, profile CRUD and restart persistence.');
  }finally{if(child&&!child.killed)await stop();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
