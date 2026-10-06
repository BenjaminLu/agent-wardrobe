const $ = id => document.getElementById(id);
if(new URLSearchParams(location.search).has('opaque'))document.body.classList.add('opaque');  // Linux without a compositor (main.cjs)
const bridge=window.bula;Avatars.setAssetLoader(async url=>{const [,modId,file]=url.match(/^mods\/([^/]+)\/([^/]+)$/);const data=await bridge.modAsset(decodeURIComponent(modId),decodeURIComponent(file));return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);});
// Live2D characters need Live2D's own Cubism Core: the copy in userData, or a download once the user agrees.
Avatars.setLive2dCore({url:()=>bridge.live2dCore(),install:()=>bridge.installLive2dCore()});
let idleTimer, closingTimer, activeTask=null, composing=false, voiceMode=false, voiceTimer, typelessArmed=0;
const progressMessages=new Map();
let history = [], busy = false, settings, characterState;
const histories={codex:history,claude:history,local:history};
// Voice previews can take a while (a new Kokoro mix reloads the model; a cloned voice's first sentence can take a minute):
// the pressed button says so, switches to 播放中 once the character speaks, and shows a failure right next to itself
// (settings hide the chat, where errors normally go). Preview buttons carry the class "preview".
let previewing=null;
function trackPreview(button){
  endPreview();
  previewing={button,label:button.textContent,started:false,timer:setTimeout(()=>endPreview(t('settings.voice.previewTimeout')),150000)};
  button.disabled=true;button.classList.add('busy');button.textContent=t('settings.voice.preparing');button.parentElement?.querySelector(':scope > .preview-note')?.remove();
}
function endPreview(error){
  if(!previewing)return;const {button,label,timer}=previewing;previewing=null;clearTimeout(timer);
  button.disabled=false;button.classList.remove('busy');button.textContent=button.dataset.i18n?t(button.dataset.i18n):label;
  if(error){const note=document.createElement('span');note.className='preview-note';note.textContent=error;button.after(note);setTimeout(()=>note.remove(),12000);}
}
document.addEventListener('click',event=>{const button=event.target.closest?.('button');if(button&&!button.disabled&&button.classList.contains('preview'))trackPreview(button);},true);
// the conversation's opening line (greeting or "new round") follows the interface language until something else is said
let opening=null;
function openingLine(key){$('conversation').replaceChildren();const el=message(t(key,{name:characterState?.mod.name||'Annie'}));opening={el,key};return el;}
function renderState(state) {
  $('stop-speech').hidden=!state.speaking;
  if(previewing){if(state.speaking&&!previewing.started){previewing.started=true;previewing.button.textContent=t('settings.voice.playing');}else if(!state.speaking&&previewing.started)endPreview();}
  const changed=!characterState||characterState.modId!==state.modId||characterState.skinId!==state.skinId||characterState.mod?.updated!==state.mod?.updated;
  if(changed) Avatars.mount($('pet-wrap'),state.mod,state.skin,'bula',{orbit:'window'});
  Avatars.update($('bula'),state);
  document.querySelector('.brand').firstChild.textContent=state.mod.name.toUpperCase();
  const providerChanged=settings&&settings.provider!==state.provider;
  characterState=state;
  if(settings){
    characterTexts();
    if(changed&&!history.length)openingLine('chat.greeting');
  }
  if(providerChanged){
    settings.provider=state.provider;history=histories[state.provider];$('provider').value=uiProvider(settings);localFields();
    showHistory();
    $('subtitle').textContent='';$('subtitle').hidden=true;status(()=>`${state.provider} · ${t('chat.ready')}`);
  }
  if(['working','waiting_for_approval'].includes(state.activity)) showChat(false);
}
function showHistory(){if(history.length){$('conversation').replaceChildren();opening=null;history.slice(-100).forEach(m=>message(m.content,m.role,m.artifacts));}else openingLine('chat.greeting');}
// the chat box, the hint and the dev placeholder name the current character
function characterTexts(){
  if(!characterState)return;const name=characterState.mod.name;
  if(!dev?.attached)$('prompt').placeholder=t('chat.placeholder',{name});
  $('prompt').setAttribute('aria-label',t('chat.promptAria',{name}));
  $('pet-wrap').title=hintFor(characterState.mod);
}
function message(text, role='assistant',artifacts=[]) { const el = document.createElement('div'); el.className = `message ${role}`; el.textContent = text; $('conversation').append(el);for(const artifact of artifacts||[]){const box=document.createElement('div');box.className='artifact';const button=document.createElement('button');button.dataset.i18n='chat.openFolder';button.textContent=t('chat.openFolder');button.onclick=()=>window.bula.openOutput(artifact.id).catch(error=>message(error.message,'error'));const label=document.createElement('div');label.textContent=artifact.files.join(' · ');box.append(label,button);el.append(box);} $('conversation').scrollTop = $('conversation').scrollHeight; return el; }
function emotion(value) { $('bula').dataset.emotion = value; }
// The stop control only exists while a task can be stopped.
function setActiveTask(id){activeTask=id;document.body.classList.toggle('task-running',Boolean(id));}
// 3D Mods (VRM, glTF, MMD) add the orbit gesture to the hint line; Live2D is flat and moves like the 2D companions.
function hintFor(mod){return ['vrm','gltf','mmd'].includes(mod.renderer)?t('avatar.hint3d'):t('avatar.hint',{name:mod.name});}
// The status line. A function is kept and re-run when the interface language changes.
let lastStatus=null;
function status(text) { lastStatus=typeof text==='function'?text:null; $('status').textContent = lastStatus?text():text; }
const sayStatus=(key,vars)=>status(()=>t(key,vars));
const nameStatus=(key,vars)=>status(()=>t('chat.withName',{name:characterState?.mod.name||'',text:t(key,vars)}));
async function init() {
  settings = await window.bula.settings();
  document.documentElement.style.setProperty('--scale',settings.scale||1);
  document.body.dataset.chatSize=settings.chatSize||'large';
  history.push(...(await window.bula.history()).map(m=>({role:m.role,content:m.content,artifacts:m.artifacts})));
  // Computer use needs a native input backend (macOS helper, Windows SendInput helper, X11 xdotool); Wayland or a missing tool disables the mode with the reason.
  const computer=await window.bula.computerSupport();$('operation-permissions').hidden=!computer.permissions;
  if(!computer.available){const option=$('task-mode').querySelector('option[value=computer]');option.disabled=true;option.title=computer.reason;if($('task-mode').value==='computer')$('task-mode').value='auto';}
  renderState(await window.bula.state());history=histories[settings.provider];
  showHistory();characterTexts();
  $('provider').value = uiProvider(settings); $('base').value = settings.base; $('model').value = settings.model; $('reply-language').value = settings.replyLanguage || 'auto'; $('ui-language').value = settings.uiLanguage || 'auto'; await initVoice(); await initWake(); await showGameEngine(); loadWatchSources();
  installedProviders = await window.bula.providers();providerLabels();
  localFields(); status(()=>`${settings.provider === 'local' ? t('chat.local') : settings.provider} · ${t('chat.ready')}`);
  showSpeakToggle(Boolean(settings.muted));
  document.body.dataset.ready='true';armIdle();
}
// Codex / Claude say when their command-line tool is missing
let installedProviders={codex:true,claude:true};
function providerLabels(){for(const name of ['codex','claude']){const label={codex:'Codex',claude:'Claude'}[name];$('provider').querySelector(`[value="${name}"]`).textContent=installedProviders[name]?label:t('settings.brain.notInstalled',{name:label});}}
function localFields() { $('local-settings').hidden = $('provider').value !== 'local'; $('builtin-settings').hidden = $('provider').value !== 'builtin'; if ($('provider').value === 'builtin') showLlm(); showCli(); }
// The settings select shows the built-in engine as its own brain; underneath it is the local provider.
const uiProvider=s=>s.provider==='local'&&s.localEngine==='builtin'?'builtin':s.provider||'codex';
const brainChoice=value=>value==='builtin'?{provider:'local',localEngine:'builtin'}:value==='local'?{provider:'local',localEngine:'lmstudio'}:{provider:value};
const cleanError=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
let llmState;
// Codex / Claude: install and sign in through the official tools, then watch until the account is ready.
const CLI_NAMES={codex:'Codex',claude:'Claude Code'};let cliPoll;
const cliText=(name,state)=>state.loggedIn?t('settings.cli.signedIn'):state.installed?t('settings.cli.needsSignIn',{name:CLI_NAMES[name]}):t('settings.cli.missing',{name:CLI_NAMES[name]});
const cliAction=state=>state.installed?t('settings.cli.signIn'):t('settings.cli.install');
let cliWaiting=false;
function setupCli(name,onState){
  clearInterval(cliPoll);
  return window.bula.setupCli(name).then(result=>{
    // no terminal found (some Linux desktops): the official command is shown and copied instead
    if(result?.command){navigator.clipboard?.writeText(result.command).catch(()=>{});message(t('chat.noTerminal',{command:result.command}),'error');}
    onState({waiting:true});const until=Date.now()+10*60*1000;
    cliPoll=setInterval(async()=>{const state=(await window.bula.cliStatus())[name];if(state.loggedIn||Date.now()>until){clearInterval(cliPoll);onState(state);if(state.loggedIn)sayStatus('settings.cli.ready',{name:CLI_NAMES[name]});}},3000);
  },error=>message(cleanError(error),'error'));
}
async function showCli(){
  const name=$('provider').value;if(!CLI_NAMES[name]){$('cli-setup').hidden=true;return;}
  const state=(await window.bula.cliStatus())[name];if($('provider').value!==name)return;
  if(cliWaiting){$('cli-status').textContent=t('settings.cli.waiting');return;}
  $('cli-setup').hidden=state.loggedIn;$('cli-status').textContent=cliText(name,state);$('cli-install').textContent=cliAction(state);$('cli-install').disabled=false;
}
$('cli-install').onclick=()=>{const name=$('provider').value;setupCli(name,state=>{cliWaiting=Boolean(state.waiting);if(state.waiting){$('cli-install').disabled=true;$('cli-status').textContent=t('settings.cli.waiting');}else showCli();});};
function modelChoices(container,name,selected,state){
  container.replaceChildren(...state.models.map(m=>{const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name=name;input.value=m.id;input.checked=m.id===selected;input.disabled=!m.fits&&!m.installed;
    const b=document.createElement('b');b.textContent=m.name;const small=document.createElement('small');
    small.textContent=[`${(m.bytes/1e9).toFixed(1)} GB`,m.hintKey?t(m.hintKey):m.hintEn,m.id===state.recommended&&t('settings.llm.recommended'),m.installed&&t('settings.llm.downloaded'),!m.fits&&t('settings.llm.needsRam',{gb:m.minRam})].filter(Boolean).join(' · ');
    label.append(input,b,small);return label;}));
}
async function showLlm(){llmState=await window.bula.llmStatus();modelChoices($('llm-models'),'llm-model',document.querySelector('input[name=llm-model]:checked')?.value||settings.builtinModel||llmState.recommended,llmState);updateLlm();}
function updateLlm(){
  if(!llmState)return;const id=document.querySelector('input[name=llm-model]:checked')?.value;const model=llmState.models.find(m=>m.id===id);const dl=llmState.downloading;
  $('llm-install').hidden=!model||model.installed||dl?.id===id;$('llm-install').disabled=Boolean(dl);$('llm-remove').hidden=!model?.installed;$('llm-progress').hidden=!dl;if(dl)$('llm-progress').value=dl.progress;
  $('llm-status').textContent=dl?t('settings.llm.downloading',{name:llmState.models.find(m=>m.id===dl.id)?.name,percent:Math.round(dl.progress*100)}):model?.installed?t('settings.llm.ready'):t('settings.llm.pick');
}
async function installLlm(id){
  const job=window.bula.installLlm(id);if(llmState)llmState.downloading={id,progress:0};updateLlm();
  try{llmState=await job;sayStatus('settings.llm.installed');}catch(error){message(cleanError(error),'error');}
  if(!$('builtin-settings').hidden)await showLlm();
}
window.bula.onLlmProgress(({id,progress})=>{if(llmState)llmState.downloading={id,progress};updateLlm();sayStatus('settings.llm.progress',{percent:Math.round(progress*100)});});
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
  try { settings = await window.bula.saveSettings({ ...brainChoice($('provider').value), builtinModel:document.querySelector('input[name=llm-model]:checked')?.value||settings.builtinModel, gameEngine:$('game-engine').value, game:$('game-choice').value, base:$('base').value, model:$('model').value, replyLanguage:$('reply-language').value, ...voiceChoice() }); await saveWake().catch(error=>message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error')); $('settings').hidden = true; document.body.classList.remove('settings'); status(()=>`${settings.provider} · ${t('chat.saved')}`); }
  catch (e) { message(e.message, 'error'); $('settings').hidden = true; document.body.classList.remove('settings'); }
};
$('chat-form').onsubmit = async event => {
  event.preventDefault(); const text = $('prompt').value.trim(); if (!text || busy||composing) return;clearTimeout(voiceTimer);
  if(dev?.attached){devSubmit(text);return;}  // 開發夥伴: the attached session gets it (see the end of this file)
  if(activeTask){
    busy=true;$('send').disabled=true;
    try{await window.bula.taskSteer({id:activeTask,text});message(text,'user');history.push({role:'user',content:text});$('prompt').value='';sayStatus('chat.taskUpdateSent');}catch(error){message(error.message,'error');}finally{busy=false;$('send').disabled=false;}return;
  }
  if(!['auto','chat'].includes($('task-mode').value)){
    busy=true;$('send').disabled=true;showChat(false);
    try{const task=await window.bula.task({mode:$('task-mode').value,text,history});setActiveTask(task.id);message(text,'user');history.push({role:'user',content:text});$('prompt').value='';nameStatus('chat.taskStarted');}
    catch(error){message(error.message,'error');}
    finally{busy=false;$('send').disabled=false;armIdle();}return;
  }
  busy = true; $('send').disabled = true; $('prompt').value = ''; message(text,'user'); history.push({role:'user',content:text}); status(()=>`${settings.provider} · ${t('chat.thinking')}`); emotion('neutral');
  try {
    const reply = await window.bula.chat(text,{auto:$('task-mode').value==='auto'});
    if (!reply.ok) { history.pop(); message(reply.error,'error'); sayStatus('chat.failed'); emotion('nervous'); }
    else if(reply.task){setActiveTask(reply.task.id);if(reply.text){history.push({role:'assistant',content:reply.text});message(reply.text);emotion(reply.emotion);}const mode=['files','browser','computer'].includes(reply.mode)?reply.mode:'files';nameStatus(`chat.task.${mode}`);}
    else { history.push({role:'assistant',content:reply.text}); if(history.length>2000)history.splice(0,history.length-2000); message(reply.text); $('subtitle').textContent = reply.text; if(document.body.classList.contains('streaming')) $('subtitle').hidden=false; emotion(reply.emotion); status(()=>`${reply.model} · ${t('chat.done')}`); }
  } catch (e) { history.pop(); message(e.message,'error'); sayStatus('chat.failed'); }
  finally { busy = false; $('send').disabled = false; $('prompt').focus(); armIdle(); }
};
$('reset').onclick = async () => { if (busy||activeTask) return;try{await window.bula.clearHistory();history.splice(0);progressMessages.clear();openingLine('chat.reset');$('subtitle').textContent='';}catch(error){message(error.message,'error');} };
$('files').onclick=()=>window.bula.files().catch(error=>message(error.message,'error'));
$('wardrobe').onclick = () => window.bula.wardrobe().catch(error=>message(error.message,'error'));
$('agent-console').onclick=()=>window.bula.agentConsole().then(result=>{if(result?.log){showChat(false);message(result.log);}}).catch(error=>message(error.message,'error'));
document.querySelectorAll('[data-permission]').forEach(button=>button.onclick=()=>window.bula.operationPermissions(button.dataset.permission).catch(error=>message(error.message,'error')));
$('official-setup').onclick=()=>window.bula.officialSetup().catch(error=>{message(error.message,'error');$('settings').hidden=true;document.body.classList.remove('settings');});
$('emergency-stop').onclick=()=>window.bula.emergencyStop().catch(error=>message(error.message,'error'));
window.bula.onFocusChat(()=>showChat(true));
$('voice-input').onclick=()=>{
  voiceMode=!voiceMode;$('voice-input').setAttribute('aria-pressed',String(voiceMode));clearTimeout(voiceTimer);showChat(true);
  sayStatus(voiceMode?'chat.typelessOn':'chat.typelessOff');
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
window.bula.onNotice(text => { if(previewing){endPreview(text);return;} message(text,'error'); sayStatus('chat.speechFailed'); });
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
      nameStatus('chat.thinking');
    }return;
  }
  if(event.type==='working'){nameStatus('chat.thinking');return;}
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
  nameStatus(event.type==='approval'?'chat.waitingConfirm':event.type==='error'?'chat.failed':event.type==='cancelled'?'chat.stopped':'chat.done');
  armIdle();
});
window.bula.onState(renderState);
function blink() { Avatars.blink($('bula')); setTimeout(blink,2800+Math.random()*2500); }
setTimeout(blink,2200);
init().then(()=>{initDev().catch(error=>console.error(error));if(!settings.onboarded)startOnboarding();}).catch(e => { message(e.message,'error'); sayStatus('chat.startupFailed'); });

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
const VOICE_NOTES=['marin','cedar','alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse'];
const openaiVoiceLabel=name=>VOICE_NOTES.includes(name)?`${name} · ${t(`settings.voice.openaiVoice.${name}`)}`:name;
function voiceChoice(){return {voiceProvider:$('voice-provider').value,openaiVoice:$('openai-voice-name').value,openaiModel:$('openai-model').value,openaiStyle:$('openai-style').value,kokoroVoice:$('kokoro-voice-name').value,kokoroSpeed:+$('kokoro-speed').value,edgeVoice:$('edge-voice-name').value,edgeRate:+$('edge-rate').value};}
// Kokoro voice ids: z = Mandarin, a = American, b = British English; f / m = female / male
const KOKORO_TAGS={zf:'female',zm:'male',af:'english',am:'english',bf:'british',bm:'british'};
function kokoroLabel(id){
  const tag=KOKORO_TAGS[id.slice(0,2)],own=id.slice(3);if(!tag)return id;
  const name=id.startsWith('z')?t(`settings.voice.kokoroName.${id}`):own.charAt(0).toUpperCase()+own.slice(1);
  return `${name} · ${t(`settings.voice.kokoroTag.${tag}`)}`;
}
let kokoroLast=null,openaiHasKey=false;
function showKokoro(state){kokoroLast=state;$('kokoro-voice').hidden=$('voice-provider').value!=='kokoro';$('kokoro-status').textContent=t(state.installed?'settings.voice.kokoroInstalled':state.downloading?'settings.voice.kokoroDownloading':'settings.voice.kokoroMissing');$('kokoro-install').hidden=state.installed;$('kokoro-install').disabled=state.downloading;$('kokoro-preview').disabled=!state.installed;$('kokoro-progress').hidden=!state.downloading;}
function showVoice(hasKey,kokoroState){
  openaiHasKey=hasKey;$('openai-voice').hidden=$('voice-provider').value!=='openai';$('edge-voice').hidden=$('voice-provider').value!=='edge';if(kokoroState)showKokoro(kokoroState);
  $('openai-key-status').textContent=t(hasKey?'settings.voice.keySaved':'settings.voice.keyMissing');
  $('openai-key-toggle').textContent=t(hasKey?'settings.voice.keyReplace':'settings.voice.keySetUp');
  $('openai-key-clear').hidden=!hasKey;if(!hasKey&&$('voice-provider').value==='openai')$('openai-key-guide').hidden=false;
}
// voice names in the selects (the values stay; only the labels follow the interface language)
function voiceOptionLabels(){
  for(const option of $('openai-voice-name').options)option.textContent=openaiVoiceLabel(option.value);
  for(const id of ['kokoro-voice-name','mix-a','mix-b'])for(const option of $(id).options)option.textContent=kokoroLabel(option.value);
  for(const option of $('edge-voice-name').options)if(option.dataset.labelKey)option.textContent=t(option.dataset.labelKey);
}
async function initVoice(){
  const voice=await window.bula.voiceStatus();
  $('openai-voice-name').replaceChildren(...voice.voices.map(name=>{const option=document.createElement('option');option.value=name;option.textContent=openaiVoiceLabel(name);return option;}));
  $('kokoro-voice-name').replaceChildren(...voice.kokoro.voices.map(v=>{const option=document.createElement('option');option.value=v.name;option.textContent=kokoroLabel(v.name);return option;}));
  $('kokoro-voice-name').value=settings.kokoroVoice||'zf_xiaoxiao';$('kokoro-speed').value=settings.kokoroSpeed||1;$('kokoro-speed-value').textContent=`${(+$('kokoro-speed').value).toFixed(2)}×`;
  $('edge-voice-name').replaceChildren(...voice.edge.voices.map(v=>{const option=document.createElement('option');option.value=v.name;if(v.labelKey)option.dataset.labelKey=v.labelKey;option.textContent=v.labelKey?t(v.labelKey):v.label;return option;}));
  $('edge-voice-name').value=settings.edgeVoice||'zh-TW-HsiaoChenNeural';$('edge-rate').value=settings.edgeRate||1;$('edge-rate-value').textContent=`${(+$('edge-rate').value).toFixed(2)}×`;
  $('voice-provider').value=settings.volume===false?'off':settings.voiceProvider||'system';$('openai-voice-name').value=settings.openaiVoice;$('openai-model').value=settings.openaiModel;$('openai-style').value=settings.openaiStyle||'';
  showVoice(voice.hasOpenAIKey,voice.kokoro);loadVoices().catch(()=>{});
}
$('voice-provider').onchange=async()=>{const v=await window.bula.voiceStatus();showVoice(v.hasOpenAIKey,v.kokoro);};
$('openai-key-toggle').onclick=()=>{$('openai-key-guide').hidden=!$('openai-key-guide').hidden;if(!$('openai-key-guide').hidden)$('openai-key').focus();};
document.querySelectorAll('[data-openai]').forEach(button=>button.onclick=()=>window.bula.openOpenAI(button.dataset.openai).catch(error=>message(error.message,'error')));
$('openai-key-save').onclick=async()=>{
  const input=$('openai-key'),key=input.value;input.value='';
  if(!key.trim()){message(t('settings.voice.keyPasteFirst'),'error');return;}
  $('openai-key-save').disabled=true;sayStatus('settings.voice.keyVerifying');
  try{const result=await window.bula.setOpenAIKey(key);showVoice(true);if(result.warning){message(result.warning,'error');sayStatus('settings.voice.keyNeedsCredit');}else{$('openai-key-guide').hidden=true;sayStatus('settings.voice.keyStored');}}
  catch(error){message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error');sayStatus('settings.voice.keyNotSaved');}
  finally{$('openai-key-save').disabled=false;}
};
$('openai-key-clear').onclick=async()=>{await window.bula.clearOpenAIKey();showVoice(false);sayStatus('settings.voice.keyRemoved');};
$('voice-preview').onclick=()=>{const name=characterState?.mod.name||'Annie';window.bula.previewVoice({...voiceChoice(),text:t('settings.voice.previewLine',{name})}).catch(error=>message(error.message,'error'));};
// Sample lines for voices that only speak one language: in the interface language when it is the voice's own,
// otherwise in the voice's language (a Mandarin voice cannot read an English sentence well).
const VOICE_SAMPLES={
  zh:{kokoro:'嗨，我是 {name}！這是我在你電腦上的聲音，喜歡嗎？',edge:'嗨，我是 {name}！這是台灣腔的聲音，聽起來怎麼樣？'},
  ja:{kokoro:'こんにちは、{name}です！この声はどうですか？',edge:'こんにちは、{name}です！この声はどうですか？'},
  en:{kokoro:"Hi, I'm {name}! This voice runs right on this Mac. Do you like it?",edge:"Hi, I'm {name}! How does this voice sound?"}
};
function voiceSample(engine,voiceLanguage,name){
  const ui=i18n.lang.startsWith('zh')?'zh':i18n.lang;
  if(ui===voiceLanguage)return t(`settings.voice.sample.${engine}`,{name});
  return (VOICE_SAMPLES[voiceLanguage]||VOICE_SAMPLES.en)[engine].replaceAll('{name}',name);
}

$('kokoro-speed').oninput=()=>{$('kokoro-speed-value').textContent=`${(+$('kokoro-speed').value).toFixed(2)}×`;};
window.bula.onKokoroProgress(p=>{$('kokoro-progress').hidden=false;$('kokoro-progress').value=p;});
$('kokoro-install').onclick=async()=>{
  showKokoro({installed:false,downloading:true});sayStatus('settings.voice.kokoroInstalling');
  try{await window.bula.installKokoro();showKokoro({installed:true,downloading:false});sayStatus('settings.voice.kokoroDone');}
  catch(error){showKokoro({installed:false,downloading:false});message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error');}
};
$('kokoro-preview').onclick=()=>{const name=characterState?.mod.name||'Annie';const lang=/^(a|b)[fm]_/.test($('kokoro-voice-name').value)?'en':'zh';window.bula.previewVoice({...voiceChoice(),voiceProvider:'kokoro',text:voiceSample('kokoro',lang,name)}).catch(error=>message(error.message,'error'));};

$('edge-rate').oninput=()=>{$('edge-rate-value').textContent=`${(+$('edge-rate').value).toFixed(2)}×`;};
$('edge-preview').onclick=()=>{const name=characterState?.mod.name||'Annie';const v=$('edge-voice-name').value;const text=voiceSample('edge',v.startsWith('zh')?'zh':v.startsWith('ja')?'ja':'en',name);window.bula.previewVoice({...voiceChoice(),voiceProvider:'edge',text}).catch(error=>message(error.message,'error'));};

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
// remembered across restarts (this window's own storage)
let micPaused=(()=>{try{return localStorage.getItem('mic-paused')==='1';}catch{return false;}})();
function showMicButton(){const b=$('mic-toggle');b.hidden=!mic&&!micPaused;b.classList.toggle('paused',micPaused);
  const label=t(micPaused?'toolbar.listeningPaused':'toolbar.stopListening');b.title=label;b.setAttribute('aria-label',label);}
$('mic-toggle').onclick=async event=>{event.stopPropagation();
  if(micPaused){micPaused=false;try{localStorage.removeItem('mic-paused');}catch{}try{await startMic();sayStatus('chat.listen.resumed');}catch(error){message(t('chat.micFailed',{error:error.message}),'error');}}
  else{micPaused=true;try{localStorage.setItem('mic-paused','1');}catch{}stopMic();await window.bula.listenCancel().catch(()=>{});sayStatus('chat.listen.paused');}
  showMicButton();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('mic-indicator').classList.contains('listening')&&!characterState?.speaking){event.preventDefault();$('mic-indicator').classList.remove('listening');window.bula.listenCancel().catch(()=>{});sayStatus('chat.listen.cancelled');}});
