const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');
const audio=require('../voice-audio.cjs');const {speechLike,speechWav}=require('./fixtures/voice/make-audio.cjs');
const {createSidecar}=require('../voice-engines/sidecar.cjs');const cosyvoice=require('../voice-engines/cosyvoice.cjs');
const {createJobs}=require('../voice-engines/jobs.cjs');const lab=require('../voice-lab.cjs');
const {createVoices}=require('../voices.cjs');
const STANDIN=path.join(__dirname,'fixtures','voice','standin-sidecar.cjs');
const tmp=prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix));
const standin={command:process.execPath,args:[STANDIN]};
const wait=async(fn,timeout=5000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('timed out');await new Promise(r=>setTimeout(r,20));}};

// --- audio checks on generated PCM
test('a clear 10 s reading passes the quality check, and WAV round-trips',()=>{
  const samples=speechLike(10),a=audio.analyze(samples,24000);
  assert.ok(Math.abs(a.duration-10)<.01);assert.ok(a.speechSeconds>6&&a.speechSeconds<=10,`speech ${a.speechSeconds}`);assert.ok(a.speechDb>-28,`level ${a.speechDb}`);
  assert.deepEqual(audio.qualityCheck(a,'cosyvoice'),{ok:true,issues:[]});
  const back=audio.parseWav(audio.encodeWav(samples,24000));assert.equal(back.sampleRate,24000);assert.equal(back.samples.length,samples.length);
  assert.ok(Math.abs(back.samples[1234]-samples[1234])<1e-4);
});
test('the quality check catches silence, too quiet, clipping and too short',()=>{
  const codes=(samples,engine='cosyvoice')=>audio.qualityCheck(audio.analyze(samples,24000),engine).issues.map(i=>i.code);
  assert.deepEqual(codes(new Float32Array(24000*5)),['silent']);
  const quiet=speechLike(10,{level:.02});assert.ok(codes(quiet).includes('too-quiet'),codes(quiet).join());
  const clipped=speechLike(10).map(v=>Math.max(-1,Math.min(1,v*8)));assert.ok(codes(clipped).includes('clipping'));
  const short=speechLike(1.5);assert.ok(codes(short).includes('too-short'));assert.equal(audio.qualityCheck(audio.analyze(short,24000)).ok,false);
  assert.ok(codes(speechLike(40)).includes('too-long'),'over 30 s is too long for a reference clip');
  assert.ok(codes(speechLike(8),'elevenlabs').includes('too-short'),'ElevenLabs wants at least 10 s');
  assert.equal(audio.qualityCheck(audio.analyze(speechLike(25),24000),'cosyvoice').ok,true,'long-ish is only a warning');
});
test('stereo 32-bit float and 8-bit WAVs are read as mono',()=>{
  const n=480,f=Buffer.alloc(44+n*8);f.write('RIFF',0);f.writeUInt32LE(36+n*8,4);f.write('WAVE',8);f.write('fmt ',12);f.writeUInt32LE(16,16);f.writeUInt16LE(3,20);f.writeUInt16LE(2,22);f.writeUInt32LE(48000,24);f.writeUInt32LE(48000*8,28);f.writeUInt16LE(8,32);f.writeUInt16LE(32,34);f.write('data',36);f.writeUInt32LE(n*8,40);
  for(let i=0;i<n;i++){f.writeFloatLE(.5,44+i*8);f.writeFloatLE(-.1,48+i*8);}
  const w=audio.parseWav(f);assert.equal(w.channels,2);assert.ok(Math.abs(w.samples[10]-.2)<1e-6);
  assert.throws(()=>audio.parseWav(Buffer.from('not a wav at all, definitely not, long enough string')),/WAV/);
});
test('trimming, length limit, resampling and slicing at pauses',()=>{
  const padded=new Float32Array(24000*6);padded.set(speechLike(3),24000*2);
  const trimmed=audio.trimSilence(padded,24000);assert.ok(trimmed.length/24000<3.6&&trimmed.length/24000>2.8,`${trimmed.length/24000}`);
  assert.ok(audio.limitLength(speechLike(30),24000,15).length<=15*24000);
  assert.equal(audio.resample(speechLike(1),24000,16000).length,16000);
  const pieces=audio.sliceOnSilence(speechLike(60),24000,{min:3,max:10});
  assert.ok(pieces.length>=6,`${pieces.length} pieces`);assert.ok(pieces.every(p=>p.length/24000<=10.5),'no piece over ~10 s');
});
test('imported audio is converted with afconvert to 24 kHz mono',{skip:process.platform!=='darwin'},async()=>{
  const dir=tmp('voice-conv-'),src=path.join(dir,'in.wav'),out=path.join(dir,'out.wav');
  fs.writeFileSync(src,audio.encodeWav(speechLike(3,{rate:44100}),44100));
  await audio.convertToWav(src,out);const w=audio.parseWav(fs.readFileSync(out));assert.equal(w.sampleRate,24000);assert.equal(w.channels,1);assert.ok(Math.abs(w.samples.length/24000-3)<.05);
  fs.writeFileSync(path.join(dir,'bad.mp3'),'nope');await assert.rejects(audio.convertToWav(path.join(dir,'bad.mp3'),path.join(dir,'x.wav')),/轉不了/);
  fs.rmSync(dir,{recursive:true,force:true});
});

