const {ROOT}=require('./root.cjs');
// 聲音工作室 (voice studio): make a voice from recordings of a real person (with their consent), design one with AI,
// or import a community GPT-SoVITS pack — then save it as a voice profile through the voices registry (voices.cjs).
// Rules kept here, not only in the page:
//  - no consent (a name and the tick) → no recording upload and no cloning, on the Mac and from the phone
//  - cloned voices are 'personal': they stay in userData/voices/<id> on this Mac; nothing is written anywhere else
//  - raw recordings live in one private temp folder (mode 700) that is deleted when the voice is saved or the window
//    closes; only the reference clip the engine needs is kept with the profile
//  - the microphone only runs while the user holds a recording going, and only in this window (its own session)
const L=require('./locales.cjs');const {t}=L;
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const audio=require('./voice-audio.cjs');const {createJobs}=require('../../voice-engines/jobs.cjs');

const SAMPLE_RATE=24000;
// Reading prompts: about 10 seconds each for quick cloning; a longer script for training. They are what people read aloud
// in each language (content for the recording, not interface text), so they stay here as data.
const PROMPTS={
  short:{
    zh:['今天天氣真好，我們一起出去走走吧！順便買杯咖啡，再到公園曬曬太陽，聽聽鳥叫聲。','謝謝你一直陪著我。不管遇到什麼困難，只要想到你，我就覺得自己又有力氣繼續往前走了。','欸，你知道嗎？我剛剛發現一間很可愛的小店，裡面賣的甜點每一樣看起來都好好吃喔。'],
    ja:['今日はいい天気だね！一緒に散歩に行こうよ。カフェでコーヒーを飲んで、公園でのんびりしよう。','いつもそばにいてくれてありがとう。あなたのことを思うと、また頑張ろうって気持ちになれるんだ。'],
    en:['What a lovely day! Let us go for a walk, grab a coffee on the way, and sit in the park for a while.','Thank you for always being there for me. Whenever things get hard, thinking of you gives me the strength to keep going.']
  },
  long:{
    zh:['早安！今天也要元氣滿滿喔。我先幫你看看行程：上午有兩個會議，下午可以專心寫程式。','中午記得吃飯，不要又一直盯著螢幕。喝點水，伸個懶腰，眼睛也休息一下吧。','哇，這個問題好難喔……不過沒關係，我們一步一步來，先把錯誤訊息仔細讀一遍。','成功了！你看，我就說你做得到嘛。今天辛苦了，要不要聽首歌放鬆一下？',
      '如果覺得累了，就早點休息吧。明天又是新的一天，我會在這裡等你回來。','一、二、三、四、五、六、七、八、九、十。春天的花，夏天的海，秋天的月亮，冬天的雪。','真的假的？太好笑了吧！哈哈哈，我笑到肚子好痛。','嗯……讓我想想。這樣好了，我們先做最重要的那一件，其他的晚一點再說。'],
    ja:['おはよう！今日も一日がんばろうね。午前中は会議が二つ、午後はゆっくりプログラムが書けるよ。','お昼ごはん、ちゃんと食べてね。画面ばっかり見てないで、少し休憩しよう。','えっ、本当に？すごいじゃん！やっぱりあなたならできると思ってたよ。','疲れたら早めに寝てね。明日も、ここで待ってるから。'],
    en:['Good morning! Let us make today a great one. You have two meetings this morning, then a quiet afternoon for coding.','Do not forget to eat lunch, and please take a break from the screen. Stretch a little and drink some water.','Wow, that is a tricky one. But do not worry, we will take it one step at a time.','You did it! I knew you could. Get some rest tonight, and I will be right here tomorrow.']
  }
};
const METHODS={
  quick:{engine:'cosyvoice',needsConsent:true,record:true,prompts:'short'},
  train:{engine:'sovits',needsConsent:true,record:true,prompts:'long'},
  cloud:{engine:'elevenlabs',needsConsent:true,record:true,prompts:'long'},
  design:{engine:'elevenlabs',needsConsent:false,record:false},
  pack:{engine:'sovits',needsConsent:false,record:false}
};