let asrLast=null,typelessLast=null;
function showAsr(state){asrLast=state;$('asr-status').textContent=t(state.installed?'settings.wake.asrInstalled':state.downloading?'settings.wake.asrDownloading':'settings.wake.asrMissing');$('asr-install').hidden=state.installed;$('asr-install').disabled=state.downloading;$('asr-progress').hidden=!state.downloading;}
async function initWake(){
  const wake=await window.bula.wakeStatus();$('wake-enabled').checked=wake.enabled;$('wake-phrases').value=wake.custom;$('wake-sensitivity').value=wake.sensitivity||'high';$('barge-in').checked=wake.bargeIn!==false;$('conversation-mode').checked=wake.conversationMode!==false;$('dictation-engine').value=wake.engine;showTypeless(wake.typeless);$('wake-phrases').placeholder=wake.phrases.join(', ');showAsr(wake.asr);
  if(wake.enabled)startMic().catch(error=>message(t('chat.micFailed',{error:error.message}),'error'));
}
function showTypeless(state){
  typelessLast=state;const on=$('dictation-engine').value==='typeless';$('typeless-note').hidden=!on;
  $('typeless-note').textContent=!state.installed?t('settings.wake.typelessMissing'):!state.supported?t('settings.wake.typelessShortcut',{shortcut:state.shortcut}):t('settings.wake.typelessReady');
}
$('dictation-engine').onchange=async()=>showTypeless((await window.bula.wakeStatus()).typeless);
async function saveWake(){
  const result=await window.bula.wakeSettings({wakeEnabled:$('wake-enabled').checked,wakePhrases:$('wake-phrases').value,wakeSensitivity:$('wake-sensitivity').value,bargeIn:$('barge-in').checked,conversationMode:$('conversation-mode').checked,dictationEngine:$('dictation-engine').value});
  $('wake-phrases').placeholder=result.phrases.join(', ');
  if(result.enabled)await startMic();else stopMic();
  return result;
}
window.bula.onAsrProgress(p=>{$('asr-progress').hidden=false;$('asr-progress').value=p;});
$('asr-install').onclick=async()=>{showAsr({installed:false,downloading:true});
  try{await window.bula.installAsr();showAsr({installed:true,downloading:false});sayStatus('settings.wake.asrDone');}
  catch(error){showAsr({installed:false,downloading:false});message(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''),'error');}};
