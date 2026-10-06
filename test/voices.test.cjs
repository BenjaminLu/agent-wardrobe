require('../src/main/locales.cjs').setLanguage('zh-Hant');  // the messages below are asserted in the source language
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const crypto=require('node:crypto');
const {createVoices,validate,boundProfile,zip,unzip,LIMITS}=require('../src/main/voices.cjs');
const mix=require('../voice-engines/kokoro-mix.cjs');const voicevox=require('../voice-engines/voicevox.cjs');const kokoro=require('../src/main/kokoro.cjs');
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'voices-'));
const license={label:'Test',commercial:true,credit:null,tier:'open'};
const fakeEngine=(id='fake',calls=[])=>({id,label:'Fake',available:async()=>({ok:true}),speak:async({text,profile,dir})=>{calls.push({text,profile,dir});return {audio:Buffer.from('RIFF'),mime:'audio/wav'};},validate:p=>{if(p.bad)throw new Error('bad params');}});
const base={id:'v-annie-1a2b',name:'安妮',engine:'fake',params:{},files:[],license,consent:null,modId:null,createdAt:'2026-10-05T00:00:00.000Z'};

test('validation refuses unsafe ids, names, files, licences and params',async t=>{
  t.after(()=>{});
  assert.equal(validate(base).name,'安妮');
  for(const [change,pattern] of [[{id:'../x'},/ID/],[{id:'v-a/b-1'},/ID/],[{name:''},/名稱/],[{name:'x'.repeat(41)},/名稱/],[{name:'a\nb'},/名稱/],[{engine:'../e'},/引擎/],
    [{files:['../escape.wav']},/檔名/],[{files:['.hidden']},/檔名/],[{files:['/abs.wav']},/檔名/],[{files:['a/b/c.wav']},/檔名/],[{files:['voice.json']},/檔名/],[{files:Array(33).fill('a.wav')},/最多/],
    [{license:{...license,tier:'free'}},/授權等級/],[{license:null},/授權/],[{consent:{person:'',at:'2026-01-01'}},/姓名/],[{modId:'../annie'},/角色/],[{params:{blob:'x'.repeat(LIMITS.params)}},/參數/]])
    assert.throws(()=>validate({...base,...change}),pattern,JSON.stringify(change).slice(0,60));
  assert.throws(()=>validate({...base,params:{bad:true}},{engine:fakeEngine()}),/bad params/,'engine validation runs');
  const root=temp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const voices=createVoices({root,engines:[fakeEngine()]});
  // files must exist inside the profile folder, be regular files and stay under the size cap
  await assert.rejects(voices.save({...base,files:['missing.wav']}),/缺少/);
  const dir=path.join(root,base.id);fs.mkdirSync(dir,{recursive:true});fs.symlinkSync('/etc/hosts',path.join(dir,'link.wav'));
  await assert.rejects(voices.save({...base,files:['link.wav']}),/不安全/);
  const big=path.join(dir,'big.wav');fs.writeFileSync(big,'');fs.truncateSync(big,LIMITS.file+1);await assert.rejects(voices.save({...base,files:['big.wav']}),/MB/);
});

test('profiles save, list without secrets, and remove',async t=>{
  const root=temp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const voices=createVoices({root,engines:[fakeEngine()]});
  const saved=await voices.save({name:'小安',engine:'fake',params:{style:1,apiKey:'sk-secret'},license},{extra:{'sample.wav':Buffer.from('RIFF')}});
  assert.match(saved.id,/^v-voice-[0-9a-f]{8}$|^v-[a-z0-9-]+-[0-9a-f]{8}$/);assert.deepEqual(saved.files,['sample.wav']);
  assert.ok(fs.existsSync(path.join(root,saved.id,'voice.json')));
  assert.deepEqual(voices.list().map(p=>p.params),[{style:1}],'secrets are not listed');assert.equal(voices.get(saved.id).params.apiKey,'sk-secret');
  fs.writeFileSync(path.join(root,'stray.txt'),'x');fs.mkdirSync(path.join(root,'v-broken-1'));fs.writeFileSync(path.join(root,'v-broken-1','voice.json'),'{');
  assert.equal(voices.list().length,1,'broken profiles are skipped');
  assert.equal(voices.remove(saved.id),true);assert.equal(voices.list().length,0);assert.throws(()=>voices.remove('../x'),/ID/);
});

