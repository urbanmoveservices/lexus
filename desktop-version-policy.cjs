const {compareVersions}=require('./app/lexus-update-core');
function desktopUpdateRequirement(req,body,policy){if(!policy)return null;const desktop=req.headers['x-lexus-client']==='desktop'||/^[a-f0-9]{64}$/i.test(String(body.device||''));if(!desktop)return null;const version=String(body.clientVersion||'');try{if(compareVersions(version,policy.version)>=0)return null;}catch{}return{error:'Update required. Install LEXUS '+policy.version+' from '+policy.downloadUrl,code:'UPDATE_REQUIRED',requiredVersion:policy.version,downloadUrl:policy.downloadUrl};}
module.exports={desktopUpdateRequirement};