window.bula.onWake(info=>{
  showChat(true);react('surprised',900);
  // Typeless types into whatever has focus: close settings so the chat box (not a settings field) receives the question
  if(info.typeless){if(!$('settings').hidden){$('settings').hidden=true;document.body.classList.remove('settings');}document.activeElement?.blur?.();$('prompt').value='';$('prompt').focus();typelessArmed=Date.now()+40000;$('mic-indicator').classList.add('listening');sayStatus('chat.listen.typeless');}
  else if(info.dictation){$('mic-indicator').classList.add('listening');sayStatus('chat.listen.dictation');}else sayStatus('chat.listen.awake');
});
// interrupting the companion, and the follow-up window after a reply, both just listen
window.bula.onBargeIn(()=>{showChat(true);$('mic-indicator').classList.add('listening');sayStatus('chat.listen.bargeIn');});
window.bula.onFollow(({seconds})=>{$('mic-indicator').classList.add('listening');sayStatus('chat.listen.follow',{seconds});});
window.bula.onDictation(({text,follow})=>{
  $('mic-indicator').classList.remove('listening');
  if(!text){if(follow){sayStatus('chat.listen.callMe');return;}sayStatus('chat.listen.missed');return;}
  $('prompt').value=text;$('chat-form').requestSubmit();
});
window.bula.onTypeless(({state,error})=>{
  $('mic-indicator').classList.remove('listening');
  if(state==='processing'){typelessArmed=Date.now()+15000;$('prompt').focus();sayStatus('chat.listen.typelessProcessing');}
  else{typelessArmed=0;if(state==='error')message(error,'error');else sayStatus('chat.listen.noQuestion');}
});
window.bula.onMicLevel(level=>{$('mic-level').value=level;});

