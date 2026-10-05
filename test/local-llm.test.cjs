const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {LocalLlm,MODELS,RUNTIME,recommended}=require('../local-llm.cjs');
test('model choice follows the Mac memory and every download is pinned',()=>{
  assert.equal(recommended(8*2**30),'qwen3.5-2b');assert.equal(recommended(16*2**30),'qwen3.5-4b');assert.equal(recommended(64*2**30),'qwen3.5-9b');
  for(const file of [RUNTIME,...MODELS.flatMap(m=>m.files)]){assert.match(file.sha256,/^[0-9a-f]{64}$/);assert.ok(file.size>0);assert.match(file.url,/^https:\/\/(github\.com\/ggml-org|huggingface\.co\/unsloth)\/.+\/(download\/b\d+|resolve\/[0-9a-f]{40})\//);}
  const llm=new LocalLlm(fs.mkdtempSync(path.join(os.tmpdir(),'llm-')),{ramBytes:16*2**30});
  const s=llm.status();assert.deepEqual(s.models.map(m=>m.fits),[true,true,true,false]);assert.ok(s.models.every(m=>!m.installed));
});
test('the server starts only for a downloaded model, on loopback, with a key',{skip:process.platform==='win32'&&'the stand-in llama-server is a script'},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'llm-'));const llm=new LocalLlm(root,{idleMs:60000});
  await assert.rejects(llm.ensure('qwen3.5-2b'),/還沒下載/);
  const runtime=path.join(root,`llama-${RUNTIME.tag}`);fs.mkdirSync(runtime);
  // stand-in llama-server: records its arguments and answers /health
  fs.writeFileSync(path.join(runtime,'llama-server'),`#!${process.execPath}\nconst a=process.argv.slice(2),get=f=>a[a.indexOf(f)+1];require('fs').writeFileSync(${JSON.stringify(path.join(root,'args.json'))},JSON.stringify(a));\nrequire('http').createServer((q,r)=>{r.statusCode=q.url==='/health'?200:404;r.end('{}');}).listen(+get('--port'),get('--host'));`,{mode:0o755});
  const model=path.join(root,'qwen3.5-2b');fs.mkdirSync(model);fs.writeFileSync(path.join(model,'model.gguf'),'x');fs.writeFileSync(path.join(model,'.complete'),'ok');
  const info=await llm.ensure('qwen3.5-2b');
  try{
    assert.match(info.base,/^http:\/\/127\.0\.0\.1:\d+\/v1$/);assert.match(info.key,/^[0-9a-f]{48}$/);assert.equal(info.model,'qwen3.5-2b');
    const args=JSON.parse(fs.readFileSync(path.join(root,'args.json'),'utf8'));assert.equal(args[args.indexOf('--host')+1],'127.0.0.1');assert.equal(args[args.indexOf('--api-key')+1],info.key);assert.ok(args.includes('--offline'));
    assert.equal(await llm.ensure('qwen3.5-2b'),info,'reuses the running server');assert.equal(llm.status().running,'qwen3.5-2b');
    assert.throws(()=>llm.remove('../x'));llm.remove('qwen3.5-2b');assert.equal(llm.status().running,null,'removing the model stops its server');assert.equal(fs.existsSync(model),false);
  }finally{llm.stop();}
});
test('each platform gets a pinned llama.cpp build: Vulkan where a loader exists, CPU otherwise',()=>{
  const {RUNTIMES,runtimeFor}=require('../local-llm.cjs');
  for(const builds of Object.values(RUNTIMES))for(const b of Object.values(builds)){assert.match(b.sha256,/^[0-9a-f]{64}$/);assert.match(b.url,/\/download\/b11378\/llama-b11378-bin-/);assert.equal(b.format,b.file.endsWith('.zip')?'zip':'tgz');}
  assert.match(runtimeFor({platform:'darwin',arch:'arm64'}).file,/macos-arm64\.tar\.gz$/);
  assert.match(runtimeFor({platform:'win32',arch:'x64',vulkan:true}).file,/win-vulkan-x64\.zip$/);assert.match(runtimeFor({platform:'win32',arch:'x64',vulkan:false}).file,/win-cpu-x64\.zip$/);
  assert.match(runtimeFor({platform:'linux',arch:'x64',vulkan:false}).file,/ubuntu-x64\.tar\.gz$/);assert.match(runtimeFor({platform:'linux',arch:'arm64',vulkan:true}).file,/ubuntu-arm64/);
  assert.equal(runtimeFor({platform:'freebsd',arch:'x64'}),null);
});