test('engine registry: pluggable, availability reported, a missing engine gives a clear error',async t=>{
  const root=temp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const calls=[];const voices=createVoices({root});
  assert.throws(()=>voices.registerEngine({id:'Bad Id',speak(){},available(){}}),/Invalid/);assert.throws(()=>voices.registerEngine({id:'x'}),/Invalid/);
  voices.registerEngine(fakeEngine('fake',calls));voices.registerEngine({id:'later',label:'Later',available:async()=>({ok:false,reason:'needs a download',install:true}),install:async()=>{},speak:async()=>{}});
  voices.registerEngine({id:'broken',label:'Broken',available:async()=>{throw new Error('boom');},speak:async()=>({audio:'nope',mime:'text/plain'})});
  assert.deepEqual(await voices.engines(),[{id:'fake',label:'Fake',available:true,reason:null,install:false},{id:'later',label:'Later',available:false,reason:'needs a download',install:true},{id:'broken',label:'Broken',available:false,reason:'boom',install:false}]);
  const p=await voices.save({...base,id:undefined});const out=await voices.speak(p.id,'你好');assert.equal(out.mime,'audio/wav');assert.equal(calls[0].dir,path.join(root,p.id));
  const orphan=await voices.save({...base,id:undefined,engine:'cosyvoice'});  // saved before its engine is installed (an imported pack)
  await assert.rejects(voices.speak(orphan.id,'你好'),/需要「cosyvoice」語音引擎/);
  const bad=await voices.save({...base,id:undefined,engine:'broken'});await assert.rejects(voices.speak(bad.id,'hi'),/沒有回傳可播放的聲音/);
  await assert.rejects(voices.speak('v-gone-1','hi'),/找不到/);
});

test('voice packs round-trip with their licence; cloned voices are never exported or imported',async t=>{
  const root=temp(),other=temp();t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(other,{recursive:true,force:true});});
  const a=createVoices({root,engines:[fakeEngine()]}),b=createVoices({root:other});
  const lic={label:'VOICEVOX:ずんだもん',commercial:false,credit:'VOICEVOX:ずんだもん',tier:'rules'};
  const saved=await a.save({name:'ずんだもん',engine:'fake',params:{styleId:3,token:'secret'},license:lic,modId:'annie'},{extra:{'policy.md':Buffer.from('# 利用規約\nクレジット必須')}});
  const pack=a.exportPack(saved.id);const entries=unzip(pack);
  assert.deepEqual([...entries.keys()].sort(),['policy.md','voice.json']);assert.ok(!entries.get('voice.json').toString().includes('secret'),'secrets stay home');
  const imported=await b.importPack(pack);
  assert.notEqual(imported.id,saved.id);assert.deepEqual(imported.license,lic);assert.equal(imported.modId,null);assert.deepEqual(imported.params,{styleId:3});
  assert.equal(fs.readFileSync(path.join(other,imported.id,'policy.md'),'utf8'),'# 利用規約\nクレジット必須');
  const cloned=await a.save({name:'媽媽',engine:'fake',params:{},license:{...license,tier:'personal'},consent:{person:'王小美',at:'2026-10-01T00:00:00Z',note:'錄音時口頭同意'}});
  assert.throws(()=>a.exportPack(cloned.id),/王小美 本人.*不能匯出/);
  const forged=zip([{name:'voice.json',data:Buffer.from(JSON.stringify({...cloned}))}]);await assert.rejects(b.importPack(forged),/真人/);
  for(const bad of [Buffer.from('not a zip'),zip([{name:'readme.txt',data:Buffer.from('x')}]),zip([{name:'voice.json',data:Buffer.from(JSON.stringify({...base,files:['../evil.sh']}))},{name:'../evil.sh',data:Buffer.from('x')}]),zip([{name:'voice.json',data:Buffer.from(JSON.stringify({...base,files:['gone.wav']}))}])])
    await assert.rejects(b.importPack(bad),/聲音包|檔名|缺少/);
  assert.ok(!fs.existsSync(path.join(path.dirname(other),'evil.sh')));
});

