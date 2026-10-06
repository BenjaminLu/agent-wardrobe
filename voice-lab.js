// 聲音工作室: choose a method → consent (for real people's voices) → record / import / design / import a pack →
// preview, name, save. The microphone runs only between the user's "start" and "stop" presses.
const $=id=>document.getElementById(id);
const RATE=24000;
const LIMITS={quick:30,train:300,cloud:180};  // seconds per take before recording stops by itself
let info=null,method=null,prompts=[],promptIndex=0,rec=null,takes=[],job=null,urls=[],finished=null,savedResult=null,previewDefault='';

function show(step){for(const s of document.querySelectorAll('.step'))s.hidden=s.id!==`step-${step}`;document.body.dataset.step=step;error('');}
function error(message){$('error').textContent=message||'';$('error').hidden=!message;}
const fail=e=>error(String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));
const blobUrl=(bytes,mime)=>{const url=URL.createObjectURL(new Blob([bytes],{type:mime}));urls.push(url);return url;};
const fmt=s=>s<60?t('voiceLab.seconds',{s:s.toFixed(1)}):t('voiceLab.minutes',{m:Math.floor(s/60),s:Math.round(s%60)});

// 16-bit mono WAV from Float32 chunks, built here so the main process only ever receives a finished file.
function wav(chunks,rate){
  const length=chunks.reduce((n,c)=>n+c.length,0),out=new DataView(new ArrayBuffer(44+length*2));
  const text=(o,s)=>{for(let i=0;i<s.length;i++)out.setUint8(o+i,s.charCodeAt(i));};
  text(0,'RIFF');out.setUint32(4,36+length*2,true);text(8,'WAVE');text(12,'fmt ');out.setUint32(16,16,true);out.setUint16(20,1,true);out.setUint16(22,1,true);
  out.setUint32(24,rate,true);out.setUint32(28,rate*2,true);out.setUint16(32,2,true);out.setUint16(34,16,true);text(36,'data');out.setUint32(40,length*2,true);
  let o=44;for(const c of chunks)for(let i=0;i<c.length;i++,o+=2){const s=Math.max(-1,Math.min(1,c[i]));out.setInt16(o,s<0?s*32768:s*32767,true);}
  return out.buffer;
}

async function init(){
  info=await window.voiceLab.init();
  $('no-voices').hidden=info.hasVoices;
  renderBind();
  document.body.dataset.ready='true';
  if(info.resume){method=info.resume.method;if(info.resume.ready)return finish({keepsKey:'voiceLab.keeps.trained'});show('record');setupRecord();if(info.resume.job)onJob(info.resume.job);return;}
  show('method');
}
for(const button of document.querySelectorAll('.method'))button.onclick=async()=>{
  try{const result=await window.voiceLab.method(button.dataset.method);method=result.method;takes=[];$('takes').replaceChildren();
    if(result.needsConsent){$('consent-person').value='';$('consent-agreed').checked=false;updateConsent();show('consent');}
    else if(method==='design'){show('design');showKey('eleven-key-design');}
    else if(method==='pack'){show('pack');showEngine('sovits',$('pack-engine'));}
  }catch(e){fail(e);}
};
// --- consent: a name and a tick, both required (the main process checks again)
function updateConsent(){$('consent-next').disabled=!($('consent-person').value.trim()&&$('consent-agreed').checked);}
$('consent-person').oninput=updateConsent;$('consent-agreed').onchange=updateConsent;
$('consent-back').onclick=()=>show('method');
$('consent-next').onclick=async()=>{try{await window.voiceLab.consent({person:$('consent-person').value,agreed:$('consent-agreed').checked});show('record');setupRecord();}catch(e){fail(e);}};

