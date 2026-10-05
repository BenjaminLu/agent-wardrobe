const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createRemote,DeviceStore}=require('../remote-server.cjs');const tailscale=require('../tailscale.cjs');
const tmp=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'remote-')),'devices.json');
test('pairing codes expire, allow five tries, and issue revocable device tokens',()=>{
  let now=1000;const store=new DeviceStore(tmp(),{now:()=>now});
  assert.throws(()=>store.pair('000000'),/過期/);
  const code=store.newCode().value;for(let i=0;i<5;i++)assert.throws(()=>store.pair(code==='111111'?'222222':'111111'),/不對/);
  assert.throws(()=>store.pair(code),/太多次/);
  const fresh=store.newCode().value;now+=6*60*1000;assert.throws(()=>store.pair(fresh),/過期/);
  const ok=store.newCode().value;const {token,device}=store.pair(ok,'iPhone');assert.match(token,/^[0-9a-f]{64}$/);
  assert.equal(store.verify(token).id,device.id);assert.equal(store.verify('f'.repeat(64)),null);assert.equal(store.verify('x'),null);
  assert.ok(!fs.readFileSync(store.file,'utf8').includes(token),'only a hash of the token is stored');
  assert.throws(()=>store.pair(ok),/過期/,'a code works once');
  store.revoke(device.id);assert.equal(store.verify(token),null);
});
test('the remote server checks the host, needs a device token, and serves only its own files',async()=>{
  const store=new DeviceStore(tmp());let listener;
  const remote=createRemote({root:path.join(__dirname,'..'),store,allowedHosts:()=>['mac.tail1234.ts.net'],getState:()=>({state:{ok:1},history:[]}),chat:async text=>({ok:true,text:`echo ${text}`}),modAsset:async()=>Buffer.from('x'),subscribe:fn=>{listener=fn;return()=>{};}});
  const port=await remote.listen(0),base=`http://127.0.0.1:${port}`;
  try{
    assert.equal((await fetch(`${base}/remote/`)).status,200);
    assert.match((await fetch(`${base}/remote/`)).headers.get('content-security-policy'),/frame-ancestors 'none'/);
    for(const p of ['/remote/../main.cjs','/remote/%2e%2e/main.cjs','/main.cjs','/remote/remote-devices.json'])assert.notEqual((await fetch(base+p)).status,200,p);
    assert.equal((await fetch(`${base}/api/state`)).status,401);
    // fetch cannot override Host, so ask with a raw request the way a DNS-rebinding page would arrive
    const status=await new Promise(resolve=>require('node:http').get({host:'127.0.0.1',port,path:'/api/state',headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}));
    assert.equal(status,403,'DNS rebinding blocked');
    const code=store.newCode().value;const paired=await (await fetch(`${base}/api/pair`,{method:'POST',body:JSON.stringify({code,name:'iPhone'})})).json();
    const auth={Authorization:`Bearer ${paired.token}`};
    assert.deepEqual(await (await fetch(`${base}/api/state`,{headers:auth})).json(),{state:{ok:1},history:[]});
    assert.equal((await (await fetch(`${base}/api/chat`,{method:'POST',headers:auth,body:JSON.stringify({text:'hi'})})).json()).text,'echo hi');
    const events=await fetch(`${base}/api/events`,{headers:auth});const reader=events.body.getReader();await reader.read();
    listener('message',{role:'assistant',text:'from desktop'});const {value}=await reader.read();assert.match(new TextDecoder().decode(value),/event: message\ndata: .*from desktop/);
    await reader.cancel();
  }finally{await remote.close();}
});
test('Tailscale status and serve errors are read from the CLI',async()=>{
  const exists=p=>p.includes('/Applications/Tailscale.app');
  const runner=(json,fail)=>(_bin,args,_o,cb)=>fail&&args[0]==='serve'?cb(Object.assign(new Error('x'),{}),'',fail):cb(null,JSON.stringify(json),'');
  assert.deepEqual(await tailscale.status({exists:()=>false}),{installed:false,running:false});
  assert.deepEqual(await tailscale.status({exists,runner:runner({BackendState:'Running',Self:{DNSName:'mac.tail1234.ts.net.'}})}),{installed:true,running:true,dnsName:'mac.tail1234.ts.net',url:'https://mac.tail1234.ts.net:8443/remote/'});
  assert.equal((await tailscale.status({exists,runner:runner({BackendState:'NeedsLogin',Self:{}})})).running,false);
  await assert.rejects(tailscale.serve(1234,{exists,runner:runner({},'serve: HTTPS is not enabled for this tailnet')}),/HTTPS Certificates/);
});
test('a tailnet name learned after start is accepted, other hosts are not',async()=>{
  const store=new DeviceStore(tmp());let hosts=[];
  const remote=createRemote({root:path.join(__dirname,'..'),store,allowedHosts:()=>hosts,refreshHosts:async()=>{hosts=['mac.tail1234.ts.net'];},getState:()=>({}),chat:async()=>({}),modAsset:async()=>Buffer.from(''),subscribe:()=>()=>{}});
  const port=await remote.listen(0);
  const get=host=>new Promise(resolve=>require('node:http').get({host:'127.0.0.1',port,path:'/remote/',headers:{Host:host}},res=>{res.resume();resolve(res.statusCode);}));
  try{assert.equal(await get('mac.tail1234.ts.net:8443'),200);assert.equal(await get('other.tail9999.ts.net'),403);assert.equal(await get('evil.example'),403);}
  finally{await remote.close();}
});
