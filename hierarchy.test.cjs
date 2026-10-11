const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createLicensing}=require('./licensing.cjs');
test('admin/seller/client hierarchy isolates tenants, gates paid keys, debits once and invalidates reset/disabled sessions',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lexus-hierarchy-')),service=createLicensing({directory,adminPassword:'test-admin-only'});
 const server=http.createServer((req,res)=>service.handle(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 async function request(route,body,cookie){const response=await fetch(base+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 try{
 const admin=(await request('admin/login',{password:'test-admin-only'})).cookie;
 const create=async(username)=>(await request('admin/seller-create',{name:username,username,password:'test-seller-password',rate:100,maxKeys:3,maxDevices:1},admin)).data.seller;
 const a=await create('seller_a'),b=await create('seller_b');assert(a.id&&b.id);
 const tokenA=(await request('seller/login',{username:'seller_a',password:'test-seller-password'})).cookie;
 const tokenB=(await request('seller/login',{username:'seller_b',password:'test-seller-password'})).cookie;
 assert.equal((await request('seller/seller-create',{name:'intruder'},tokenA)).status,403);
 assert.equal((await request('admin/sellers',undefined,tokenA)).status,401);
 const issued=await request('seller/issue',{customer:'CLIENT A',preferredKey:'memberA1',plan:'monthly',maxDevices:1},tokenA);assert.equal(issued.status,200);const id=issued.data.license.id;
 assert.equal(issued.data.license.status,'UNPAID');assert.throws(()=>service.activate('memberA1','device'),/unpaid/);
 assert.equal((await request('seller/keys',undefined,tokenB)).data.keys.length,0);
 assert.equal((await request('seller/manage',{id,action:'paid'},tokenB)).status,400);
 assert.equal((await request('seller/manage',{id,action:'paid'},tokenA)).status,400);
 await request('admin/credit',{id:a.id,amount:200},admin);
 assert.equal((await request('seller/manage',{id,action:'paid'},tokenA)).status,200);
 assert.equal((await request('seller/manage',{id,action:'paid'},tokenA)).status,400);
 assert.equal((await request('seller/overview',undefined,tokenA)).data.seller.balance,100);
 const clientLogin=await request('license/activate',{key:'memberA1',device:'device'});assert.equal(clientLogin.status,200);assert.equal((await request('license/renew-request',{},clientLogin.cookie)).status,200);assert.equal((await request('license/renew-request',{},clientLogin.cookie)).status,200);assert.equal((await request('license/state',undefined,clientLogin.cookie)).data.details.renewalRequests.length,1);
 const activated=service.activate('memberA1','device');assert(service.sessionLicense(activated.token));
 await request('seller/manage',{id,action:'reset'},tokenA);assert.equal(service.sessionLicense(activated.token),null);
 const second=service.activate('memberA1','device');await request('seller/manage',{id,action:'renew'},tokenA);assert.equal((await request('seller/overview',undefined,tokenA)).data.seller.balance,0);
 await request('seller/ip-assign',{id,host:'127.0.0.1',port:8888,username:'test-proxy-user',password:'private-proxy-test',expiresAt:new Date(Date.now()+86400000).toISOString()},tokenA);
 const disk=fs.readFileSync(path.join(directory,'registry.json'),'utf8');assert(!disk.includes('private-proxy-test'));assert(!disk.includes('test-seller-password'));assert(!disk.includes('memberA1'));
 const ips=(await request('seller/ips',undefined,tokenA)).data;assert(!JSON.stringify(ips).includes('credentials'));
 assert.equal((await request('seller/ip-assign',{id,host:'127.0.0.1',port:1,expiresAt:new Date(Date.now()+86400000).toISOString()},tokenB)).status,400);
 await request('admin/seller-update',{id:a.id,enabled:false},admin);assert.equal(service.sessionLicense(second.token),null);assert.throws(()=>service.activate('memberA1','device'),/disabled/);assert.equal((await request('seller/keys',undefined,tokenA)).status,401);
 assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'registry.json'),'utf8')).renewalRequests[0].status,'COMPLETED');
 const restart=createLicensing({directory});assert.throws(()=>restart.activate('memberA1','device'),/disabled/);
 assert.equal((await request('seller/ledger',undefined,tokenB)).data.entries.length,0);
 }finally{await new Promise(r=>server.close(r));}
});