// --- 聲音: voice profiles (萌系混音, VOICEVOX, and cloned voices from 錄音複製), bound per character, exported as packs.
let voicesState=null,vvSpeakers=[];
const ENGINE_NAMES={'kokoro-mix':()=>t('settings.voices.newMix'),'voicevox':()=>'VOICEVOX','cosyvoice':()=>t('settings.voices.engineClone'),'sovits':()=>t('settings.voices.engineClone'),'elevenlabs':()=>'ElevenLabs'};
const vbutton=(text,fn,cls)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(cls)b.className=cls;b.onclick=()=>Promise.resolve().then(fn).catch(error=>previewing?endPreview(cleanError(error)):message(cleanError(error),'error'));return b;};
const characterName=()=>characterState?.mod.name||t('settings.voices.characterFallback');
$('voice-for').onchange=async()=>{const id=$('voice-for').value||null;await window.bula.voiceBind(id);await loadVoices();const voice=$('voice-for').selectedOptions[0].textContent,name=characterName();if(id)sayStatus('settings.voices.bound',{name,voice});else sayStatus('settings.voices.unbound');};
$('voice-provider').addEventListener('change',()=>loadVoices().catch(()=>{}));
async function loadVoices(){
  voicesState=await window.bula.voices();renderVoices();
}
function renderVoices(){
  const s=voicesState,name=characterName(),bound=s.profiles.find(p=>p.id===s.bound);
  // One answer to "which voice will I hear": the character's own voice wins; otherwise the default voice below
  $('voices-bound').hidden=true;
  const def=$('voice-provider').selectedOptions[0]?.textContent||'',off=$('voice-provider').value==='off';
  $('voice-for-label').textContent=t('settings.voice.forLabel',{name});
  $('voice-for').replaceChildren(new Option(t('settings.voices.forDefault',{voice:def}),''),...s.profiles.map(p=>new Option(`${p.cloned?'🔒 ':''}${p.name}`,p.id)));$('voice-for').value=bound?.id||'';
  $('voice-current-text').textContent=off?t('settings.voices.currentOff'):bound?t('settings.voices.currentOwn',{name,voice:bound.name}):t('settings.voices.currentDefault',{name,voice:def});
  $('voice-default').classList.toggle('inactive',Boolean(bound)&&!off);
  $('voice-default-note').textContent=bound&&!off?t('settings.voice.defaultNoteBound',{name}):t('settings.voice.defaultNote');
  $('voices-lang').hidden=!(bound?.engine==='voicevox'&&$('reply-language').value!=='ja');
  $('voice-lab').hidden=typeof window.bula.openVoiceLab!=='function';
  $('voices-list').replaceChildren(...s.profiles.map(p=>{
    const li=document.createElement('li');li.className=p.id===s.bound?'bound':'';li.dataset.id=p.id;
    const title=document.createElement('b');title.translate=false;title.dataset.current=t('settings.voices.currentCharacter');title.textContent=`${p.cloned?'🔒 ':''}${p.name}${p.id===s.bound?t('settings.voices.inUse',{name}):''}`;
    const credit=document.createElement('span');credit.className='credit';credit.textContent=`${ENGINE_NAMES[p.engine]?.()||p.engine} · ${p.license.credit?t('settings.voices.credit',{credit:p.license.credit}):''}${p.license.label}${p.license.commercial?'':t('settings.voices.nonCommercial')}${p.cloned?t('settings.voices.clonedNote',{person:p.consent.person}):''}`;
    // speaking speed of this voice (saved with it); cloned voices often come out slow
    const speed=document.createElement('label');speed.className='voice-speed';const value=document.createElement('span');const range=document.createElement('input');
    range.type='range';range.min='0.7';range.max='1.5';range.step='0.05';range.value=String(p.params?.speed||1);value.textContent=`${Number(range.value).toFixed(2)}×`;
    range.oninput=()=>{value.textContent=`${Number(range.value).toFixed(2)}×`;};
    range.onchange=async()=>{try{const r=await window.bula.voiceSpeed(p.id,Number(range.value));sayStatus('settings.voices.speedChanged',{voice:p.name,speed:r.speed});}catch(error){message(cleanError(error),'error');}};
    speed.append(`${t('settings.voice.speed')} `,value,range);
    // cloned CosyVoice voices: fast (default, ~40% quicker) or best quality
    if(p.engine==='cosyvoice'){const q=document.createElement('select');q.append(new Option(t('settings.voices.fast'),'fast'),new Option(t('settings.voices.best'),'best'));q.value=p.params?.quality||'fast';
      q.onchange=async()=>{try{await window.bula.voiceSpeed(p.id,Number(range.value),q.value);sayStatus('settings.voices.qualityChanged',{voice:p.name,quality:q.selectedOptions[0].textContent});}catch(error){message(cleanError(error),'error');}};speed.append(q);}
    const row=document.createElement('div');row.className='voice-row';
    row.append(vbutton(t('settings.voice.preview'),()=>window.bula.voicePreview({profileId:p.id}),'preview'),
      p.id===s.bound?vbutton(t('settings.voices.unbind',{name}),async()=>{await window.bula.voiceBind(null);loadVoices();}):vbutton(t('settings.voices.bind',{name}),async()=>{await window.bula.voiceBind(p.id);loadVoices();sayStatus('settings.voices.bound',{name,voice:p.name});}));
    if(p.engine==='voicevox')row.append(vbutton(t('settings.voices.terms'),async()=>{const info=await window.bula.voicePolicy(p.id);message(`${info.license.credit||p.name}\n${info.policy||t('settings.voices.noTerms')}`);}));
    const exp=vbutton(t('settings.voices.export'),async()=>{const r=await window.bula.voiceExport(p.id);if(r.saved)sayStatus('settings.voices.exported',{path:r.saved});});
    if(p.cloned){exp.disabled=true;exp.title=t('settings.voices.clonedNoExport');}
    else if(p.license.tier==='personal'){exp.disabled=true;exp.title=t('settings.voices.personalNoExport');}
    row.append(exp,vbutton(t('settings.voices.delete'),async()=>{if(!confirm(t('settings.voices.confirmDelete',{voice:p.name})))return;await window.bula.voiceRemove(p.id);loadVoices();},'danger'));
    li.append(title,credit,speed,row);return li;}));
}
const kokoroOption=v=>{const o=document.createElement('option');o.value=v.name;o.textContent=kokoroLabel(v.name);return o;};
function mixLabels(){const b=+$('mix-blend').value,p=+$('mix-pitch').value;$('mix-blend-value').textContent=`${b}% A · ${100-b}% B`;$('mix-pitch-value').textContent=t('settings.mix.semitones',{n:`${p>0?'+':''}${p}`});$('mix-speed-value').textContent=`${(+$('mix-speed').value).toFixed(2)}×`;}
function mixPreset(id){const p=voicesState.presets.find(x=>x.id===id);if(!p)return;$('mix-name').value=p.name;$('mix-a').value=p.mix[0].voice;$('mix-b').value=p.mix[1]?.voice||p.mix[0].voice;$('mix-blend').value=Math.round(p.mix[0].weight*100);$('mix-pitch').value=p.pitch;$('mix-speed').value=p.speed;mixLabels();}
function mixParams(){const a=+$('mix-blend').value/100;return {mix:[{voice:$('mix-a').value,weight:a},{voice:$('mix-b').value,weight:+(1-a).toFixed(2)}].filter(m=>m.weight>0),pitch:+$('mix-pitch').value,speed:+$('mix-speed').value};}
$('voice-new-mix').onclick=async()=>{
  if(!voicesState)await loadVoices();$('voice-vv').hidden=true;$('voice-mix').hidden=false;
  $('mix-preset').replaceChildren(...voicesState.presets.map(p=>Object.assign(document.createElement('option'),{value:p.id,textContent:p.name})));
  $('mix-a').replaceChildren(...voicesState.kokoroVoices.map(kokoroOption));$('mix-b').replaceChildren(...voicesState.kokoroVoices.map(kokoroOption));mixPreset(voicesState.presets[0].id);
  const mix=voicesState.engines.find(e=>e.id==='kokoro-mix');if(!mix?.available)message(mix?.reason||t('settings.mix.needsKokoro'),'error');
};
$('mix-preset').onchange=()=>mixPreset($('mix-preset').value);
for(const id of ['mix-blend','mix-pitch','mix-speed'])$(id).oninput=mixLabels;
$('mix-preview').onclick=()=>window.bula.voicePreview({engine:'kokoro-mix',params:mixParams()}).catch(error=>previewing?endPreview(cleanError(error)):message(cleanError(error),'error'));
$('mix-save').onclick=async()=>{try{await window.bula.voiceSave({name:$('mix-name').value,engine:'kokoro-mix',params:mixParams(),bind:true});$('voice-mix').hidden=true;await loadVoices();sayStatus('settings.mix.saved',{voice:$('mix-name').value});}catch(error){message(cleanError(error),'error');}};
$('mix-cancel').onclick=()=>{$('voice-mix').hidden=true;};
// VOICEVOX: a running engine or VOICEVOX.app is used; otherwise the official engine is downloaded once (about 1.9 GB) after asking.
let vvLast=null;
async function showVoicevox(){
  const s=await window.bula.voicevoxStatus();vvLast=s;vvStatusText();
  $('vv-install').hidden=s.running||s.installed||s.app;$('vv-install').disabled=s.downloading;$('vv-progress').hidden=!s.downloading;
  if(s.running||s.installed||s.app){vvSpeakers=await window.bula.voicevoxSpeakers();
    $('vv-speaker').replaceChildren(...vvSpeakers.map((v,i)=>Object.assign(document.createElement('option'),{value:String(i),textContent:v.name})));vvStyles();$('vv-pick').hidden=false;}
}
function vvStatusText(){
  const s=vvLast;if(!s)return;const gb=s.download?(s.download.size/1e9).toFixed(1):'?';$('vv-install').dataset.gb=gb;
  if(vvRate?.text&&s.downloading){$('vv-status').textContent=vvRate.text();}
  else $('vv-status').textContent=s.running?t('settings.vv.running'):s.installed?t('settings.vv.installed',{version:s.version}):s.app?t('settings.vv.app'):s.downloading?t('settings.vv.downloading'):t('settings.vv.needed',{version:s.version,gb});
  $('vv-install').textContent=t('settings.vv.download',{gb});
}
function vvStyles(){const s=vvSpeakers[+$('vv-speaker').value];$('vv-style').replaceChildren(...(s?.styles||[]).map(style=>Object.assign(document.createElement('option'),{value:String(style.id),textContent:style.name})));}
function vvLabels(){$('vv-speed-value').textContent=`${(+$('vv-speed').value).toFixed(2)}×`;const p=+$('vv-pitch').value;$('vv-pitch-value').textContent=`${p>0?'+':''}${p.toFixed(2)}`;}
function vvParams(){const s=vvSpeakers[+$('vv-speaker').value],style=s.styles.find(x=>String(x.id)===$('vv-style').value);return {speakerUuid:s.uuid,speakerName:s.name,styleId:style.id,styleName:style.name,speed:+$('vv-speed').value,pitch:+$('vv-pitch').value,intonation:1};}
$('voice-new-vv').onclick=async()=>{$('voice-mix').hidden=true;$('voice-vv').hidden=false;$('vv-pick').hidden=true;vvLabels();await showVoicevox().catch(error=>message(cleanError(error),'error'));};
$('vv-speaker').onchange=vvStyles;$('vv-speed').oninput=vvLabels;$('vv-pitch').oninput=vvLabels;
let vvRate=null;
window.bula.onVoicevoxProgress(info=>{const {p,done,total,at}=typeof info==='number'?{p:info}:info;$('vv-progress').hidden=false;$('vv-progress').value=p;
  if(done==null)return;const mb=n=>n>=1e9?`${(n/1e9).toFixed(2)} GB`:`${Math.round(n/1e6)} MB`;
  if(vvRate&&at>vvRate.at){const speed=(done-vvRate.done)/((at-vvRate.at)/1000);vvRate.speed=vvRate.speed?vvRate.speed*.8+speed*.2:speed;}vvRate={...vvRate,done,at};
  const left=vvRate.speed>0?(total-done)/vvRate.speed:null,rateNow=vvRate.speed;
  const eta=()=>left==null?'':left>3600?t('settings.vv.etaHours',{n:(left/3600).toFixed(1)}):left>60?t('settings.vv.etaMinutes',{n:Math.ceil(left/60)}):t('settings.vv.etaSoon');
  vvRate.text=()=>t('settings.vv.progress',{percent:Math.floor(p*100),done:mb(done),total:mb(total),rate:rateNow?` · ${mb(rateNow)}/s · ${eta()}`:''});
  $('vv-status').textContent=vvRate.text();});
