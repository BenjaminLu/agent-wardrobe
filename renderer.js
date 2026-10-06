const $ = id => document.getElementById(id);
if(new URLSearchParams(location.search).has('opaque'))document.body.classList.add('opaque');  // Linux without a compositor (main.cjs)
const bridge=window.bula;Avatars.setAssetLoader(async url=>{const [,modId,file]=url.match(/^mods\/([^/]+)\/([^/]+)$/);const data=await bridge.modAsset(decodeURIComponent(modId),decodeURIComponent(file));return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);});
// Live2D characters need Live2D's own Cubism Core: the copy in userData, or a download once the user agrees.
Avatars.setLive2dCore({url:()=>bridge.live2dCore(),install:()=>bridge.installLive2dCore()});
let idleTimer, closingTimer, activeTask=null, composing=false, voiceMode=false, voiceTimer, typelessArmed=0;
const progressMessages=new Map();
let history = [], busy = false, settings, characterState, t = window.bulaLocale(navigator.language);
const histories={codex:history,claude:history,local:history};
// Voice previews can take a while (a new Kokoro mix reloads the model; a cloned voice's first sentence can take a minute):
// the pressed button says so, switches to 播放中 once the character speaks, and shows a failure right next to itself
// (settings hide the chat, where errors normally go).
let previewing=null;
function trackPreview(button){
  endPreview();const zh=settings?.language?.startsWith('zh')!==false;
  previewing={button,label:button.textContent,started:false,timer:setTimeout(()=>endPreview(zh?'等太久了，沒有聽到聲音，請再試一次。':'No sound came; try again.'),150000)};
  button.disabled=true;button.classList.add('busy');button.textContent=zh?'⏳ 準備聲音…':'⏳ Preparing…';button.parentElement?.querySelector(':scope > .preview-note')?.remove();
}
function endPreview(error){
  if(!previewing)return;const {button,label,timer}=previewing;previewing=null;clearTimeout(timer);
  button.disabled=false;button.classList.remove('busy');button.textContent=label;
  if(error){const note=document.createElement('span');note.className='preview-note';note.textContent=error;button.after(note);setTimeout(()=>note.remove(),12000);}
}
document.addEventListener('click',event=>{const button=event.target.closest?.('button');if(button&&!button.disabled&&/試聽|Preview/i.test(button.textContent))trackPreview(button);},true);
function renderState(state) {
  $('stop-speech').hidden=!state.speaking;
  if(previewing){if(state.speaking&&!previewing.started){previewing.started=true;previewing.button.textContent=settings?.language?.startsWith('zh')!==false?'🔊 播放中…':'🔊 Playing…';}else if(!state.speaking&&previewing.started)endPreview();}
  const changed=!characterState||characterState.modId!==state.modId||characterState.skinId!==state.skinId||characterState.mod?.updated!==state.mod?.updated;
  if(changed) Avatars.mount($('pet-wrap'),state.mod,state.skin,'bula',{orbit:'window'});
  Avatars.update($('bula'),state);
  document.querySelector('.brand').firstChild.textContent=state.mod.name.toUpperCase();
  if(settings){
    $('prompt').placeholder=t.placeholder.replaceAll('{name}',state.mod.name);
    $('prompt').setAttribute('aria-label',`Chat with ${state.mod.name}`);
    $('pet-wrap').title=hintFor(state.mod);
    if(changed&&!history.length){$('conversation').replaceChildren();message(t.greeting.replaceAll('{name}',state.mod.name));}
  }
  if(settings&&settings.provider!==state.provider){
    settings.provider=state.provider;history=histories[state.provider];$('provider').value=uiProvider(settings);localFields();
    $('conversation').replaceChildren();if(history.length)history.slice(-100).forEach(m=>message(m.content,m.role,m.artifacts));else message(t.greeting.replaceAll('{name}',state.mod.name));
    $('subtitle').textContent='';$('subtitle').hidden=true;status(`${state.provider} · ${t.ready}`);
  }
  characterState=state;
  if(['working','waiting_for_approval'].includes(state.activity)) showChat(false);
}
function message(text, role='assistant',artifacts=[]) { const el = document.createElement('div'); el.className = `message ${role}`; el.textContent = text; $('conversation').append(el);for(const artifact of artifacts||[]){const box=document.createElement('div');box.className='artifact';const button=document.createElement('button');button.textContent=settings?.language.startsWith('zh')?'📁 開啟資料夾':'📁 Open folder';button.onclick=()=>window.bula.openOutput(artifact.id).catch(error=>message(error.message,'error'));const label=document.createElement('div');label.textContent=artifact.files.join(' · ');box.append(label,button);el.append(box);} $('conversation').scrollTop = $('conversation').scrollHeight; return el; }
function emotion(value) { $('bula').dataset.emotion = value; }
// The stop control only exists while a task can be stopped.
function setActiveTask(id){activeTask=id;document.body.classList.toggle('task-running',Boolean(id));}
// 3D Mods (VRM, glTF, MMD) add the orbit gesture to the hint line; Live2D is flat and moves like the 2D companions.
function hintFor(mod){const zh=settings?.language?.startsWith('zh');return (zh?`拖曳移動 ${mod.name} · 點一下聊天 · ⌘＋捲動縮放`:`Drag to move ${mod.name} · click to chat · ⌘-scroll to resize`).replace(['vrm','gltf','mmd'].includes(mod.renderer)?/^[^·]*·\s*/:/$^/,'')+(['vrm','gltf','mmd'].includes(mod.renderer)?(zh?' · 3D：拖曳旋轉、⌥拖曳移動':' · 3D: drag to rotate, ⌥-drag to move'):'');}
function status(text) { $('status').textContent = text; }
async function init() {
  settings = await window.bula.settings();
  document.documentElement.style.setProperty('--scale',settings.scale||1);
  document.body.dataset.chatSize=settings.chatSize||'large';
  history.push(...(await window.bula.history()).map(m=>({role:m.role,content:m.content,artifacts:m.artifacts})));
  if(!settings.language.startsWith('zh')){
    for(const [value,label] of [['auto','Auto'],['chat','Chat only'],['computer','Computer use'],['browser','Browser use'],['files','Organize / save files']])$('task-mode').querySelector(`option[value=${value}]`).textContent=label;$('emergency-stop').lastChild.textContent='Stop';$('emergency-stop').title='Stop task (⌘⇧X)';$('emergency-stop').setAttribute('aria-label','Stop task');$('agent-console').textContent='Detailed log ↗';
    $('operation-help').textContent='Tasks use the selected brain. Claude uses official tools; Codex / LM Studio use App browser and native desktop tools. Local models need tool calling; desktop operation also needs vision.';
    document.querySelector('[data-permission=screen]').textContent='Screen Recording';document.querySelector('[data-permission=accessibility]').textContent='Accessibility';
    $('official-setup').textContent='Official Claude setup';
  }

  $('voice-input').title=settings.language.startsWith('zh')?'Typeless 語音模式：貼入文字後自動送出（包含一般貼上）':'Typeless voice mode: automatically send pasted text (including ordinary paste)';
  $('files').title=settings.language.startsWith('zh')?'角色文件（⌘⇧O）':'Character files (⌘⇧O)';
  $('wardrobe').title=settings.language.startsWith('zh')?'Mod 市集（⌘⇧S）':'Mod Marketplace (⌘⇧S)';
  t = window.bulaLocale(settings.language); document.documentElement.lang = settings.language;
  const settingsLabel=settings.language.startsWith('zh') ? '設定' : settings.language.startsWith('ja') ? '設定' : 'Settings';
  $('settings-label').textContent=settingsLabel; $('settings-toggle').title=settingsLabel; $('settings-toggle').setAttribute('aria-label',settingsLabel);
  // Computer use needs a native input backend (macOS helper, Windows SendInput helper, X11 xdotool); Wayland or a missing tool disables the mode with the reason.
  const computer=await window.bula.computerSupport();$('operation-permissions').hidden=!computer.permissions;
  if(!computer.available){const option=$('task-mode').querySelector('option[value=computer]');option.disabled=true;option.title=computer.reason;if($('task-mode').value==='computer')$('task-mode').value='auto';}
  renderState(await window.bula.state());history=histories[settings.provider];
  $('conversation').replaceChildren();if(history.length)history.slice(-100).forEach(m=>message(m.content,m.role,m.artifacts));else message(t.greeting.replaceAll('{name}',characterState.mod.name));
  $('prompt').placeholder=t.placeholder.replaceAll('{name}',characterState.mod.name);
  $('pet-wrap').title=hintFor(characterState.mod); $('reset').textContent=t.clear; $('save').textContent=t.save;
  for (const [selector,text] of [['#provider',t.brain],['#base',t.baseLabel],['#model',t.modelLabel]]) document.querySelector(selector).parentElement.firstChild.textContent=text;
  document.querySelector('#settings .pane[data-pane=brain] > p').textContent=t.privacy;
  $('provider').querySelector('[value=codex]').textContent='Codex'; $('provider').querySelector('[value=claude]').textContent='Claude'; $('provider').querySelector('[value=local]').textContent='LM Studio · '+t.local;
  $('provider').value = uiProvider(settings); $('base').value = settings.base; $('model').value = settings.model; $('reply-language').value = settings.replyLanguage || 'auto'; await initVoice(); await initWake(); await showGameEngine(); loadWatchSources();
  const providers = await window.bula.providers();
  for (const name of ['codex','claude']) if (!providers[name]) $('provider').querySelector(`[value="${name}"]`).textContent += t.missing;
  localFields(); status(`${settings.provider === 'local' ? t.local : settings.provider} · ${t.ready}`);
  document.body.dataset.ready='true';armIdle();
}
function localFields() { $('local-settings').hidden = $('provider').value !== 'local'; $('builtin-settings').hidden = $('provider').value !== 'builtin'; if ($('provider').value === 'builtin') showLlm(); showCli(); }
// The settings select shows the built-in engine as its own brain; underneath it is the local provider.
const uiProvider=s=>s.provider==='local'&&s.localEngine==='builtin'?'builtin':s.provider||'codex';
const brainChoice=value=>value==='builtin'?{provider:'local',localEngine:'builtin'}:value==='local'?{provider:'local',localEngine:'lmstudio'}:{provider:value};
const cleanError=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
let llmState;
// Codex / Claude: install and sign in through the official tools, then watch until the account is ready.
const CLI_NAMES={codex:'Codex',claude:'Claude Code'};let cliPoll;
const cliText=(name,state,zh=settings.language.startsWith('zh'))=>state.loggedIn?(zh?'已登入 ✓':'Signed in ✓'):state.installed?(zh?`${CLI_NAMES[name]} 已安裝，還沒登入`:`${CLI_NAMES[name]} needs sign-in`):(zh?`這台 Mac 還沒有 ${CLI_NAMES[name]}`:`${CLI_NAMES[name]} is not installed`);
const cliAction=(state,zh=settings.language.startsWith('zh'))=>state.installed?(zh?'登入':'Sign in'):(zh?'安裝並登入':'Install and sign in');
function setupCli(name,onState){
  const zh=settings.language.startsWith('zh');clearInterval(cliPoll);
  return window.bula.setupCli(name).then(result=>{
    // no terminal found (some Linux desktops): the official command is shown and copied instead
    if(result?.command){navigator.clipboard?.writeText(result.command).catch(()=>{});message(zh?`找不到終端機。請自己開一個終端機貼上這行（已複製）：\n${result.command}`:`No terminal found. Open one and paste this (copied):\n${result.command}`,'error');}
    onState({waiting:true});const until=Date.now()+10*60*1000;
    cliPoll=setInterval(async()=>{const state=(await window.bula.cliStatus())[name];if(state.loggedIn||Date.now()>until){clearInterval(cliPoll);onState(state);if(state.loggedIn)status(zh?`${CLI_NAMES[name]} 已登入，可以用了`:`${CLI_NAMES[name]} is ready`);}},3000);
  },error=>message(cleanError(error),'error'));
}
async function showCli(){
  const name=$('provider').value;if(!CLI_NAMES[name]){$('cli-setup').hidden=true;return;}
  const state=(await window.bula.cliStatus())[name];if($('provider').value!==name)return;
  $('cli-setup').hidden=state.loggedIn;$('cli-status').textContent=cliText(name,state);$('cli-install').textContent=cliAction(state);$('cli-install').disabled=false;
}
$('cli-install').onclick=()=>{const name=$('provider').value,zh=settings.language.startsWith('zh');setupCli(name,state=>{if(state.waiting){$('cli-install').disabled=true;$('cli-status').textContent=zh?'已開啟終端機，完成登入後會自動偵測…':'Finish in Terminal; this updates automatically…';}else showCli();});};
function modelChoices(container,name,selected,state){
  const zh=settings.language.startsWith('zh');
  container.replaceChildren(...state.models.map(m=>{const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name=name;input.value=m.id;input.checked=m.id===selected;input.disabled=!m.fits&&!m.installed;
    const b=document.createElement('b');b.textContent=m.name;const small=document.createElement('small');
    small.textContent=[`${(m.bytes/1e9).toFixed(1)} GB`,zh?m.hint:m.hintEn,m.id===state.recommended&&(zh?'推薦這台 Mac':'recommended'),m.installed&&(zh?'已下載 ✓':'downloaded ✓'),!m.fits&&(zh?`需要 ${m.minRam} GB 記憶體`:`needs ${m.minRam} GB RAM`)].filter(Boolean).join(' · ');
    label.append(input,b,small);return label;}));
}
async function showLlm(){llmState=await window.bula.llmStatus();modelChoices($('llm-models'),'llm-model',document.querySelector('input[name=llm-model]:checked')?.value||settings.builtinModel||llmState.recommended,llmState);updateLlm();}
function updateLlm(){
  if(!llmState)return;const zh=settings.language.startsWith('zh');const id=document.querySelector('input[name=llm-model]:checked')?.value;const model=llmState.models.find(m=>m.id===id);const dl=llmState.downloading;
  $('llm-install').hidden=!model||model.installed||dl?.id===id;$('llm-install').disabled=Boolean(dl);$('llm-remove').hidden=!model?.installed;$('llm-progress').hidden=!dl;if(dl)$('llm-progress').value=dl.progress;
  $('llm-status').textContent=dl?`${zh?'正在下載':'Downloading'} ${llmState.models.find(m=>m.id===dl.id)?.name} ${Math.round(dl.progress*100)}%`:model?.installed?(zh?'已下載，存檔後就會用它':'Ready to use'):(zh?'選好後按下載':'Pick one, then download');
}
async function installLlm(id){
  const zh=settings.language.startsWith('zh');const job=window.bula.installLlm(id);if(llmState)llmState.downloading={id,progress:0};updateLlm();
  try{llmState=await job;status(zh?'本機模型下載完成，可以聊天了':'Local model ready');}catch(error){message(cleanError(error),'error');}
  if(!$('builtin-settings').hidden)await showLlm();
}
window.bula.onLlmProgress(({id,progress})=>{if(llmState)llmState.downloading={id,progress};updateLlm();status(`${settings.language.startsWith('zh')?'正在下載本機模型':'Downloading local model'} ${Math.round(progress*100)}%`);});
$('llm-models').onchange=updateLlm;
$('llm-install').onclick=()=>installLlm(document.querySelector('input[name=llm-model]:checked').value);
$('llm-remove').onclick=async()=>{try{llmState=await window.bula.removeLlm(document.querySelector('input[name=llm-model]:checked').value);}catch(error){message(cleanError(error),'error');}await showLlm();};
$('provider').onchange = localFields;
// ⤢ cycles the chat panel through normal, large and extra large; the window grows up and to the left.
$('chat-size').onclick=async()=>{const order=['normal','large','xl'],next=order[(order.indexOf(document.body.dataset.chatSize||'large')+1)%order.length];
  document.body.dataset.chatSize=await window.bula.chatSize(next);$('conversation').scrollTop=$('conversation').scrollHeight;armIdle();};