// --- recording
function renderBind(){$('bind-label').textContent=info?.mod?t('voiceLab.finish.bindTo',{name:info.mod.name}):t('voiceLab.finish.bind');}
function renderRecordTitle(){if(['quick','train','cloud'].includes(method))$('record-title').textContent=t(`voiceLab.record.title.${method}`);}
function setupRecord(){
  renderRecordTitle();if(!rec)$('timer').textContent=fmt(0);
  $('ref-text-row').hidden=method!=='quick';$('name-row-cloud').hidden=method!=='cloud';
  $('prompt-lang').value=info.language?.startsWith('ja')?'ja':info.language?.startsWith('en')?'en':'zh';pickPrompts();
  showEngine({quick:'cosyvoice',train:'sovits',cloud:'elevenlabs'}[method],$('engine-status'));
  $('eleven-key').hidden=method!=='cloud'||info.engines.elevenlabs.hasKey;updateCreate();
}
function pickPrompts(){prompts=info.prompts[method==='quick'?'short':'long'][$('prompt-lang').value];promptIndex=0;showPrompt();}
function showPrompt(){$('prompt-text').textContent=method==='quick'?prompts[promptIndex%prompts.length]:prompts.slice(promptIndex%prompts.length).concat(prompts.slice(0,promptIndex%prompts.length)).join('\n');if(method==='quick')$('ref-text').value=$('prompt-text').textContent;}
$('prompt-lang').onchange=pickPrompts;$('prompt-next').onclick=()=>{promptIndex++;showPrompt();};
$('record').onclick=()=>rec?stopRecording():startRecording().catch(e=>{cleanupMic();fail(e);});
async function startRecording(){
  error('');if(!await window.voiceLab.micAccess())throw new Error(t('voiceLab.error.mic'));
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  const context=new AudioContext();await context.audioWorklet.addModule('mic-worklet.js');
  const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'mic-downsampler',{processorOptions:{rate:RATE}});
  rec={stream,context,chunks:[],started:performance.now(),text:$('prompt-text').textContent};
  node.port.onmessage=event=>{if(!rec)return;rec.chunks.push(event.data);let sum=0;for(const v of event.data)sum+=v*v;const db=20*Math.log10(Math.sqrt(sum/event.data.length)+1e-9);
    $('level').style.width=`${Math.max(0,Math.min(100,(db+60)/60*100))}%`;const seconds=rec.chunks.length/10;$('timer').textContent=fmt(seconds);if(seconds>=LIMITS[method])stopRecording();};
  source.connect(node);
  $('mic-on').hidden=false;$('record').classList.add('on');$('record').textContent=t('voiceLab.record.stop');document.body.dataset.recording='true';
}
function cleanupMic(){if(rec){rec.stream.getTracks().forEach(t=>t.stop());rec.context.close();}rec=null;$('mic-on').hidden=true;$('record').classList.remove('on');$('record').textContent=t('voiceLab.record.start');$('level').style.width='0';document.body.dataset.recording='false';}
async function stopRecording(){
  const current=rec;if(!current)return;cleanupMic();
  if(!current.chunks.length)return;
  const bytes=wav(current.chunks,RATE);
  const number=takes.length+1;
  try{addTake({...await window.voiceLab.addTake({bytes,name:t('voiceLab.take.name',{n:number}),text:method==='quick'?$('ref-text').value:current.text.split('\n')[0],kind:'mic'}),number},bytes);}catch(e){fail(e);}
}
$('import').onchange=async()=>{
  for(const file of $('import').files){try{const t=await window.voiceLab.addTake({bytes:await file.arrayBuffer(),name:file.name,text:'',kind:'file'});addTake(t,t.wav);}catch(e){fail(e);}}
  $('import').value='';
};
// a take's name, length and quality notes; drawn again when the interface language changes
function renderTake(li,take){
  const name=li.querySelector('b'),q=li.querySelector('.q'),remove=li.querySelector('button');
  name.textContent=`${take.number?t('voiceLab.take.name',{n:take.number}):take.name} · ${fmt(take.duration)}`;  // a microphone take is named by its number in the current languageremove.textContent=t('voiceLab.take.remove');q.replaceChildren();
  if(!take.quality.issues.length){const s=document.createElement('span');s.className='good';s.textContent=t('voiceLab.take.good');q.append(s);}
  for(const issue of take.quality.issues){const s=document.createElement('span');s.className=issue.level==='error'?'bad':'meh';s.textContent=`${issue.level==='error'?'✗':'!'} ${issue.key?t(issue.key,issue.vars):issue.message} `;q.append(s);}
}
function addTake(take,bytes){
  takes.push(take);const li=document.createElement('li');li.dataset.take=take.id;
  const name=document.createElement('b');
  const player=document.createElement('audio');player.controls=true;player.src=blobUrl(bytes,'audio/wav');
  const q=document.createElement('span');q.className='q';
  const remove=document.createElement('button');remove.type='button';
  remove.onclick=async()=>{await window.voiceLab.removeTake(take.id).catch(fail);takes=takes.filter(t=>t.id!==take.id);li.remove();updateCreate();};
  li.append(name,player,q,remove);renderTake(li,take);$('takes').append(li);updateCreate();
}
function updateCreate(){
  const good=takes.filter(t=>t.quality.ok),seconds=good.reduce((n,t)=>n+t.analysis.speechSeconds,0);
  const engine=info.engines[{quick:'cosyvoice',train:'sovits',cloud:'elevenlabs'}[method]];
  $('create').disabled=!good.length||!engine?.ok||(method==='train'&&seconds<60)||(method==='cloud'&&seconds<10)||Boolean(job&&job.state==='running');
  $('create').textContent=method==='train'?t(seconds<60?'voiceLab.record.trainShort':'voiceLab.record.train',{time:fmt(seconds)}):t('voiceLab.record.create');
}
$('record-back').onclick=()=>{cleanupMic();show('method');};
$('create').onclick=async()=>{
  $('create').disabled=true;error('');
  try{
    const result=await window.voiceLab.create({refText:$('ref-text').value,lang:$('prompt-lang').value,removeNoise:$('remove-noise').checked,takeIds:takes.filter(t=>t.quality.ok).map(t=>t.id)});
    if(result.job)onJob(result.job);else finish(result);
  }catch(e){fail(e);updateCreate();}
};
// --- engines: install on demand with progress
function showEngine(id,target){
  const engine=info.engines[id];target.replaceChildren();
  target.dataset.engine=id;
  const line=document.createElement('div');line.textContent=t('voiceLab.engine.status',{label:engine.label,status:engine.ok?t('voiceLab.engine.ready'):engine.reason});target.append(line);
  const lic=document.createElement('div');lic.className='hint';lic.textContent=t('voiceLab.engine.license',{license:engine.license});target.append(lic);
  if(!engine.ok&&engine.install){
    const button=document.createElement('button');button.type='button';button.textContent=t('voiceLab.engine.install');const bar=document.createElement('div');bar.className='bar';bar.hidden=true;bar.append(document.createElement('div'));
    const detail=document.createElement('div');detail.className='hint';
    button.onclick=async()=>{button.disabled=true;bar.hidden=false;target.dataset.installing=id;
      try{info.engines=await window.voiceLab.install(id);showEngine(id,target);updateCreate();}catch(e){fail(e);button.disabled=false;button.textContent=t('voiceLab.engine.retry');bar.hidden=true;delete target.dataset.installing;detail.textContent=t('voiceLab.engine.failed',{error:String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'')});}};
    target.append(button,bar,detail);target.progress=p=>{bar.firstChild.style.width=`${Math.round(p.progress*100)}%`;detail.textContent=`${Math.round(p.progress*100)}% · ${p.detail||''}`;};
  }
}
window.voiceLab.onInstallProgress(p=>{for(const t of [$('engine-status'),$('pack-engine')])if(t.dataset.installing===p.engine)t.progress?.(p);});
// --- ElevenLabs key: verified once in the main process, stored encrypted, never shown again
function showKey(id){$(id).hidden=info.engines.elevenlabs.hasKey;}
for(const [input,button,box] of [['eleven-key-input','eleven-key-save','eleven-key'],['eleven-key-input-2','eleven-key-save-2','eleven-key-design']])
  $(button).onclick=async()=>{const value=$(input).value;$(input).value='';$(button).disabled=true;
    try{await window.voiceLab.setElevenKey(value);info.engines=await window.voiceLab.engines();$(box).hidden=true;if(method==='cloud')setupRecord();}catch(e){fail(e);}finally{$(button).disabled=false;}};