$('vv-install').onclick=async()=>{const gb=$('vv-install').dataset.gb?`${$('vv-install').dataset.gb} GB`:'';if(!confirm(t('settings.vv.confirm',{gb})))return;
  $('vv-install').disabled=true;$('vv-progress').hidden=false;vvRate=null;sayStatus('settings.vv.downloading');
  try{await window.bula.installVoicevox();sayStatus('settings.vv.installedStatus');await showVoicevox();}catch(error){message(cleanError(error),'error');$('vv-install').disabled=false;}};
$('vv-preview').onclick=()=>window.bula.voicePreview({engine:'voicevox',params:vvParams()}).catch(error=>previewing?endPreview(cleanError(error)):message(cleanError(error),'error'));
$('vv-save').onclick=async()=>{try{const p=vvParams();const r=await window.bula.voiceSave({name:t('settings.vv.profileName',{speaker:p.speakerName,style:p.styleName}),engine:'voicevox',params:p,bind:true});$('voice-vv').hidden=true;await loadVoices();message(t('settings.vv.saved',{voice:r.profile.name,credit:r.profile.license.credit}));}catch(error){message(cleanError(error),'error');}};
$('vv-cancel').onclick=()=>{$('voice-vv').hidden=true;};
$('voices-japanese').onclick=async()=>{await window.bula.voiceJapanese();settings.replyLanguage='ja';$('reply-language').value='ja';loadVoices();sayStatus('settings.voices.japaneseSet');};
$('voice-import').onclick=async()=>{try{const r=await window.bula.voiceImport();if(r.canceled)return;await loadVoices();message(t('settings.voices.imported',{voice:r.profile.name,license:r.profile.license.label,credit:r.profile.license.credit?t('settings.voices.importedCredit',{credit:r.profile.license.credit}):''}));}catch(error){message(cleanError(error),'error');}};
$('voice-lab').onclick=()=>window.bula.openVoiceLab?.();
$('reply-language').addEventListener('change',()=>{if(voicesState)loadVoices();});

