const crypto=require('node:crypto');
function createHierarchy({registry,persist,issue,publicKey,authenticated,sessionLicense}){
 registry.sellers??=[];registry.audit??=[];registry.ledger??=[];registry.ipAssignments??=[];registry.renewalRequests??=[];registry.signupRequests??=[];
 const sellerSessions=new Map(),failures=new Map(),signupAttempts=new Map();
 const text=(v,max=100)=>{v=String(v||'').trim();if(!v||v.length>max)throw Error('Invalid or missing text');return v;};
 const integer=(v,min,max)=>{v=Number(v);if(!Number.isSafeInteger(v)||v<min||v>max)throw Error(`Value must be ${min}–${max}`);return v;};
 const publicSeller=s=>({id:s.id,name:s.name,username:s.username,enabled:s.enabled,rate:s.rate,balance:s.balance,maxDevices:s.maxDevices,maxKeys:s.maxKeys,createdAt:s.createdAt});
 const seller=id=>registry.sellers.find(s=>s.id===id);
 function audit(actor,action,licenseId=null,detail={}){registry.audit.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),actor:actor.role==='admin'?'admin':actor.id,action,licenseId,...detail});}
 const usdt=require('./usdt-payments.cjs').createUsdtPayments({registry,persist,audit});
 function own(actor,id){const k=registry.keys.find(k=>k.id===id);if(!k||actor.role==='seller'&&k.sellerId!==actor.id)throw Error('License not found');return k;}
 function debit(actor,k,action){const s=seller(k.sellerId);if(actor.role==='seller'){if(!s?.enabled)throw Error('Seller disabled');if(s.balance<s.rate)throw Error('Insufficient seller credit; ask admin to add credit');s.balance-=s.rate;}registry.ledger.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),sellerId:k.sellerId||null,licenseId:k.id,action,amount:actor.role==='seller'?s.rate:0});}
 function cookie(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(s=>s.length===2));}
 function sellerAuth(token){const record=sellerSessions.get(token);const s=record&&seller(record.id);if(!record||record.expiry<=Date.now()||!s?.enabled){sellerSessions.delete(token);return null;}return{role:'seller',id:s.id};}
 function activeOwner(k){return !k.sellerId||seller(k.sellerId)?.enabled===true;}
 function connection(k){const x=registry.ipAssignments.find(i=>i.licenseId===k.id);return x?{host:x.host,port:x.port,expiresAt:x.expiresAt,status:Date.parse(x.expiresAt)>Date.now()?'ACTIVE':'EXPIRED'}:null;}
 async function handle(req,res,url){
  const prefix=url.pathname.startsWith('/api/seller/')?'seller':url.pathname.startsWith('/api/admin/')?'admin':url.pathname.startsWith('/api/portal/')?'portal':null;
  if(!prefix)return false;
  const route=url.pathname.slice(('/api/'+prefix+'/').length);
  if(prefix==='portal'&&route!=='signup')return false;
  if(prefix==='admin'&&!['sellers','seller-create','seller-update','credit','manage','overview','ledger','audit','ips','ip-assign','export','signup-requests','signup-approve','signup-reject','usdt','usdt-settings','usdt-check'].includes(route))return false;
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   if(prefix==='seller'&&!['login','logout','session','keys','overview','ledger','audit','ips','export','issue','manage','ip-assign','usdt','usdt-quote','usdt-submit','usdt-check'].includes(route)){json(403,{error:'Seller access denied'});return true;}
   const c=cookie(req);let actor=prefix==='admin'&&authenticated(c.lexus_admin)?{role:'admin'}:prefix==='seller'?sellerAuth(c.lexus_seller):prefix==='portal'?{role:'public'}:null;
   if(!actor&&!(prefix==='seller'&&route==='login')){json(401,{error:'Sign in required'});return true;}
   if(req.method==='GET'){
    const visible=registry.keys.filter(k=>actor.role==='admin'||k.sellerId===actor.id);
    const ids=new Set(visible.map(k=>k.id));
    switch(route){
     case 'usdt':json(200,await usdt.settings(actor));break;
     case 'session':json(200,{authenticated:true,seller:publicSeller(seller(actor.id))});break;
     case 'signup-requests':json(200,{requests:registry.signupRequests});break;
     case 'sellers':json(200,{sellers:registry.sellers.map(publicSeller)});break;
     case 'keys':case 'export':json(200,{keys:visible.map(publicKey)});break;
     case 'ledger':json(200,{entries:registry.ledger.filter(e=>actor.role==='admin'||e.sellerId===actor.id)});break;
     case 'audit':json(200,{entries:registry.audit.filter(e=>actor.role==='admin'||e.actor===actor.id||ids.has(e.licenseId))});break;
     case 'ips':json(200,{entries:visible.map(k=>({licenseId:k.id,customer:k.customer,connection:connection(k)})).filter(e=>e.connection)});break;
     case 'overview':json(200,{total:visible.length,active:visible.filter(k=>publicKey(k).status==='ACTIVE').length,unpaid:visible.filter(k=>k.paid===false).length,paid:visible.filter(k=>k.paid!==false).length,expiring:visible.filter(k=>Date.parse(k.expiresAt)>Date.now()&&Date.parse(k.expiresAt)<Date.now()+7*86400000).length,sellers:actor.role==='admin'?registry.sellers.length:undefined,seller:actor.role==='seller'?publicSeller(seller(actor.id)):undefined});break;
     default:json(404,{error:'Unknown endpoint'});
    }return true;
   }
   if(req.method!=='POST'){json(405,{error:'Method not allowed'});return true;}
   if(req.headers.origin&&!['http://127.0.0.1:'+url.port,'http://localhost:'+url.port,...String(process.env.LEXUS_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)].includes(req.headers.origin)){json(403,{error:'Invalid origin'});return true;}
   if(req.headers['content-type']?.split(';')[0]!=='application/json'){json(415,{error:'JSON required'});return true;}
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>(route==='usdt-settings'?750000:16384))throw Error('Request too large');}const b=JSON.parse(raw||'{}');
   if(route==='login'){
    const remote=req.socket.remoteAddress,previous=failures.get(remote);if(previous?.count>=8&&Date.now()-previous.at<900000)throw Error('Too many attempts; retry in 15 minutes');
    const s=registry.sellers.find(s=>s.username===String(b.username||'').trim().toLowerCase());const derived=crypto.scryptSync(String(b.password||''),s?.salt||'dummy-salt',64).toString('hex');
    if(!s?.enabled||derived!==s.passwordHash){const f=!previous||Date.now()-previous.at>=900000?{at:Date.now(),count:0}:previous;f.count++;failures.set(remote,f);throw Error('Invalid seller credentials');}
    failures.delete(remote);const token=crypto.randomBytes(32).toString('base64url');sellerSessions.set(token,{id:s.id,expiry:Date.now()+28800000});res.setHeader('Set-Cookie',`lexus_seller=${token}; HttpOnly; SameSite=Strict; Path=/api/seller; Max-Age=28800`);json(200,{ok:true,seller:publicSeller(s)});return true;
   }
   let result={ok:true};
   switch(route){
    case 'usdt-settings':result=await usdt.configure(actor,b);break;
    case 'usdt-quote':result=await usdt.quote(actor,b);break;
    case 'usdt-submit':result=await usdt.submit(actor,b);break;
    case 'usdt-check':result=await usdt.recheck(actor,b);break;
    case 'logout':sellerSessions.delete(c.lexus_seller);res.setHeader('Set-Cookie','lexus_seller=; HttpOnly; SameSite=Strict; Path=/api/seller; Max-Age=0');break;
    case 'signup':{
     const remote=req.socket.remoteAddress,previous=signupAttempts.get(remote);if(previous?.count>=5&&Date.now()-previous.at<3600000)throw Error('Too many signup requests; try again later');
     const attempt=!previous||Date.now()-previous.at>=3600000?{at:Date.now(),count:0}:previous;attempt.count++;signupAttempts.set(remote,attempt);
     const name=text(b.name),username=text(b.username,64).toLowerCase(),email=text(b.email,254).toLowerCase();if(!/^[a-z0-9_.-]{3,64}$/.test(username)||!/^\S+@\S+\.\S+$/.test(email))throw Error('Enter a valid email and username (3–64 letters/numbers/._-)');
     if(registry.sellers.some(s=>s.username===username)||registry.signupRequests.some(r=>r.status==='PENDING'&&(r.username===username||r.email===email)))throw Error('This username or email already has an account or pending request');
     if(registry.signupRequests.length>=10000)throw Error('Signup temporarily unavailable');
     const request={id:crypto.randomUUID(),name,username,email,status:'PENDING',createdAt:new Date().toISOString()};registry.signupRequests.unshift(request);result={ok:true,message:'Application received. Administrator approval is required before seller sign-in.'};break;
    }
    case 'signup-reject':{const request=registry.signupRequests.find(r=>r.id===b.id&&r.status==='PENDING');if(!request)throw Error('Pending request not found');request.status='REJECTED';request.reviewedAt=new Date().toISOString();audit(actor,'signup-rejected',null,{requestId:request.id});break;}
    case 'signup-approve':
    case 'seller-create':{
     const request=route==='signup-approve'?registry.signupRequests.find(r=>r.id===b.id&&r.status==='PENDING'):null;if(route==='signup-approve'&&!request)throw Error('Pending request not found');if(request){b.name=request.name;b.username=request.username;b.password=crypto.randomBytes(15).toString('base64url');}

     const username=text(b.username,64).toLowerCase();if(!/^[a-z0-9_.-]{3,64}$/.test(username)||registry.sellers.some(s=>s.username===username))throw Error('Seller username must be unique, 3–64 letters/numbers/._-');
     const password=text(b.password,128);if(password.length<8)throw Error('Seller password needs at least 8 characters');const salt=crypto.randomBytes(16).toString('hex');
     const s={id:crypto.randomUUID(),name:text(b.name),username,salt,passwordHash:crypto.scryptSync(password,salt,64).toString('hex'),enabled:true,rate:integer(b.rate??1600,0,10000000),balance:0,maxDevices:integer(b.maxDevices??2,1,10),maxKeys:integer(b.maxKeys??100,1,100000),createdAt:new Date().toISOString()};registry.sellers.push(s);audit(actor,'seller-created',null,{sellerId:s.id});result={seller:publicSeller(s)};if(request){request.status='APPROVED';request.sellerId=s.id;request.reviewedAt=new Date().toISOString();result.initialPassword=b.password;audit(actor,'signup-approved',null,{requestId:request.id,sellerId:s.id});}break;
    }
    case 'seller-update':{const s=seller(b.id);if(!s)throw Error('Seller not found');const changes={};if(b.enabled!==undefined){if(typeof b.enabled!=='boolean')throw Error('Invalid enabled value');changes.enabled=b.enabled;}for(const field of ['rate','maxDevices','maxKeys'])if(b[field]!==undefined)changes[field]=integer(b[field],field==='rate'?0:1,field==='maxDevices'?10:field==='rate'?10000000:100000);Object.assign(s,changes);audit(actor,'seller-updated',null,{sellerId:s.id});result={seller:publicSeller(s)};break;}
    case 'credit':{const s=seller(b.id);if(!s)throw Error('Seller not found');const amount=integer(b.amount,1,100000000);if(!Number.isSafeInteger(s.balance+amount))throw Error('Balance limit');s.balance+=amount;registry.ledger.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),sellerId:s.id,action:'admin-credit',amount,note:String(b.note||'').slice(0,200)});audit(actor,'seller-credit',null,{sellerId:s.id,amount});break;}
    case 'issue':{
     const s=seller(actor.id);if(registry.keys.filter(k=>k.sellerId===s.id).length>=s.maxKeys)throw Error('Seller key limit reached');const plan=b.plan==='yearly'?'yearly':b.plan==='monthly'?'monthly':null;if(!plan)throw Error('Choose monthly or yearly');
     result=issue({customer:b.customer,preferredKey:b.preferredKey,days:plan==='yearly'?365:30,maxDevices:Math.min(integer(b.maxDevices??s.maxDevices,1,10),s.maxDevices),sellerId:s.id,paid:false,plan});audit(actor,'key-created-unpaid',result.license.id);break;
    }
    case 'manage':{
     const k=own(actor,b.id),action=b.action;
     if(action==='paid'){if(k.paid!==false)throw Error('Key already paid');debit(actor,k,'key-paid');k.paid=true;k.paidAt=new Date().toISOString();k.expiresAt=new Date(Date.now()+(k.plan==='yearly'?365:30)*86400000).toISOString();}
     else if(action==='renew'){if(k.paid===false)throw Error('Mark this key paid first');debit(actor,k,'key-renewed');k.expiresAt=new Date(Math.max(Date.now(),Date.parse(k.expiresAt))+(k.plan==='yearly'?365:30)*86400000).toISOString();}
     else if(action==='reset'){k.devices=[];k.keyVersion=(k.keyVersion||0)+1;}
     else if(action==='deactivate'){k.revoked=true;k.keyVersion=(k.keyVersion||0)+1;}
     else if(action==='activate'){k.revoked=false;}
     else if(action==='edit'){k.customer=text(b.customer);}
     else throw Error('Unknown license action');if(action==='renew')for(const request of registry.renewalRequests.filter(r=>r.licenseId===k.id&&r.status==='PENDING')){request.status='COMPLETED';request.completedAt=new Date().toISOString();}audit(actor,'key-'+action,k.id);result={license:publicKey(k)};break;
    }
    case 'ip-assign':{const k=own(actor,b.id);const host=text(b.host,253);if(!/^[a-zA-Z0-9.:-]+$/.test(host))throw Error('Invalid host');const port=integer(b.port,1,65535);const expiresAt=new Date(b.expiresAt);if(!Number.isFinite(+expiresAt)||+expiresAt<=Date.now())throw Error('Choose a future expiry');
     const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(registry.signingKey,'hex'),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify({username:String(b.username||'').slice(0,128),password:String(b.password||'').slice(0,128)})),cipher.final()]);
     registry.ipAssignments=registry.ipAssignments.filter(x=>x.licenseId!==k.id);registry.ipAssignments.push({licenseId:k.id,host,port,expiresAt:expiresAt.toISOString(),credentials:{iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),value:encrypted.toString('hex')}});audit(actor,'ip-assigned',k.id);break;}
    default:json(404,{error:'Unknown endpoint'});return true;
   }
   persist();json(200,result);
  }catch(e){json(400,{error:e.message});}return true;
 }
 function clientSummary(id){const k=registry.keys.find(k=>k.id===id);return k?{plan:k.plan||'custom',paid:k.paid!==false,connection:connection(k),history:registry.audit.filter(e=>e.licenseId===id).map(e=>({at:e.at,action:e.action})),renewalRequests:registry.renewalRequests.filter(r=>r.licenseId===id),payments:registry.ledger.filter(e=>e.licenseId===id).map(e=>({at:e.at,action:e.action}))}:null;}
 function requestRenewal(token){const license=sessionLicense(token);if(!license)throw Error('Activate your key first');let request=registry.renewalRequests.find(r=>r.licenseId===license.id&&r.status==='PENDING');if(!request){request={id:crypto.randomUUID(),licenseId:license.id,status:'PENDING',at:new Date().toISOString()};registry.renewalRequests.unshift(request);audit({role:'client',id:license.id},'renewal-requested',license.id);persist();}return{ok:true,request};}
 return{handle,activeOwner,connection,clientSummary,requestRenewal,pollPayments:usdt.poll};
}
module.exports={createHierarchy};
