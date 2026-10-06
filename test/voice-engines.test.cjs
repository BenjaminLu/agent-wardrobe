require('../src/main/locales.cjs').setLanguage('zh-Hant');  // the messages below are asserted in the source language
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');
const eleven=require('../voice-engines/elevenlabs.cjs');const sovits=require('../voice-engines/sovits.cjs');const {pickleGlobals,scanCheckpoint}=require('../voice-engines/pickle-scan.cjs');
const {createJobs}=require('../voice-engines/jobs.cjs');const {makeZip}=require('./fixtures/zip.cjs');const {speechWav}=require('./fixtures/voice/make-audio.cjs');
const {createVoices}=require('../src/main/voices.cjs');
const tmp=prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix));
const KEY='sk_'+'a1B2c3'.repeat(8);

// --- ElevenLabs against a local stand-in: the key only ever travels in the xi-api-key header
async function standin(fn){
  const seen=[];
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
    seen.push({method:req.method,url:req.url,key:req.headers['xi-api-key'],auth:req.headers.authorization,type:req.headers['content-type'],body});
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.headers['xi-api-key']!==KEY){json(401,{detail:{status:'invalid_api_key',message:`Invalid key ${req.headers['xi-api-key']}`}});return;}
    if(req.url==='/v1/user')return json(200,{subscription:{tier:'creator'}});
    if(req.url==='/v1/voices/add')return json(200,{voice_id:'ClonedVoice123',requires_verification:false});
    if(req.url.startsWith('/v1/text-to-voice/design')){const b=JSON.parse(body);if(b.voice_description.length<20)return json(422,{detail:{status:'invalid'}});
      return json(200,{previews:[{audio_base_64:Buffer.from('ID3preview1').toString('base64'),generated_voice_id:'GenA1234567',media_type:'audio/mpeg',duration_secs:5},{audio_base_64:Buffer.from('ID3preview2').toString('base64'),generated_voice_id:'GenB1234567',media_type:'audio/mpeg',duration_secs:5}],text:b.text});}
    if(req.url==='/v1/text-to-voice')return json(200,{voice_id:'DesignedVoice1',name:'x'});
    if(req.url.startsWith('/v1/text-to-speech/ClonedVoice123')){res.writeHead(200,{'Content-Type':'audio/mpeg'});res.end('ID3speech');return;}
    if(req.url.startsWith('/v1/text-to-speech/Busy')){json(429,{detail:{status:'too_many_concurrent_requests'}});return;}
    if(req.method==='DELETE')return json(200,{status:'ok'});
    json(404,{});
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{return await fn(`http://127.0.0.1:${server.address().port}`,seen);}finally{server.closeAllConnections();server.close();}
}
test('ElevenLabs: verify, clone, design, save a design, speak, delete — key only in the header',async()=>{
  await standin(async(base,seen)=>{
    const engine=eleven.create({getKey:()=>KEY,base});
    assert.deepEqual(await engine.verifyKey(KEY),{ok:true});
    const clone=await engine.clone({name:'小明',files:[{name:'a.wav',data:speechWav(12)}],description:'Cloned with consent of 小明'});
    assert.deepEqual(clone,{voiceId:'ClonedVoice123',requiresVerification:false});
    const add=seen.find(r=>r.url==='/v1/voices/add');assert.match(add.type,/^multipart\/form-data; boundary=/);
    const text=add.body.toString('latin1');assert.ok(text.includes('name="files"; filename="a.wav"')&&text.includes('RIFF'),'the recording is uploaded as a file');
    const design=await engine.design({prompt:'可愛的動漫少女，活潑'});
    assert.equal(design.previews.length,2);assert.equal(design.previews[0].audio.toString(),'ID3preview1');
    const sent=JSON.parse(seen.find(r=>r.url.startsWith('/v1/text-to-voice/design')).body);
    assert.match(sent.voice_description,/可愛的動漫少女，活潑/);assert.ok(sent.voice_description.length>=20,'a short prompt is padded to the minimum');
    assert.ok(sent.text.length>=100&&/[一-鿿]/.test(sent.text),'a Chinese prompt gets a Chinese sample text');assert.equal(sent.model_id,'eleven_multilingual_ttv_v2');
    assert.deepEqual(await engine.saveDesign({generatedVoiceId:'GenA1234567',name:'動漫少女',description:design.description}),{voiceId:'DesignedVoice1'});
    const spoken=await engine.speak({text:'你好',profile:{params:{voiceId:'ClonedVoice123',model:'eleven_multilingual_v2',stability:.4}}});
    assert.deepEqual([spoken.audio.toString(),spoken.mime],['ID3speech','audio/mpeg']);
    const tts=JSON.parse(seen.find(r=>r.url.startsWith('/v1/text-to-speech/')).body);
    assert.deepEqual([tts.model_id,tts.voice_settings.stability,tts.text],['eleven_multilingual_v2',.4,'你好']);
    assert.match(seen.find(r=>r.url.startsWith('/v1/text-to-speech/')).url,/output_format=mp3_44100_128/);
    await engine.remove({profile:{params:{voiceId:'ClonedVoice123'}}});assert.ok(seen.some(r=>r.method==='DELETE'&&r.url==='/v1/voices/ClonedVoice123'));
    for(const r of seen){assert.equal(r.key,KEY);assert.ok(!r.url.includes(KEY),`key not in ${r.url}`);assert.equal(r.auth,undefined);assert.ok(!r.body.toString('latin1').includes(KEY),'key not in a body');}
  });
});
test('ElevenLabs: errors are explained without echoing what the server said; bad ids and keys are refused locally',async()=>{
  await standin(async(base,seen)=>{
    const bad=eleven.create({getKey:()=>'sk_'+'z'.repeat(40),base});
    await assert.rejects(bad.speak({text:'hi',profile:{params:{voiceId:'ClonedVoice123'}}}),e=>/無效/.test(e.message)&&!e.message.includes('zzzz'));
    await assert.rejects(eleven.create({getKey:()=>KEY,base}).speak({text:'hi',profile:{params:{voiceId:'Busy12345'}}}),/太頻繁/);
    await assert.rejects(eleven.create({getKey:()=>null,base}).speak({text:'hi',profile:{params:{voiceId:'ClonedVoice123'}}}),/尚未設定/);
    const before=seen.length;
    assert.throws(()=>eleven.validate({voiceId:'../../v1/user'}),/ID/);
    await assert.rejects(eleven.create({getKey:()=>KEY,base}).saveDesign({generatedVoiceId:'a/b',name:'x',description:'y'}),/Unknown/);
    assert.equal(seen.length,before,'nothing sent for a bad id');
    assert.equal(eleven.looksLikeKey(KEY),true);assert.equal(eleven.looksLikeKey('sk-openai-style-key-0000000000'),false);
    assert.equal((await eleven.create({getKey:()=>null}).available()).ok,false);
  });
});