// --- First-run guide: brain, voice, wake word, tips. Pre-filled from current settings; finishing saves them.
let obStep=0,obProviders={},obWaiting={};
const OB_BRAINS=[['builtin','onboarding.brains.builtin','onboarding.brains.builtinHint'],['codex','Codex','onboarding.brains.codexHint'],['claude','Claude','onboarding.brains.claudeHint'],['local','LM Studio','onboarding.brains.localHint']];
async function startOnboarding(){
  obProviders=await window.bula.cliStatus().catch(()=>({}));obWaiting={};
  // Without a signed-in Codex or Claude, the free built-in model is the one that works out of the box.
  const current=uiProvider(settings),obDefault=settings.onboarded||current==='builtin'||current==='local'||obProviders[current]?.loggedIn?current:'builtin';
  const llm=await window.bula.llmStatus();obLlm=llm;modelChoices($('ob-llm-models'),'ob-llm-model',settings.builtinModel||llm.recommended,llm);
  renderObBrains(obDefault);
  const voice=settings.volume===false?'off':settings.voiceProvider||'edge';document.querySelector(`input[name=ob-voice][value=${['edge','kokoro','system','off'].includes(voice)?voice:'edge'}]`).checked=true;
  const wake=await window.bula.wakeStatus();$('ob-wake').checked=wake.enabled;$('ob-asr').checked=!wake.asr.installed;$('ob-asr').disabled=wake.asr.installed;$('ob-wake-word').textContent=wake.phrases[0]||t('onboarding.wake.defaultWord');
  $('ob-llm').hidden=obDefault!=='builtin';
  obStep=0;showObStep();document.body.classList.add('onboarding');$('onboarding').hidden=false;showChat(false);clearTimeout(idleTimer);
}
let obLlm=null;
// the brain choices; re-rendered when the interface language changes (the choice is kept)
function renderObBrains(selected=document.querySelector('input[name=ob-brain]:checked')?.value){
  $('ob-brains').replaceChildren(...OB_BRAINS.map(([value,nameKey,hintKey])=>{const name=nameKey.includes('.')?t(nameKey):nameKey,hint=t(hintKey);const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name='ob-brain';input.value=value;input.checked=selected===value;
    const b=document.createElement('b');b.textContent=name;const small=document.createElement('small');small.textContent=hint;label.append(input,b,small);
    const state=obProviders[value];
    if(state){small.textContent=t('onboarding.brains.withState',{hint,state:cliText(value,state)});if(!state.loggedIn){const button=document.createElement('button');button.type='button';button.textContent=obWaiting[value]?t('onboarding.cliWaiting'):cliAction(state);button.disabled=Boolean(obWaiting[value]);
      button.onclick=event=>{event.preventDefault();input.checked=true;$('ob-llm').hidden=true;setupCli(value,next=>{const live=()=>[...$('ob-brains').querySelectorAll('input')].find(i=>i.value===value)?.closest('label');
        if(next.waiting){obWaiting[value]=true;const btn=live()?.querySelector('button');if(btn){btn.disabled=true;btn.textContent=t('onboarding.cliWaiting');}return;}
        obWaiting[value]=false;obProviders[value]=next;renderObBrains();});};label.append(button);}}
    return label;}));
}
function showObStep(){
  document.querySelectorAll('.ob-page').forEach(page=>{page.hidden=+page.dataset.step!==obStep;});
  document.querySelectorAll('.ob-steps span').forEach((dot,i)=>dot.classList.toggle('done',i<=obStep));
  $('ob-back').hidden=obStep===0;$('ob-next').textContent=t(obStep===3?'onboarding.getStarted':'onboarding.next');$('ob-skip').hidden=obStep===3;
}
async function finishOnboarding(apply){
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
  sayStatus(apply?'onboarding.finished':'onboarding.skipped');
}
$('ob-next').onclick=()=>{if(obStep===3)return finishOnboarding(true);obStep++;showObStep();};
$('ob-brains').onchange=()=>{$('ob-llm').hidden=document.querySelector('input[name=ob-brain]:checked')?.value!=='builtin';};
$('ob-back').onclick=()=>{obStep=Math.max(0,obStep-1);showObStep();};
$('ob-skip').onclick=()=>finishOnboarding(false);
$('ob-preview').onclick=()=>{const voice=document.querySelector('input[name=ob-voice]:checked').value;const name=characterState?.mod.name||'Annie';
  if(voice==='kokoro'){sayStatus('onboarding.kokoroLater');return;}
  window.bula.previewVoice({...voiceChoice(),voiceProvider:voice,text:t('onboarding.previewLine',{name})}).catch(error=>message(error.message,'error'));};
// Game decision model: Laya on this Mac, or TypeSafe's Jev API with the user's key (verified, then stored encrypted).
async function showGameEngine(){
  const info=await window.bula.gameEngines();if(!$('game-engine').dataset.touched){$('game-engine').value=info.selected;$('game-choice').value=settings.game||'lane';}
  const jev=$('game-engine').value==='jev';$('game-jev').hidden=!jev;$('game-jev-key').hidden=$('game-jev-save').hidden=$('game-jev-get').hidden=info.jev.hasKey;$('game-jev-clear').hidden=!info.jev.hasKey;
  $('game-jev-status').textContent=t(info.jev.hasKey?'settings.games.jevSaved':'settings.games.jevAbout');
}
$('game-engine').onchange=()=>{$('game-engine').dataset.touched='1';showGameEngine();};
$('game-jev-save').onclick=async()=>{$('game-jev-save').disabled=true;$('game-jev-status').textContent=t('settings.games.jevChecking');
  try{await window.bula.setJevKey($('game-jev-key').value);$('game-jev-key').value='';}catch(error){message(cleanError(error),'error');}$('game-jev-save').disabled=false;showGameEngine();};
$('game-jev-get').onclick=()=>window.bula.openJevKeys();
$('game-jev-clear').onclick=async()=>{await window.bula.clearJevKey();showGameEngine();};
// Characters made from photos: open the camera window, list them, delete one.
async function showPeople(){const list=await window.bula.personList().catch(()=>[]);
  $('person-list').replaceChildren(...list.map(p=>{const li=document.createElement('li');const span=document.createElement('span');span.translate=false;span.textContent=`🙂 ${p.name}`;const edit=document.createElement('button');edit.type='button';edit.className='edit';edit.textContent=t('settings.characters.edit');edit.onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');window.bula.personEdit(p.id).catch(error=>message(cleanError(error),'error'));};
    const del=document.createElement('button');del.type='button';del.textContent=t('settings.characters.delete');
    del.onclick=async()=>{await window.bula.personDelete(p.id);showPeople();};li.append(span,edit,del);return li;}));}