test('character binding: the worn character speaks with its own profile, others fall back',async t=>{
  const root=temp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const voices=createVoices({root,engines:[fakeEngine()]});
  const p=await voices.save({...base,id:undefined});
  const bindings={annie:p.id,miso:'v-deleted-1'};
  assert.equal(boundProfile(bindings,'annie',voices),p.id);
  assert.equal(boundProfile(bindings,'miso',voices),null,'a deleted profile falls back to the voice provider');
  assert.equal(boundProfile(bindings,'not-a-mod',voices),null);assert.equal(boundProfile(undefined,'annie',voices),null);assert.equal(boundProfile(bindings,'__proto__',voices),null);
});

// --- Kokoro mix
const fakeVoices=speakers=>{const f=new Float32Array(speakers*mix.PER);for(let s=0;s<speakers;s++)f.fill(s+1,s*mix.PER,(s+1)*mix.PER);f[3*mix.PER+5]=100;return Buffer.from(f.buffer);};
test('embedding blend: weighted average of speaker styles, written into speaker 0 of a full-size copy',()=>{
  const voices=fakeVoices(4);
  const out=mix.blend(voices,[{sid:1,weight:.6},{sid:3,weight:.4}]);
  assert.equal(out.length,mix.PER);assert.ok(Math.abs(out[0]-(.6*2+.4*4))<1e-6);assert.ok(Math.abs(out[5]-(.6*2+.4*100))<1e-5);
  const unnormalised=mix.blend(voices,[{sid:1,weight:3},{sid:2,weight:1}]);assert.ok(Math.abs(unnormalised[7]-(.75*2+.25*3))<1e-6,'weights are normalised');
  const derived=mix.derive(voices,out),f=new Float32Array(derived.buffer,derived.byteOffset,derived.length/4);
  assert.equal(derived.length,voices.length,'sherpa-onnx needs the same speaker count');assert.ok(Math.abs(f[0]-2.8)<1e-6);assert.equal(f[mix.PER],2,'other speakers untouched');
  assert.throws(()=>mix.blend(voices,[{sid:9,weight:1}]),/沒有這個聲音/);assert.throws(()=>mix.blend(Buffer.alloc(12),[{sid:0,weight:1}]),/格式/);
  assert.throws(()=>mix.validate({mix:[{voice:'nobody',weight:1}]}),/不認得/);assert.throws(()=>mix.validate({mix:[{voice:'zf_xiaoyi',weight:0}]}),/不能是 0/);
  assert.throws(()=>mix.validate({mix:[{voice:'zf_xiaoyi',weight:1}],pitch:20}),/音高/);
  for(const p of mix.PRESETS)mix.validate(p);assert.deepEqual(mix.PRESETS.map(p=>p.name),['萌系少女','元氣妹妹','溫柔姊姊','傲嬌','少年']);
});
const frequency=(x,rate)=>{let crossings=0;for(let i=1;i<x.length;i++)if(x[i-1]<0&&x[i]>=0)crossings++;return crossings/(x.length/rate);};
test('pitch shift keeps the length and sample rate and moves the pitch',()=>{
  const rate=24000,x=new Float32Array(rate);for(let i=0;i<x.length;i++)x[i]=.5*Math.sin(2*Math.PI*220*i/rate);
  for(const semitones of [-5,3,7,12]){
    const y=mix.pitchShift(x,rate,semitones);assert.equal(y.length,x.length);
    const f=frequency(y.subarray(2400,21600),rate),want=220*2**(semitones/12);assert.ok(Math.abs(f-want)/want<.04,`${semitones}: ${f} vs ${want}`);
    assert.ok(Math.max(...y.subarray(2400,21600))<=.6,'no clipping blow-up');
  }
  assert.equal(mix.pitchShift(x,rate,0),x);
  const stretched=mix.stretch(x,1.5,rate);assert.equal(stretched.length,Math.round(x.length*1.5));
});
test('the mix engine speaks through a derived voices file as speaker 0 and keeps one copy',async t=>{
  const model=temp(),cache=temp();t.after(()=>{fs.rmSync(model,{recursive:true,force:true});fs.rmSync(cache,{recursive:true,force:true});});
  const engine0=mix.createKokoroMix({modelDir:model,cacheDir:cache,sherpa:{}});assert.deepEqual(await engine0.available(),{ok:false,reason:'要先下載本機 Kokoro 語音模型（約 400 MB）。',install:true});
  for(const n of kokoro.REQUIRED)fs.writeFileSync(path.join(model,n),'x');fs.writeFileSync(path.join(model,'voices.bin'),fakeVoices(53));fs.writeFileSync(path.join(model,'.complete'),'r');
  const made=[];const sherpa={OfflineTts:class{constructor(c){this.voices=c.model.kokoro.voices;made.push(this);}generateAsync(r){this.request=r;const f=new Float32Array(this.voices?fs.readFileSync(this.voices).buffer:[]);return Promise.resolve({samples:new Float32Array(2400).fill(f[0]/100),sampleRate:24000});}}};
  const engine=mix.createKokoroMix({modelDir:model,cacheDir:cache,sherpa});
  const params={mix:[{voice:'zf_xiaoyi',weight:.6},{voice:'zf_xiaobei',weight:.4}],pitch:0,speed:1.2};
  const out=await engine.speak({text:'你好',profile:{params}});
  assert.equal(out.mime,'audio/wav');assert.equal(made[0].request.sid,0);assert.equal(made[0].request.speed,1.2);
  const want=.6*(48+1)+.4*(45+1);assert.ok(Math.abs(out.audio.readInt16LE(44)/32767-want/100)<1e-3,'speaker 0 holds the blend');
  await engine.speak({text:'再一次',profile:{params}});assert.equal(made.length,1,'same mix, same model instance');
  await engine.speak({text:'換一個',profile:{params:{...params,mix:[{voice:'zf_xiaoni',weight:1}]}}});assert.equal(made.length,2);
  assert.equal(fs.readdirSync(cache).length,1,'only the derived file in use is kept');
});