// --- GPT-SoVITS packs: safe pickles only, v1/v2/v2Pro only, and always personal
const pickle={
  safe:Buffer.from('\x80\x02}q\x00(X\x06\x00\x00\x00weightq\x01ccollections\nOrderedDict\nq\x02)Rq\x03X\x06\x00\x00\x00configq\x04}q\x05u.','latin1'),
  tensor:Buffer.from('\x80\x02ctorch._utils\n_rebuild_tensor_v2\nq\x00(X\x01\x00\x00\x000ctorch\nHalfStorage\nq\x01tq\x02Rq\x03.','latin1'),
  evil:Buffer.from('\x80\x02cposix\nsystem\nq\x00X\x02\x00\x00\x00idq\x01\x85q\x02Rq\x03.','latin1'),
  // protocol 4: push "os", "system", then two harmless names and pop them so only a careless scanner sees OrderedDict
  smuggled:Buffer.from('\x80\x04\x8c\x02os\x94\x8c\x06system\x94\x8c\x0bcollections\x94\x8c\x0bOrderedDict\x9400\x93)R.','latin1'),
  stackGlobal:Buffer.from('\x80\x04\x8c\x0bcollections\x94\x8c\x0bOrderedDict\x94\x93\x94)R.','latin1'),
  memoGlobal:Buffer.from('\x80\x04\x8c\x0bcollections\x94\x8c\x0bOrderedDict\x94\x93\x94h\x00h\x01\x93.','latin1')
};
test('pickle scan lists what a checkpoint would run and refuses tricks',()=>{
  assert.deepEqual(pickleGlobals(pickle.safe),['collections.OrderedDict']);
  assert.deepEqual(pickleGlobals(pickle.tensor).sort(),['torch.HalfStorage','torch._utils._rebuild_tensor_v2']);
  assert.deepEqual(pickleGlobals(pickle.evil),['posix.system']);
  assert.deepEqual(pickleGlobals(pickle.stackGlobal),['collections.OrderedDict']);
  assert.deepEqual(pickleGlobals(pickle.memoGlobal),['collections.OrderedDict']);
  assert.throws(()=>pickleGlobals(pickle.smuggled),/STACK_GLOBAL/);
  assert.throws(()=>pickleGlobals(Buffer.from('\x80\x02\x82\x01.','latin1')),/擴充碼/);
  assert.throws(()=>pickleGlobals(Buffer.from('\x80\x02X\xff\x00\x00\x00ab','latin1')),/截斷/);
});
function checkpoint(file,data,{header=null,pad=1.2e6}={}){
  let buf=makeZip([{name:'archive/data.pkl',data},{name:'archive/data/0',data:Buffer.alloc(pad)},{name:'archive/version',data:'3\n'}]);
  if(header)buf=Buffer.concat([Buffer.from(header,'latin1'),buf.subarray(2)]);
  fs.writeFileSync(file,buf);return file;
}
function pack(dir,{gpt=pickle.safe,sov=pickle.safe,header='05',ref=true,text='こんにちは、よろしくね'}={}){
  fs.mkdirSync(dir,{recursive:true});const files=[];
  files.push({path:checkpoint(path.join(dir,'miku-e15.ckpt'),gpt),name:'miku-e15.ckpt'});
  files.push({path:checkpoint(path.join(dir,'miku_e8.pth'),sov,{header}),name:'miku_e8.pth'});
  if(ref){fs.writeFileSync(path.join(dir,`${text}.wav`),speechWav(5,{rate:32000}));files.push({path:path.join(dir,`${text}.wav`),name:`${text}.wav`});}
  return files;
}
test('a community pack is checked, copied under fixed names and forced to personal use only',{skip:process.platform!=='darwin'},async()=>{
  const dir=tmp('pack-'),dest=path.join(tmp('voices-'),'v-miku-abc123');
  const result=await sovits.importPack({files:pack(dir),dest,name:'初音（社群）'});
  assert.deepEqual(result.files,['gpt.ckpt','sovits.pth','reference.wav','reference.txt']);
  assert.deepEqual(fs.readdirSync(dest).sort(),['gpt.ckpt','reference.txt','reference.wav','sovits.pth']);
  assert.equal(result.license.tier,'personal');assert.equal(result.license.commercial,false);assert.match(result.license.label,/社群聲音模型多半用原作配音訓練，僅供自己使用/);
  assert.equal(result.note,'社群聲音模型多半用原作配音訓練，僅供自己使用');
  assert.deepEqual([result.params.refText,result.params.refLang,result.params.version,result.params.source],['こんにちは、よろしくね','ja','v2Pro','pack']);
  // saved through the real registry, the voice cannot be exported
  const voices=createVoices({root:path.dirname(dest)});voices.registerEngine(sovits.create({dir:tmp('sv-'),sidecar:{command:process.execPath,args:[path.join(__dirname,'fixtures','voice','standin-sidecar.cjs')]}}));
  const saved=await voices.save({id:'v-miku-abc123',name:'初音（社群）',engine:'sovits',params:result.params,files:result.files,license:result.license});
  assert.equal(saved.license.tier,'personal');assert.throws(()=>voices.exportPack(saved.id),/不能匯出/);
  const spoken=await voices.speak(saved.id,'今日もがんばろう');assert.equal(spoken.mime,'audio/wav');
  voices.engine('sovits').stop({now:true});
});
test('packs that could run code, need v3/v4, or are incomplete are refused',{skip:process.platform!=='darwin'},async()=>{
  const dest=()=>path.join(tmp('voices-'),'v-x-1');
  await assert.rejects(sovits.importPack({files:pack(tmp('p-'),{gpt:pickle.evil}),dest:dest()}),/posix\.system/);
  await assert.rejects(sovits.importPack({files:pack(tmp('p-'),{sov:pickle.smuggled}),dest:dest()}),/STACK_GLOBAL/);
  await assert.rejects(sovits.importPack({files:pack(tmp('p-'),{header:'04'}),dest:dest()}),/v4/);
  await assert.rejects(sovits.importPack({files:pack(tmp('p-'),{ref:false}),dest:dest()}),/參考音檔/);
  await assert.rejects(sovits.importPack({files:pack(tmp('p-')).filter(f=>!f.name.endsWith('.pth')),dest:dest()}),/\.pth/);
  const legacy=path.join(tmp('p-'),'old.ckpt');fs.writeFileSync(legacy,Buffer.concat([Buffer.from('\x80\x02','latin1'),Buffer.alloc(2e6)]));
  assert.throws(()=>scanCheckpoint(legacy),/舊格式/);
});

