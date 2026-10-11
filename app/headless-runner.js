const {EventEmitter}=require('node:events');
const driver=require('./headless-driver');
async function launchHeadlessRun(options){
 if(options.mode!=='nget')return{ok:false,error:'HEADLESS supports Classic only. Select Classic and retry.'};
 let current,transition=false,timer=null,stable;const events=new EventEmitter();
 const status=message=>options.onStatusMessage?.(message);
 const attach=raw=>{raw.browser.on('disconnected',()=>{if(transition||stable?.closed)return;stable.closed=true;clearInterval(timer);events.emit('disconnected');});};
 let first;try{first=await driver.launchSystemChromeRun({...options,headless:true,browserKind:'chrome'});}catch(error){return{ok:false,error:error.message};}if(!first.ok)return first;current=first.handle;
 stable={...current,engine:'headless',headless:true,closed:false,browser:{on:(...args)=>events.on(...args),disconnect:()=>current.browser.disconnect(),close:()=>current.browser.close()},reveal:async()=>{
  if(stable.closed)return{ok:false,error:'Headless run is closed'};
  if(transition)return{ok:false,error:'Opening visible browser…'};
  if(!stable.headless){await current.page.bringToFront();return{ok:true};}
  transition=true;clearInterval(timer);const url=current.page.url();status('HEADLESS · opening manual browser…');
  try{await current.browser.close();const result=await driver.launchSystemChromeRun({...options,startUrl:url,headless:false,browserKind:'chrome'});if(!result.ok)throw Error(result.error);current=result.handle;if(stable.closed){await driver.closeChromeHandle(current);return{ok:false,error:'Run was stopped'};}
   for(const key of ['page','chromeProc','debugPort','proxyTunnel'])stable[key]=current[key];stable.headless=false;stable.meta.headless=false;attach(current);status('HEADLESS · visible handoff — complete login/CAPTCHA/payment');options.onStatus?.();return{ok:true};
  }catch(error){stable.closed=true;stable.meta.error=error.message;status('HEADLESS HANDOFF FAILED · '+error.message);events.emit('disconnected');return{ok:false,error:error.message};}finally{transition=false;}
 },close:async()=>{stable.closed=true;clearInterval(timer);await driver.closeChromeHandle(current);}};
 stable.meta.engine='headless';stable.meta.headless=true;attach(current);
 let checking=false;
 timer=setInterval(async()=>{if(checking||transition||stable.closed||!stable.headless)return;checking=true;try{const reason=await current.page.evaluate(()=>{
   const visible=e=>!!e&&e.getClientRects().length>0;
   if(/booking\/bkgPaymentOptions|payment|razorpay|paytm|phonepe|ipay/i.test(location.href))return'payment';
   if(Array.from(document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],#captcha,input[name*="captcha" i]')).some(visible))return'login / CAPTCHA / OTP';
   if(Array.from(document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenge"],.captcha-img')).some(visible))return'challenge';
   if(/checking your browser|verify you are human|access denied/i.test(document.body?.innerText||''))return'site challenge';
   return'';
  });if(reason){status('HEADLESS · manual action: '+reason);await stable.reveal();}}catch(error){if(!stable.closed)status('HEADLESS · '+error.message);}finally{checking=false;}},1000);
 status('HEADLESS · background browser ready');return{ok:true,handle:stable};
}
async function closeHeadlessHandle(handle){if(handle?.close)await handle.close();}
module.exports={launchHeadlessRun,closeHeadlessHandle};
