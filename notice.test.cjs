const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createLicensing}=require('./licensing.cjs');
const {noticeNews,validateNotice}=require('./app/notice-payload');
test('only an administrator can publish notices; guidance survives restart and is public read-only',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lexus-notice-'));
 const service=createLicensing({directory,adminPassword:'FixturePassword123!'});
 const server=http.createServer((req,res)=>service.handle(req,res,new URL(req.url,'http://localhost')));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const notice={enabled:true,title:'Gateway guidance',message:'Test announcement',recommended:'PhonePe QR',avoid:'UPI collect for QR'};
 try {
  let response=await fetch(base+'/api/admin/notice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(notice)});
  assert.equal(response.status,401);
  const token=service.login('FixturePassword123!');
  response=await fetch(base+'/api/admin/notice',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'lexus_admin='+token},body:JSON.stringify(notice)});
  assert.equal(response.status,200);
  assert.deepEqual((await(await fetch(base+'/api/license/notice')).json()).notice,notice);
  const restarted=createLicensing({directory});
  const request={method:'GET',headers:{},socket:{remoteAddress:'fixture'}};
  let data;await restarted.handle(request,{writeHead(){},end(text){data=JSON.parse(text);}},new URL('http://localhost/api/license/notice'));
  assert.deepEqual(data.notice,notice);
  assert.throws(()=>validateNotice({...notice,message:'a'.repeat(4001)}),/Invalid notice/);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true});}
});
test('notice includes admin instructions and available version without starting an update',()=>{
 const result=noticeNews({enabled:true,title:'Notice',message:'Hello',recommended:'QR',avoid:'Collect'},{version:'0.1.10'},'0.1.8');
 assert(result.items.includes('Recommended: QR'));
 assert(result.items.some(x=>x.includes('Click Update LEXUS')));
 assert.deepEqual(noticeNews({enabled:false},null,'0.1.10'),{items:[]});
});
