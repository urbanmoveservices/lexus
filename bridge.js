// Browser implementation of the recovered Electron preload contract.
if(!new URLSearchParams(location.search).has('view')) history.replaceState(null,'',location.pathname+'?view=web');
const listeners=new Map();
const emit=(name,value)=>(listeners.get(name)||[]).forEach(fn=>fn(null,value));
const contextBridge={exposeInMainWorld:(name,api)=>window[name]=api};
let activationPromise,clientWorkspaceId=null;
async function ensureActivation(){
  if(activationPromise)return activationPromise;
  activationPromise=(async()=>{
    const state=await(await fetch('/api/license/state')).json();if(state.activated){clientWorkspaceId=state.license.id;return;}
    await new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='lexus-activation';
      const heading=document.createElement('h2');heading.textContent='Activate LEXUS';dialog.append(heading);
      const text=document.createElement('p');text.textContent='Enter an activation key issued by your LEXUS administrator.';dialog.append(text);
      const form=document.createElement('form');const input=document.createElement('input');input.type='password';input.placeholder='LEXUS activation key';input.required=true;input.setAttribute('aria-label','LEXUS activation key');form.append(input);
      const button=document.createElement('button');button.textContent='Activate';button.type='submit';form.append(button);const feedback=document.createElement('p');feedback.setAttribute('role','status');form.append(feedback);dialog.append(form);
      const link=document.createElement('a');link.href='/admin';link.target='_blank';link.rel='noopener';link.textContent='Open admin panel';dialog.append(link);
      const clientLink=document.createElement('a');clientLink.href='/client';clientLink.target='_blank';clientLink.rel='noopener';clientLink.textContent='Personalize your key after admin activation';dialog.append(clientLink);
      dialog.addEventListener('cancel',event=>event.preventDefault());form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;try{let device=localStorage.getItem('lexus-device');if(!device){device=crypto.randomUUID();localStorage.setItem('lexus-device',device);}const response=await fetch('/api/license/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:input.value.trim(),device})});const result=await response.json();if(!response.ok)throw Error(result.error);clientWorkspaceId=result.license.id;dialog.close();dialog.remove();resolve();}catch(error){feedback.textContent=error.message;}finally{button.disabled=false;}});document.body.append(dialog);dialog.showModal();input.focus();
    });
  })();return activationPromise;
}
function showError(message){const el=document.getElementById('toast');if(el){el.textContent=message;el.hidden=false;setTimeout(()=>el.hidden=true,7000);}}
window.addEventListener('unhandledrejection',e=>{showError(e.reason?.message||String(e.reason));e.preventDefault();});
const ipcRenderer={
  on(name,fn){listeners.set(name,[...(listeners.get(name)||[]),fn]);},
  removeListener(name,fn){listeners.set(name,(listeners.get(name)||[]).filter(x=>x!==fn));},
  async invoke(channel,...args){
    await ensureActivation();
    if(channel==='ui:open-modal'){emit('shell:open-modal',args[0]);return {ok:true};}
    if(channel==='ui:new-book-draft'){emit('book:new-draft');return {ok:true};}
    if(channel==='ui:close-modal'){document.querySelectorAll('.modal-panel').forEach(el=>el.classList.remove('is-active'));return {ok:true};}
    if(channel==='ui:toolbar-menu'||channel==='ui:set-shell-mode')return {ok:true};
    if(channel==='app:quit'){showError('Close this browser tab to exit the local workspace.');return {ok:true};}
    if(channel==='panels:open-ticket'){
      const journey=await ipcRenderer.invoke('profiles:get',{kind:'journeys',id:args[0].journeyId});
      if(!journey)throw Error('Saved journey not found');
      const dialog=document.createElement('dialog');dialog.className='lexus-ticket-detail';
      const title=document.createElement('h2');title.textContent=journey.name;dialog.append(title);
      const summary=document.createElement('p');summary.textContent=`${journey.from} → ${journey.to} | ${journey.date} | Train ${journey.trainNo} | ${journey.class} | ${journey.quota}`;dialog.append(summary);
      const pax=document.createElement('p');pax.textContent=(journey.passengers||[]).map(x=>`${x.name}, ${x.age}, ${x.gender}`).join('; ');dialog.append(pax);
      const note=document.createElement('p');note.textContent='Saved journey details. Live booking requires the original Electron runtime and connected services.';dialog.append(note);
      const close=document.createElement('button');close.textContent='Close';close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(close);document.body.append(dialog);dialog.showModal();return {ok:true};
    }
    const response=await fetch('/api/invoke',{method:'POST',headers:{'Content-Type':'application/json','X-LEXUS-Workspace':clientWorkspaceId||''},body:JSON.stringify({channel,args})});
    const result=await response.json();if(response.status===409||response.status===401){location.reload();throw Error('Activation user changed. Reloading your workspace.');}if(!response.ok||result.error)throw Error(result.error||'Local API failed');return result.data;
  }
};
document.addEventListener('DOMContentLoaded',()=>{
  window.ocean.webBackup=async(action)=>{
    if(action==='settings-export'){
      const data=await ipcRenderer.invoke('web:export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='lexus-profiles.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showError('Profiles exported without passwords or payment secrets');
    }else{
      const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{const file=input.files[0];if(!file)return;await ipcRenderer.invoke('web:import',JSON.parse(await file.text()));emit('shell:open-modal','tickets');showError('Profiles imported as new records; enter passwords again');}catch(e){showError(e.message);}};input.click();
    }
  };
});