// --- GPT-SoVITS fine-tuning as a job: slice → transcribe → (stand-in) training, then cancel
const trainer={command:process.execPath,args:[path.join(__dirname,'fixtures','voice','standin-trainer.cjs')]};
test('training runs through its stages with progress and produces a voice',async()=>{
  const work=tmp('train-'),out=path.join(work,'out'),take=path.join(work,'take.wav');fs.writeFileSync(take,speechWav(75));
  const heard=[];const engine=sovits.create({dir:tmp('sv-'),trainer,transcribe:samples=>{heard.push(samples.length);return '今天天氣真好';}});
  const events=[];const jobs=createJobs({onChange:j=>events.push(j)});
  const job=jobs.start({kind:'train',title:'訓練',stages:engine.STAGES,estimate:engine.estimateTraining(1.25),run:ctx=>engine.train({takes:[{file:take,text:''}],workDir:path.join(work,'w'),outDir:out,lang:'zh',epochs:{gpt:3,sovits:2}},ctx)});
  await jobs.wait(job.id);const done=jobs.get(job.id);
  assert.equal(done.state,'done',done.error);assert.deepEqual(done.result.files,['gpt.ckpt','sovits.pth','reference.wav','reference.txt']);
  assert.ok(heard.length>=7&&heard.every(n=>n>=16000*1.5),'each slice was transcribed at 16 kHz');
  assert.deepEqual([...new Set(events.map(e=>e.stage))],['slice','asr','features','gpt','sovits']);
  const progress=events.map(e=>e.progress);assert.ok(progress.every((p,i)=>!i||p>=progress[i-1]),'progress only moves forward');
  assert.ok(events.some(e=>e.stage==='gpt'&&/gpt 2\/3/.test(e.detail)));
  assert.equal(fs.readFileSync(path.join(out,'reference.txt'),'utf8'),'今天天氣真好');
  const ref=require('../src/main/voice-audio.cjs').parseWav(fs.readFileSync(path.join(out,'reference.wav')));assert.ok(ref.samples.length/ref.sampleRate>=3&&ref.samples.length/ref.sampleRate<=10.5);
  assert.ok(engine.estimateTraining(5)>engine.estimateTraining(1));
});
test('cancelling a training stops the trainer process',async()=>{
  const work=tmp('train-'),take=path.join(work,'take.wav'),pidFile=path.join(work,'pid');fs.writeFileSync(take,speechWav(70));
  process.env.VOICE_TRAINER_STEP_MS='2000';process.env.VOICE_TRAINER_PID=pidFile;
  try{
    const engine=sovits.create({dir:tmp('sv-'),trainer,transcribe:()=>'一二三'});const jobs=createJobs();
    const job=jobs.start({kind:'train',title:'訓練',stages:engine.STAGES,run:ctx=>engine.train({takes:[{file:take}],workDir:path.join(work,'w'),outDir:path.join(work,'out')},ctx)});
    const until=Date.now()+10000;while(!fs.existsSync(pidFile)&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
    const pid=+fs.readFileSync(pidFile,'utf8');assert.ok(pid>0);
    jobs.cancel(job.id);await jobs.wait(job.id);assert.equal(jobs.get(job.id).state,'cancelled');
    const alive=()=>{try{process.kill(pid,0);return true;}catch{return false;}};
    const deadline=Date.now()+6000;while(alive()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
    assert.equal(alive(),false,'trainer process was killed');assert.equal(fs.existsSync(path.join(work,'out','gpt.ckpt')),false);
  }finally{delete process.env.VOICE_TRAINER_STEP_MS;delete process.env.VOICE_TRAINER_PID;}
});
test('too little audio is refused before training starts',async()=>{
  const work=tmp('train-'),take=path.join(work,'take.wav');fs.writeFileSync(take,speechWav(6));
  const engine=sovits.create({dir:tmp('sv-'),trainer});const jobs=createJobs();
  const job=jobs.start({kind:'train',title:'x',stages:engine.STAGES,run:ctx=>engine.train({takes:[{file:take}],workDir:path.join(work,'w'),outDir:path.join(work,'o')},ctx)});
  await jobs.wait(job.id);assert.equal(jobs.get(job.id).state,'error');assert.match(jobs.get(job.id).error,/太少/);
});