// --- consent
test('no name or no tick means no consent; consent records who and when',()=>{
  for(const bad of [null,{},{person:'  ',agreed:true},{person:'小明'},{person:'小明',agreed:'yes'}])assert.throws(()=>lab.requireConsent(bad),e=>e.code==='CONSENT_REQUIRED');
  const c=lab.requireConsent({person:' 小明\n',agreed:true},()=>new Date('2026-10-05T00:00:00Z'));
  assert.equal(c.person,'小明');assert.equal(c.at,'2026-10-05T00:00:00.000Z');assert.match(c.note,/同意/);
});
test('a phone recording without consent is refused before anything is written or uploaded',async()=>{
  const root=tmp('voice-root-'),temp=tmp('voice-temp-');let uploads=0,speaks=0;
  const engines={cosyvoice:{...cosyvoice.create({dir:tmp('cv-'),sidecar:standin}),prepare:()=>{speaks++;}},elevenlabs:{clone:async()=>{uploads++;}}};
  const studio=lab.createStudio({getVoices:()=>createVoices({root}),voicesRoot:root,engines,getElevenKey:()=>'k',bindVoice:()=>{},tempBase:temp});
  const wav=speechWav(10).toString('base64');
  for(const consent of [undefined,{person:'小明',agreed:false},{person:'',agreed:true}])
    for(const engine of ['cosyvoice','elevenlabs'])await assert.rejects(studio.fromPhone({wav,engine,name:'x',consent}),e=>e.code==='CONSENT_REQUIRED');
  assert.equal(uploads+speaks,0);assert.deepEqual(fs.readdirSync(root),[]);assert.deepEqual(fs.readdirSync(temp),[]);
});
test('a phone recording with consent becomes a personal CosyVoice profile; raw audio never touches the disk',async()=>{
  const root=tmp('voice-root-'),temp=tmp('voice-temp-'),voices=createVoices({root}),bound=[];
  const engines={cosyvoice:cosyvoice.create({dir:tmp('cv-'),sidecar:standin})};voices.registerEngine(engines.cosyvoice);
  const studio=lab.createStudio({getVoices:()=>voices,voicesRoot:root,engines,bindVoice:(mod,id)=>bound.push([mod,id]),currentMod:()=>({id:'annie',name:'Annie'}),tempBase:temp});
  const quiet=await studio.fromPhone({wav:speechWav(10,{level:.02}).toString('base64'),engine:'cosyvoice',name:'小明',consent:{person:'小明',agreed:true}});
  assert.equal(quiet.ok,false);assert.ok(quiet.quality.issues.some(i=>i.code==='too-quiet'));
  const result=await studio.fromPhone({wav:speechWav(12).toString('base64'),engine:'cosyvoice',name:'小明',transcript:'今天天氣真好',consent:{person:'小明',agreed:true},bind:true});
  assert.equal(result.ok,true);const p=result.profile;
  assert.match(p.id,/^v-voice-[0-9a-f]{6}$|^v-[a-z0-9-]+-[0-9a-f]{6}$/);assert.equal(p.license.tier,'personal');assert.equal(p.consent.person,'小明');assert.equal(p.modId,null);
  assert.deepEqual(fs.readdirSync(path.join(root,p.id)).sort(),['reference.txt','reference.wav','voice.json']);
  assert.ok(audio.parseWav(fs.readFileSync(path.join(root,p.id,'reference.wav'))).samples.length/24000<=15.01,'reference clip is at most ~15 s');
  assert.deepEqual(bound,[['annie',p.id]]);assert.deepEqual(fs.readdirSync(temp),[],'temp folder removed');
  const spoken=await voices.speak(p.id,'Hello there');assert.equal(spoken.mime,'audio/wav');assert.ok(audio.parseWav(spoken.audio).samples.length>0);
  assert.throws(()=>voices.exportPack(p.id),/不能匯出/);
  engines.cosyvoice.stop({now:true});
});
test('the studio temp folder is private (700) and is swept',()=>{
  const base=tmp('voice-sweep-'),t=lab.tempFolder(base);if(process.platform!=='win32')assert.equal(fs.statSync(t.dir).mode&0o777,0o700);
  fs.writeFileSync(t.file('take.wav'),'x');
  // a crashed run's folder (its pid is gone) and an old unnamed one are swept; another running copy's folder and our own stay
  const dead=path.join(base,'agent-wardrobe-voicelab-999999-abc'),old=path.join(base,'agent-wardrobe-voicelab-xyz'),other=path.join(base,`agent-wardrobe-voicelab-${process.ppid}-def`);
  for(const d of [dead,old,other])fs.mkdirSync(d);
  lab.sweepTemp(base);assert.deepEqual([dead,old,other,t.dir].map(d=>fs.existsSync(d)),[false,false,true,true]);
  t.remove();assert.equal(fs.existsSync(t.dir),false);
});