$('settings-toggle').onclick = () => { if ($('settings').hidden) { loadWatchSources(); showRemote(); showPeople(); loadVoices().catch(()=>{}); } $('settings').hidden = !$('settings').hidden; document.body.classList.toggle('settings', !$('settings').hidden); };
// Settings are grouped like the Mac's System Settings: a sidebar of sections, one shown at a time (the last one is remembered)
function showPane(name){
  if(!document.querySelector(`#settings-nav [data-pane="${name}"]`))name='brain';
  for(const b of document.querySelectorAll('#settings-nav button'))b.setAttribute('aria-selected',String(b.dataset.pane===name));
  for(const pane of document.querySelectorAll('#settings-panes .pane'))pane.hidden=pane.dataset.pane!==name;
  $('settings-panes').scrollTop=0;try{localStorage.setItem('settings-pane',name);}catch{}
}
for(const b of document.querySelectorAll('#settings-nav button'))b.onclick=()=>showPane(b.dataset.pane);
{let pane='brain';try{pane=localStorage.getItem('settings-pane')||pane;}catch{}showPane(pane);}
$('save').onclick = async () => {
  try { settings = await window.bula.saveSettings({ ...brainChoice($('provider').value), builtinModel:document.querySelector('input[name=llm-model]:checked')?.value||settings.builtinModel, gameEngine:$('game-engine').value, game:$('game-choice').value, base:$('base').value, model:$('model').value, replyLanguage:$('reply-language').value, ...voiceChoice() }); await saveWake().catch(error=>message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error')); $('settings').hidden = true; document.body.classList.remove('settings'); status(`${settings.provider} · ${t.saved}`); }
  catch (e) { message(e.message, 'error'); $('settings').hidden = true; document.body.classList.remove('settings'); }
};
$('chat-form').onsubmit = async event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!text || busy||composing) return;clearTimeout(voiceTimer);
  if(activeTask){
    busy=true;$('send').disabled=true;
    try{await window.bula.taskSteer({id:activeTask,text});message(text,'user');history.push({role:'user',content:text});$('prompt').value='';status(settings.language.startsWith('zh')?'已送出補充指示':'Task update sent');}catch(error){message(error.message,'error');}finally{busy=false;$('send').disabled=false;}return;
  }
  if(!['auto','chat'].includes($('task-mode').value)){
    busy=true;$('send').disabled=true;showChat(false);
    try{const task=await window.bula.task({mode:$('task-mode').value,text,history});setActiveTask(task.id);message(text,'user');history.push({role:'user',content:text});$('prompt').value='';status(characterState.mod.name+' · '+(settings.language.startsWith('zh')?'我來處理，完成後告訴你':'I’m on it. I’ll explain the result here.'));}
    catch(error){message(error.message,'error');}
    finally{busy=false;$('send').disabled=false;armIdle();}return;
  }
  busy = true; $('send').disabled = true; $('prompt').value = ''; message(text,'user'); history.push({role:'user',content:text}); status(`${settings.provider} · ${t.thinking}`); emotion('neutral');
  try {
    const reply = await window.bula.chat(text,{auto:$('task-mode').value==='auto'});
    if (!reply.ok) { history.pop(); message(reply.error,'error'); status(t.failed); emotion('nervous'); }
    else if(reply.task){setActiveTask(reply.task.id);if(reply.text){history.push({role:'assistant',content:reply.text});message(reply.text);emotion(reply.emotion);}const zh=settings.language.startsWith('zh'),mode=reply.mode||'files';status(characterState.mod.name+' · '+({files:zh?'正在整理，檔案會放到桌面':'Organizing files on your Desktop',browser:zh?'正在操作瀏覽器':'Working in the browser',computer:zh?'正在操作電腦':'Working on your computer'})[mode]);}
    else { history.push({role:'assistant',content:reply.text}); if(history.length>2000)history.splice(0,history.length-2000); message(reply.text); $('subtitle').textContent = reply.text; if(document.body.classList.contains('streaming')) $('subtitle').hidden=false; emotion(reply.emotion); status(`${reply.model} · ${t.done}`); }
  } catch (e) { history.pop(); message(e.message,'error'); status(t.failed); }
  finally { busy = false; $('send').disabled = false; $('prompt').focus(); armIdle(); }
};
$('reset').onclick = async () => { if (busy||activeTask) return;try{await window.bula.clearHistory();history.splice(0);progressMessages.clear();$('conversation').replaceChildren();message(t.reset);$('subtitle').textContent='';}catch(error){message(error.message,'error');} };
$('files').onclick=()=>window.bula.files().catch(error=>message(error.message,'error'));
$('wardrobe').onclick = () => window.bula.wardrobe().catch(error=>message(error.message,'error'));
$('agent-console').onclick=()=>window.bula.agentConsole().then(result=>{if(result?.log){showChat(false);message(result.log);}}).catch(error=>message(error.message,'error'));
document.querySelectorAll('[data-permission]').forEach(button=>button.onclick=()=>window.bula.operationPermissions(button.dataset.permission).catch(error=>message(error.message,'error')));
$('official-setup').onclick=()=>window.bula.officialSetup().catch(error=>{message(error.message,'error');$('settings').hidden=true;document.body.classList.remove('settings');});
$('emergency-stop').onclick=()=>window.bula.emergencyStop().catch(error=>message(error.message,'error'));
window.bula.onFocusChat(()=>showChat(true));
$('voice-input').onclick=()=>{
  voiceMode=!voiceMode;$('voice-input').setAttribute('aria-pressed',String(voiceMode));clearTimeout(voiceTimer);showChat(true);
  status(voiceMode?(settings.language.startsWith('zh')?'使用 Typeless 語音快捷鍵；貼入後自動送出':'Use your Typeless shortcut; pasted text sends automatically'):(settings.language.startsWith('zh')?'語音自動送出已關閉':'Voice auto-send off'));
};
$('prompt').addEventListener('compositionstart',()=>{composing=true;clearTimeout(voiceTimer);});
$('prompt').addEventListener('compositionend',()=>{composing=false;armIdle();});
$('prompt').addEventListener('keydown',event=>{
  if(event.key==='Enter'&&!event.shiftKey){
    if(event.isComposing||composing||event.keyCode===229)return;
    event.preventDefault();$('chat-form').requestSubmit();
  }
});
// Text from Typeless arrives as a paste: send it after a short pause, in voice mode or right after a wake-word question.
const autoSend=()=>voiceMode||Date.now()<typelessArmed;
function armSend(){clearTimeout(voiceTimer);voiceTimer=setTimeout(()=>{if(autoSend()&&!composing&&!busy&&document.activeElement===$('prompt')&&$('prompt').value.trim()){typelessArmed=0;$('chat-form').requestSubmit();}},800);}
$('prompt').addEventListener('paste',event=>{if(autoSend()&&event.isTrusted)armSend();});
$('prompt').addEventListener('input',event=>{if(Date.now()<typelessArmed&&event.isTrusted&&/^insert(FromPaste|Text|ReplacementText)$/.test(event.inputType||''))armSend();});
$('close').onclick = () => window.bula.hide();
window.bula.onSpeaking(on => {$('bula').classList.toggle('talking',on);armIdle();});
// Spoken replies play here with WebAudio on every platform; each clip reports back when it ends, fails or is stopped.
const speaker={context:null,current:null,generation:0};
window.bula.onAudioPlay(async({id,data,mime})=>{
  stopClip();const generation=++speaker.generation;
  try{
    // with no working output device (a headless machine, a device that vanished) the context never runs: don't wait on it forever
    speaker.context||=new AudioContext({latencyHint:'interactive'});if(speaker.context.state==='suspended')await Promise.race([speaker.context.resume(),new Promise(r=>setTimeout(r,1000))]);
    const buffer=await speaker.context.decodeAudioData(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
    if(generation!==speaker.generation){window.bula.audioDone(id,'stopped');return;}
    const source=speaker.context.createBufferSource();source.buffer=buffer;source.connect(speaker.context.destination);
    let finished=false;const end=()=>{if(finished)return;finished=true;clearTimeout(guard);if(speaker.current?.source===source)speaker.current=null;window.bula.audioDone(id,null);};
    const guard=setTimeout(end,buffer.duration*1000+1500);  // the clip's own length, if 'ended' never comes
    speaker.current={id,source,guard};source.onended=end;source.start();
  }catch(error){window.bula.audioDone(id,`${mime}: ${error?.message||error}`);}
});
function stopClip(){const clip=speaker.current;speaker.current=null;if(!clip)return;clip.source.onended=null;clearTimeout(clip.guard);try{clip.source.stop();}catch{}window.bula.audioDone(clip.id,'stopped');}
window.bula.onAudioStop(id=>{if(id==null||speaker.current?.id===id){speaker.generation++;stopClip();}});
window.bula.onStreaming(on => { document.body.classList.toggle('streaming',on); if(!on)showChat(false); $('subtitle').hidden = !on || !$('subtitle').textContent; });
window.bula.onNotice(text => { if(previewing){endPreview(text);return;} message(text,'error'); status(t.speechFailed); });
window.bula.onTask(event=>{
  if(['result','error','cancelled'].includes(event.type)&&event.id===activeTask)setActiveTask(null);
  if(['working','progress','approval'].includes(event.type))setActiveTask(event.id);
  if(event.type==='progress'){
    if(event.text){showChat(false);
      const key=event.id+':'+event.messageId;
      const previous=event.messageId&&progressMessages.get(key);
      if(previous?.isConnected)previous.textContent=event.text;
      else {const bubble=message(event.text);if(event.messageId)progressMessages.set(key,bubble);}
      $('conversation').scrollTop=$('conversation').scrollHeight;
      if(document.body.classList.contains('streaming')){$('subtitle').textContent=event.text;$('subtitle').hidden=false;}
      status(characterState.mod.name+' · '+t.thinking);
    }return;
  }
  if(event.type==='working'){status(characterState.mod.name+' · '+t.thinking);return;}
  if(!event.text)return;
  if(['result','error','cancelled'].includes(event.type)&&histories[event.provider]){const context=histories[event.provider];context.push({role:'assistant',content:event.text,artifacts:event.artifacts});if(context.length>2000)context.splice(0,context.length-2000);}
  if(!document.body.classList.contains('streaming'))showChat(false);
  if(['result','error','cancelled'].includes(event.type)){
    for(const [key,bubble] of progressMessages){
      if(key.startsWith(event.id+':')){if(bubble.textContent.trim()===event.text.trim())bubble.remove();progressMessages.delete(key);}
    }
  }
  message(event.text,event.type==='error'?'error':'assistant',event.artifacts);
  $('subtitle').textContent=event.text;
  if(document.body.classList.contains('streaming'))$('subtitle').hidden=false;
  emotion(event.type==='error'?'nervous':event.type==='result'?'happy':'neutral');
  status(characterState.mod.name+' · '+(event.type==='approval'?(settings.language.startsWith('zh')?'等你確認':'Waiting for confirmation'):event.type==='error'?t.failed:event.type==='cancelled'?(settings.language.startsWith('zh')?'已停止':'Stopped'):t.done));
  armIdle();
});
window.bula.onState(renderState);
function blink() { Avatars.blink($('bula')); setTimeout(blink,2800+Math.random()*2500); }
setTimeout(blink,2200);
init().then(()=>{if(!settings.onboarded)startOnboarding();}).catch(e => { message(e.message,'error'); status('啟動未完成'); });

function armIdle(){clearTimeout(idleTimer);idleTimer=setTimeout(collapseIfIdle,15000);}
function collapseIfIdle(){
  if(document.body.classList.contains('onboarding')){armIdle();return;}
  if(busy||voiceMode||composing||window.getSelection()?.toString()||characterState?.speaking||$('prompt').value.trim()||!$('settings').hidden||['working','waiting_for_approval'].includes(characterState?.activity)){armIdle();return;}
  if(document.body.classList.contains('streaming'))return;
  document.body.classList.add('closing-chat');
  clearTimeout(closingTimer);closingTimer=setTimeout(()=>{
    $('panel').hidden=true;document.body.classList.remove('closing-chat');document.body.classList.add('quiet');
    window.bula.compact(true).catch(error=>console.error(error.message));
  },180);
}
function showChat(focus=false){
  clearTimeout(closingTimer);$('panel').hidden=false;document.body.classList.remove('quiet','closing-chat');
  window.bula.compact(false).catch(error=>console.error(error.message));armIdle();if(focus)$('prompt').focus();
}
$('panel').addEventListener('pointerdown',()=>{clearTimeout(closingTimer);document.body.classList.remove('closing-chat');armIdle();});
$('panel').addEventListener('keydown',armIdle);
$('prompt').addEventListener('input',armIdle);
$('conversation').addEventListener('scroll',armIdle);

// Character interaction: drag to move, press without moving to poke, eyes follow the cursor, idle glances.
const pet=$('pet-wrap');let pokes=[],reactTimer,lastCursor=null,stillSince=Date.now();
function react(kind,ms=1300){const el=$('bula');if(el)Avatars.react(el,kind,ms);}
function poke(){
  if($('panel').hidden)showChat(true);
  const el=$('bula'),now=Date.now();pokes=pokes.filter(time=>now-time<700);pokes.push(now);
  const has=cls=>Avatars.has(el,cls);
  if(pokes.length>=2){react(has('love-eyes')?'love':has('joy-eyes')?'joy':'surprised',1800);return;}
  const options=['surprised',...(has('joy-eyes')?['joy']:[]),...(has('wink')?['wink','wink']:[])];
  react(options[Math.floor(Math.random()*options.length)]);armIdle();
}
pet.addEventListener('pointerdown',event=>{if(event.button!==0||document.body.classList.contains('streaming'))return;pet.setPointerCapture(event.pointerId);window.bula.drag('start').catch(()=>{});});
pet.addEventListener('pointerup',async()=>{try{const result=await window.bula.drag('end');if(!result.moved)poke();}catch{}});
pet.addEventListener('pointercancel',()=>window.bula.drag('end').catch(()=>{}));
function look(dx,dy){Avatars.look($('bula'),dx,dy);}
setInterval(async()=>{
  if(document.hidden||document.body.classList.contains('streaming'))return;
  // 3D models have no .eyes element: aim from the upper third of the character instead.
  const el=$('bula');if(!el)return;const eyes=el.querySelector('.eyes')||el;
  let cursor;try{cursor=await window.bula.cursor();}catch{return;}
  if(!lastCursor||Math.abs(cursor.x-lastCursor.x)+Math.abs(cursor.y-lastCursor.y)>3)stillSince=Date.now();lastCursor=cursor;
  if(Date.now()-stillSince>8000){if(Math.random()<.04){const side=Math.random()<.5?-1:1;look(side,.2);setTimeout(()=>look(0,0),900);}return;}
  const box=eyes.getBoundingClientRect(),dx=cursor.x-(box.left+box.width/2),dy=cursor.y-(box.top+(eyes===el?box.height*.35:box.height/2)),distance=Math.hypot(dx,dy)||1,reach=Math.min(1,distance/220);
  look(dx/distance*reach,dy/distance*reach);
},120);

// --- AI voice settings: provider, OpenAI voice/model/style and the API key guide.
const VOICE_NOTES={marin:'推薦 · 自然',cedar:'推薦 · 沉穩',alloy:'中性',ash:'清亮',ballad:'柔和',coral:'溫暖',echo:'低沉',fable:'說書感',nova:'明亮',onyx:'厚實',sage:'平靜',shimmer:'輕快',verse:'表情豐富'};
function voiceChoice(){return {voiceProvider:$('voice-provider').value,openaiVoice:$('openai-voice-name').value,openaiModel:$('openai-model').value,openaiStyle:$('openai-style').value,kokoroVoice:$('kokoro-voice-name').value,kokoroSpeed:+$('kokoro-speed').value,edgeVoice:$('edge-voice-name').value,edgeRate:+$('edge-rate').value};}
const KOKORO_NAMES={zf_xiaoxiao:'曉曉 · 女聲',zf_xiaobei:'小北 · 女聲',zf_xiaoni:'小妮 · 女聲',zf_xiaoyi:'小藝 · 女聲',zm_yunxi:'雲希 · 男聲',zm_yunjian:'雲健 · 男聲',zm_yunxia:'雲夏 · 男聲',zm_yunyang:'雲揚 · 男聲',af_heart:'Heart · English',af_bella:'Bella · English',af_nicole:'Nicole · English',af_sky:'Sky · English',am_michael:'Michael · English',am_adam:'Adam · English',bf_emma:'Emma · British',bm_george:'George · British'};
function showKokoro(state){const zh=settings.language.startsWith('zh');$('kokoro-voice').hidden=$('voice-provider').value!=='kokoro';$('kokoro-status').textContent=state.installed?(zh?'語音模型：已安裝 ✓':'Voice model: installed ✓'):state.downloading?(zh?'正在下載語音模型…':'Downloading voice model…'):(zh?'語音模型：尚未下載':'Voice model: not downloaded');$('kokoro-install').hidden=state.installed;$('kokoro-install').disabled=state.downloading;$('kokoro-preview').disabled=!state.installed;$('kokoro-progress').hidden=!state.downloading;}
function showVoice(hasKey,kokoroState){
  const zh=settings.language.startsWith('zh');$('openai-voice').hidden=$('voice-provider').value!=='openai';$('edge-voice').hidden=$('voice-provider').value!=='edge';if(kokoroState)showKokoro(kokoroState);
  $('openai-key-status').textContent=hasKey?(zh?'API key：已儲存 ✓':'API key: saved ✓'):(zh?'API key：尚未設定':'API key: not set');
  $('openai-key-toggle').textContent=hasKey?(zh?'更換 API key':'Replace API key'):(zh?'設定 API key':'Set up API key');
  $('openai-key-clear').hidden=!hasKey;if(!hasKey&&$('voice-provider').value==='openai')$('openai-key-guide').hidden=false;
}
async function initVoice(){
  const voice=await window.bula.voiceStatus();
  $('openai-voice-name').replaceChildren(...voice.voices.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=`${name} · ${VOICE_NOTES[name]||''}`;return option;}));
  $('kokoro-voice-name').replaceChildren(...voice.kokoro.voices.map(v=>{const option=document.createElement('option');option.value=v.name;option.textContent=KOKORO_NAMES[v.name]||v.name;return option;}));
  $('kokoro-voice-name').value=settings.kokoroVoice||'zf_xiaoxiao';$('kokoro-speed').value=settings.kokoroSpeed||1;$('kokoro-speed-value').textContent=`${(+$('kokoro-speed').value).toFixed(2)}×`;
  $('edge-voice-name').replaceChildren(...voice.edge.voices.map(v=>{const option=document.createElement('option');option.value=v.name;option.textContent=v.label;return option;}));
  $('edge-voice-name').value=settings.edgeVoice||'zh-TW-HsiaoChenNeural';$('edge-rate').value=settings.edgeRate||1;$('edge-rate-value').textContent=`${(+$('edge-rate').value).toFixed(2)}×`;
  $('voice-provider').value=settings.volume===false?'off':settings.voiceProvider||'system';$('openai-voice-name').value=settings.openaiVoice;$('openai-model').value=settings.openaiModel;$('openai-style').value=settings.openaiStyle||'';
  showVoice(voice.hasOpenAIKey,voice.kokoro);loadVoices().catch(()=>{});
}
$('voice-provider').onchange=async()=>{const v=await window.bula.voiceStatus();showVoice(v.hasOpenAIKey,v.kokoro);};
$('openai-key-toggle').onclick=()=>{$('openai-key-guide').hidden=!$('openai-key-guide').hidden;if(!$('openai-key-guide').hidden)$('openai-key').focus();};
document.querySelectorAll('[data-openai]').forEach(button=>button.onclick=()=>window.bula.openOpenAI(button.dataset.openai).catch(error=>message(error.message,'error')));
$('openai-key-save').onclick=async()=>{
  const input=$('openai-key'),key=input.value;input.value='';const zh=settings.language.startsWith('zh');
  if(!key.trim()){message(zh?'請先貼上 API key。':'Paste your API key first.','error');return;}
  $('openai-key-save').disabled=true;status(zh?'正在向 OpenAI 驗證 key…':'Verifying the key with OpenAI…');
  try{const result=await window.bula.setOpenAIKey(key);showVoice(true);if(result.warning){message(result.warning,'error');status(zh?'API key 已保存，需先儲值':'API key saved; add credit first');}else{$('openai-key-guide').hidden=true;status(zh?'API key 已驗證並加密保存':'API key verified and stored encrypted');}}
  catch(error){message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error');status(zh?'API key 未儲存':'API key not saved');}
  finally{$('openai-key-save').disabled=false;}
};
$('openai-key-clear').onclick=async()=>{await window.bula.clearOpenAIKey();showVoice(false);status(settings.language.startsWith('zh')?'已移除這台 Mac 上的 API key':'API key removed from this Mac');};
$('voice-preview').onclick=()=>{const zh=settings.language.startsWith('zh');const name=characterState?.mod.name||'Annie';window.bula.previewVoice({...voiceChoice(),text:zh?`嗨，我是 ${name}！這是我的新聲音，喜歡嗎？`:`Hi, I'm ${name}! This is my new voice. Do you like it?`}).catch(error=>message(error.message,'error'));};

$('kokoro-speed').oninput=()=>{$('kokoro-speed-value').textContent=`${(+$('kokoro-speed').value).toFixed(2)}×`;};
window.bula.onKokoroProgress(p=>{$('kokoro-progress').hidden=false;$('kokoro-progress').value=p;});
$('kokoro-install').onclick=async()=>{
  const zh=settings.language.startsWith('zh');showKokoro({installed:false,downloading:true});status(zh?'正在下載本機語音模型…':'Downloading the local voice model…');
  try{await window.bula.installKokoro();showKokoro({installed:true,downloading:false});status(zh?'本機語音模型已安裝':'Local voice model installed');}
  catch(error){showKokoro({installed:false,downloading:false});message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error');}
};
$('kokoro-preview').onclick=()=>{const zh=settings.language.startsWith('zh');const name=characterState?.mod.name||'Annie';const en=/^(a|b)[fm]_/.test($('kokoro-voice-name').value);window.bula.previewVoice({...voiceChoice(),voiceProvider:'kokoro',text:(zh&&!en)?`嗨，我是 ${name}！這是我在你電腦上的聲音，喜歡嗎？`:`Hi, I'm ${name}! This voice runs right on your Mac. Do you like it?`}).catch(error=>message(error.message,'error'));};

$('edge-rate').oninput=()=>{$('edge-rate-value').textContent=`${(+$('edge-rate').value).toFixed(2)}×`;};
$('edge-preview').onclick=()=>{const name=characterState?.mod.name||'Annie';const v=$('edge-voice-name').value;const text=v.startsWith('zh')?`嗨，我是 ${name}！這是台灣腔的聲音，聽起來怎麼樣？`:v.startsWith('ja')?`こんにちは、${name}です！この声はどうですか？`:`Hi, I'm ${name}! How does this voice sound?`;window.bula.previewVoice({...voiceChoice(),voiceProvider:'edge',text}).catch(error=>message(error.message,'error'));};

// ⌘/Ctrl-scroll or a trackpad pinch over the character resizes it; the window follows.
let scaleTimer;
pet.addEventListener('wheel',event=>{
  if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();event.stopPropagation();
  const current=+getComputedStyle(document.documentElement).getPropertyValue('--scale')||1;
  const next=Math.max(.6,Math.min(1.6,current*Math.exp(-event.deltaY*.004)));
  document.documentElement.style.setProperty('--scale',next.toFixed(3));armIdle();
  clearTimeout(scaleTimer);scaleTimer=setTimeout(()=>window.bula.scale(next).then(saved=>{settings.scale=saved;status(`${Math.round(saved*100)}%`);}),120);
},{passive:false,capture:true});

// --- Hands-free: wake word -> dictation -> send. The microphone runs only while wake is enabled.
let mic=null;
async function startMic(){
  if(mic||micPaused)return;
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const context=new AudioContext();await context.audioWorklet.addModule('mic-worklet.js');
  const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'mic-downsampler');
  node.port.onmessage=event=>window.bula.micAudio(event.data);source.connect(node);mic={stream,context};showMicButton();
}
function stopMic(){if(!mic)return;mic.stream.getTracks().forEach(track=>track.stop());mic.context.close();mic=null;$('mic-indicator').classList.remove('listening');showMicButton();}
// The mic button next to Skin: listening for the wake word (blue), hearing you (pulsing red), or paused (🔇). A click pauses
// the microphone altogether, ending any dictation or follow-up listening; another click turns it back on. Esc also ends
// an active listen.
let micPaused=false;
function showMicButton(){const zh=settings?.language?.startsWith('zh')!==false,b=$('mic-toggle');b.hidden=!mic&&!micPaused;b.classList.toggle('paused',micPaused);
  const label=micPaused?(zh?'監聽已暫停，按一下恢復':'Listening paused; click to resume'):(zh?'停止監聽':'Stop listening');b.title=label;b.setAttribute('aria-label',label);}
$('mic-toggle').onclick=async event=>{event.stopPropagation();const zh=settings.language.startsWith('zh');
  if(micPaused){micPaused=false;try{await startMic();status(zh?'恢復監聽了':'Listening again');}catch(error){message(`麥克風無法啟動：${error.message}`,'error');}}
  else{micPaused=true;stopMic();await window.bula.listenCancel().catch(()=>{});status(zh?'已停止監聽，按 🔇 恢復':'Stopped listening');}
  showMicButton();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('mic-indicator').classList.contains('listening')&&!characterState?.speaking){event.preventDefault();$('mic-indicator').classList.remove('listening');window.bula.listenCancel().catch(()=>{});status(settings.language.startsWith('zh')?'好，不聽了':'Stopped listening');}});
