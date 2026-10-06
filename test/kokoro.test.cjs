const test=require('node:test');require('../locales.cjs').setLanguage('zh-Hant');  // messages are matched in the source language
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const http=require('node:http');
const {Kokoro,install,installed,sentences,wav,VOICES,REQUIRED}=require('../kokoro.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('replies are split into sentences so speech can start early',()=>{
  assert.deepEqual(sentences('嗨，我是 Annie！今天想聊什麼？好。'),['嗨，我是 Annie！','今天想聊什麼？','好。']);
  assert.deepEqual(sentences('Hi, I am Annie. It costs 3.5 dollars! OK'),['Hi, I am Annie.','It costs 3.5 dollars!','OK']);
});
test('samples become a 16-bit mono WAV',()=>{
  const out=wav(new Float32Array([0,1,-1,.5]),24000);
  assert.equal(out.subarray(0,4).toString(),'RIFF');assert.equal(out.readUInt32LE(24),24000);assert.equal(out.length,44+8);assert.equal(out.readInt16LE(46),32767);
});
async function fakeHub(files,fn){
  const server=http.createServer((req,res)=>{if(req.url==='/list'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({siblings:Object.entries(files).map(([rfilename,c])=>({rfilename,size:Buffer.byteLength(c)}))}));return;}
    const name=decodeURIComponent(req.url.slice('/files/'.length));if(!(name in files)){res.writeHead(404);res.end();return;}res.end(files[name]);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;try{return await fn(base);}finally{server.close();}
}
const files=Object.fromEntries([...REQUIRED,'espeak-ng-data/en_dict','dict/jieba.dict.utf8'].map(n=>[n,`content of ${n}`]));
test('the model installs only after every file arrives and verifies',async()=>{
  const dir=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'kokoro-')),'model');const progress=[];
  await fakeHub(files,base=>install(dir,{listUrl:`${base}/list`,fileBase:`${base}/files`,hashes:{'model.onnx':sha(files['model.onnx'])},onProgress:p=>progress.push(p)}));
  assert.ok(installed(dir));assert.equal(fs.readFileSync(path.join(dir,'dict/jieba.dict.utf8'),'utf8'),'content of dict/jieba.dict.utf8');
  assert.equal(progress.at(-1),1);assert.ok(!fs.existsSync(dir+'.partial'));
});
test('a corrupted download is discarded and never marked installed',async()=>{
  const dir=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'kokoro-')),'model');
  await assert.rejects(fakeHub(files,base=>install(dir,{listUrl:`${base}/list`,fileBase:`${base}/files`,hashes:{'model.onnx':'0'.repeat(64)}})),/integrity/);
  assert.equal(installed(dir),false);assert.ok(!fs.existsSync(dir+'.partial'));
});
test('model listings cannot write outside the model folder',async()=>{
  const dir=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'kokoro-')),'model');
  await fakeHub({...files,'../escape.txt':'x'},base=>install(dir,{listUrl:`${base}/list`,fileBase:`${base}/files`,hashes:{}}));
  assert.ok(!fs.existsSync(path.join(path.dirname(dir),'escape.txt')));
});
test('synthesis uses the chosen speaker, clamps speed and copies samples into V8 memory',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kokoro-'));for(const n of REQUIRED)fs.writeFileSync(path.join(dir,n),'x');fs.writeFileSync(path.join(dir,'.complete'),'r');
  let request;const sherpa={OfflineTts:class{generateAsync(r){request=r;return Promise.resolve({samples:new Float32Array(240),sampleRate:24000});}}};
  const out=await new Kokoro(dir,{sherpa}).synthesize('你好','zm_yunxi',9);
  assert.equal(request.sid,VOICES.find(v=>v.name==='zm_yunxi').sid);assert.equal(request.speed,1.6);assert.equal(request.enableExternalBuffer,false);assert.equal(out.subarray(0,4).toString(),'RIFF');
  await assert.rejects(new Kokoro(path.join(dir,'missing')).synthesize('hi','af_heart'),/尚未下載/);
});
