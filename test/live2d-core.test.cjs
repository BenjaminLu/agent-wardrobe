const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createLive2dCore,SOURCE}=require('../live2d-core.cjs');const {createRemote,DeviceStore}=require('../remote-server.cjs');
const {STANDIN_CORE}=require('./fixtures/models/make.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'live2d-core-'));

test('Cubism Core is fetched from Live2D only when install() is called, once, and checked',async()=>{
  const dir=path.join(tmp(),'live2d'),calls=[];const core=createLive2dCore({dir,fetchImpl:async url=>{calls.push(url);await new Promise(r=>setTimeout(r,20));return new Response(fs.readFileSync(STANDIN_CORE));}});
  assert.equal(core.url(),null);assert.equal(core.installed(),false);assert.deepEqual(calls,[],'nothing is downloaded up front');
  const [a,b]=await Promise.all([core.install(),core.install()]);assert.equal(a,b);assert.deepEqual(calls,[SOURCE],'two windows share one download');
  assert.equal(SOURCE,'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js');
  assert.match(core.url(),/^file:\/\/.*\/live2d\/live2dcubismcore\.min\.js$/);await core.install();assert.equal(calls.length,1);
});
test('a failed or wrong download leaves nothing behind',async()=>{
  for(const [response,error] of [[new Response('nope',{status:404}),/HTTP 404/],[new Response('<html>Please accept</html>'),/不是 Live2D Cubism Core/]]){
    const dir=path.join(tmp(),'live2d');const core=createLive2dCore({dir,fetchImpl:async()=>response});
    await assert.rejects(core.install(),error);assert.equal(core.installed(),false);assert.ok(!fs.existsSync(core.file));
  }
});
test('the phone gets Cubism Core only after the Mac has it, with WebAssembly allowed by the page policy',async()=>{
  let corePath=null;const remote=createRemote({root:path.join(__dirname,'..'),store:new DeviceStore(path.join(tmp(),'devices.json')),getState:()=>({}),chat:async()=>({}),modAsset:async()=>Buffer.alloc(0),live2dCore:()=>corePath});
  const base=`http://127.0.0.1:${await remote.listen(0)}`;
  try{
    assert.equal((await fetch(`${base}/remote/vendor/live2dcubismcore.min.js`,{method:'HEAD'})).status,404);
    corePath=STANDIN_CORE;const head=await fetch(`${base}/remote/vendor/live2dcubismcore.min.js`,{method:'HEAD'});assert.equal(head.status,200);
    const got=await fetch(`${base}/remote/vendor/live2dcubismcore.min.js`);assert.match(await got.text(),/Live2DCubismCore/);assert.match(got.headers.get('content-security-policy'),/script-src 'self' 'wasm-unsafe-eval'/);
    assert.equal((await fetch(`${base}/remote/vendor/live2d-kit.js`)).status,200);
  }finally{await remote.close();}
});
