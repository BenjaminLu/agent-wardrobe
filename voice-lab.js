// 聲音工作室: choose a method → consent (for real people's voices) → record / import / design / import a pack →
// preview, name, save. The microphone runs only between the user's "start" and "stop" presses.
const $=id=>document.getElementById(id);
const RATE=24000;
const LIMITS={quick:30,train:300,cloud:180};  // seconds per take before recording stops by itself
let info=null,method=null,prompts=[],promptIndex=0,rec=null,takes=[],job=null,urls=[];

function show(step){for(const s of document.querySelectorAll('.step'))s.hidden=s.id!==`step-${step}`;document.body.dataset.step=step;error('');}
function error(message){$('error').textContent=message||'';$('error').hidden=!message;}
const fail=e=>error(String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));
const blobUrl=(bytes,mime)=>{const url=URL.createObjectURL(new Blob([bytes],{type:mime}));urls.push(url);return url;};
const fmt=s=>s<60?`${s.toFixed(1)} 秒`:`${Math.floor(s/60)} 分 ${Math.round(s%60)} 秒`;

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
  $('bind-label').textContent=info.mod?`綁定到目前角色（${info.mod.name}）`:'綁定到目前角色';
  document.body.dataset.ready='true';
  if(info.resume){method=info.resume.method;if(info.resume.ready)return finish({keeps:'訓練好的模型和一段參考錄音'});show('record');setupRecord();if(info.resume.job)onJob(info.resume.job);return;}
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
function setupRecord(){
  $('record-title').textContent={quick:'⚡ 快速複製：念約 10 秒',train:'🎓 高品質訓練：總共錄 1–10 分鐘（可以分好幾段）',cloud:'☁️ 雲端複製：錄 1 分鐘以上效果最好'}[method];
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
  error('');if(!await window.voiceLab.micAccess())throw new Error('沒有麥克風權限：到「系統設定 → 隱私權與安全性 → 麥克風」打開 Agent Wardrobe。');
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
  const context=new AudioContext();await context.audioWorklet.addModule('mic-worklet.js');
  const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'mic-downsampler',{processorOptions:{rate:RATE}});
  rec={stream,context,chunks:[],started:performance.now(),text:$('prompt-text').textContent};
  node.port.onmessage=event=>{if(!rec)return;rec.chunks.push(event.data);let sum=0;for(const v of event.data)sum+=v*v;const db=20*Math.log10(Math.sqrt(sum/event.data.length)+1e-9);
    $('level').style.width=`${Math.max(0,Math.min(100,(db+60)/60*100))}%`;const seconds=rec.chunks.length/10;$('timer').textContent=fmt(seconds);if(seconds>=LIMITS[method])stopRecording();};
  source.connect(node);
  $('mic-on').hidden=false;$('record').classList.add('on');$('record').textContent='■ 停止錄音';document.body.dataset.recording='true';
}
function cleanupMic(){if(rec){rec.stream.getTracks().forEach(t=>t.stop());rec.context.close();}rec=null;$('mic-on').hidden=true;$('record').classList.remove('on');$('record').textContent='● 開始錄音';$('level').style.width='0';document.body.dataset.recording='false';}
async function stopRecording(){
  const current=rec;if(!current)return;cleanupMic();
  if(!current.chunks.length)return;
  const bytes=wav(current.chunks,RATE);
  try{addTake(await window.voiceLab.addTake({bytes,name:`錄音 ${takes.length+1}`,text:method==='quick'?$('ref-text').value:current.text.split('\n')[0],kind:'mic'}),bytes);}catch(e){fail(e);}
}
$('import').onchange=async()=>{
  for(const file of $('import').files){try{const t=await window.voiceLab.addTake({bytes:await file.arrayBuffer(),name:file.name,text:'',kind:'file'});addTake(t,t.wav);}catch(e){fail(e);}}
  $('import').value='';
};
function addTake(take,bytes){
  takes.push(take);const li=document.createElement('li');li.dataset.take=take.id;
  const name=document.createElement('b');name.textContent=`${take.name} · ${fmt(take.duration)}`;
  const player=document.createElement('audio');player.controls=true;player.src=blobUrl(bytes,'audio/wav');
  const q=document.createElement('span');q.className='q';
  if(!take.quality.issues.length){const s=document.createElement('span');s.className='good';s.textContent='✓ 音質沒問題';q.append(s);}
  for(const issue of take.quality.issues){const s=document.createElement('span');s.className=issue.level==='error'?'bad':'meh';s.textContent=`${issue.level==='error'?'✗':'!'} ${issue.message} `;q.append(s);}
  const remove=document.createElement('button');remove.type='button';remove.textContent='刪除';
  remove.onclick=async()=>{await window.voiceLab.removeTake(take.id).catch(fail);takes=takes.filter(t=>t.id!==take.id);li.remove();updateCreate();};
  li.append(name,player,q,remove);$('takes').append(li);updateCreate();
}
function updateCreate(){
  const good=takes.filter(t=>t.quality.ok),seconds=good.reduce((n,t)=>n+t.analysis.speechSeconds,0);
  const engine=info.engines[{quick:'cosyvoice',train:'sovits',cloud:'elevenlabs'}[method]];
  $('create').disabled=!good.length||!engine?.ok||(method==='train'&&seconds<60)||(method==='cloud'&&seconds<10)||Boolean(job&&job.state==='running');
  $('create').textContent=method==='train'?`開始訓練（已錄 ${fmt(seconds)}${seconds<60?'，至少 1 分鐘':''}）`:'做成聲音';
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
  const line=document.createElement('div');line.textContent=`${engine.label}：${engine.ok?'已就緒 ✓':engine.reason}`;target.append(line);
  const lic=document.createElement('div');lic.className='hint';lic.textContent=`授權：${engine.license}`;target.append(lic);
  if(!engine.ok&&engine.install){
    const button=document.createElement('button');button.type='button';button.textContent='安裝';const bar=document.createElement('div');bar.className='bar';bar.hidden=true;bar.append(document.createElement('div'));
    const detail=document.createElement('div');detail.className='hint';
    button.onclick=async()=>{button.disabled=true;bar.hidden=false;target.dataset.installing=id;
      try{info.engines=await window.voiceLab.install(id);showEngine(id,target);updateCreate();}catch(e){fail(e);button.disabled=false;button.textContent='重試安裝';bar.hidden=true;delete target.dataset.installing;detail.textContent=`安裝失敗：${String(e?.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'')}`;}};
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
  job=value;$('job').hidden=false;$('job-title').textContent=value.title;
  $('job-stages').replaceChildren(...value.stages.map(s=>{const li=document.createElement('li');li.textContent=s.label;const order=STAGE_ORDER(value);
    li.className=order.indexOf(s.id)<order.indexOf(value.stage)||value.state==='done'?'done':s.id===value.stage&&value.state==='running'?'on':'';return li;}));
  $('job-bar').style.width=`${Math.round(value.progress*100)}%`;
  $('job-detail').textContent=value.state==='running'?`${Math.round(value.progress*100)}% · ${value.detail||value.stageLabel} · 大約還要 ${fmt(value.eta)}（訓練時可以關掉這個視窗）`:
    value.state==='cancelled'?'已取消。錄音還在，可以再試一次。':value.state==='error'?`訓練失敗：${value.error}`:'訓練完成！';
  $('job-cancel').hidden=value.state!=='running';updateCreate();
  if(value.state==='done')finish({keeps:'訓練好的模型和一段參考錄音'});
}
window.voiceLab.onJob(value=>{if(!job||value.id===job.id)onJob(value);});
$('job-cancel').onclick=()=>job&&window.voiceLab.cancelJob(job.id);
// --- AI design
$('design-back').onclick=()=>show('method');
$('design-go').onclick=async()=>{
  $('design-go').disabled=true;$('design-results').replaceChildren();error('');
  try{const {previews}=await window.voiceLab.design({prompt:$('design-prompt').value});
    for(const p of previews){const row=document.createElement('div');row.className='design';const player=document.createElement('audio');player.controls=true;player.src=blobUrl(p.audio,p.mime);
      const pick=document.createElement('button');pick.type='button';pick.className='primary';pick.textContent='選這個';
      pick.onclick=async()=>{pick.disabled=true;try{finish(await window.voiceLab.designPick({id:p.id,name:$('design-prompt').value.slice(0,30)}));}catch(e){fail(e);pick.disabled=false;}};
      row.append(player,pick);$('design-results').append(row);}
  }catch(e){fail(e);}finally{$('design-go').disabled=false;}
};
// --- community pack
$('pack-back').onclick=()=>show('method');
$('pack-pick').onclick=async()=>{try{const result=await window.voiceLab.importPack({refText:$('pack-ref-text').value});if(!result.canceled)finish({keeps:`模型檔和參考音檔（GPT-SoVITS ${result.version}）。${result.note}`});}catch(e){fail(e);}};
// --- finish: preview, name, save, bind
function finish(result){
  show('finish');$('saved').hidden=true;$('save').disabled=false;
  $('kept').textContent=method==='design'||method==='pack'?`保留：${result.keeps}`:`原始錄音會在儲存（或關掉視窗）時刪除，只留下：${result.keeps}。`;
  $('voice-name').value||=$('consent-person').value?`${$('consent-person').value}的聲音`:'';
}
$('preview').onclick=async()=>{
  const label=$('preview').textContent;$('preview').disabled=true;$('preview').textContent='⏳ 合成中…（剛裝好的引擎第一句要等比較久，最多約 1 分鐘）';error('');
  try{const {audio,mime}=await window.voiceLab.preview({text:$('preview-text').value});$('preview-audio').src=blobUrl(audio,mime);$('preview-audio').hidden=false;await $('preview-audio').play().catch(()=>{});}
  catch(e){fail(e);}finally{$('preview').disabled=false;$('preview').textContent=label;}
};
$('save').onclick=async()=>{
  $('save').disabled=true;error('');
  try{const result=await window.voiceLab.save({name:$('voice-name').value||'我的聲音',bind:$('bind').checked});
    $('saved').hidden=false;$('saved').textContent=`已儲存「${result.profile.name}」${result.bound?`，並綁定到 ${result.bound.name}`:''}。${method==='quick'||method==='train'||method==='cloud'?'原始錄音已刪除。':''}`;
    document.body.dataset.saved=result.profile.id;
  }catch(e){fail(e);$('save').disabled=false;}
};
$('finish-back').onclick=()=>{location.reload();};
window.addEventListener('beforeunload',()=>{cleanupMic();for(const u of urls)URL.revokeObjectURL(u);});
init().catch(fail);
// Imported audio on Windows and Linux: Chromium decodes it (wav, mp3, m4a, flac, ogg…) at the rate main asks for; channels are averaged to mono.
window.voiceLab.onDecode(async({id,data,rate})=>{
  try{const buffer=await new OfflineAudioContext(1,1,rate).decodeAudioData(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    const mono=new Float32Array(buffer.length);for(let c=0;c<buffer.numberOfChannels;c++){const ch=buffer.getChannelData(c);for(let i=0;i<ch.length;i++)mono[i]+=ch[i]/buffer.numberOfChannels;}
    await window.voiceLab.decoded(id,{samples:mono});}
  catch(error){await window.voiceLab.decoded(id,{error:String(error?.message||error)});}
});