$('person-open').onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');window.bula.personOpen().catch(error=>message(cleanError(error),'error'));};
// Phone remote: Tailscale publishes a small chat page to the user's own devices; phones pair once with a code.
async function showRemote(status){
  status??=await window.bula.remoteStatus().catch(()=>null);if(!status)return;const ts=status.tailscale;
  $('remote-status').textContent=!ts.installed?t('settings.remote.needsTailscale')
    :!ts.running?t('settings.remote.notRunning')
    :status.enabled?t('settings.remote.on',{url:status.url}):t('settings.remote.connected',{dns:ts.dnsName});
  $('remote-tasks-row').hidden=!status.enabled;$('remote-tasks').checked=status.remoteTasks;
  $('remote-toggle').textContent=t(status.enabled?'settings.remote.turnOff':'settings.remote.turnOn');$('remote-pair').hidden=!status.enabled;
  $('remote-devices').replaceChildren(...status.devices.map(d=>{const li=document.createElement('li');const span=document.createElement('span');span.textContent=t('settings.remote.device',{name:d.name,time:d.lastSeen?new Date(d.lastSeen).toLocaleString(i18n.lang):'—'});
    const remove=document.createElement('button');remove.type='button';remove.textContent=t('settings.remote.remove');remove.onclick=async()=>{await window.bula.remoteRevoke(d.id);showRemote();};li.append(span,remove);return li;}));
}
$('remote-toggle').onclick=async()=>{
  $('remote-toggle').disabled=true;$('remote-qr').hidden=true;
  try{const status=await window.bula.remoteStatus();await showRemote(status.enabled?await window.bula.remoteDisable():await window.bula.remoteEnable());}
  catch(error){const text=cleanError(error);$('remote-status').textContent=text;message(text,'error');}
  $('remote-toggle').disabled=false;
};
$('remote-tasks').onchange=async()=>showRemote(await window.bula.remoteTasks($('remote-tasks').checked));
// A phone changed the brain, language or voice: show the new values here too.
window.bula.onSettingsChanged(next=>{settings=next;$('provider').value=uiProvider(settings);$('reply-language').value=settings.replyLanguage||'auto';$('ui-language').value=settings.uiLanguage||'auto';$('voice-provider').value=settings.volume===false?'off':settings.voiceProvider;localFields();sayStatus('chat.settingsFromPhone');});
$('remote-pair').onclick=async()=>{
  try{const pair=await window.bula.remotePair();const svg=new DOMParser().parseFromString(pair.qr,'image/svg+xml').documentElement;
    $('remote-qr-image').replaceChildren(document.importNode(svg,true));$('remote-link').textContent=pair.link.replace(/\?pair=.*/,'');$('remote-code').textContent=pair.code;$('remote-qr').hidden=false;
    setTimeout(()=>{$('remote-qr').hidden=true;showRemote();},Math.max(0,pair.expires-Date.now()));}
  catch(error){message(cleanError(error),'error');}
};
window.bula.onRemoteChat(({device,text,reply,emotion:mood})=>{message(`📱 ${text}`,'user');message(reply);if(mood)emotion(mood);showRemote();});
// Watch mode: the character comments on the game window the user is playing.
let watching=false,watchNote=null;
// the note under the watch controls; a function is re-run when the interface language changes
function watchStatus(text){watchNote=typeof text==='function'?text:null;$('watch-status').textContent=watchNote?text():text;}
function watchToggleLabel(){$('watch-toggle').textContent=t(watching?'settings.games.stop':'settings.games.start');}
let watchList=[];
function watchSourceLabel(s){const screens=watchList.filter(x=>x.screen).length;return s.screen?t('settings.games.wholeScreen',{which:screens>1?t('settings.games.screenWhich',{name:s.name}):''}):s.name;}
async function loadWatchSources(){
  try{const list=await window.bula.watchSources();const keep=$('watch-source').value;watchList=list;
    $('watch-source').replaceChildren(new Option(t('settings.games.chooseWindow'),''),...list.map(s=>new Option(watchSourceLabel(s),s.id)));$('watch-source').value=keep;
    watchStatus(()=>t('settings.games.watchHelp'));}
  catch(error){watchStatus(()=>t('settings.games.needsScreen'));}
}
function watchSourceLabels(){const options=[...$('watch-source').options];if(options[0])options[0].textContent=t('settings.games.chooseWindow');for(const option of options.slice(1)){const s=watchList.find(x=>x.id===option.value);if(s)option.textContent=watchSourceLabel(s);}}
$('watch-source').onchange=()=>{const option=$('watch-source').selectedOptions[0],name=option?.textContent||'';if(!$('watch-game').value.trim()&&!option?.value.startsWith('screen:'))$('watch-game').value=name.split(/ [-–—|] /)[0].trim();};
$('watch-refresh').onclick=loadWatchSources;
$('watch-toggle').onclick=async()=>{
  if(watching){await window.bula.watchStop();return;}
  try{const info=await window.bula.watchStart({sourceId:$('watch-source').value,game:$('watch-game').value,interval:6});
    watchStatus(()=>info.found?t('settings.games.found',{game:info.title}):t('settings.games.notFound'));}
  catch(error){const text=cleanError(error);message(text,'error');watchStatus(text);}
};
window.bula.onWatch(event=>{
  if(event.state==='research')sayStatus('settings.games.researching',{game:event.game});
  if(event.state==='watching'){watching=true;watchToggleLabel();sayStatus('settings.games.watching',{game:event.game});}
  if(event.state==='stopped'){watching=false;watchToggleLabel();}
  if(event.state==='comment'){message(event.text);emotion(event.emotion);if(event.progress)watchStatus(()=>t('settings.games.progress',{progress:event.progress}));}
  if(event.state==='error'){watchStatus(event.error);status(event.error);}
  if(event.state==='lost'){watchStatus(()=>t('settings.games.lost'));sayStatus('settings.games.lost');}
});
$('open-game').onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');window.bula.openGame($('game-engine').value,$('game-choice').value);};
$('show-onboarding').onclick=()=>{$('settings').hidden=true;document.body.classList.remove('settings');startOnboarding();};

// Stop reading aloud: the button by the character (shown while it speaks), or Esc
$('stop-speech').onclick=event=>{event.stopPropagation();window.bula.stop();};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&characterState?.speaking){event.preventDefault();event.stopImmediatePropagation();window.bula.stop();}},true);