// --- training job
const STAGE_ORDER=j=>j.stages.map(s=>s.id);
function onJob(value){
  job=value;$('job').hidden=false;$('job-title').textContent=value.titleKey?t(value.titleKey,value.titleVars):value.title;
  $('job-stages').replaceChildren(...value.stages.map(s=>{const li=document.createElement('li');li.textContent=s.key?t(s.key):s.label;const order=STAGE_ORDER(value);
    li.className=order.indexOf(s.id)<order.indexOf(value.stage)||value.state==='done'?'done':s.id===value.stage&&value.state==='running'?'on':'';return li;}));
  $('job-bar').style.width=`${Math.round(value.progress*100)}%`;
  const stage=value.stages.find(s=>s.id===value.stage);
  $('job-detail').textContent=value.state==='running'?t('voiceLab.job.running',{percent:Math.round(value.progress*100),detail:value.detail||(stage?.key?t(stage.key):value.stageLabel),eta:fmt(value.eta)}):
    value.state==='cancelled'?t('voiceLab.job.cancelled'):value.state==='error'?t('voiceLab.job.failed',{error:value.error}):t('voiceLab.job.done');
  $('job-cancel').hidden=value.state!=='running';updateCreate();
  if(value.state==='done'&&!finished)finish({keepsKey:'voiceLab.keeps.trained'});
}
window.voiceLab.onJob(value=>{if(!job||value.id===job.id)onJob(value);});
$('job-cancel').onclick=()=>job&&window.voiceLab.cancelJob(job.id);
// --- AI design
$('design-back').onclick=()=>show('method');
$('design-go').onclick=async()=>{
  $('design-go').disabled=true;$('design-results').replaceChildren();error('');
  try{const {previews}=await window.voiceLab.design({prompt:$('design-prompt').value});
    for(const p of previews){const row=document.createElement('div');row.className='design';const player=document.createElement('audio');player.controls=true;player.src=blobUrl(p.audio,p.mime);
      const pick=document.createElement('button');pick.type='button';pick.className='primary';pick.dataset.i18n='voiceLab.design.pick';pick.textContent=t(pick.dataset.i18n);
      pick.onclick=async()=>{pick.disabled=true;try{finish(await window.voiceLab.designPick({id:p.id,name:$('design-prompt').value.slice(0,30)}));}catch(e){fail(e);pick.disabled=false;}};
      row.append(player,pick);$('design-results').append(row);}
  }catch(e){fail(e);}finally{$('design-go').disabled=false;}
};
// --- community pack
$('pack-back').onclick=()=>show('method');
$('pack-pick').onclick=async()=>{try{const result=await window.voiceLab.importPack({refText:$('pack-ref-text').value});if(!result.canceled)finish({keepsKey:'voiceLab.keeps.pack',keepsVars:{version:result.version},noteKey:result.noteKey,note:result.note});}catch(e){fail(e);}};
// --- finish: preview, name, save, bind
function finish(result){
  finished=result;savedResult=null;
  show('finish');$('saved').hidden=true;$('save').disabled=false;renderFinish();
  $('voice-name').value||=$('consent-person').value?t('voiceLab.finish.defaultName',{person:$('consent-person').value}):'';
}
// what the finish step says: what is kept, the sample sentence (unless edited) and, once saved, what happened
function renderFinish(){
  if(!finished)return;
  const keeps=finished.keepsKey?t(finished.keepsKey,{...finished.keepsVars,note:finished.noteKey?t(finished.noteKey):finished.note||''}):finished.keeps||'';
  $('kept').textContent=method==='design'||method==='pack'?t('voiceLab.finish.kept',{keeps}):t('voiceLab.finish.deleted',{keeps});
  const sample=t('voiceLab.finish.previewDefault');if(!$('preview-text').value||$('preview-text').value===previewDefault)$('preview-text').value=sample;previewDefault=sample;
  if(!$('preview').disabled)$('preview').textContent=t('voiceLab.finish.preview');
  if(savedResult){const {result,deleted}=savedResult;
    $('saved').textContent=t(result.bound?'voiceLab.finish.savedBound':'voiceLab.finish.saved',{name:result.profile.name,character:result.bound?.name||''})+(deleted?t('voiceLab.finish.recordingsDeleted'):'');}
}
$('preview').onclick=async()=>{
  $('preview').disabled=true;$('preview').textContent=t('voiceLab.finish.previewing');error('');
  try{const {audio,mime}=await window.voiceLab.preview({text:$('preview-text').value});$('preview-audio').src=blobUrl(audio,mime);$('preview-audio').hidden=false;await $('preview-audio').play().catch(()=>{});}
  catch(e){fail(e);}finally{$('preview').disabled=false;$('preview').textContent=t('voiceLab.finish.preview');}
};
$('save').onclick=async()=>{
  $('save').disabled=true;error('');
  try{const result=await window.voiceLab.save({name:$('voice-name').value||t('voiceLab.finish.fallbackName'),bind:$('bind').checked});
    savedResult={result,deleted:method==='quick'||method==='train'||method==='cloud'};$('saved').hidden=false;renderFinish();
    document.body.dataset.saved=result.profile.id;
  }catch(e){fail(e);$('save').disabled=false;}
};
$('finish-back').onclick=()=>{location.reload();};
window.addEventListener('beforeunload',()=>{cleanupMic();for(const u of urls)URL.revokeObjectURL(u);});
init().catch(fail);
// a new interface language: everything this script wrote is written again (inputs, takes and recordings stay)
window.i18n.onChange(()=>{
  if(!info)return;
  renderBind();renderRecordTitle();
  $('record').textContent=t(rec?'voiceLab.record.stop':'voiceLab.record.start');$('timer').textContent=fmt(rec?rec.chunks.length/10:0);
  for(const li of $('takes').children){const take=takes.find(x=>x.id===li.dataset.take);if(take)renderTake(li,take);}
  if(method)updateCreate();
  for(const target of [$('engine-status'),$('pack-engine')])if(target.dataset.engine&&!target.dataset.installing)
    window.voiceLab.engines().then(engines=>{info.engines=engines;if(!target.dataset.installing)showEngine(target.dataset.engine,target);}).catch(()=>{});
  if(job)onJob(job);
  for(const button of document.querySelectorAll('#design-results button[data-i18n]'))button.textContent=t(button.dataset.i18n);
  renderFinish();
});
// Imported audio on Windows and Linux: Chromium decodes it (wav, mp3, m4a, flac, ogg…) at the rate main asks for; channels are averaged to mono.
window.voiceLab.onDecode(async({id,data,rate})=>{
  try{const buffer=await new OfflineAudioContext(1,1,rate).decodeAudioData(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    const mono=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const ch=buffer.getChannelData(c);for(let i=0;i<ch.length;i++)mono[i]+=ch[i]/buffer.numberOfChannels;}
    await window.voiceLab.decoded(id,{samples:mono});}
  catch(error){await window.voiceLab.decoded(id,{error:String(error?.message||error)});}
});