// Consent: the person's name and an explicit yes. Returns what is stored in profile.consent.
function requireConsent(consent,now=()=>new Date()){
  const person=String(consent?.person||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,60);
  if(!person)throw L.error('voiceLab.error.consentPerson',null,{code:'CONSENT_REQUIRED'});
  if(consent?.agreed!==true)throw L.error('voiceLab.error.consentAgreed',null,{code:'CONSENT_REQUIRED'});
  return {person,at:now().toISOString(),note:String(consent.note||t('voiceLab.consent.note')).slice(0,200)};
}
const slug=name=>String(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,20)||'voice';
const profileId=name=>`v-${slug(name)}-${crypto.randomBytes(3).toString('hex')}`;
function personalLicense(engineLabel,consent){return {label:t('voiceLab.license.personal',{engine:engineLabel}),commercial:false,credit:consent?t('voiceLab.license.credit',{person:consent.person}):'',tier:'personal'};}
const cloudLicense=consent=>({...personalLicense('ElevenLabs',consent),label:t('voiceLab.license.cloud')});
function buildProfile({id,name,engine,params,files,license,consent=null}){
  return {id,name:String(name).replace(/[\x00-\x1f]/g,' ').trim().slice(0,40)||t('voiceLab.finish.fallbackName'),engine,params,files,license,consent,modId:null,createdAt:new Date().toISOString()};
}