// --- 開發夥伴: the companion attached to one of the user's Claude Code / Codex sessions (dev-companion.cjs in main).
// While attached, typed and spoken messages go to that session; its replies stream into the chat, tool activity shows as
// a status line, and permission requests appear as cards answered with the buttons or by saying 允許 / 拒絕.
let dev=null,devLive=null,devLastSegment=null,devToolLine=null;
const ENGINE_ICON={claude:'✳️',codex:'◎'},ENGINE_NAME={claude:'Claude',codex:'Codex'};
function devAgo(ms){const m=Math.round((Date.now()-ms)/60000);if(m<1)return t('companion.dev.justNow');if(m<60)return t('companion.dev.minutesAgo',{count:m});const h=Math.round(m/60);if(h<24)return t('companion.dev.hoursAgo',{count:h});return t('companion.dev.daysAgo',{count:Math.round(h/24)});}
const devSize=bytes=>bytes==null?'':bytes>=1e6?`${(bytes/1e6).toFixed(bytes>=1e7?0:1)} MB`:`${Math.max(1,Math.round(bytes/1e3))} KB`;
function renderDev(){
  const a=dev?.attached;document.body.classList.toggle('dev-attached',Boolean(a));$('dev-bar').hidden=!a;
  if(a){$('dev-label').textContent=t('companion.dev.attachedLabel',{project:a.project,engine:ENGINE_NAME[a.engine]});$('dev-label').title=`${a.cwd}\n${a.title||''}${a.mode?`\n${t('companion.dev.modeLine',{mode:a.mode})}`:''}`;
    $('dev-stop').disabled=!dev.busy&&!dev.pending?.length;$('prompt').placeholder=t('companion.dev.placeholder',{project:a.project});}
  else if(characterState)$('prompt').placeholder=t('chat.placeholder',{name:characterState.mod.name});
  $('dev-open').classList.toggle('on',Boolean(a));
}
// notes from the coding session; a note made from interface text keeps its key so it follows the language
function devNote(text){const el=message(typeof text==='function'?text():text,'assistant');el.classList.add('dev-note');if(typeof text==='function')el._i18n=text;return el;}
async function initDev(){
  dev=await window.bula.devState();renderDev();
  $('dev-ask-codex').checked=Boolean(settings.devCodexAskMe);
  // a session attached before the app was closed: offer to reconnect, never reconnect by itself
  if(dev.offer&&!dev.attached){
    const o=dev.offer,el=devNote(()=>t('companion.dev.offer',{project:o.project,engine:ENGINE_NAME[o.engine],title:o.title?t('companion.dev.titleSuffix',{title:o.title}):''}));
    el.classList.add('offer');const row=document.createElement('div');row.className='actions';
    const yes=Object.assign(document.createElement('button'),{type:'button',className:'reattach',textContent:t('companion.dev.reattach')});yes.dataset.i18n='companion.dev.reattach';
    const no=Object.assign(document.createElement('button'),{type:'button',className:'dismiss',textContent:t('companion.dev.noThanks')});no.dataset.i18n='companion.dev.noThanks';
    yes.onclick=()=>{row.remove();devAttach(o.engine,o.id);};no.onclick=()=>{row.remove();window.bula.devDismiss().then(state=>{dev=state;renderDev();}).catch(()=>{});};
    row.append(yes,no);el.append(row);showChat(false);
  }
}
function openDevPicker(){
  if(!$('settings').hidden){$('settings').hidden=true;document.body.classList.remove('settings');}
  showChat(false);$('dev-picker').hidden=false;document.body.classList.add('dev-picking');loadDevSessions();
}
function closeDevPicker(){$('dev-picker').hidden=true;document.body.classList.remove('dev-picking');armIdle();}
const devEmpty=text=>Object.assign(document.createElement('li'),{className:'empty',textContent:text});
let devSessionList=null;
async function loadDevSessions(){
  const list=$('dev-list');devSessionList=null;list.replaceChildren(devEmpty(t('companion.dev.looking')));
  let sessions;try{sessions=await window.bula.devSessions();}catch(error){list.replaceChildren(devEmpty(cleanError(error)));return;}
  devSessionList=sessions;renderDevSessions();
}
function renderDevSessions(){
  const list=$('dev-list'),sessions=devSessionList;if(!sessions)return;
  if(!sessions.length){list.replaceChildren(devEmpty(t('companion.dev.none')));return;}
  list.replaceChildren(...sessions.map(s=>{
    const li=document.createElement('li'),b=document.createElement('button');b.type='button';b.dataset.engine=s.engine;b.dataset.id=s.id;
    const icon=Object.assign(document.createElement('span'),{className:'engine',textContent:ENGINE_ICON[s.engine]||'•',title:ENGINE_NAME[s.engine]});
    const project=Object.assign(document.createElement('span'),{className:'project',textContent:`${s.project} · ${ENGINE_NAME[s.engine]}`,title:s.cwd,translate:false});
    const title=Object.assign(document.createElement('span'),{className:'title',textContent:s.title||t('companion.dev.untitled'),title:s.title||''});if(s.title)title.translate=false;
    const meta=Object.assign(document.createElement('span'),{className:'meta',textContent:[devAgo(s.updatedAt),s.turns?t('companion.dev.turns',{count:s.turns}):devSize(s.size)].filter(Boolean).join(' · ')});
    b.append(icon,project,title,meta);
    if(s.maybeOpen)b.append(Object.assign(document.createElement('span'),{className:'warn',textContent:t('companion.dev.maybeOpen')}));
    b.onclick=()=>{closeDevPicker();devAttach(s.engine,s.id);};li.append(b);return li;}));
}
async function devAttach(engine,id){
  sayStatus('companion.dev.attaching');
  try{dev=await window.bula.devAttach({engine,id,askUser:$('dev-ask-codex').checked});renderDev();}
  catch(error){message(cleanError(error),'error');sayStatus('chat.failed');}
}
async function devSubmit(text){
  clearTimeout(voiceTimer);$('prompt').value='';message(text,'user');
  try{const result=await window.bula.devInput(text);
    if(!result.ok)message(result.error,'error');
    else if(result.answered)sayStatus(result.answered==='allow'?'companion.dev.allowed':'companion.dev.denied');
    else if(result.interrupted)sayStatus('companion.dev.stopping');
    else status(()=>`${ENGINE_NAME[dev.attached.engine]} · ${t('chat.thinking')}`);}
  catch(error){message(cleanError(error),'error');}
  armIdle();
}
const DEV_RESULTS={allowed:'companion.dev.resolvedAllowed',denied:'companion.dev.resolvedDenied'};
function devCard(a){
  const el=document.createElement('div');el.className='message approval';el.dataset.request=a.requestId;
  el.append(Object.assign(document.createElement('b'),{textContent:`🔐 ${a.title}`}),Object.assign(document.createElement('div'),{className:'question',textContent:a.question}));
  const detail=[a.command?`$ ${a.command}`:null,a.command&&a.cwd?`(${a.cwd})`:null,a.diff||null,!a.command&&!a.diff?(a.detail||(a.files||[]).join('\n')||null):null].filter(Boolean).join('\n');
  if(detail)el.append(Object.assign(document.createElement('pre'),{textContent:detail}));
  if(a.reason)el.append(Object.assign(document.createElement('small'),{textContent:a.reason}));
  const row=document.createElement('div');row.className='actions';
  const allow=Object.assign(document.createElement('button'),{type:'button',className:'allow',textContent:t('companion.dev.allow')});allow.dataset.i18n='companion.dev.allow';
  const deny=Object.assign(document.createElement('button'),{type:'button',className:'deny',textContent:t('companion.dev.deny')});deny.dataset.i18n='companion.dev.deny';
  const answer=ok=>{allow.disabled=deny.disabled=true;window.bula.devAnswer(a.requestId,ok).then(r=>{if(!r.ok){allow.disabled=deny.disabled=false;message(r.error,'error');}}).catch(error=>{allow.disabled=deny.disabled=false;message(cleanError(error),'error');});};
  allow.onclick=()=>answer(true);deny.onclick=()=>answer(false);row.append(allow,deny);el.append(row);
  const result=Object.assign(document.createElement('div'),{className:'result',textContent:t('companion.dev.answerHint')});result.dataset.i18n='companion.dev.answerHint';el.append(result);
  $('conversation').append(el);$('conversation').scrollTop=$('conversation').scrollHeight;return el;
}
function devFinishLive(text){if(devLive){devLive.classList.remove('streaming');if(text!=null)devLive.textContent=text;devLastSegment=devLive;devLive=null;}}
window.bula.onDev(event=>{
  if(event.state)dev=event.state;
  if(event.type==='attached'){const a=dev.attached;devLive=devLastSegment=devToolLine=null;showChat(false);
    devNote(()=>t('companion.dev.attached',{project:a.project,engine:ENGINE_NAME[a.engine],title:a.title?t('companion.dev.attachedTitle',{title:a.title}):'',cwd:a.cwd}));
    if(a.maybeOpen){const warn=message(t('companion.dev.openWarning'),'error');warn.dataset.i18n='companion.dev.openWarning';}
    status(`${a.project} · ${ENGINE_NAME[a.engine]}`);}
  if(event.type==='left'){devLive=devLastSegment=devToolLine=null;devNote(()=>t('companion.dev.left',{project:event.project?t('companion.dev.leftProject',{project:event.project}):'',resume:event.resumeCommand?t('companion.dev.resume',{command:event.resumeCommand}):''}));status(()=>`${settings.provider} · ${t('chat.ready')}`);}
  if(event.type==='user'){devToolLine=null;devLastSegment=null;devLive=null;if(event.source==='phone')message(`📱 ${event.text}`,'user');}
  if(event.type==='delta'){if(!devLive){devLive=message('','assistant');devLive.classList.add('streaming');}devLive.textContent+=event.text;$('conversation').scrollTop=$('conversation').scrollHeight;}
  if(event.type==='progress'){if(devLive)devFinishLive(event.text);else devLastSegment=message(event.text,'assistant');}
  if(event.type==='tool'){status(event.label);if(!devToolLine?.isConnected){devToolLine=message('','assistant');devToolLine.classList.add('tool');}devToolLine.textContent=`🔧 ${event.label}`;$('conversation').append(devToolLine);$('conversation').scrollTop=$('conversation').scrollHeight;}
  if(event.type==='approval'){devFinishLive();showChat(false);devCard(event.approval);sayStatus('companion.dev.waitingDecision');}
  if(event.type==='resolved'){const card=document.querySelector(`.message.approval[data-request="${CSS.escape(event.requestId)}"]`);
    if(card){card.querySelector('.actions')?.remove();const result=card.querySelector('.result');result.dataset.i18n=DEV_RESULTS[event.result]||'companion.dev.resolvedGone';result.textContent=t(result.dataset.i18n);card.dataset.result=event.result;}}
  if(event.type==='reply'){
    if(devLive)devFinishLive(event.text);else if(!(devLastSegment?.isConnected&&devLastSegment.textContent.trim()===event.text.trim()))devLastSegment=message(event.text,'assistant');
    devLastSegment?.classList.add('dev-reply');$('subtitle').textContent=event.spoken||event.text;if(document.body.classList.contains('streaming'))$('subtitle').hidden=false;}
  if(event.type==='interrupting')sayStatus('companion.dev.stopping');
  if(event.type==='turn'){devFinishLive();devToolLine=null;
    if(event.status==='failed')message(t('companion.dev.turnFailed',{error:event.error?t('companion.dev.errorSuffix',{error:event.error}):''}),'error');
    sayStatus(event.status==='completed'?'chat.done':event.status==='interrupted'?'companion.dev.stopped':'chat.failed');armIdle();}
  if(event.type==='notice')devNote(event.text);
  if(event.type==='error')message(t('companion.dev.error',{message:event.message}),'error');
  renderDev();
});
$('dev-open').onclick=()=>dev?.attached?showChat(true):openDevPicker();
$('dev-pick').onclick=openDevPicker;$('dev-close').onclick=closeDevPicker;$('dev-refresh').onclick=loadDevSessions;
$('dev-stop').onclick=()=>window.bula.devInterrupt().catch(error=>message(cleanError(error),'error'));
$('dev-leave').onclick=()=>window.bula.devLeave().then(state=>{dev=state;renderDev();}).catch(error=>message(cleanError(error),'error'));

// 🔊 / 🔇 next to Skin: mute replies read aloud without changing the chosen voice (previews still play)
function showSpeakToggle(muted){const b=$('speak-toggle');b.textContent=muted?'🔇':'🔊';b.classList.toggle('muted',muted);
  const label=t(muted?'toolbar.muted':'toolbar.mute');b.title=label;b.setAttribute('aria-label',label);}
$('speak-toggle').onclick=async event=>{event.stopPropagation();const muted=await window.bula.mute(!settings.muted);settings.muted=muted;showSpeakToggle(muted);sayStatus(muted?'toolbar.mutedStatus':'toolbar.unmutedStatus');};
window.bula.onMuted(muted=>{settings.muted=muted;showSpeakToggle(muted);});
// the interface language changes at once (no Save needed): every window re-renders through i18n.js
$('ui-language').onchange=async()=>{try{const result=await window.bula.uiLanguage($('ui-language').value);if(settings)settings.uiLanguage=result.uiLanguage;}catch(error){message(error.message,'error');}};
// i18n.js has already refilled every data-i18n element; here the text this script wrote itself is redone.
// Inputs, selections, the conversation and recordings stay as they are.
i18n.onChange(()=>{
  if(lastStatus)$('status').textContent=lastStatus();
  for(const el of document.querySelectorAll('#conversation .dev-note'))if(el._i18n&&el.firstChild?.nodeType===3)el.firstChild.nodeValue=el._i18n();
  if(opening?.el.isConnected)opening.el.textContent=t(opening.key,{name:characterState?.mod.name||'Annie'});
  if(!settings)return;
  characterTexts();renderDev();providerLabels();showMicButton();showSpeakToggle(Boolean(settings.muted));
  showCli().catch(()=>{});
  if(llmState&&!$('builtin-settings').hidden){modelChoices($('llm-models'),'llm-model',document.querySelector('input[name=llm-model]:checked')?.value,llmState);updateLlm();}
  showVoice(openaiHasKey,kokoroLast);voiceOptionLabels();if(asrLast)showAsr(asrLast);if(typelessLast)showTypeless(typelessLast);
  if(voicesState)renderVoices();mixLabels();vvStatusText();
  showGameEngine().catch(()=>{});showPeople().catch(()=>{});showRemote().catch(()=>{});
  watchSourceLabels();watchToggleLabel();if(watchNote)$('watch-status').textContent=watchNote();
  if(!$('dev-picker').hidden)renderDevSessions();
  if(!$('onboarding').hidden){renderObBrains();if(obLlm)modelChoices($('ob-llm-models'),'ob-llm-model',document.querySelector('input[name=ob-llm-model]:checked')?.value,obLlm);showObStep();}
});