// --- the sidecar protocol against a stand-in process
test('sidecar: starts on demand, ignores library logging, reports progress, answers in order',async()=>{
  const out=tmp('sc-'),side=createSidecar({...standin,name:'Stand-in',idleMs:0});
  assert.equal(side.running,false);const progress=[];
  const r=await side.request('speak',{text:'hello',out:path.join(out,'a.wav')},{onProgress:p=>progress.push(p)});
  assert.equal(r.ok,true);assert.deepEqual(progress,[1]);assert.equal(side.info.device,'standin');assert.ok(fs.existsSync(path.join(out,'a.wav')));
  const [a,b]=await Promise.all([side.request('ping'),side.request('speak',{text:'x',out:path.join(out,'b.wav')})]);assert.ok(a.ok&&b.ok);
  await assert.rejects(side.request('speak',{text:'x',ref:'/nonexistent.wav',out:path.join(out,'c.wav')}),/reference missing/);
  side.stop();await wait(()=>!side.running);
});
test('sidecar: cancel rejects at once and the process keeps serving; a fatal start is reported; it restarts after exit',async()=>{
  const out=tmp('sc-'),side=createSidecar({...standin,name:'Stand-in',idleMs:0}),controller=new AbortController();
  const slow=side.request('speak',{text:'[slow] long',out:path.join(out,'s.wav')},{signal:controller.signal});
  setTimeout(()=>controller.abort(),100);const started=Date.now();
  await assert.rejects(slow,e=>e.name==='AbortError');assert.ok(Date.now()-started<2000);
  const pid=side.pid;process.kill(pid,'SIGKILL');await wait(()=>!side.running);
  assert.equal((await side.request('ping')).ok,true,'a new process is started');assert.notEqual(side.pid,pid);side.stop();
  const broken=createSidecar({...standin,env:{VOICE_STANDIN_FAIL:'start'},name:'Stand-in'});
  await assert.rejects(broken.request('ping'),/無法啟動：stand-in refused/);
});
test('sidecar: stops by itself after a quiet spell',async()=>{
  const side=createSidecar({...standin,idleMs:150});await side.request('ping');assert.equal(side.running,true);await wait(()=>!side.running,3000);
});
test('cosyvoice engine: prepares the reference, picks zero-shot or cross-lingual, speaks through the sidecar',async()=>{
  const log=path.join(tmp('cvlog-'),'log.jsonl'),dir=tmp('cvprof-');
  const engine=cosyvoice.create({dir:tmp('cv-'),sidecar:{...standin,env:{VOICE_STANDIN_LOG:log}}});
  const prepared=engine.prepare({wav:speechWav(10),refText:'今天天氣真好',dir});
  assert.deepEqual(prepared.files,['reference.wav','reference.txt']);assert.equal(prepared.params.lang,'zh');assert.equal(prepared.params.model,'CosyVoice2-0.5B');
  const profile={engine:'cosyvoice',params:prepared.params};
  assert.equal((await engine.speak({text:'你好呀',profile,dir})).mime,'audio/wav');assert.equal(prepared.params.refText,'今天天氣真好','the profile keeps what was said');
  await engine.speak({text:'Hello, nice to meet you',profile,dir});
  await engine.speak({text:'こんにちは',profile:{params:{...prepared.params,refText:''}},dir});
  const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(c=>c.op==='speak');
  assert.deepEqual(calls.map(c=>c.mode),['zero_shot','cross_lingual','cross_lingual']);assert.equal(calls[0].refText,'今天天气真好','Traditional Chinese reaches the model as Simplified');assert.equal(calls[0].text,'你好呀');
  assert.ok(calls.every(c=>!fs.existsSync(c.out)),'temporary output files are removed');
  // fast synthesis by default (4 flow steps); 'best' quality asks for the full 10
  assert.deepEqual(calls.map(c=>c.steps),[4,4,4]);assert.equal(cosyvoice.validate({}).quality,'fast');assert.equal(cosyvoice.validate({quality:'best'}).quality,'best');assert.equal(cosyvoice.validate({quality:'x'}).quality,'fast');
  await engine.speak({text:'你好',profile:{params:{...prepared.params,quality:'best'}},dir});
  assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(c=>c.op==='speak').at(-1).steps,10);
  await assert.rejects(engine.speak({text:'hi',profile,dir:tmp('empty-')}),/參考錄音不見了/);
  assert.equal(cosyvoice.validate({model:'evil',speed:9,refText:'a\nb'}).model,'CosyVoice2-0.5B');assert.equal(cosyvoice.validate({speed:9}).speed,1.4);
  engine.stop({now:true});
});
test('cosyvoice reports how big the install is when it is missing',async()=>{
  const status=await cosyvoice.create({dir:tmp('cv-')}).available();
  if(process.platform==='darwin'){assert.equal(status.ok,false);assert.equal(status.install,true);assert.match(status.reason,/GB/);}
});