function showAsr(state){const zh=settings.language.startsWith('zh');$('asr-status').textContent=state.installed?(zh?'語音辨識模型：已安裝 ✓':'Speech model: installed ✓'):state.downloading?(zh?'正在下載語音辨識模型…':'Downloading…'):(zh?'語音辨識模型：尚未下載':'Speech model: not downloaded');$('asr-install').hidden=state.installed;$('asr-install').disabled=state.downloading;$('asr-progress').hidden=!state.downloading;}
async function initWake(){
  const wake=await window.bula.wakeStatus();$('wake-enabled').checked=wake.enabled;$('wake-phrases').value=wake.custom;$('wake-sensitivity').value=wake.sensitivity||'high';$('barge-in').checked=wake.bargeIn!==false;$('conversation-mode').checked=wake.conversationMode!==false;$('dictation-engine').value=wake.engine;showTypeless(wake.typeless);$('wake-phrases').placeholder=wake.phrases.join(', ');showAsr(wake.asr);
  if(wake.enabled)startMic().catch(error=>message(`麥克風無法啟動：${error.message}`,'error'));
}
function showTypeless(state){
  const zh=settings.language.startsWith('zh'),on=$('dictation-engine').value==='typeless';$('typeless-note').hidden=!on;
  $('typeless-note').textContent=!state.installed?(zh?'這台 Mac 沒有安裝 Typeless，叫醒後會改用本機辨識。':'Typeless is not installed; the local recogniser is used.'):!state.supported?(zh?`Typeless 的聽寫快捷鍵是「${state.shortcut}」；目前只支援 Fn，請在 Typeless 改回 Fn。`:`Typeless dictation is set to "${state.shortcut}"; only Fn is supported.`):(zh?'叫醒後我會按 Fn 讓 Typeless 聽你說，講完停一下就送出。需要「輔助使用」權限。':'After waking, I tap Fn for Typeless; pause when done and it sends. Needs Accessibility permission.');
}
$('dictation-engine').onchange=async()=>showTypeless((await window.bula.wakeStatus()).typeless);
async function saveWake(){
  const result=await window.bula.wakeSettings({wakeEnabled:$('wake-enabled').checked,wakePhrases:$('wake-phrases').value,wakeSensitivity:$('wake-sensitivity').value,bargeIn:$('barge-in').checked,conversationMode:$('conversation-mode').checked,dictationEngine:$('dictation-engine').value});
  $('wake-phrases').placeholder=result.phrases.join(', ');
  if(result.enabled)await startMic();else stopMic();
  return result;
}
window.bula.onAsrProgress(p=>{$('asr-progress').hidden=false;$('asr-progress').value=p;});
$('asr-install').onclick=async()=>{const zh=settings.language.startsWith('zh');showAsr({installed:false,downloading:true});
  try{await window.bula.installAsr();showAsr({installed:true,downloading:false});status(zh?'語音辨識模型已安裝':'Speech model installed');}
  catch(error){showAsr({installed:false,downloading:false});message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error');}};
window.bula.onWake(info=>{
  const zh=settings.language.startsWith('zh');showChat(true);react('surprised',900);
  // Typeless types into whatever has focus: close settings so the chat box (not a settings field) receives the question
  if(info.typeless){if(!$('settings').hidden){$('settings').hidden=true;document.body.classList.remove('settings');}document.activeElement?.blur?.();$('prompt').value='';$('prompt').focus();typelessArmed=Date.now()+40000;$('mic-indicator').classList.add('listening');status(zh?'我在聽（Typeless），請說…':'Listening (Typeless)…');}
  else if(info.dictation){$('mic-indicator').classList.add('listening');status(zh?'我在聽，請說…':'Listening…');}else status(zh?'我在！（下載語音辨識模型後可以直接用說的）':'I\'m here!');
});
// interrupting the companion, and the follow-up window after a reply, both just listen
window.bula.onBargeIn(()=>{const zh=settings.language.startsWith('zh');showChat(true);$('mic-indicator').classList.add('listening');status(zh?'好，我在聽…':'Listening…');});
window.bula.onFollow(({seconds})=>{const zh=settings.language.startsWith('zh');$('mic-indicator').classList.add('listening');status(zh?`還在聽，可以直接說下一句（${seconds} 秒）`:`Still listening for ${seconds} s`);});
window.bula.onDictation(({text,follow})=>{
  const zh=settings.language.startsWith('zh');$('mic-indicator').classList.remove('listening');
  if(!text){if(follow){status(zh?'要再聊就叫我一聲':'Call me when you need me');return;}status(zh?'沒聽清楚，再叫我一次':'Didn\'t catch that');return;}
  $('prompt').value=text;$('chat-form').requestSubmit();
});
window.bula.onTypeless(({state,error})=>{
  const zh=settings.language.startsWith('zh');$('mic-indicator').classList.remove('listening');
  if(state==='processing'){typelessArmed=Date.now()+15000;$('prompt').focus();status(zh?'Typeless 辨識中…':'Typeless is transcribing…');}
  else{typelessArmed=0;if(state==='error')message(error,'error');else status(zh?'沒聽到問題，再叫我一次':'Didn\'t hear a question');}
});
window.bula.onMicLevel(level=>{$('mic-level').value=level;});

// --- 聲音: voice profiles (萌系混音, VOICEVOX, and cloned voices from 錄音複製), bound per character, exported as packs.
let voicesState=null,vvSpeakers=[];
const ENGINE_NAMES={'kokoro-mix':'萌系混音','voicevox':'VOICEVOX','cosyvoice':'錄音複製','sovits':'錄音複製','elevenlabs':'ElevenLabs'};
const vbutton=(text,fn,cls)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(cls)b.className=cls;b.onclick=()=>Promise.resolve().then(fn).catch(error=>previewing?endPreview(cleanError(error)):message(cleanError(error),'error'));return b;};
$('voice-for').onchange=async()=>{const id=$('voice-for').value||null;await window.bula.voiceBind(id);await loadVoices();status(id?`${characterState?.mod.name||'角色'} 換上了「${$('voice-for').selectedOptions[0].textContent}」`:'改回預設語音');};
$('voice-provider').addEventListener('change',()=>loadVoices().catch(()=>{}));
async function loadVoices(){
  voicesState=await window.bula.voices();const s=voicesState,name=characterState?.mod.name||'角色',bound=s.profiles.find(p=>p.id===s.bound);
  // One answer to "which voice will I hear": the character's own voice wins; otherwise the default voice below
  $('voices-bound').hidden=true;
  const def=$('voice-provider').selectedOptions[0]?.textContent||'',off=$('voice-provider').value==='off';
  $('voice-for-label').textContent=`${name} 用`;
  $('voice-for').replaceChildren(new Option(`預設語音（${def}）`,''),...s.profiles.map(p=>new Option(`${p.cloned?'🔒 ':''}${p.name}`,p.id)));$('voice-for').value=bound?.id||'';
  $('voice-current-text').textContent=off?'🔇 語音已關閉：所有角色都不說話（在下方「預設語音」打開）。':bound?`🔊 ${name} 現在用專屬聲音「${bound.name}」。`:`🔊 ${name} 現在用預設語音：${def}。`;
  $('voice-default').classList.toggle('inactive',Boolean(bound)&&!off);
  $('voice-default-note').textContent=bound&&!off?`${name} 有專屬聲音，這裡的設定只影響沒有專屬聲音的角色。`:'沒有專屬聲音的角色都用這個。';
  $('voices-lang').hidden=!(bound?.engine==='voicevox'&&$('reply-language').value!=='ja');
  $('voice-lab').hidden=typeof window.bula.openVoiceLab!=='function';
  $('voices-list').replaceChildren(...s.profiles.map(p=>{
    const li=document.createElement('li');li.className=p.id===s.bound?'bound':'';li.dataset.id=p.id;
    const title=document.createElement('b');title.textContent=`${p.cloned?'🔒 ':''}${p.name}${p.id===s.bound?`　✓ ${name} 使用中`:''}`;
    const credit=document.createElement('span');credit.className='credit';credit.textContent=`${ENGINE_NAMES[p.engine]||p.engine} · ${p.license.credit?`標示：${p.license.credit} · `:''}${p.license.label}${p.license.commercial?'':' · 非商用'}${p.cloned?` · ${p.consent.person} 本人同意，只在這台 Mac 使用`:''}`;
    // speaking speed of this voice (saved with it); cloned voices often come out slow
    const speed=document.createElement('label');speed.className='voice-speed';const value=document.createElement('span');const range=document.createElement('input');
    range.type='range';range.min='0.7';range.max='1.5';range.step='0.05';range.value=String(p.params?.speed||1);value.textContent=`${Number(range.value).toFixed(2)}×`;
    range.oninput=()=>{value.textContent=`${Number(range.value).toFixed(2)}×`;};
    range.onchange=async()=>{try{const r=await window.bula.voiceSpeed(p.id,Number(range.value));status(`「${p.name}」語速 ${r.speed}×`);}catch(error){message(cleanError(error),'error');}};
    speed.append('語速 ',value,range);
    // cloned CosyVoice voices: fast (default, ~40% quicker) or best quality
    if(p.engine==='cosyvoice'){const q=document.createElement('select');q.append(new Option('快速合成','fast'),new Option('最佳音質（較慢）','best'));q.value=p.params?.quality||'fast';
      q.onchange=async()=>{try{await window.bula.voiceSpeed(p.id,Number(range.value),q.value);status(`「${p.name}」改成${q.selectedOptions[0].textContent}`);}catch(error){message(cleanError(error),'error');}};speed.append(q);}
    const row=document.createElement('div');row.className='voice-row';
    row.append(vbutton('▶ 試聽',()=>window.bula.voicePreview({profileId:p.id})),
      p.id===s.bound?vbutton(`${name} 改回預設語音`,async()=>{await window.bula.voiceBind(null);loadVoices();}):vbutton(`給 ${name} 用`,async()=>{await window.bula.voiceBind(p.id);loadVoices();status(`${name} 換上了「${p.name}」`);}));
    if(p.engine==='voicevox')row.append(vbutton('利用規約',async()=>{const info=await window.bula.voicePolicy(p.id);message(`${info.license.credit||p.name}\n${info.policy||'（沒有取得規約文字）'}`);}));
    const exp=vbutton('匯出',async()=>{const r=await window.bula.voiceExport(p.id);if(r.saved)status(`已匯出聲音包：${r.saved}`);});
    if(p.cloned){exp.disabled=true;exp.title='用真人聲音複製的聲音只能在這台 Mac 使用，不能匯出。';}
    else if(p.license.tier==='personal'){exp.disabled=true;exp.title='這個聲音只限自己在這台 Mac 使用（例如社群聲音模型），不能匯出。';}
    row.append(exp,vbutton('刪除',async()=>{if(!confirm(`刪除聲音「${p.name}」？`))return;await window.bula.voiceRemove(p.id);loadVoices();},'danger'));
    li.append(title,credit,speed,row);return li;}));
}
const kokoroOption=v=>{const o=document.createElement('option');o.value=v.name;o.textContent=KOKORO_NAMES[v.name]||v.name;return o;};
function mixLabels(){const b=+$('mix-blend').value,p=+$('mix-pitch').value;$('mix-blend-value').textContent=`${b}% A · ${100-b}% B`;$('mix-pitch-value').textContent=`${p>0?'+':''}${p} 半音`;$('mix-speed-value').textContent=`${(+$('mix-speed').value).toFixed(2)}×`;}
function mixPreset(id){const p=voicesState.presets.find(x=>x.id===id);if(!p)return;$('mix-name').value=p.name;$('mix-a').value=p.mix[0].voice;$('mix-b').value=p.mix[1]?.voice||p.mix[0].voice;$('mix-blend').value=Math.round(p.mix[0].weight*100);$('mix-pitch').value=p.pitch;$('mix-speed').value=p.speed;mixLabels();}
function mixParams(){const a=+$('mix-blend').value/100;return {mix:[{voice:$('mix-a').value,weight:a},{voice:$('mix-b').value,weight:+(1-a).toFixed(2)}].filter(m=>m.weight>0),pitch:+$('mix-pitch').value,speed:+$('mix-speed').value};}
$('voice-new-mix').onclick=async()=>{
  if(!voicesState)await loadVoices();$('voice-vv').hidden=true;$('voice-mix').hidden=false;
  $('mix-preset').replaceChildren(...voicesState.presets.map(p=>Object.assign(document.createElement('option'),{value:p.id,textContent:p.name})));
  $('mix-a').replaceChildren(...voicesState.kokoroVoices.map(kokoroOption));$('mix-b').replaceChildren(...voicesState.kokoroVoices.map(kokoroOption));mixPreset(voicesState.presets[0].id);
  const mix=voicesState.engines.find(e=>e.id==='kokoro-mix');if(!mix?.available)message(mix?.reason||'需要本機 Kokoro 語音模型。','error');
};
$('mix-preset').onchange=()=>mixPreset($('mix-preset').value);
for(const id of ['mix-blend','mix-pitch','mix-speed'])$(id).oninput=mixLabels;
$('mix-preview').onclick=()=>window.bula.voicePreview({engine:'kokoro-mix',params:mixParams()}).catch(error=>previewing?endPreview(cleanError(error)):message(cleanError(error),'error'));
$('mix-save').onclick=async()=>{try{await window.bula.voiceSave({name:$('mix-name').value,engine:'kokoro-mix',params:mixParams(),bind:true});$('voice-mix').hidden=true;await loadVoices();status(`已儲存「${$('mix-name').value}」`);}catch(error){message(cleanError(error),'error');}};
$('mix-cancel').onclick=()=>{$('voice-mix').hidden=true;};
// VOICEVOX: a running engine or VOICEVOX.app is used; otherwise the official engine is downloaded once (about 1.9 GB) after asking.
async function showVoicevox(){
  const s=await window.bula.voicevoxStatus(),gb=s.download?(s.download.size/1e9).toFixed(1):'?';
  $('vv-status').textContent=s.running?'VOICEVOX ENGINE 執行中 ✓':s.installed?`VOICEVOX ENGINE ${s.version} 已下載 ✓`:s.app?'會使用 VOICEVOX.app 內的引擎':s.downloading?'正在下載 VOICEVOX ENGINE…':`需要 VOICEVOX ENGINE ${s.version}（約 ${gb} GB，官方 GitHub 版本）。`;
  $('vv-install').hidden=s.running||s.installed||s.app;$('vv-install').disabled=s.downloading;$('vv-install').textContent=`下載 VOICEVOX ENGINE（約 ${gb} GB）`;$('vv-progress').hidden=!s.downloading;
  if(s.running||s.installed||s.app){vvSpeakers=await window.bula.voicevoxSpeakers();
    $('vv-speaker').replaceChildren(...vvSpeakers.map((v,i)=>Object.assign(document.createElement('option'),{value:String(i),textContent:v.name})));vvStyles();$('vv-pick').hidden=false;}
}
function vvStyles(){const s=vvSpeakers[+$('vv-speaker').value];$('vv-style').replaceChildren(...(s?.styles||[]).map(t=>Object.assign(document.createElement('option'),{value:String(t.id),textContent:t.name})));}
function vvLabels(){$('vv-speed-value').textContent=`${(+$('vv-speed').value).toFixed(2)}×`;const p=+$('vv-pitch').value;$('vv-pitch-value').textContent=`${p>0?'+':''}${p.toFixed(2)}`;}
function vvParams(){const s=vvSpeakers[+$('vv-speaker').value],t=s.styles.find(x=>String(x.id)===$('vv-style').value);return {speakerUuid:s.uuid,speakerName:s.name,styleId:t.id,styleName:t.name,speed:+$('vv-speed').value,pitch:+$('vv-pitch').value,intonation:1};}
$('voice-new-vv').onclick=async()=>{$('voice-mix').hidden=true;$('voice-vv').hidden=false;$('vv-pick').hidden=true;vvLabels();await showVoicevox().catch(error=>message(cleanError(error),'error'));};
$('vv-speaker').onchange=vvStyles;$('vv-speed').oninput=vvLabels;$('vv-pitch').oninput=vvLabels;
let vvRate=null;
window.bula.onVoicevoxProgress(info=>{const {p,done,total,at}=typeof info==='number'?{p:info}:info;$('vv-progress').hidden=false;$('vv-progress').value=p;
  if(done==null)return;const mb=n=>n>=1e9?`${(n/1e9).toFixed(2)} GB`:`${Math.round(n/1e6)} MB`;
  if(vvRate&&at>vvRate.at){const speed=(done-vvRate.done)/((at-vvRate.at)/1000);vvRate.speed=vvRate.speed?vvRate.speed*.8+speed*.2:speed;}vvRate={...vvRate,done,at};
  const left=vvRate.speed>0?(total-done)/vvRate.speed:null,eta=left==null?'':left>3600?`約 ${(left/3600).toFixed(1)} 小時`:left>60?`約 ${Math.ceil(left/60)} 分鐘`:'快好了';
  $('vv-status').textContent=`下載中 ${Math.floor(p*100)}% · ${mb(done)} / ${mb(total)}${vvRate.speed?` · ${mb(vvRate.speed)}/s · ${eta}`:''}（可以先做別的事，關掉 App 下次會接著下載）`;});
$('vv-install').onclick=async()=>{const gb=$('vv-install').textContent.match(/[\d.]+ GB/)?.[0]||'';if(!confirm(`從 VOICEVOX 官方 GitHub 下載 VOICEVOX ENGINE（${gb}）到這台 Mac？下載完會檢查檔案完整性。`))return;
  $('vv-install').disabled=true;$('vv-progress').hidden=false;vvRate=null;status('正在下載 VOICEVOX ENGINE…');
  try{await window.bula.installVoicevox();status('VOICEVOX ENGINE 已安裝');await showVoicevox();}catch(error){message(cleanError(error),'error');$('vv-install').disabled=false;}};
$('vv-preview').onclick=()=>window.bula.voicePreview({engine:'voicevox',params:vvParams()}).catch(error=>previewing?endPreview(cleanError(error)):message(cleanError(error),'error'));
$('vv-save').onclick=async()=>{try{const p=vvParams();const r=await window.bula.voiceSave({name:`${p.speakerName}（${p.styleName}）`,engine:'voicevox',params:p,bind:true});$('voice-vv').hidden=true;await loadVoices();message(`已儲存「${r.profile.name}」。使用時請標示：${r.profile.license.credit}`);}catch(error){message(cleanError(error),'error');}};
$('vv-cancel').onclick=()=>{$('voice-vv').hidden=true;};
$('voices-japanese').onclick=async()=>{await window.bula.voiceJapanese();settings.replyLanguage='ja';$('reply-language').value='ja';loadVoices();status('角色之後會用日文回覆');};
$('voice-import').onclick=async()=>{try{const r=await window.bula.voiceImport();if(r.canceled)return;await loadVoices();message(`已匯入「${r.profile.name}」（${r.profile.license.label}${r.profile.license.credit?`，標示：${r.profile.license.credit}`:''}）`);}catch(error){message(cleanError(error),'error');}};
$('voice-lab').onclick=()=>window.bula.openVoiceLab?.();
$('reply-language').addEventListener('change',()=>{if(voicesState)loadVoices();});

// --- First-run guide: brain, voice, wake word, tips. Pre-filled from current settings; finishing saves them.
let obStep=0,obProviders={};
const OB_BRAINS=[['builtin','本機模型（免費）','在這台 Mac 上跑，不用帳號也不用錢；要先下載模型','Local model (free)','Runs on this Mac, no account or cost; download a model first'],['codex','Codex','用你的 ChatGPT／Codex 帳號','Codex','Uses your ChatGPT / Codex account'],['claude','Claude','用你的 Claude 帳號（Pro／Max 可操作電腦）','Claude','Uses your Claude account (Pro / Max can operate the computer)'],['local','LM Studio','本機模型，完全離線；要先在 LM Studio 載入模型','LM Studio','Local and offline; load a model in LM Studio first']];
// The guide is written in Traditional Chinese; other system languages get the English in each element's data-en.
function localizeOnboarding(){if(settings.language.startsWith('zh'))return;for(const el of document.querySelectorAll('#onboarding [data-en]'))el.textContent=el.dataset.en;}
async function startOnboarding(){
  obProviders=await window.bula.cliStatus().catch(()=>({}));
  // Without a signed-in Codex or Claude, the free built-in model is the one that works out of the box.
  const current=uiProvider(settings),obDefault=settings.onboarded||current==='builtin'||current==='local'||obProviders[current]?.loggedIn?current:'builtin';
  const llm=await window.bula.llmStatus();modelChoices($('ob-llm-models'),'ob-llm-model',settings.builtinModel||llm.recommended,llm);
  const zh=settings.language.startsWith('zh');localizeOnboarding();
  $('ob-brains').replaceChildren(...OB_BRAINS.map(([value,zhName,zhHint,enName,enHint])=>{const name=zh?zhName:enName,hint=zh?zhHint:enHint;const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name='ob-brain';input.value=value;input.checked=obDefault===value;
    const b=document.createElement('b');b.textContent=name;const small=document.createElement('small');small.textContent=hint;label.append(input,b,small);
    const state=obProviders[value];
    if(state){small.textContent=`${hint} · ${cliText(value,state)}`;if(!state.loggedIn){const button=document.createElement('button');button.type='button';button.textContent=cliAction(state);
      button.onclick=event=>{event.preventDefault();input.checked=true;$('ob-llm').hidden=true;setupCli(value,next=>{if(next.waiting){button.disabled=true;button.textContent=zh?'已開啟終端機，完成後會自動偵測…':'Finish in Terminal; this updates automatically…';return;}obProviders[value]=next;small.textContent=`${hint} · ${cliText(value,next)}`;button.hidden=next.loggedIn;button.disabled=false;button.textContent=cliAction(next);});};label.append(button);}}
    return label;}));
  const voice=settings.volume===false?'off':settings.voiceProvider||'edge';document.querySelector(`input[name=ob-voice][value=${['edge','kokoro','system','off'].includes(voice)?voice:'edge'}]`).checked=true;
  const wake=await window.bula.wakeStatus();$('ob-wake').checked=wake.enabled;$('ob-asr').checked=!wake.asr.installed;$('ob-asr').disabled=wake.asr.installed;$('ob-wake-word').textContent=wake.phrases[0]||'嘿安妮';
  $('ob-llm').hidden=obDefault!=='builtin';
  obStep=0;showObStep();document.body.classList.add('onboarding');$('onboarding').hidden=false;showChat(false);clearTimeout(idleTimer);
}
function showObStep(){
  document.querySelectorAll('.ob-page').forEach(page=>{page.hidden=+page.dataset.step!==obStep;});
  document.querySelectorAll('.ob-steps span').forEach((dot,i)=>dot.classList.toggle('done',i<=obStep));
  $('ob-back').hidden=obStep===0;const zh=settings.language.startsWith('zh');$('ob-next').textContent=obStep===3?(zh?'開始使用':'Get started'):(zh?'下一步':'Next');$('ob-skip').hidden=obStep===3;
}
async function finishOnboarding(apply){
  const zh=settings.language.startsWith('zh');
  if(apply){
    const brain=document.querySelector('input[name=ob-brain]:checked')?.value||settings.provider,voice=document.querySelector('input[name=ob-voice]:checked').value;
    const model=document.querySelector('input[name=ob-llm-model]:checked')?.value||settings.builtinModel;
    settings=await window.bula.saveSettings({...brainChoice(brain),builtinModel:model,base:settings.base,model:settings.model,replyLanguage:settings.replyLanguage,...voiceChoice(),voiceProvider:voice});
    $('provider').value=uiProvider(settings);localFields();$('voice-provider').value=voice;
    if(brain==='builtin'&&!(await window.bula.llmStatus()).models.find(m=>m.id===model)?.installed)installLlm(model);
    try{const wake=await window.bula.wakeSettings({wakeEnabled:$('ob-wake').checked});if(wake.enabled)await startMic();else stopMic();$('wake-enabled').checked=wake.enabled;}
    catch(error){message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error');}
    if(voice==='kokoro')$('kokoro-install').click();
    if($('ob-asr').checked&&!$('ob-asr').disabled)$('asr-install').click();
  }
  await window.bula.setOnboarded();settings.onboarded=true;
  document.body.classList.remove('onboarding');$('onboarding').hidden=true;showChat(true);
  status(zh?(apply?'設定完成，點我開始聊天':'已略過引導，可在設定重新開啟'):(apply?'All set. Click me to chat':'Guide skipped; reopen it from Settings'));
}
$('ob-next').onclick=()=>{if(obStep===3)return finishOnboarding(true);obStep++;showObStep();};
$('ob-brains').onchange=()=>{$('ob-llm').hidden=document.querySelector('input[name=ob-brain]:checked')?.value!=='builtin';};
$('ob-back').onclick=()=>{obStep=Math.max(0,obStep-1);showObStep();};
$('ob-skip').onclick=()=>finishOnboarding(false);
$('ob-preview').onclick=()=>{const voice=document.querySelector('input[name=ob-voice]:checked').value;const name=characterState?.mod.name||'Annie';
  if(voice==='kokoro'){status(settings.language.startsWith('zh')?'本機語音要先下載模型，完成引導後會開始下載':'Download starts after the guide');return;}
  window.bula.previewVoice({...voiceChoice(),voiceProvider:voice,text:settings.language.startsWith('zh')?`嗨，我是 ${name}！以後就用這個聲音陪你，可以嗎？`:`Hi, I'm ${name}! Shall I use this voice from now on?`}).catch(error=>message(error.message,'error'));};
// Game decision model: Laya on this Mac, or TypeSafe's Jev API with the user's key (verified, then stored encrypted).
async function showGameEngine(){
  const zh=settings.language.startsWith('zh'),info=await window.bula.gameEngines();if(!$('game-engine').dataset.touched){$('game-engine').value=info.selected;$('game-choice').value=settings.game||'lane';}
  const jev=$('game-engine').value==='jev';$('game-jev').hidden=!jev;$('game-jev-key').hidden=$('game-jev-save').hidden=$('game-jev-get').hidden=info.jev.hasKey;$('game-jev-clear').hidden=!info.jev.hasKey;
  $('game-jev-status').textContent=info.jev.hasKey?(zh?'Jev key 已加密保存 ✓':'Jev key saved (encrypted) ✓'):(zh?'Jev 是 TypeSafe 的付費 API；遊戲每秒最多問 12 次':"Jev is TypeSafe's paid API; the game asks at most 12 times a second");
}
$('game-engine').onchange=()=>{$('game-engine').dataset.touched='1';showGameEngine();};
$('game-jev-save').onclick=async()=>{const zh=settings.language.startsWith('zh');$('game-jev-save').disabled=true;$('game-jev-status').textContent=zh?'驗證中…':'Checking…';
  try{await window.bula.setJevKey($('game-jev-key').value);$('game-jev-key').value='';}catch(error){message(cleanError(error),'error');}$('game-jev-save').disabled=false;showGameEngine();};
$('game-jev-get').onclick=()=>window.bula.openJevKeys();
$('game-jev-clear').onclick=async()=>{await window.bula.clearJevKey();showGameEngine();};
// Characters made from photos: open the camera window, list them, delete one.
async function showPeople(){const zh=settings.language.startsWith('zh'),list=await window.bula.personList().catch(()=>[]);
  $('person-list').replaceChildren(...list.map(p=>{const li=document.createElement('li');const span=document.createElement('span');span.textContent=`🙂 ${p.name}`;const edit=document.createElement('button');edit.type='button';edit.className='edit';edit.textContent=zh?'修改':'Edit';edit.onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');window.bula.personEdit(p.id).catch(error=>message(cleanError(error),'error'));};
    const del=document.createElement('button');del.type='button';del.textContent=zh?'刪除':'Delete';
    del.onclick=async()=>{await window.bula.personDelete(p.id);showPeople();};li.append(span,edit,del);return li;}));}
$('person-open').onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');window.bula.personOpen().catch(error=>message(cleanError(error),'error'));};
// Phone remote: Tailscale publishes a small chat page to the user's own devices; phones pair once with a code.
async function showRemote(status){
  const zh=settings.language.startsWith('zh');status??=await window.bula.remoteStatus().catch(()=>null);if(!status)return;const ts=status.tailscale;
  $('remote-status').textContent=!ts.installed?(zh?'需要先在這台 Mac 和手機安裝 Tailscale，並登入同一個帳號。':'Install Tailscale on this Mac and your phone, signed in to the same account.')
    :!ts.running?(zh?'Tailscale 還沒登入或沒有連線。':'Tailscale is not signed in or not connected.')
    :status.enabled?(zh?`手機遙控開啟中：${status.url}\n只有你 Tailscale 網路裡的裝置連得到。`:`On: ${status.url}\nOnly devices in your tailnet can reach it.`):(zh?`Tailscale 已連線（${ts.dnsName}），可以開啟手機遙控。`:`Tailscale connected (${ts.dnsName}).`);
  $('remote-tasks-row').hidden=!status.enabled;$('remote-tasks').checked=status.remoteTasks;
  $('remote-toggle').textContent=status.enabled?(zh?'關閉手機遙控':'Turn off'):(zh?'開啟手機遙控':'Turn on');$('remote-pair').hidden=!status.enabled;
  $('remote-devices').replaceChildren(...status.devices.map(d=>{const li=document.createElement('li');const span=document.createElement('span');span.textContent=`📱 ${d.name} · ${zh?'最後連線':'last seen'} ${d.lastSeen?new Date(d.lastSeen).toLocaleString():'—'}`;
    const remove=document.createElement('button');remove.type='button';remove.textContent=zh?'移除':'Remove';remove.onclick=async()=>{await window.bula.remoteRevoke(d.id);showRemote();};li.append(span,remove);return li;}));
}
$('remote-toggle').onclick=async()=>{
  $('remote-toggle').disabled=true;$('remote-qr').hidden=true;
  try{const status=await window.bula.remoteStatus();await showRemote(status.enabled?await window.bula.remoteDisable():await window.bula.remoteEnable());}
  catch(error){const text=cleanError(error);$('remote-status').textContent=text;message(text,'error');}
  $('remote-toggle').disabled=false;
};
$('remote-tasks').onchange=async()=>showRemote(await window.bula.remoteTasks($('remote-tasks').checked));
// A phone changed the brain, language or voice: show the new values here too.
window.bula.onSettingsChanged(next=>{settings=next;$('provider').value=uiProvider(settings);$('reply-language').value=settings.replyLanguage||'auto';$('voice-provider').value=settings.volume===false?'off':settings.voiceProvider;localFields();status(settings.language.startsWith('zh')?'設定已從手機更新':'Settings changed from the phone');});
$('remote-pair').onclick=async()=>{
  try{const pair=await window.bula.remotePair();const svg=new DOMParser().parseFromString(pair.qr,'image/svg+xml').documentElement;
    $('remote-qr-image').replaceChildren(document.importNode(svg,true));$('remote-link').textContent=pair.link.replace(/\?pair=.*/,'');$('remote-code').textContent=pair.code;$('remote-qr').hidden=false;
    setTimeout(()=>{$('remote-qr').hidden=true;showRemote();},Math.max(0,pair.expires-Date.now()));}
  catch(error){message(cleanError(error),'error');}
};
window.bula.onRemoteChat(({device,text,reply,emotion:mood})=>{message(`📱 ${text}`,'user');message(reply);if(mood)emotion(mood);showRemote();});
// Watch mode: the character comments on the game window the user is playing.
let watching=false;
async function loadWatchSources(){
  const zh=settings.language.startsWith('zh');try{const list=await window.bula.watchSources();const keep=$('watch-source').value;
    $('watch-source').replaceChildren(new Option(zh?'（選擇遊戲視窗）':'(choose the game window)',''),...list.map(s=>new Option(s.screen?(zh?`整個螢幕${list.filter(x=>x.screen).length>1?`（${s.name}）`:''}：全螢幕遊戲選這個`:`Whole screen${list.filter(x=>x.screen).length>1?` (${s.name})`:''}: for full-screen games`):s.name,s.id)));$('watch-source').value=keep;
    $('watch-status').textContent=zh?'看不到你的遊戲？先讓它顯示在目前的桌面上（不要最小化）再按重新整理；全螢幕遊戲請選「整個螢幕」。':'Game missing? Show it on this desktop (not minimised) and refresh; for full-screen games choose the whole screen.';}
  catch(error){$('watch-status').textContent=zh?'需要「螢幕錄製」權限才能看到遊戲視窗。':'Screen Recording permission is needed to see game windows.';}
}
$('watch-source').onchange=()=>{const option=$('watch-source').selectedOptions[0],name=option?.textContent||'';if(!$('watch-game').value.trim()&&!option?.value.startsWith('screen:'))$('watch-game').value=name.split(/ [-–—|] /)[0].trim();};
$('watch-refresh').onclick=loadWatchSources;
$('watch-toggle').onclick=async()=>{
  const zh=settings.language.startsWith('zh');
  if(watching){await window.bula.watchStop();return;}
  try{const info=await window.bula.watchStart({sourceId:$('watch-source').value,game:$('watch-game').value,interval:6});
    $('watch-status').textContent=info.found?(zh?`已查到「${info.title}」的玩法（不含劇情）`:`Looked up ${info.title} (no story)`):(zh?'沒查到這款遊戲，會只看畫面吐槽':'No info found; commenting from the screen only');}
  catch(error){const text=cleanError(error);message(text,'error');$('watch-status').textContent=text;}
};
window.bula.onWatch(event=>{
  const zh=settings.language.startsWith('zh');
  if(event.state==='research')status(zh?`正在查「${event.game}」的玩法…`:`Looking up ${event.game}…`);
  if(event.state==='watching'){watching=true;$('watch-toggle').textContent=zh?'■ 停止陪玩':'■ Stop';status(zh?`陪你玩 ${event.game} 中`:`Watching ${event.game}`);}
  if(event.state==='stopped'){watching=false;$('watch-toggle').textContent=zh?'▶ 開始陪玩':'▶ Start';}
  if(event.state==='comment'){message(event.text);emotion(event.emotion);if(event.progress)$('watch-status').textContent=(zh?'目前進度：':'Progress: ')+event.progress;}
  if(event.state==='error'){$('watch-status').textContent=event.error;status(event.error);}
  if(event.state==='lost'){const text=zh?'看不到遊戲視窗了：關掉、最小化或切到全螢幕了？全螢幕請改選「整個螢幕」。':'The game window is gone (closed, minimised or full screen?). For full screen choose the whole screen.';$('watch-status').textContent=text;status(text);}
});
$('open-game').onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');window.bula.openGame($('game-engine').value,$('game-choice').value);};
$('show-onboarding').onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');startOnboarding();};

// Stop reading aloud: the button by the character (shown while it speaks), or Esc
$('stop-speech').onclick=event=>{event.stopPropagation();window.bula.stop();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&characterState?.speaking){event.preventDefault();event.stopImmediatePropagation();window.bula.stop();}},true);
