const crypto=require('node:crypto');
const QRCode=require('qrcode');
const CONTRACT='a614f803b6fd780986a42c78ec9c7f77e6ded13c';
const TRANSFER='ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha=b=>crypto.createHash('sha256').update(b).digest();
function addressHex(value){
 const address=String(value||'').trim();if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address))throw Error('Enter a valid TRON receiving/sending address');
 let n=0n;for(const c of address)n=n*58n+BigInt(alphabet.indexOf(c));let hex=n.toString(16);if(hex.length%2)hex='0'+hex;const bytes=Buffer.from(hex,'hex');
 if(bytes.length!==25||bytes[0]!==0x41||!sha(sha(bytes.subarray(0,21))).subarray(0,4).equals(bytes.subarray(21)))throw Error('Invalid TRON address checksum');
 return bytes.subarray(1,21).toString('hex');
}
const unitsText=n=>(BigInt(n)/1000000n).toString()+'.'+(BigInt(n)%1000000n).toString().padStart(6,'0');
function createUsdtPayments({registry,persist,audit,fetchImpl=fetch,now=Date.now}){
 registry.usdtOrders??=[];registry.usdtSettings??={enabled:false,address:'',qr:''};
 let rateCache=null,quoteBusy=false,pollBusy=false;const checking=new Set();
 const publicOrder=o=>({...o});
 const owner=(actor,id)=>{const o=registry.usdtOrders.find(o=>o.id===id);if(!o||(actor.role!=='admin'&&o.sellerId!==actor.id))throw Error('Payment request not found');return o;};
 async function json(url,options={}){const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Payment provider unavailable ('+r.status+'); retry later');return r.json();}
 async function rate(){
  const fixed=Number(registry.usdtSettings.fixedRate);if(Number.isFinite(fixed)&&fixed>=1&&fixed<=10000)return{value:fixed,updatedAt:now(),source:'Admin fixed rate'};
  if(rateCache&&now()-rateCache.fetchedAt<60000&&now()-rateCache.updatedAt<600000)return rateCache;
  const headers={};if(process.env.LEXUS_COINGECKO_API_KEY)headers['x-cg-demo-api-key']=process.env.LEXUS_COINGECKO_API_KEY;
  const data=await json('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr&include_last_updated_at=true',{headers});
  const value=Number(data.tether?.inr),updatedAt=Number(data.tether?.last_updated_at)*1000;
  if(!Number.isFinite(value)||value<1||value>10000||!Number.isFinite(updatedAt)||Math.abs(now()-updatedAt)>600000)throw Error('Live USDT/INR rate unavailable or stale; payment request was not created');
  rateCache={value,updatedAt,fetchedAt:now(),source:'CoinGecko'};return rateCache;
 }
 function list(actor){return registry.usdtOrders.filter(o=>actor.role==='admin'||o.sellerId===actor.id).map(publicOrder);}
 async function settings(actor){const s=registry.usdtSettings;return{settings:{enabled:s.enabled,address:s.address,qr:s.qr,network:'TRC20',verification:'automatic',fixedRate:s.fixedRate||0,rateSource:s.fixedRate?'Admin fixed rate':'CoinGecko',providerKeyConfigured:actor.role==='admin'?!!process.env.LEXUS_TRONGRID_API_KEY:undefined},orders:list(actor)};}
 async function configure(actor,b){
  if(actor.role!=='admin')throw Error('Administrator required');const address=String(b.address||'').trim();addressHex(address);
  // Uploaded QR must decode to the exact receiving address; persist a fresh canonical QR.
  if(b.qr){const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.qr));if(!match||match[2].length>700000)throw Error('QR must be a PNG/JPEG under 500 KB');const bytes=Buffer.from(match[2],'base64');let decoded;
   if(match[1]==='png'){if(bytes.length<24||bytes.readUInt32BE(16)>1600||bytes.readUInt32BE(20)>1600)throw Error('QR image dimensions exceed 1600 pixels');decoded=require('pngjs').PNG.sync.read(bytes);}
   else decoded=require('jpeg-js').decode(bytes,{useTArray:true,maxResolutionInMP:3,maxMemoryUsageInMB:32});
   if(decoded.width>1600||decoded.height>1600)throw Error('QR image dimensions exceed 1600 pixels');const result=require('jsqr')(new Uint8ClampedArray(decoded.data),decoded.width,decoded.height);if(result?.data!==address)throw Error('Uploaded QR must contain exactly the receiving TRON address');
  }
  const qr=await QRCode.toDataURL(address,{errorCorrectionLevel:'M',margin:2,width:280});
  const fixedRate=Number(b.fixedRate||0);if(!Number.isFinite(fixedRate)||fixedRate<0||fixedRate>10000||fixedRate>0&&fixedRate<1)throw Error('Enter a rate between 1 and 10000, or leave blank for live rate');
  registry.usdtSettings={address,qr,enabled:b.enabled===true,fixedRate};audit(actor,'usdt-settings-updated',null,{address,enabled:b.enabled===true,fixedRate});persist();return settings(actor);
 }
 async function quote(actor,b){
  if(actor.role!=='seller')throw Error('Seller required');const s=registry.usdtSettings;if(!s.enabled)throw Error('USDT payments are not enabled by admin');addressHex(s.address);
  const sender=String(b.sender||'').trim();addressHex(sender);if(sender===s.address)throw Error('Sending and receiving wallets must differ');
  const credit=Number(b.credit);if(!Number.isSafeInteger(credit)||credit<100||credit>1000000)throw Error('Enter whole rupee credit between 100 and 1000000');
  if(registry.usdtOrders.filter(o=>o.sellerId===actor.id&&o.status==='PENDING'&&now()<Date.parse(o.expiresAt)).length>=3)throw Error('Complete your existing payment requests first');
  if(quoteBusy)throw Error('Payment request is being prepared; retry');quoteBusy=true;
  try{const price=await rate();const base=Math.ceil(credit/price.value*1000000);let units;
   for(let i=0;i<100;i++){units=String(base+crypto.randomInt(1,10000));if(!registry.usdtOrders.some(o=>o.address===s.address&&o.units===units&&o.status==='PENDING'&&now()<Date.parse(o.expiresAt)))break;units=null;}
   if(!units)throw Error('Could not reserve payment amount; retry');
   const o={id:crypto.randomUUID(),sellerId:actor.id,sellerName:registry.sellers.find(s=>s.id===actor.id)?.name,address:s.address,sender,network:'TRC20',credit,rate:price.value,rateSource:price.source,rateUpdatedAt:new Date(price.updatedAt).toISOString(),units,usdt:unitsText(units),createdAt:new Date(now()).toISOString(),expiresAt:new Date(now()+1800000).toISOString(),status:'PENDING',txid:'',message:'Send the exact USDT amount, then submit the transaction hash.'};
   registry.usdtOrders.unshift(o);audit(actor,'usdt-request-created',null,{orderId:o.id,credit});persist();return{order:publicOrder(o)};
  }finally{quoteBusy=false;}
 }
 async function check(o){
  if(o.status!=='PENDING'||!o.txid||checking.has(o.id)||o.lastCheckedAt&&now()-Date.parse(o.lastCheckedAt)<15000)return publicOrder(o);checking.add(o.id);
  try{
   const headers={'Content-Type':'application/json'};if(process.env.LEXUS_TRONGRID_API_KEY)headers['TRON-PRO-API-KEY']=process.env.LEXUS_TRONGRID_API_KEY;
   const receipt=await json('https://api.trongrid.io/walletsolidity/gettransactioninfobyid',{method:'POST',headers,body:JSON.stringify({value:o.txid})});
   if(!receipt.id){o.message='Waiting for a solidified TRON receipt. Automatic checks continue.';return publicOrder(o);}
   if(receipt.id.toLowerCase()!==o.txid||receipt.receipt?.result!=='SUCCESS'||!Number.isSafeInteger(receipt.blockNumber)||!Number.isSafeInteger(receipt.blockTimeStamp))throw Error('Transaction failed or receipt is invalid');
   if(receipt.blockTimeStamp<Date.parse(o.createdAt)||receipt.blockTimeStamp>Date.parse(o.expiresAt))throw Error('Transfer is outside this payment request time window');
   const destination=addressHex(o.address),source=addressHex(o.sender);
   const matches=(receipt.log||[]).filter(l=>String(l.address).toLowerCase().replace(/^41(?=.{40}$)/,'')===CONTRACT&&l.topics?.length===3&&l.topics[0]?.toLowerCase()===TRANSFER&&/^[0-9a-f]{64}$/i.test(l.topics[1])&&/^[0-9a-f]{64}$/i.test(l.topics[2])&&l.topics[1].slice(0,24)==='0'.repeat(24)&&l.topics[2].slice(0,24)==='0'.repeat(24)&&l.topics[1].slice(-40).toLowerCase()===source&&l.topics[2].slice(-40).toLowerCase()===destination&&/^[0-9a-f]{64}$/i.test(l.data)&&BigInt('0x'+l.data)===BigInt(o.units));
   if(matches.length!==1)throw Error('USDT token, sending wallet, receiving wallet or exact amount does not match');
   if(registry.usdtOrders.some(x=>x.id!==o.id&&x.txid===o.txid&&x.status==='CREDITED'))throw Error('Transaction already credited');
   const seller=registry.sellers.find(s=>s.id===o.sellerId);if(!seller?.enabled)throw Error('Seller disabled; contact admin');if(!Number.isSafeInteger(seller.balance+o.credit))throw Error('Balance limit');
   // No awaits between replay check and balance update: one transaction can credit only once.
   seller.balance+=o.credit;o.status='CREDITED';o.creditedAt=new Date(now()).toISOString();o.blockNumber=receipt.blockNumber;o.message='Confirmed on TRON; seller credit added.';
   registry.ledger.unshift({id:crypto.randomUUID(),at:o.creditedAt,sellerId:seller.id,action:'usdt-credit',amount:o.credit,orderId:o.id,txid:o.txid,note:o.usdt+' USDT · TRC20 · rate ₹'+o.rate});audit({role:'seller',id:seller.id},'usdt-credit',null,{orderId:o.id,amount:o.credit,txid:o.txid});
  }catch(e){o.message=e.message;}finally{o.lastCheckedAt=new Date(now()).toISOString();persist();checking.delete(o.id);}return publicOrder(o);
 }
 async function submit(actor,b){const o=owner(actor,b.id);const txid=String(b.txid||'').trim().toLowerCase();if(!/^[0-9a-f]{64}$/.test(txid))throw Error('Enter a 64-character TRON transaction hash');if(o.status==='CREDITED'){if(o.txid!==txid)throw Error('Already credited');return{order:publicOrder(o)};}
  if(registry.usdtOrders.some(x=>x.id!==o.id&&x.txid===txid))throw Error('Transaction hash is already assigned to another payment request');
  if(o.txid&&o.txid!==txid)throw Error('Transaction already submitted; contact admin before replacing it');
  if(!o.txid&&now()>Date.parse(o.expiresAt)+3600000)throw Error('Payment request is too old; contact admin');
  o.txid=txid;persist();return{order:await check(o)};
 }
 async function recheck(actor,b){const o=owner(actor,b.id);if(o.lastCheckedAt&&now()-Date.parse(o.lastCheckedAt)<15000)return{order:publicOrder(o)};return{order:await check(o)};}
 async function poll(){if(pollBusy)return;pollBusy=true;try{for(const o of registry.usdtOrders.filter(o=>o.status==='PENDING'&&o.txid&&now()-Date.parse(o.createdAt)<7*86400000).sort((a,b)=>(Date.parse(a.lastCheckedAt)||0)-(Date.parse(b.lastCheckedAt)||0)).slice(0,20))await check(o);}finally{pollBusy=false;}}
 return{settings,configure,quote,submit,recheck,poll,list};
}
module.exports={createUsdtPayments,addressHex,CONTRACT,TRANSFER};