// A private temp folder for raw audio: mode 700, removed with remove(). Its name carries this process's pid, so a crash's
// leftovers can be removed at start without touching a folder another running copy of the app is still using.
function tempFolder(base=os.tmpdir()){
  const dir=fs.mkdtempSync(path.join(base,`agent-wardrobe-voicelab-${process.pid}-`));fs.chmodSync(dir,0o700);
  return {dir,file:name=>path.join(dir,name),remove:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
function sweepTemp(base=os.tmpdir()){for(const name of fs.readdirSync(base)){const m=name.match(/^agent-wardrobe-voicelab-(?:(\d+)-)?/);if(!m)continue;const pid=Number(m[1]);if(pid&&pid!==process.pid&&alive(pid))continue;if(pid===process.pid)continue;fs.rmSync(path.join(base,name),{recursive:true,force:true});}}

// Turns one take (mono samples) into the reference clip CosyVoice wants: silence trimmed, at most ~15 s, 24 kHz.
function referenceClip(samples,sampleRate,seconds=15){
  const trimmed=audio.trimSilence(audio.resample(samples,sampleRate,SAMPLE_RATE),SAMPLE_RATE);
  return audio.encodeWav(audio.limitLength(trimmed,SAMPLE_RATE,seconds),SAMPLE_RATE);
}
function moveFolder(from,to){fs.mkdirSync(path.dirname(to),{recursive:true});try{fs.renameSync(from,to);}catch{fs.cpSync(from,to,{recursive:true});fs.rmSync(from,{recursive:true,force:true});}}

// The parts of the studio that do not need a window: used by the window's IPC and by the phone's route.
function createStudio({getVoices,voicesRoot,engines,getElevenKey,setElevenKey,bindVoice,currentMod=()=>null,onJob=()=>{},tempBase=os.tmpdir()}){
  const jobs=createJobs({onChange:onJob});
  const voicesDir=id=>{const v=getVoices();return v?.dir?.(id)||path.join(voicesRoot,id);};
  async function save({draftDir,profile,bind}){
    const voices=getVoices();if(!voices)throw L.error('voiceLab.error.noVoices');
    const target=voicesDir(profile.id);if(!path.resolve(target).startsWith(path.resolve(voicesRoot)+path.sep)&&!voices.dir)throw new Error('Unsafe voice folder');
    if(draftDir)moveFolder(draftDir,target);
    try{await voices.save(profile);}catch(error){fs.rmSync(target,{recursive:true,force:true});throw error;}
    let bound=null;if(bind){const mod=currentMod();if(mod){bindVoice(mod.id,profile.id);bound=mod;}}
    return {profile:voices.get?.(profile.id)||profile,bound:bound&&{id:bound.id,name:bound.name}};
  }
  // From the phone: one recording + consent → a CosyVoice or ElevenLabs voice. The raw audio is never written to disk.
  async function fromPhone({wav,engine,name,transcript,lang,consent,bind}){
    const agreed=requireConsent(consent);
    if(!['cosyvoice','elevenlabs'].includes(engine))throw L.error('voiceLab.error.phoneEngine');
    let parsed;try{parsed=audio.parseWav(Buffer.from(String(wav||''),'base64'));}catch{throw L.error('voiceLab.error.phoneNoRecording');}
    const quality=audio.qualityCheck(audio.analyze(parsed.samples,parsed.sampleRate),engine);
    if(!quality.ok)return {ok:false,quality};
    const id=profileId(name);
    if(engine==='cosyvoice'){
      const status=await engines.cosyvoice.available();if(!status.ok)throw L.error('voiceLab.error.phoneInstall',{reason:status.reason});
      const draft=tempFolder(tempBase);
      try{
        const prepared=engines.cosyvoice.prepare({wav:referenceClip(parsed.samples,parsed.sampleRate),refText:transcript,lang,dir:draft.file('profile')});
        const profile=buildProfile({id,name,engine:'cosyvoice',params:prepared.params,files:prepared.files,license:personalLicense('CosyVoice',agreed),consent:agreed});
        return {ok:true,quality,...await save({draftDir:draft.file('profile'),profile,bind})};
      }finally{draft.remove();}
    }
    if(!getElevenKey())throw L.error('voiceLab.error.phoneNoKey');
    const wavData=audio.encodeWav(audio.trimSilence(parsed.samples,parsed.sampleRate),parsed.sampleRate);
    const {voiceId}=await engines.elevenlabs.clone({name:String(name).slice(0,60),files:[{name:'sample.wav',data:wavData}],description:`Cloned with consent of ${agreed.person}`});
    const profile=buildProfile({id,name,engine:'elevenlabs',params:engines.elevenlabs.validate({voiceId,source:'clone'}),files:[],license:cloudLicense(agreed),consent:agreed});
    return {ok:true,quality,...await save({profile,bind})};
  }
  return {jobs,save,fromPhone,voicesDir};
}

// The studio window. main.cjs passes Electron pieces and the shared studio.
function createVoiceLab({BrowserWindow,session,ipcMain,dialog,systemPreferences,studio,engines,getVoices,getElevenKey,setElevenKey,clearElevenKey,currentMod,language=()=>'zh-TW',root=ROOT,tempBase=os.tmpdir(),fakeMic=false}){
  let win=null,draft=null,decodeId=0;const decoding=new Map();
  // Imported audio → 16-bit mono WAV at `rate`: afconvert on macOS; on Windows and Linux the studio page decodes it with WebAudio.
  function convert(input,output,{rate=SAMPLE_RATE}={}){
    if(process.platform==='darwin')return audio.convertToWav(input,output,{rate});
    if(!win||win.isDestroyed())return Promise.reject(L.error('voiceLab.error.reopen'));
    const id=++decodeId,data=fs.readFileSync(input);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{decoding.delete(id);reject(L.error('voiceLab.error.decodeTimeout'));},120000);
      decoding.set(id,result=>{clearTimeout(timer);if(result?.error||!(result?.samples instanceof Float32Array))return reject(L.error('voiceLab.error.convert',{detail:String(result?.error||t('voiceLab.error.undecodable')).slice(0,120)}));
        fs.writeFileSync(output,audio.encodeWav(result.samples,rate),{mode:0o600});resolve(output);});
      win.webContents.send('voicelab:decode',{id,rate,data:new Uint8Array(data.buffer,data.byteOffset,data.byteLength)});});
  }
  const send=(channel,value)=>{if(win&&!win.isDestroyed())win.webContents.send(channel,value);};
  const newDraft=()=>{draft?.temp.remove();draft={temp:tempFolder(tempBase),method:null,consent:null,takes:new Map(),ready:null,designs:null};return draft;};
  const requireDraft=()=>{if(!draft)throw L.error('voiceLab.error.reopen');return draft;};
  const method=()=>METHODS[requireDraft().method]||null;
  const trainingRunning=()=>Boolean(draft?.jobId&&studio.jobs.get(draft.jobId)?.state==='running');
  async function engineStatus(){
    const out={};for(const [id,engine] of Object.entries(engines))out[id]={...await engine.available().catch(error=>({ok:false,reason:error.message})),label:engine.label,license:engine.license};
    out.elevenlabs.hasKey=Boolean(getElevenKey());return out;
  }
  const take=id=>{const found=requireDraft().takes.get(id);if(!found)throw L.error('voiceLab.error.noTake');return found;};
  const describe=t=>({id:t.id,name:t.name,text:t.text,duration:+t.analysis.duration.toFixed(2),analysis:t.analysis,quality:t.quality});
  async function addTake({bytes,name=t('voiceLab.take.default'),text='',kind='mic'}){
    const d=requireDraft(),m=method();if(!m?.record)throw L.error('voiceLab.error.noRecording');
    if(m.needsConsent&&!d.consent)throw L.error('voiceLab.error.consentFirst',null,{code:'CONSENT_REQUIRED'});
    const data=Buffer.from(bytes);if(!data.length||data.length>200e6)throw L.error('voiceLab.error.takeSize');
    const id=crypto.randomBytes(6).toString('hex'),wavFile=d.temp.file(`take-${id}.wav`);
    if(kind==='file'){const ext=(path.extname(String(name)).toLowerCase().match(/^\.(wav|mp3|m4a|aac|aiff?|caf|flac)$/)||[])[0];if(!ext)throw L.error('voiceLab.error.importType');
      const raw=d.temp.file(`import-${id}${ext}`);fs.writeFileSync(raw,data,{mode:0o600});
      try{await convert(raw,wavFile,{rate:SAMPLE_RATE});}finally{fs.rmSync(raw,{force:true});}}
    else fs.writeFileSync(wavFile,data,{mode:0o600});
    const {samples,sampleRate}=audio.parseWav(fs.readFileSync(wavFile));const analysis=audio.analyze(samples,sampleRate);
    const made={id,name:String(name).slice(0,80),text:String(text).slice(0,500),file:wavFile,analysis,quality:audio.qualityCheck(analysis,m.engine)};d.takes.set(id,made);
    return {...describe(made),wav:kind==='file'?fs.readFileSync(wavFile):null};
  }
  // Builds the voice from the takes (or the design / pack) into draft/profile; the page then previews and saves it.
  async function create(options={}){
    const d=requireDraft(),m=method();if(!m)throw L.error('voiceLab.error.pickMethod');
    if(m.needsConsent&&!d.consent)throw L.error('voiceLab.error.noConsent',null,{code:'CONSENT_REQUIRED'});
    const takes=(options.takeIds||[...d.takes.keys()]).map(take);
    if(m.record&&!takes.length)throw L.error('voiceLab.error.recordFirst');
    const bad=takes.find(x=>!x.quality.ok);if(bad){const issue=bad.quality.issues.find(i=>i.level==='error');throw L.error('voiceLab.error.badTake',{name:bad.name,issue:t(issue.key,issue.vars)});}
    const profileDir=d.temp.file('profile');fs.rmSync(profileDir,{recursive:true,force:true});
    if(d.method==='quick'){
      const status=await engines.cosyvoice.available();if(!status.ok)throw new Error(status.reason);
      const best=takes.length===1?takes[0]:[...takes].sort((a,b)=>Math.abs(a.analysis.speechSeconds-10)-Math.abs(b.analysis.speechSeconds-10))[0];
      const {samples,sampleRate}=audio.parseWav(fs.readFileSync(best.file));
      const prepared=engines.cosyvoice.prepare({wav:referenceClip(samples,sampleRate),refText:options.refText??best.text,lang:options.lang,model:options.model,dir:profileDir});
      d.ready={engine:'cosyvoice',params:prepared.params,files:prepared.files,license:personalLicense('CosyVoice',d.consent),consent:d.consent,dir:profileDir};
      return {ready:true,keepsKey:'voiceLab.keeps.reference',keeps:t('voiceLab.keeps.reference')};
    }
    if(d.method==='cloud'){
      if(!getElevenKey())throw L.error('voiceLab.error.elevenKeyFirst');
      const total=takes.reduce((a,x)=>a+x.analysis.speechSeconds,0);if(total<10)throw L.error('voiceLab.error.elevenTooShort');
      const files=takes.map((t,i)=>{const {samples,sampleRate}=audio.parseWav(fs.readFileSync(t.file));return {name:`sample-${i+1}.wav`,data:audio.encodeWav(audio.trimSilence(samples,sampleRate),sampleRate)};});
      const {voiceId,requiresVerification}=await engines.elevenlabs.clone({name:String(options.name||d.consent.person).slice(0,60),files,description:`Cloned with consent of ${d.consent.person}`,removeNoise:options.removeNoise===true});
      fs.mkdirSync(profileDir,{recursive:true});
      d.ready={engine:'elevenlabs',params:engines.elevenlabs.validate({voiceId,source:'clone',model:options.model}),files:[],license:cloudLicense(d.consent),consent:d.consent,dir:profileDir,cloudVoiceId:voiceId};
      return {ready:true,keepsKey:'voiceLab.keeps.cloud',keeps:t('voiceLab.keeps.cloud'),requiresVerification};
    }
    if(d.method==='train'){
      const status=await engines.sovits.available();if(!status.ok)throw new Error(status.reason);
      const minutes=takes.reduce((a,x)=>a+x.analysis.speechSeconds,0)/60;if(minutes<1)throw L.error('voiceLab.error.trainTooShort',{seconds:Math.round(minutes*60)});
      const lang=['zh','ja','en'].includes(options.lang)?options.lang:'zh',consent=d.consent,work=d.temp.file('train');fs.mkdirSync(work,{recursive:true,mode:0o700});
      const titleVars={name:options.name||consent.person};
      const job=studio.jobs.start({kind:'sovits-train',title:t('voiceLab.job.trainTitle',titleVars),titleKey:'voiceLab.job.trainTitle',titleVars,stages:engines.sovits.STAGES,estimate:engines.sovits.estimateTraining(minutes),
        run:async ctx=>{const result=await engines.sovits.train({takes:takes.map(x=>({file:x.file,text:x.text})),workDir:work,outDir:profileDir,lang},ctx);
          fs.rmSync(work,{recursive:true,force:true});  // slices and features go as soon as training ends
          if(draft===d)d.ready={engine:'sovits',params:result.params,files:result.files,license:personalLicense('GPT-SoVITS',consent),consent,dir:profileDir};return {ready:true};}});
      d.jobId=job.id;return {job};
    }
    throw L.error('voiceLab.error.notRecorded');
  }
  async function design({prompt}){
    const d=requireDraft();if(d.method!=='design')throw L.error('voiceLab.error.pickDesign');
    if(!getElevenKey())throw L.error('voiceLab.error.elevenKeyFirst');
    const result=await engines.elevenlabs.design({prompt});d.designs={description:result.description,ids:result.previews.map(p=>p.generatedVoiceId)};
    return {previews:result.previews.map(p=>({id:p.generatedVoiceId,audio:p.audio,mime:p.mime})),text:result.text};
  }
  async function designPick({id,name}){
    const d=requireDraft();if(!d.designs?.ids.includes(id))throw L.error('voiceLab.error.noDesign');
    const {voiceId}=await engines.elevenlabs.saveDesign({generatedVoiceId:id,name:String(name||t('voiceLab.design.defaultName')).slice(0,60),description:d.designs.description});
    const profileDir=d.temp.file('profile');fs.mkdirSync(profileDir,{recursive:true});
    d.ready={engine:'elevenlabs',params:engines.elevenlabs.validate({voiceId,source:'design'}),files:[],license:{label:t('voiceLab.license.design'),commercial:false,credit:'ElevenLabs Voice Design',tier:'personal'},consent:null,dir:profileDir,cloudVoiceId:voiceId};
    return {ready:true,keepsKey:'voiceLab.keeps.design',keeps:t('voiceLab.keeps.design')};
  }
  async function importPack({files,name,refText,refLang}){
    const d=requireDraft();if(d.method!=='pack')throw L.error('voiceLab.error.pickPack');
    let list=files;
    if(!list){const picked=await dialog.showOpenDialog(win,{title:t('voiceLab.pack.dialogTitle'),properties:['openFile','multiSelections'],filters:[{name:'GPT-SoVITS',extensions:['ckpt','pth','wav','mp3','m4a','flac','ogg','txt','lab','list']}]});
      if(picked.canceled)return {canceled:true};list=picked.filePaths.map(p=>({path:p,name:path.basename(p)}));}
    const profileDir=d.temp.file('profile');fs.rmSync(profileDir,{recursive:true,force:true});
    const result=await engines.sovits.importPack({files:list,dest:profileDir,name,refText,refLang,convert});
    d.ready={engine:'sovits',params:result.params,files:result.files,license:result.license,consent:null,dir:profileDir};
    return {ready:true,note:result.note,noteKey:result.noteKey,refText:result.params.refText,version:result.params.version};
  }
  async function preview({text}){
    const d=requireDraft();if(!d.ready)throw L.error('voiceLab.error.notReady');
    const engine=engines[d.ready.engine];
    const result=await engine.speak({text:String(text||'').slice(0,300)||t('voiceLab.finish.previewFallback'),profile:{params:d.ready.params,engine:d.ready.engine},dir:d.ready.dir});
    return {audio:result.audio,mime:result.mime};
  }
  async function saveDraft({name,bind}){
    const d=requireDraft();if(!d.ready)throw L.error('voiceLab.error.notReady');
    const profile=buildProfile({id:profileId(name),name,engine:d.ready.engine,params:d.ready.params,files:d.ready.files,license:d.ready.license,consent:d.ready.consent});
    const result=await studio.save({draftDir:d.ready.dir,profile,bind:bind===true});
    d.ready=null;d.temp.remove();draft=null;  // every raw take and leftover goes with the temp folder
    return {...result,deletedRecordings:true};
  }
  const handlers={
    // a training run (or its finished voice) survives closing and reopening the window
    'voicelab:init':async()=>{const keep=draft&&(trainingRunning()||draft.ready);if(!keep)newDraft();
      return {methods:METHODS,prompts:PROMPTS,engines:await engineStatus(),mod:currentMod()&&{id:currentMod().id,name:currentMod().name},language:language(),hasVoices:Boolean(getVoices()),
        resume:keep?{method:draft.method,ready:Boolean(draft.ready),job:draft.jobId?studio.jobs.get(draft.jobId):null}:null};},
    'voicelab:method':value=>{if(!METHODS[value])throw new Error('Unknown method');if(trainingRunning())throw L.error('voiceLab.error.training');const d=newDraft();d.method=value;return {method:value,needsConsent:METHODS[value].needsConsent};},
    'voicelab:consent':value=>{const d=requireDraft();if(!method()?.needsConsent)return {ok:true};d.consent=requireConsent(value);return {ok:true,consent:d.consent};},
    // asked only when the user presses record; never at open
    'voicelab:mic-access':async()=>{const d=requireDraft();if(method()?.needsConsent&&!d.consent)throw L.error('voiceLab.error.consentStep',null,{code:'CONSENT_REQUIRED'});
      if(process.platform!=='darwin'||fakeMic||systemPreferences.getMediaAccessStatus('microphone')==='granted')return true;return systemPreferences.askForMediaAccess('microphone');},  // fakeMic: smoke runs use Chromium's fake microphone
    'voicelab:add-take':addTake,
    'voicelab:remove-take':id=>{const found=take(id);fs.rmSync(found.file,{force:true});requireDraft().takes.delete(id);return true;},
    'voicelab:engines':engineStatus,
    'voicelab:install':async id=>{if(!['cosyvoice','sovits'].includes(id))throw new Error('Unknown engine');let last=0;
      await engines[id].install(p=>{if(p.progress-last>=.002||p.stage==='done'){last=p.progress;send('voicelab:install-progress',{engine:id,...p});}});return engineStatus();},
    'voicelab:create':create,'voicelab:design':design,'voicelab:design-pick':designPick,'voicelab:import-pack':importPack,
    'voicelab:preview':preview,'voicelab:save':saveDraft,
    'voicelab:job-cancel':id=>studio.jobs.cancel(String(id)),
    'voicelab:jobs':()=>studio.jobs.list(),
    'voicelab:eleven-key':async key=>{key=String(key||'').replace(/\s+/g,'');if(!require('../../voice-engines/elevenlabs.cjs').looksLikeKey(key))throw L.error('voiceLab.error.notElevenKey');
      await engines.elevenlabs.verifyKey(key);setElevenKey(key);return {hasKey:true};},
    'voicelab:eleven-key-clear':()=>{clearElevenKey();return {hasKey:false};},
    'voicelab:decoded':(id,result)=>{const done=decoding.get(Number(id));if(done){decoding.delete(Number(id));done(result);}return true;},
    'voicelab:close':()=>{win?.close();return true;}
  };
  for(const [name,fn] of Object.entries(handlers))ipcMain.handle(name,async(event,...args)=>{if(!win||event.sender!==win.webContents)throw new Error('Unknown window');return fn(...args);});
  async function open(){
    if(win&&!win.isDestroyed()){win.show();win.focus();return win;}
    // its own session, so the microphone is allowed here (audio only) and nowhere else
    const lab=session.fromPartition('voice-lab');
    const allowed=(contents,permission,details)=>contents===win?.webContents&&permission==='media'&&(details?.mediaTypes?details.mediaTypes.length>0&&details.mediaTypes.every(t=>t==='audio'):details?.mediaType!=='video');
    lab.setPermissionRequestHandler((contents,permission,callback,details)=>callback(allowed(contents,permission,details)));
    lab.setPermissionCheckHandler((contents,permission,_origin,details)=>allowed(contents,permission,details));
    win=new BrowserWindow({width:860,height:760,minWidth:640,minHeight:600,title:t('voiceLab.title'),backgroundColor:'#f6fafd',show:false,
      webPreferences:{preload:path.join(root,'src','preload','voice-lab-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,session:lab}});
    const opened=win;opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));opened.webContents.on('will-navigate',event=>event.preventDefault());
    opened.once('ready-to-show',()=>opened.show());
    opened.on('closed',()=>{if(win===opened){win=null;if(!trainingRunning()&&!(draft?.jobId&&draft.ready)){draft?.temp.remove();draft=null;}}});
    await opened.loadFile(path.join(root,'src','renderer','voice-lab','voice-lab.html'));return opened;
  }
  L.onChange(()=>{if(win&&!win.isDestroyed())win.setTitle(t('voiceLab.title'));});
  // a training job outlives the window; its temp folder goes when it ends or the app quits
  function cleanup(){studio.jobs.cancelAll();draft?.temp.remove();draft=null;for(const e of Object.values(engines))e.stop?.({now:true});}
  return {open,cleanup,getWindow:()=>win,get draft(){return draft;},send};
}
module.exports={createVoiceLab,createStudio,requireConsent,buildProfile,profileId,personalLicense,referenceClip,tempFolder,sweepTemp,PROMPTS,METHODS,SAMPLE_RATE};