// --- VOICEVOX against a local stand-in engine
async function standIn(fn){
  const seen=[];const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const url=new URL(req.url,'http://x');seen.push({method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),body:body&&JSON.parse(body)});
    const json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
    if(url.pathname==='/version')return json('0.25.2');
    if(url.pathname==='/speakers')return json([{name:'ずんだもん',speaker_uuid:'388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',styles:[{name:'ノーマル',id:3,type:'talk'},{name:'ささやき',id:22,type:'talk'},{name:'歌',id:3000,type:'sing'}]}]);
    if(url.pathname==='/speaker_info')return json({policy:'# ずんだもん 利用規約\nクレジット表記：VOICEVOX:ずんだもん',portrait:'',style_infos:[]});
    if(url.pathname==='/audio_query'&&req.method==='POST')return json({accent_phrases:[],speedScale:1,pitchScale:0,intonationScale:1,outputSamplingRate:24000});
    if(url.pathname==='/synthesis'&&req.method==='POST'){res.setHeader('Content-Type','audio/wav');return res.end(Buffer.from('RIFF....WAVEfmt '));}
    res.writeHead(404);res.end();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));try{return await fn(`http://127.0.0.1:${server.address().port}`,seen);}finally{server.closeAllConnections();server.close();}
}
test('VOICEVOX client: speakers, policy with credit, query then synthesis with the profile scales',async t=>{
  const dir=temp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  await standIn(async(url,seen)=>{
    const warnings=[];const engine=voicevox.createVoicevox({dir,external:url,ownPort:1,appEngine:'/nonexistent',onWarn:w=>warnings.push(w)});
    assert.deepEqual(await engine.available(),{ok:true});
    const speakers=await engine.speakers();assert.deepEqual(speakers[0].styles,[{id:3,name:'ノーマル'},{id:22,name:'ささやき'}],'singing styles are left out');
    const params={speakerUuid:speakers[0].uuid,speakerName:'ずんだもん',styleId:3,styleName:'ノーマル',speed:1.1,pitch:.05,intonation:1.2};
    const made=await engine.profile(params);
    assert.deepEqual(made.license,{label:'VOICEVOX:ずんだもん（依角色利用規約，使用時須標示）',commercial:false,credit:'VOICEVOX:ずんだもん',tier:'rules'});
    assert.match(made.files['policy.md'].toString(),/利用規約/);assert.equal(seen.find(r=>r.path==='/speaker_info').query.resource_format,'url');
    const out=await engine.speak({text:'こんにちは、ずんだもんなのだ',profile:{params}});
    assert.equal(out.mime,'audio/wav');assert.equal(out.audio.subarray(0,4).toString(),'RIFF');
    const query=seen.find(r=>r.path==='/audio_query'),synth=seen.find(r=>r.path==='/synthesis');
    assert.deepEqual(query.query,{text:'こんにちは、ずんだもんなのだ',speaker:'3'});assert.equal(synth.query.speaker,'3');
    assert.deepEqual([synth.body.speedScale,synth.body.pitchScale,synth.body.intonationScale],[1.1,.05,1.2]);
    assert.equal(warnings.length,0);await engine.speak({text:'你好，今天天氣很好',profile:{params}});assert.match(warnings[0],/只會說日文/);
    assert.throws(()=>voicevox.validate({...params,styleId:-1}),/風格/);assert.throws(()=>voicevox.validate({...params,pitch:1}),/pitch/);
    // the whole profile path through the registry
    const root=temp();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const voices=createVoices({root,engines:[engine]});
    const saved=await voices.save({name:'ずんだもん',engine:'voicevox',params});assert.equal(saved.license.credit,'VOICEVOX:ずんだもん');assert.deepEqual(saved.files,['policy.md']);
    assert.equal((await voices.speak(saved.id,'やあ')).mime,'audio/wav');
  });
});
test('VOICEVOX: no engine offers the pinned download; the download is size- and hash-checked, unpacked and started as a child',async t=>{
  const dir=path.join(temp(),'voicevox');t.after(()=>fs.rmSync(path.dirname(dir),{recursive:true,force:true}));
  assert.equal(voicevox.VERSION,'0.25.2');assert.equal(voicevox.releaseUrl(voicevox.RELEASES.arm64.file),'https://github.com/VOICEVOX/voicevox_engine/releases/download/0.25.2/voicevox_engine-macos-arm64-0.25.2.vvpp');
  const none=voicevox.createVoicevox({dir,external:'http://127.0.0.1:1',ownPort:1,appEngine:'/nonexistent'});
  const status=await none.available();assert.equal(status.ok,false);assert.equal(status.install,true);assert.match(status.reason,/0\.25\.2/);
  await assert.rejects(none.speak({text:'やあ',profile:{params:{speakerUuid:'388f246b',speakerName:'a',styleName:'b',styleId:1}}}),/還沒有 VOICEVOX ENGINE/);
  // a stand-in .vvpp: a zip with the manifest and a "run" script that serves the stand-in API
  const src=temp();t.after(()=>fs.rmSync(src,{recursive:true,force:true}));
  fs.writeFileSync(path.join(src,'engine_manifest.json'),JSON.stringify({command:'run'}));
  fs.writeFileSync(path.join(src,'run'),`#!${process.execPath}\nconst port=+process.argv[process.argv.indexOf('--port')+1];require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end('"0.25.2"');}).listen(port,'127.0.0.1');\n`);
  const vvpp=zip([{name:'engine_manifest.json',data:fs.readFileSync(path.join(src,'engine_manifest.json'))},{name:'run',data:fs.readFileSync(path.join(src,'run'))}]);
  const release={file:'engine.vvpp',size:vvpp.length,sha256:crypto.createHash('sha256').update(vvpp).digest('hex')};
  const fetchFrom=data=>async(url,opts)=>url.startsWith('http://127.0.0.1')?fetch(url,opts):new Response(data);
  const port=40000+Math.floor(Math.random()*9000);
  const corrupt=voicevox.createVoicevox({dir,external:'http://127.0.0.1:1',ownPort:port,appEngine:'/nonexistent',arch:'arm64',releases:{arm64:release},fetchImpl:fetchFrom(Buffer.concat([vvpp.subarray(0,-1),Buffer.from('x')]))});
  await assert.rejects(corrupt.install(),/完整性/);assert.ok(!fs.existsSync(dir)&&!fs.existsSync(path.join(`${dir}.partial`,release.file)),'a corrupt download is thrown away');
  // an interrupted download resumes with a Range request instead of starting over
  const half=Math.floor(vvpp.length/2),ranges=[];
  const broken=async(url,opts)=>{if(url.startsWith('http://127.0.0.1'))return fetch(url,opts);ranges.push(opts.headers?.Range||null);
    if(ranges.length===1)return new Response(new ReadableStream({sent:false,pull(c){if(this.sent)c.error(new Error('network lost'));else{this.sent=true;c.enqueue(vvpp.subarray(0,half));}}}));
    return new Response(vvpp.subarray(half),{status:206});};
  const resuming=voicevox.createVoicevox({dir,external:'http://127.0.0.1:1',ownPort:1,appEngine:'/nonexistent',arch:'arm64',releases:{arm64:release},fetchImpl:broken});
  await assert.rejects(resuming.install(),/network lost/);assert.equal(fs.statSync(path.join(`${dir}.partial`,release.file)).size,half,'the part already downloaded is kept');
  const bytes=[];assert.equal((await resuming.install((p,b)=>bytes.push(b))).installed,true);assert.deepEqual(ranges,[null,`bytes=${half}-`]);
  assert.equal(bytes[0].done,half,'progress starts from the resumed part');assert.equal(bytes.at(-1).total,vvpp.length);
  fs.rmSync(dir,{recursive:true,force:true});
  const engine=voicevox.createVoicevox({dir,external:'http://127.0.0.1:1',ownPort:port,appEngine:'/nonexistent',arch:'arm64',releases:{arm64:release},fetchImpl:fetchFrom(vvpp)});
  const progress=[];const after=await engine.install(p=>progress.push(p));
  assert.equal(after.installed,true);assert.equal(progress.at(-1),1);assert.ok(!fs.existsSync(path.join(dir,release.file)),'the archive is removed after unpacking');
  // NVIDIA builds come in two parts that join into one zip; each part is checked on its own
  fs.rmSync(dir,{recursive:true,force:true});const cut=Math.floor(vvpp.length/3),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
  const parts={file:'engine.vvpp',size:vvpp.length,args:['--use_gpu'],parts:[{file:'e.001.vvppp',size:cut,sha256:sha(vvpp.subarray(0,cut))},{file:'e.002.vvppp',size:vvpp.length-cut,sha256:sha(vvpp.subarray(cut))}]};
  const asked=[];const joined=voicevox.createVoicevox({dir,external:'http://127.0.0.1:1',ownPort:1,appEngine:'/nonexistent',arch:'arm64',releases:{arm64:parts},fetchImpl:async url=>{if(!url.endsWith('vvppp'))throw new Error('offline');asked.push(path.basename(url));return new Response(url.endsWith('001.vvppp')?vvpp.subarray(0,cut):vvpp.subarray(cut));}});
  assert.equal((await joined.install()).installed,true);assert.deepEqual(asked,['e.001.vvppp','e.002.vvppp']);assert.ok(fs.existsSync(path.join(dir,'.gpu')),'the GPU build starts with --use_gpu');
  fs.rmSync(dir,{recursive:true,force:true});await engine.install();
  if(process.platform==='win32')return;  // the stand-in engine is a script with a shebang
  t.after(()=>engine.stop());
  await engine.start();assert.ok(engine.child,'started as our child');assert.equal(engine.base,`http://127.0.0.1:${port}`);
  const child=engine.child;engine.stop();await new Promise(r=>child.exitCode!==null||child.signalCode?r():child.once('exit',r));assert.equal(engine.child,null);
});
