const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Secrets,openaiSpeech,OPENAI_VOICES,OPENAI_MODELS,looksLikeOpenAIKey}=require('../tts.cjs');

// stand-in for Electron safeStorage: reversible, but never the plain text
const fakeSafe={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from([...Buffer.from(s)].map(b=>b^0x5a)),decryptString:b=>Buffer.from([...b].map(x=>x^0x5a)).toString()};
const tmp=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'tts-')),'secrets.json');

test('API keys are stored encrypted, owner-only, and can be removed',()=>{
  const file=tmp(),secrets=new Secrets(file,fakeSafe);
  assert.equal(secrets.has('openai'),false);
  secrets.set('openai','sk-test-1234567890abcdefghij');
  assert.equal(secrets.get('openai'),'sk-test-1234567890abcdefghij');
  const raw=fs.readFileSync(file,'utf8');assert.ok(!raw.includes('sk-test'),'key is not written in plain text');
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.equal(new Secrets(file,fakeSafe).get('openai'),'sk-test-1234567890abcdefghij','survives restart');
  secrets.clear('openai');assert.equal(secrets.has('openai'),false);
});
test('keys are refused when the OS cannot encrypt them',()=>{
  assert.throws(()=>new Secrets(tmp(),{...fakeSafe,isEncryptionAvailable:()=>false}).set('openai','sk-x'),/encrypt/i);
});
test('only plausible OpenAI keys are accepted',()=>{
  for(const ok of ['sk-proj-abcdefghijklmnopqrstuvwxyz0123','sk-abcdefghijklmnopqrstuvwx','sk-proj-'+'Ab9_-'.repeat(32),'sk-svcacct-'+'x'.repeat(150)])assert.ok(looksLikeOpenAIKey(ok));
  for(const bad of ['','sk-short','hello world sk-abc','sk-abc\ndef'.padEnd(40,'x'),'x'.repeat(40)])assert.equal(looksLikeOpenAIKey(bad),false,bad);
});
async function fakeOpenAI(handler,fn){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{return await fn(`http://127.0.0.1:${server.address().port}/v1`);}finally{server.closeAllConnections();server.close();}}
test('speech requests send the chosen voice, model and style and return audio',async()=>{
  let seen;
  const audio=await fakeOpenAI(async(req,res)=>{let body='';for await(const c of req)body+=c;seen={url:req.url,auth:req.headers.authorization,body:JSON.parse(body)};res.setHeader('Content-Type','audio/mpeg');res.end(Buffer.from('ID3fake'));},
    base=>openaiSpeech({base,key:'sk-test-key-abcdefghijklmnop',text:'你好'.repeat(3000),voice:'marin',model:'gpt-4o-mini-tts',instructions:'Warm and playful.'}));
  assert.equal(audio.toString(),'ID3fake');assert.equal(seen.url,'/v1/audio/speech');assert.equal(seen.auth,'Bearer sk-test-key-abcdefghijklmnop');
  assert.equal(seen.body.voice,'marin');assert.equal(seen.body.model,'gpt-4o-mini-tts');assert.equal(seen.body.instructions,'Warm and playful.');assert.equal(seen.body.response_format,'mp3');
  assert.ok(seen.body.input.length<=4096,'input capped at the API limit');
});
test('older models do not receive style instructions; unknown voices and models are rejected',async()=>{
  let body;await fakeOpenAI(async(req,res)=>{let b='';for await(const c of req)b+=c;body=JSON.parse(b);res.end('ok');},base=>openaiSpeech({base,key:'sk-test-key-abcdefghijklmnop',text:'hi',voice:'nova',model:'tts-1',instructions:'x'}));
  assert.equal(body.instructions,undefined);
  await assert.rejects(openaiSpeech({key:'sk-test-key-abcdefghijklmnop',text:'hi',voice:'darth',model:'tts-1'}),/voice/i);
  await assert.rejects(openaiSpeech({key:'sk-test-key-abcdefghijklmnop',text:'hi',voice:'nova',model:'gpt-9'}),/model/i);
  await assert.rejects(openaiSpeech({key:'',text:'hi',voice:'nova',model:'tts-1'}),/API key/i);
  assert.ok(OPENAI_VOICES.includes('cedar')&&OPENAI_MODELS.includes('gpt-4o-mini-tts'));
});
test('API failures become actionable messages without leaking the key',async()=>{
  for(const [status,pattern] of [[401,/無效|撤銷|invalid/i],[403,/權限/],[429,/額度|limit/i],[500,/OpenAI/]]){
    const error=await fakeOpenAI((req,res)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'bad key sk-test-key-abcdefghijklmnop'}}));},
      base=>openaiSpeech({base,key:'sk-test-key-abcdefghijklmnop',text:'hi',voice:'nova',model:'tts-1'}).then(()=>null,e=>e));
    assert.match(error.message,pattern);assert.ok(!error.message.includes('sk-test-key'),'key never appears in errors');
  }
});

test('429 tells an empty API balance apart from rate limiting',async()=>{
  for(const [code,pattern] of [['insufficient_quota',/額度|儲值/],['rate_limit_exceeded',/太頻繁/]]){
    const error=await fakeOpenAI((req,res)=>{res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code,message:'quota for sk-test-key-abcdefghijklmnop'}}));},
      base=>openaiSpeech({base,key:'sk-test-key-abcdefghijklmnop',text:'hi',voice:'nova',model:'tts-1'}).then(()=>null,e=>e));
    assert.match(error.message,pattern);assert.ok(error.code);assert.ok(!error.message.includes('sk-test'));
  }
});