// --- job progress and cancel
test('jobs: weighted stages, progress, an estimate that follows the pace, and done',async()=>{
  let clock=0;const events=[];const jobs=createJobs({onChange:j=>events.push(j),now:()=>clock});
  let release;const gate=new Promise(r=>{release=r;});
  const job=jobs.start({kind:'t',title:'Test',estimate:100,stages:[{id:'a',label:'A',weight:1},{id:'b',label:'B',weight:3}],
    run:async ctx=>{ctx.stage('a');ctx.progress(.5);await gate;ctx.stage('b');ctx.progress(.5,'half');return {ready:true};}});
  assert.equal(job.state,'running');await wait(()=>events.some(e=>e.progress===.125));
  clock=10000;assert.equal(jobs.get(job.id).stage,'a');assert.ok(jobs.get(job.id).eta>0);
  assert.throws(()=>jobs.start({kind:'t',title:'again',stages:[{id:'a'}],run:async()=>{}}),/已經有一個/);
  release();await jobs.wait(job.id);const done=jobs.get(job.id);
  assert.equal(done.state,'done');assert.equal(done.progress,1);assert.deepEqual(done.result,{ready:true});
  assert.ok(events.some(e=>e.stage==='b'&&Math.abs(e.progress-.625)<1e-9&&e.detail==='half'));
});
test('jobs: cancel aborts the run and ends as cancelled; a failure ends as error',async()=>{
  const jobs=createJobs();let aborted=false;
  const job=jobs.start({kind:'x',title:'X',stages:[{id:'a'}],run:ctx=>new Promise((_,reject)=>{const stop=()=>{aborted=true;reject(Object.assign(new Error('stop'),{name:'AbortError'}));};if(ctx.signal.aborted)stop();else ctx.signal.addEventListener('abort',stop);})});
  assert.equal(jobs.cancel(job.id),true);await jobs.wait(job.id);assert.equal(jobs.get(job.id).state,'cancelled');assert.equal(aborted,true);
  assert.equal(jobs.cancel(job.id),false,'only a running job can be cancelled');
  const bad=jobs.start({kind:'x',title:'Y',stages:[{id:'a'}],run:async()=>{throw new Error('boom');}});await jobs.wait(bad.id);
  assert.deepEqual([jobs.get(bad.id).state,jobs.get(bad.id).error],['error','boom']);
});
