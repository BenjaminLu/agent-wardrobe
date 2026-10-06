// Phone remote for the desktop character: pair once, then chat, hand it work on the Mac, read what it saved, and change its settings.
const $=id=>document.getElementById(id);
const KEY='bula-remote-token';
let token=(()=>{try{return localStorage.getItem(KEY);}catch{return null;}})(),pet=null,speakReplies=false,remoteSettings=null;
const api=async(pathname,options={})=>{const res=await fetch(pathname,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}),...options.headers}});
  const data=res.headers.get('Content-Type')?.includes('json')?await res.json():await res.arrayBuffer();if(res.status===401&&pathname!=='/api/pair'){forget();throw new Error(data.error);}if(!res.ok)throw new Error(data.error||res.status);return data;};
const post=(pathname,body)=>api(pathname,{method:'POST',body:JSON.stringify(body)});
function forget(){token=null;try{localStorage.removeItem(KEY);}catch{}showPair();}
function showPair(message=''){$('app').hidden=true;$('pair').hidden=false;$('pair-error').textContent=message;}
// Web addresses in messages and saved files open in a new tab. Only http(s); built as DOM nodes, never as HTML.
const LINK=/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s<>"'`，。、；！？）」』】]+/g;
function linkify(el,text){
  el.replaceChildren();let last=0;
  for(const match of String(text).matchAll(LINK)){
    let url=match[2]||match[0],label=match[1]||url;
    if(!match[2]){const trail=url.match(/[.,;:!?)\]]+$/);if(trail){url=url.slice(0,-trail[0].length);label=url;}}
    let href;try{href=new URL(url);}catch{continue;}if(!['http:','https:'].includes(href.protocol))continue;
    el.append(String(text).slice(last,match.index));const a=document.createElement('a');a.href=href.href;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';el.append(a);
    last=match.index+(match[2]?match[0].length:url.length);
  }
  el.append(String(text).slice(last));
}
function line(text,role='assistant'){const el=document.createElement('div');el.className=`msg ${role}`;linkify(el,text);$('log').append(el);$('log').scrollTop=$('log').scrollHeight;return el;}
// The phone reads replies aloud itself, so nothing plays out loud at home.
// Replies are read aloud on the phone in the character's own voice (synthesized on the Mac, sentence by sentence, the next one
// prepared while the current one plays); without an own voice, the phone's built-in speech is used.
// one audio element, unlocked by the 🔊 tap: iOS only lets an element play later if it first played inside a tap
const sayEl=new Audio();let sayRun=0,sayAudio=null;
const sentencesOf=text=>String(text).replace(/\s*\n\s*/g,'\n').replace(/([.!?])\s+/g,'$1\n').replace(/([。！？；])/g,'$1\n').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,30);
function stopSaying(){sayRun++;if(sayAudio){sayAudio.pause();sayAudio=null;}if('speechSynthesis' in window)speechSynthesis.cancel();}
function systemSay(text){if(!('speechSynthesis' in window))return;const u=new SpeechSynthesisUtterance(text);u.lang=/[぀-ヿ]/.test(text)?'ja-JP':/[一-鿿]/.test(text)?'zh-TW':'en-US';speechSynthesis.cancel();speechSynthesis.speak(u);}
async function say(text){
  if(!speakReplies||!String(text||'').trim())return;stopSaying();const run=sayRun,parts=sentencesOf(text);
  const fetchPart=part=>post('/api/voices/say',{text:part}).catch(()=>({voice:null}));
  let next=fetchPart(parts[0]);
  for(let i=0;i<parts.length;i++){
    const got=await next;if(run!==sayRun)return;
    if(!got.voice){systemSay(parts.slice(i).join(' '));return;}  // no own voice (or the Mac couldn't make it): the phone's own speech
    if(i+1<parts.length)next=fetchPart(parts[i+1]);
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(got.audio),c=>c.charCodeAt(0))],{type:got.mime}));sayAudio=sayEl;sayEl.src=url;
    await new Promise(done=>{sayAudio.onended=sayAudio.onerror=done;sayAudio.play().catch(done);});URL.revokeObjectURL(url);if(run!==sayRun)return;
  }
  sayAudio=null;
}
function render(state){
  $('stop-speech').hidden=!state.speaking;
  $('name').textContent=state.mod.name;document.title=`${state.mod.name} 遙控`;
  if(!pet||pet.dataset.mod!==`${state.mod.id}/${state.skin.id}`){$('pet').replaceChildren();pet=Avatars.mount($('pet'),state.mod,state.skin,'remote-pet');if(pet)pet.dataset.mod=`${state.mod.id}/${state.skin.id}`;}
  if(pet)Avatars.update(pet,state);
}

// --- Tasks on the Mac: progress and the result arrive as events; the stop button cancels.
const TASK_NAMES={browser:'瀏覽器任務',computer:'電腦任務',files:'整理存檔'};
let taskLine=null;const finishedTasks=new Set();  // late 'working' events after a result are ignored
function onTask(event){
  const name=TASK_NAMES[event.mode]||'任務';
  if(finishedTasks.has(event.id))return;
  if(['working','progress','approval'].includes(event.type)){$('task-bar').hidden=false;$('task-state').textContent=event.type==='approval'?`${name}：在 Mac 上等你確認`:`${name}進行中…`;}
  if(event.type==='progress'&&event.text){taskLine??=line('','task');linkify(taskLine,`⏳ ${event.text}`);}
  if(['result','error','cancelled'].includes(event.type)){
    finishedTasks.add(event.id);$('task-bar').hidden=true;const text=event.type==='result'?`✅ ${name}完成\n${event.text||''}`:event.type==='cancelled'?`■ ${name}已停止`:`⚠️ ${name}沒有完成${event.text?`：${event.text}`:''}`;
    linkify(taskLine||=line('','task'),text);if(event.type==='error')taskLine?.classList.add('error');taskLine=null;
    if(event.type==='result'){say(event.text||'');loadFiles();}
  }
}
$('task-stop').onclick=()=>post('/api/stop',{}).catch(error=>line(error.message,'note'));

// Server-sent events over fetch, so the device token travels in a header rather than the URL.
async function listen(){
  for(;;){
    try{const res=await fetch('/api/events',{headers:{Authorization:`Bearer ${token}`}});if(res.status===401)return forget();
      $('link').classList.add('on');const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='';
      for(;;){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let i;
        while((i=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,i);buffer=buffer.slice(i+2);const type=block.match(/^event: (.+)$/m)?.[1],data=block.match(/^data: (.+)$/m)?.[1];if(!type||!data)continue;
          const value=JSON.parse(data);if(type==='state'){render(value);markWorn(value);}if(type==='task')onTask(value);if(type==='dev')onDev(value);if(type==='settings')fillSettings(value);if(type==='edit')onEdit(value);if(type==='assist')onAssist(value);if(type==='characters'&&!$('tab-characters').hidden)loadCharacters();if((type==='voices'||type==='state'&&value.mod.id!==voiceMod)&&!$('tab-settings').hidden)loadVoices();if(type==='state')voiceMod=value.mod.id;
          if(type==='message'){line(value.text,value.role);if(value.role==='assistant')say(value.text);}}}
    }catch{}
    $('link').classList.remove('on');await new Promise(r=>setTimeout(r,3000));
  }
}

// --- Chat: plain chat, auto (the character may hand work to a task), or a task directly.
$('chat').onsubmit=async event=>{
  event.preventDefault();const text=$('text').value.trim(),mode=$('mode').value;if(!text)return;$('text').value='';line(text,'user');
  const thinking=line(mode==='chat'||mode==='auto'?'思考中…':'交給 Mac 處理中…','note');
  try{
    // 開發夥伴: everything goes to the attached session; its reply arrives as a 'dev' event
    if(devState?.attached){const reply=await post('/api/chat',{text});thinking.remove();if(!reply.ok)line(reply.error,'note');return;}
    if(TASK_NAMES[mode]){await post('/api/task',{mode,text});thinking.remove();taskLine=line(`⏳ ${TASK_NAMES[mode]}開始了`,'task');return;}
    const reply=await post('/api/chat',{text,auto:mode==='auto'});thinking.remove();
    if(!reply.ok&&reply.error){line(reply.error,'note');return;}
    if(reply.task){line(reply.text||'好，我去處理。');taskLine=line(`⏳ ${TASK_NAMES[reply.mode]||'任務'}開始了`,'task');return;}
    line(reply.text);say(reply.text);
  }catch(error){thinking.remove();line(error.message,'note');}
};

// --- Files the character saved on the Mac (reports and tables), readable here.
async function loadFiles(){
  try{const groups=await api('/api/outputs');
    $('files').replaceChildren(...(groups.length?groups.map(group=>{const box=document.createElement('div');box.className='file-group';const title=document.createElement('b');title.textContent=group.title;
      const when=document.createElement('small');when.textContent=new Date(group.updatedAt).toLocaleString();box.append(title,when);
      for(const name of group.files){const button=document.createElement('button');button.type='button';button.textContent=`📄 ${name}`;button.onclick=()=>openFile(group.id,name);box.append(button);}
      return box;}):[Object.assign(document.createElement('p'),{className:'hint',textContent:'還沒有存下任何檔案。請角色「整理成報告存起來」試試。'})]));}
  catch(error){$('files').textContent=error.message;}
}
function csvRows(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
  else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(c!=='\r')cell+=c;}
  if(cell||row.length){row.push(cell);rows.push(row);}return rows;}
async function openFile(id,name){
  try{const file=await api(`/api/output-file?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`);$('files').hidden=true;$('viewer').hidden=false;$('viewer-name').textContent=name;
    if(/\.csv$/i.test(name)){const table=document.createElement('table');csvRows(file.content).forEach((cells,r)=>{const tr=document.createElement('tr');for(const value of cells){const td=document.createElement(r?'td':'th');linkify(td,value);tr.append(td);}table.append(tr);});$('viewer-body').replaceChildren(table);}
    else linkify($('viewer-body'),/\.json$/i.test(name)?JSON.stringify(JSON.parse(file.content),null,2):file.content);}
  catch(error){alert(error.message);}
}
$('viewer-back').onclick=()=>{$('viewer').hidden=true;$('files').hidden=false;};

// --- Settings: character, skin, persona, brain, reply language and the Mac's voice.
const option=(value,label)=>Object.assign(document.createElement('option'),{value,textContent:label});
function fillSettings(data){
  remoteSettings=data;const s=data.settings,sel=data.selection,mod=data.characters.find(m=>m.id===sel.modId)||data.characters[0];
  $('s-mod').replaceChildren(...data.characters.map(m=>option(m.id,m.name)));$('s-mod').value=sel.modId;
  $('s-skin').replaceChildren(...mod.skins.map(k=>option(k.id,k.name)));$('s-skin').value=sel.skinId;
  $('s-persona').replaceChildren(...mod.personas.map(p=>option(p.id,p.name)));$('s-persona').value=sel.personaId;
  $('s-brain').value=s.provider==='local'&&s.localEngine==='builtin'?'builtin':s.provider;
  $('s-model').replaceChildren(...data.builtinModels.map(m=>option(m.id,m.name)));$('s-model').value=s.builtinModel;$('s-model-row').hidden=$('s-brain').value!=='builtin';
  $('s-speak').checked=!s.muted;$('s-reply').value=s.replyLanguage||'auto';$('s-voice').value=data.volume?s.voiceProvider:'off';
  $('s-note').textContent=data.remoteTasks?'這支手機可以叫 Mac 做事（瀏覽器、電腦、整理存檔）。':'要從手機叫 Mac 做事，請在 Mac 的「設定 → 手機遙控」打開「允許手機下達電腦任務」。';
  renderDev();
  for(const value of ['browser','computer','files','auto'])$('mode').querySelector(`[value=${value}]`).disabled=!data.remoteTasks;if(data.computer&&!data.computer.available){const o=$('mode').querySelector('[value=computer]');o.disabled=true;o.title=data.computer.reason;if($('mode').value==='computer')$('mode').value='chat';}if(!data.remoteTasks&&$('mode').value!=='chat')$('mode').value='chat';
}
const change=async(pathname,body)=>{try{fillSettings(await post(pathname,body));}catch(error){alert(error.message);fillSettings(remoteSettings);}};
$('s-mod').onchange=()=>{const mod=remoteSettings.characters.find(m=>m.id===$('s-mod').value);change('/api/select',{modId:mod.id,skinId:mod.skins[0].id,personaId:mod.personas[0].id});};
$('s-skin').onchange=()=>change('/api/select',{modId:$('s-mod').value,skinId:$('s-skin').value,personaId:$('s-persona').value});
$('s-persona').onchange=$('s-skin').onchange;
$('s-brain').onchange=()=>{const v=$('s-brain').value;change('/api/settings',{settings:v==='builtin'?{provider:'local',localEngine:'builtin',builtinModel:$('s-model').value||remoteSettings.settings.builtinModel}:v==='local'?{provider:'local',localEngine:'lmstudio'}:{provider:v}});};
$('s-model').onchange=()=>change('/api/settings',{settings:{builtinModel:$('s-model').value}});
$('s-reply').onchange=()=>change('/api/settings',{settings:{replyLanguage:$('s-reply').value}});
$('s-voice').onchange=()=>change('/api/settings',{settings:{voiceProvider:$('s-voice').value}});
$('s-speak').onchange=()=>post('/api/mute',{muted:!$('s-speak').checked}).catch(error=>alert(error.message));

// --- Characters: wear one, pick a skin, edit it with Codex, make one from a phone photo, or start from the open libraries.
const modCache=new Map();
const loadMod=async id=>{if(!modCache.has(id))modCache.set(id,api(`/api/mod?id=${encodeURIComponent(id)}`));return modCache.get(id);};
let worn={};
function markWorn(state){worn={modId:state.mod.id,skinId:state.skin.id};for(const card of document.querySelectorAll('.char')){card.classList.toggle('on',card.dataset.id===worn.modId);
  for(const b of card.querySelectorAll('.skins button'))b.classList.toggle('on',card.dataset.id===worn.modId&&b.dataset.skin===worn.skinId);}}
async function loadCharacters(){
  try{const data=await api('/api/characters');worn=data.selection;modCache.clear();
    $('char-list').replaceChildren(...data.characters.map(c=>{const card=document.createElement('div');card.className='char';card.dataset.id=c.id;
      const mini=document.createElement('div');mini.className='mini';
      // 3D and Live2D previews would need one WebGL context each; they are shown once worn
      if(['vrm','gltf','mmd'].includes(c.renderer))mini.textContent='3D 角色';else if(c.renderer==='live2d')mini.textContent='Live2D 角色';else loadMod(c.id).then(mod=>{const el=Avatars.mount(mini,mod,mod.skins[0],`mini-${c.id}`);Avatars.update(el,{activity:'idle',emotion:'neutral',displayState:'idle'});}).catch(()=>{mini.textContent='—';});
      const name=document.createElement('b');name.textContent=c.name+(c.private?' 🔒':'');const desc=document.createElement('small');desc.textContent=c.description||'';
      const skins=document.createElement('div');skins.className='skins';for(const s of c.skins){const b=document.createElement('button');b.type='button';b.dataset.skin=s.id;b.textContent=s.name;b.onclick=()=>post('/api/select',{modId:c.id,skinId:s.id}).catch(e=>alert(e.message));skins.append(b);}
      const edit=document.createElement('button');edit.type='button';edit.className='edit';edit.textContent=c.private?'✏️ 修改造型':'✏️ 做我的版本';
      edit.onclick=()=>{const skin=card.querySelector('.skins button.on')?.dataset.skin;openEditor(()=>post('/api/edit/start',{modId:c.id,skinId:skin}),c.private?`修改：${c.name}`:`我的版本：${c.name}`);};
      mini.onclick=()=>post('/api/select',{modId:c.id,skinId:c.skins[0].id}).catch(e=>alert(e.message));
      card.append(mini,name,desc,skins,edit);
      // SVG characters can get a new skin from a photo of clothes
      if(c.renderer==='svg'){const dress=document.createElement('button');dress.type='button';dress.className='edit';dress.textContent='📷 拍照換造型';
        dress.onclick=()=>{outfitFor={modId:c.id,skinId:card.querySelector('.skins button.on')?.dataset.skin||c.skins[0].id,name:c.name};$('outfit-photo').click();};card.append(dress);}
      return card;}));
    markWorn({mod:{id:worn.modId},skin:{id:worn.skinId}});}
  catch(error){$('char-list').textContent=error.message;}
}
// The editor shows a drawing with every look, asks Codex for changes, and saves. Codex work arrives as 'edit' events.
const LOOKS=[['一般','neutral'],['開心','happy'],['得意','smug'],['驚訝','surprised'],['難過','sad']];
const STEP={draw:'Codex 畫第一版',revise:'Codex 對照修改',thinking:'Codex 構思中',fix:'修正不合規格的地方'};
function showDrawing(result){
  $('ed-pet').replaceChildren();const el=Avatars.mount($('ed-pet'),result.mod,result.mod.skins[0],'ed-main');Avatars.update(el,{activity:'idle',emotion:'neutral',displayState:'idle'});
  $('ed-looks').replaceChildren(...LOOKS.map(([label,emotion],i)=>{const f=document.createElement('figure'),cell=document.createElement('div');cell.className='cell';const cap=document.createElement('figcaption');cap.textContent=label;f.append(cell,cap);
    const e=Avatars.mount(cell,result.mod,result.mod.skins[0],`ed-look-${i}`);Avatars.update(e,{activity:'idle',emotion,displayState:'idle'});return f;}));
  $('ed-redraw').hidden=true;$('ed-revise-form').hidden=false;$('ed-save-form').hidden=false;if(result.name)$('ed-name').value=result.name;
  $('ed-status').textContent=result.summary?`${result.summary}。不滿意就寫下想怎麼改，或取名字後儲存。`:'';
}
function onStart(start){
  if(start.redraw){const img=document.createElement('img');img.src=start.image;$('ed-pet').replaceChildren(img);$('ed-looks').replaceChildren();$('ed-redraw').hidden=false;$('ed-revise-form').hidden=true;$('ed-save-form').hidden=true;$('ed-name').value=start.name;
    $('ed-status').textContent='這個角色不是用可編輯的 SVG 畫的。先請 Codex 照著重畫一份（約 3–5 分鐘），之後就能一直修改。';}
  else showDrawing(start);
}
async function openEditor(start,title){
  $('editor').hidden=false;$('ed-title').textContent=title;$('ed-name').placeholder='角色名字';$('ed-pet').replaceChildren();$('ed-looks').replaceChildren();$('ed-status').textContent='準備中…';
  $('ed-redraw').hidden=$('ed-revise-form').hidden=$('ed-save-form').hidden=true;
  try{const result=await start();if(result)onStart(result);}catch(error){$('ed-status').textContent=error.message;}
}
function onEdit(event){
  if($('editor').hidden)return;
  if(event.state==='progress')$('ed-status').textContent=event.step==='done'?'完成！':`${STEP[event.step]||event.step}${event.detail&&event.step!=='fix'?`（${event.detail}）`:''}…`;
  if(event.state==='done')showDrawing(event.result);
  if(event.state==='error'){$('ed-status').textContent=event.error;for(const b of document.querySelectorAll('#editor button'))b.disabled=false;}
}
const job=async(pathname,body,label)=>{for(const b of document.querySelectorAll('#editor button:not(#ed-close)'))b.disabled=true;$('ed-status').textContent=label;
  try{await post(pathname,body);}catch(error){$('ed-status').textContent=error.message;}finally{for(const b of document.querySelectorAll('#editor button'))b.disabled=false;}};
$('ed-redraw').onclick=()=>job('/api/edit/redraw',{},'Codex 正在重畫…（約 3–5 分鐘，可以先去做別的事）');
$('ed-revise-form').onsubmit=event=>{event.preventDefault();const text=$('ed-revise').value.trim();if(!text)return;$('ed-revise').value='';job('/api/edit/revise',{text},`請 Codex 修改：${text}（約 1–3 分鐘）`);};
$('ed-save-form').onsubmit=async event=>{event.preventDefault();try{await post('/api/edit/save',{name:$('ed-name').value.trim()});$('editor').hidden=true;loadCharacters();}catch(error){$('ed-status').textContent=error.message;}};
$('ed-close').onclick=()=>{$('editor').hidden=true;post('/api/edit/cancel',{}).catch(()=>{});};
// a photo from the phone's camera, shrunk to 1024 px here
function shrinkPhoto(input,done){const file=input.files[0];if(!file)return;input.value='';const img=new Image();
  img.onload=()=>{const scale=Math.min(1,1024/Math.max(img.naturalWidth,img.naturalHeight)),c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(img.src);done(c.toDataURL('image/jpeg',.88));};
  img.src=URL.createObjectURL(file);}
$('char-photo').onchange=()=>shrinkPhoto($('char-photo'),photo=>openEditor(async()=>{const preview=document.createElement('img');preview.src=photo;$('ed-pet').replaceChildren(preview);await job('/api/edit/photo',{photo},'交給 Codex 畫…（約 4–6 分鐘，會自己對照照片修改兩輪）');return null;},'用照片做角色'));
// a photo of clothes: Codex dresses the picked character in them and the result is saved as a new skin
let outfitFor=null;
$('outfit-photo').onchange=()=>shrinkPhoto($('outfit-photo'),photo=>{const target=outfitFor;if(!target)return;
  openEditor(async()=>{await post('/api/edit/start',{modId:target.modId,skinId:target.skinId,outfit:true});const preview=document.createElement('img');preview.src=photo;$('ed-pet').replaceChildren(preview);$('ed-name').value='';$('ed-name').placeholder='這套造型的名字';
    await job('/api/edit/outfit',{photo},`Codex 正在幫 ${target.name} 換上照片裡的衣服…（約 2–4 分鐘）`);return null;},`拍照換造型：${target.name}`);});
// open libraries, through the Mac (thumbnails and downloads stay on the Mac's allow-list)
async function searchStore(event){
  event?.preventDefault();const q=$('lib-q').value.trim();const sources=[...document.querySelectorAll('.lib-sources input:checked')].map(i=>i.value).join(',');
  $('lib-status').textContent=q?'搜尋中…':'載入精選角色…';$('lib-results').replaceChildren();
  try{const {items,needs}=await api(`/api/library/search?q=${encodeURIComponent(q)}&sources=${sources}`);
    $('lib-status').textContent=(items.length?`${q?'找到':'精選'} ${items.length} 個角色`:'沒有找到，換個關鍵字試試')+(needs.includes('VROID_LOGIN')?'（在 Mac 的 Mod 市集連結 VRoid Hub 後會有更多）':'');
    $('lib-results').replaceChildren(...items.map(item=>{const card=document.createElement('div');card.className=`lib tier-${item.license.tier}`;const thumb=document.createElement('div');thumb.className='thumb';thumb.textContent='…';
      if(item.kind==='assisted')thumb.textContent='🌐';else api(`/api/library/thumb?key=${encodeURIComponent(item.key)}`).then(r=>{if(r.url){thumb.textContent='';thumb.style.backgroundImage=`url("${r.url}")`;}else thumb.textContent='沒有預覽圖';}).catch(()=>{thumb.textContent='沒有預覽圖';});
      const title=document.createElement('b');title.textContent=item.title;const meta=document.createElement('span');const lic=document.createElement('span');lic.className='lic';lic.textContent=item.license.label;meta.append(lic,` ${item.source}`);
      const go=document.createElement('button');go.type='button';
      if(item.kind==='assisted'){go.textContent='在 Mac 上 AI 輔助下載';go.onclick=async()=>{go.disabled=true;try{await post('/api/assist/open',{site:item.site,page:item.page});go.textContent='已在 Mac 上打開 ✓';$('assist-status').textContent='請到 Mac 前登入、下載，AI 會幫你看條款。';}catch(error){go.disabled=false;$('lib-status').textContent=error.message;}};card.append(thumb,title,meta,go);return card;}
      go.textContent=item.kind==='image'?'請 Codex 畫成角色':'加入並換上';
      go.onclick=async()=>{go.disabled=true;go.textContent='處理中…';try{const r=await post('/api/library/import',{key:item.key});if(r.opened==='phone-editor')openEditor(async()=>r.edit,`畫成角色：${item.title}`);else{go.textContent='已加入並換上 ✓';loadCharacters();}}catch(error){go.disabled=false;go.textContent='重試';$('lib-status').textContent=error.message;}};
      card.append(thumb,title,meta,go);return card;}));}
  catch(error){$('lib-status').textContent=error.message;}
}
$('lib-form').onsubmit=searchStore;
// AI-assisted download runs on the Mac (sign-in and the site's own pages stay there); the phone opens it and shows its status
for(const button of document.querySelectorAll('.assist button'))button.onclick=async()=>{$('assist-status').textContent='請 Mac 打開下載視窗…';
  try{const r=await post('/api/assist/open',{site:button.dataset.site,q:$('lib-q').value.trim()});$('assist-status').textContent=`已在 Mac 上打開 ${button.textContent}：請到 Mac 前登入、下載，AI 會幫你看條款。`;}
  catch(error){$('assist-status').textContent=error.message;}};
function onAssist(value){if(!value)return;const job=value.job;$('assist-status').textContent=`Mac 下載視窗：${job?.error||value.status||'已打開'}`;}
// --- Voices: the Mac's voice profiles; bind one to the worn character, preview it here or on the Mac.
let voiceMod=null;
async function loadVoices(){
  try{const data=await api('/api/voices'),bound=data.profiles.find(p=>p.id===data.bound);
    $('v-note').textContent=bound?`🔊 ${data.modName} 現在用專屬聲音「${bound.name}」，上面的預設語音不影響她。`:data.profiles.length?`🔊 ${data.modName} 現在用預設語音。從下面選一個就會改用專屬聲音。`:'還沒有專屬聲音。在 Mac 的「設定 → 語音・聲音」可以做新的聲音，或用下面的錄音。';
    $('v-list').replaceChildren(...data.profiles.map(p=>{const box=document.createElement('div');box.className=`voice${p.id===data.bound?' on':''}`;box.dataset.id=p.id;
      const title=document.createElement('b');title.textContent=`${p.cloned?'🔒 ':''}${p.name}`;const lic=document.createElement('small');lic.textContent=[p.license.credit&&`標示：${p.license.credit}`,p.license.label].filter(Boolean).join(' · ');
      const row=document.createElement('div');row.className='row';const btn=(text,fn,cls)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(cls)b.className=cls;b.onclick=async()=>{const label=b.textContent;if(/試聽/.test(label)){b.disabled=true;b.textContent='⏳ 準備聲音…';}try{await fn(b);}catch(error){alert(error.message);}finally{b.disabled=false;b.textContent=label;}};return b;};
      row.append(btn(p.id===data.bound?'✓ 使用中（按一下改回預設）':'用這個聲音',async()=>{await post('/api/voices/bind',{id:p.id===data.bound?null:p.id});loadVoices();},'bind'),
        btn('▶ 手機試聽',async b=>{const r=await post('/api/voices/preview',{id:p.id,where:'phone'});const bytes=Uint8Array.from(atob(r.audio),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:r.mime}));const audio=new Audio(url);b.textContent='🔊 播放中…';await new Promise(done=>{audio.onended=audio.onerror=done;audio.play().catch(done);});URL.revokeObjectURL(url);}),
        btn('▶ Mac 試聽',()=>post('/api/voices/preview',{id:p.id,where:'mac'})));
      // speaking speed, saved with the voice on the Mac
      const speed=document.createElement('label');speed.className='voice-speed';const v=document.createElement('span');const r=document.createElement('input');r.type='range';r.min='0.7';r.max='1.5';r.step='0.05';r.value=String(p.params?.speed||1);
      v.textContent=`${Number(r.value).toFixed(2)}×`;r.oninput=()=>{v.textContent=`${Number(r.value).toFixed(2)}×`;};r.onchange=()=>post('/api/voices/speed',{id:p.id,speed:Number(r.value)}).catch(e=>alert(e.message));
      speed.append('語速 ',v,r);
      box.append(title,lic,speed,row);return box;}));}
  catch(error){$('v-note').textContent=error.message;}
}
// --- 錄音做聲音: consent first, then one ~10 s reading recorded here (MediaRecorder; the page is HTTPS through Tailscale),
// turned into a 24 kHz WAV on the phone and sent to the Mac, which makes a CosyVoice or ElevenLabs voice from it.
// The microphone only runs between the two presses; nothing is recorded on its own.
let recInfo=null,recPrompt=0,recMedia=null,recWav=null;
function recReset(){recStop(true);recWav=null;$('rec-consent').hidden=false;$('rec-record').hidden=true;$('rec-person').value='';$('rec-agreed').checked=false;$('rec-next').disabled=true;
  $('rec-play').hidden=true;$('rec-send').disabled=true;$('rec-status').textContent='';$('rec-time').textContent='';}
$('rec-open').onclick=async()=>{recReset();$('rec').hidden=false;
  try{recInfo=await api('/api/voices/record');const lang=/^ja/.test(navigator.language)?'ja':/^en/.test(navigator.language)?'en':'zh';recInfo.lang=lang;recShowPrompt();recEngineNote();}
  catch(error){$('rec-status').textContent=error.message;}};
$('rec-close').onclick=()=>{recReset();$('rec').hidden=true;};
const recConsentOk=()=>$('rec-person').value.trim()&&$('rec-agreed').checked;
$('rec-person').oninput=$('rec-agreed').onchange=()=>{$('rec-next').disabled=!recConsentOk();};
$('rec-next').onclick=()=>{if(!recConsentOk())return;$('rec-consent').hidden=true;$('rec-record').hidden=false;$('rec-name').value=`${$('rec-person').value.trim()}的聲音`;};
function recShowPrompt(){const list=recInfo?.prompts?.[recInfo.lang]||[];$('rec-prompt').textContent=list[recPrompt%Math.max(1,list.length)]||'';}
function recEngineNote(){const e=recInfo?.engines?.[$('rec-engine').value];$('rec-engine-note').textContent=e?.ok?'':`${e?.reason||''}${e?.install?'（請在 Mac 的「設定 → 聲音 → 錄音複製」安裝）':''}`;}
$('rec-engine').onchange=recEngineNote;$('rec-another').onclick=()=>{recPrompt++;recShowPrompt();};
function recStop(discard){if(!recMedia)return;const m=recMedia;recMedia=null;clearInterval(m.timer);if(discard)m.recorder.onstop=null;if(m.recorder.state!=='inactive')m.recorder.stop();m.stream.getTracks().forEach(t=>t.stop());$('rec-on').hidden=true;$('rec-btn').textContent='● 開始錄音';$('rec-btn').classList.remove('on');document.body.dataset.recording='false';}
// 16-bit mono WAV at 24 kHz from whatever the browser recorded (webm/opus or mp4/aac)
async function recToWav(blob){
  const ctx=new AudioContext(),decoded=await ctx.decodeAudioData(await blob.arrayBuffer());ctx.close();
  const off=new OfflineAudioContext(1,Math.ceil(decoded.duration*24000),24000),src=off.createBufferSource();src.buffer=decoded;src.connect(off.destination);src.start();
  const data=(await off.startRendering()).getChannelData(0),view=new DataView(new ArrayBuffer(44+data.length*2));
  const w=(o,s)=>{for(let i=0;i<s.length;i++)view.setUint8(o+i,s.charCodeAt(i));};
  w(0,'RIFF');view.setUint32(4,36+data.length*2,true);w(8,'WAVE');w(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);w(36,'data');view.setUint32(40,data.length*2,true);
  for(let i=0;i<data.length;i++){const s=Math.max(-1,Math.min(1,data[i]));view.setInt16(44+i*2,s<0?s*32768:s*32767,true);}
  return new Uint8Array(view.buffer);
}
$('rec-btn').onclick=async()=>{
  if(recMedia){recStop(false);return;}
  if(!recConsentOk()){$('rec-status').textContent='請先完成同意步驟。';return;}
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
    const recorder=new MediaRecorder(stream),chunks=[],started=Date.now();
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onstop=async()=>{try{recWav=await recToWav(new Blob(chunks,{type:recorder.mimeType}));const url=URL.createObjectURL(new Blob([recWav],{type:'audio/wav'}));$('rec-play').src=url;$('rec-play').hidden=false;$('rec-send').disabled=false;$('rec-status').textContent='聽聽看，沒問題就按「做成聲音」。';}catch(error){$('rec-status').textContent=`讀不了這段錄音：${error.message}`;}};
    recMedia={recorder,stream,timer:setInterval(()=>{const s=(Date.now()-started)/1000;$('rec-time').textContent=`${s.toFixed(0)} 秒`;if(s>=30)recStop(false);},250)};
    recorder.start(250);$('rec-on').hidden=false;$('rec-btn').textContent='■ 停止';$('rec-btn').classList.add('on');document.body.dataset.recording='true';$('rec-status').textContent='';
  }catch(error){$('rec-status').textContent=`麥克風無法啟動：${error.message}`;}
};
$('rec-send').onclick=async()=>{
  if(!recWav||!recConsentOk())return;$('rec-send').disabled=true;$('rec-status').textContent='Mac 正在做聲音…';
  let binary='';for(let i=0;i<recWav.length;i+=32768)binary+=String.fromCharCode(...recWav.subarray(i,i+32768));
  try{
    const r=await post('/api/voices/record',{audio:btoa(binary),engine:$('rec-engine').value,name:$('rec-name').value,transcript:$('rec-prompt').textContent,lang:recInfo?.lang,consent:{person:$('rec-person').value.trim(),agreed:$('rec-agreed').checked},bind:$('rec-bind').checked});
    if(!r.ok){$('rec-status').textContent=`錄音品質：${r.quality.issues.filter(i=>i.level==='error').map(i=>i.message).join(' ')} 請再錄一次。`;$('rec-send').disabled=false;return;}
    recWav=null;$('rec-play').hidden=true;$('rec-status').textContent=`已做好「${r.profile.name}」${r.bound?`，${r.bound.name} 現在用這個聲音說話`:''}。原始錄音沒有留在 Mac 上，只留下參考片段。`;
    document.body.dataset.recSaved=r.profile.id;loadVoices();
  }catch(error){$('rec-status').textContent=error.message;$('rec-send').disabled=false;}
};
for(const button of document.querySelectorAll('#tabs button'))button.onclick=()=>{
  for(const b of document.querySelectorAll('#tabs button'))b.classList.toggle('on',b===button);
  for(const tab of document.querySelectorAll('.tab'))tab.hidden=tab.id!==`tab-${button.dataset.tab}`;
  if(button.dataset.tab==='files')loadFiles();
  if(button.dataset.tab==='characters')loadCharacters();
  if(button.dataset.tab==='store'&&!$('lib-results').children.length)searchStore();
  if(button.dataset.tab==='settings')loadVoices();
};

async function start(){
  $('pair').hidden=true;$('app').hidden=false;
  Avatars.setAssetLoader(async url=>{const [,mod,file]=url.match(/^mods\/([^/]+)\/([^/]+)$/);return api(`/api/mod-asset?mod=${encodeURIComponent(decodeURIComponent(mod))}&file=${encodeURIComponent(decodeURIComponent(file))}`);});
  const data=await api('/api/state');render(data.state);fillSettings(await api('/api/settings'));loadDev().catch(()=>{});
  for(const m of data.history)line(m.content,m.role);if(!data.history.length)line(`嗨，我是 ${data.state.mod.name}！在手機上也可以找我聊天。`);
  listen();
}
$('pair-form').onsubmit=async event=>{event.preventDefault();await pair($('pair-code').value.trim());};
async function pair(code){
  try{const name=/iPhone/.test(navigator.userAgent)?'iPhone':/iPad/.test(navigator.userAgent)?'iPad':/Android/.test(navigator.userAgent)?'Android':'手機';
    const data=await post('/api/pair',{code,name});token=data.token;try{localStorage.setItem(KEY,token);}catch{}
    history.replaceState(null,'','/remote/');await start();}
  catch(error){showPair(error.message);}
}
$('voice').onclick=()=>{speakReplies=!speakReplies;if(!speakReplies)stopSaying();else{sayEl.src='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';sayEl.play().catch(()=>{});}$('voice').textContent=speakReplies?'🔊':'🔇';$('voice').setAttribute('aria-pressed',String(speakReplies));if(speakReplies)say('好，我會念出來。');};
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
const code=new URLSearchParams(location.search).get('pair');
if(code&&!token)pair(code);else if(token)start().catch(error=>showPair(error.message));else showPair();

// stop the Mac reading a reply aloud
$('stop-speech').onclick=()=>post('/api/stop-speech',{}).catch(e=>alert(e.message));

// --- 開發夥伴: the Mac's companion attached to a Claude Code / Codex session. The phone can pick a session, talk to it,
// answer its approval requests and stop or leave it (picking, talking and answering need 「允許手機下達電腦任務」).
const DEV_ENGINE={claude:'Claude',codex:'Codex'};let devState=null;
async function loadDev(){devState=await api('/api/dev/state');renderDev();}
function devStatus(text){const a=devState?.attached;if(a)$('dev-label').textContent=`已接入：${a.project} · ${DEV_ENGINE[a.engine]}${text?` — ${text}`:''}`;}
function renderDev(){
  const a=devState?.attached;$('dev-bar').hidden=!a;$('dev-pick-row').hidden=Boolean(a)||!remoteSettings?.remoteTasks;if(a)$('dev-list').hidden=true;
  if(a)$('dev-label').textContent=`已接入：${a.project} · ${DEV_ENGINE[a.engine]}`;
  $('text').placeholder=a?`跟 ${a.project} 的工作階段說…`:'跟我說點什麼…';
}
$('dev-pick').onclick=async()=>{
  if(!$('dev-list').hidden){$('dev-list').hidden=true;return;}
  $('dev-list').hidden=false;$('dev-list').textContent='正在找最近的工作階段…';
  try{const list=await api('/api/dev/sessions');
    $('dev-list').replaceChildren(...(list.length?list.map(s=>{const b=document.createElement('button');b.type='button';b.dataset.id=s.id;
      const head=document.createElement('b');head.textContent=`${s.engine==='claude'?'✳️':'◎'} ${s.project} · ${DEV_ENGINE[s.engine]}`;
      const title=document.createElement('small');title.textContent=s.title||'（沒有標題）';const when=document.createElement('small');when.textContent=new Date(s.updatedAt).toLocaleString();b.append(head,title,when);
      if(s.maybeOpen){const warn=document.createElement('small');warn.className='warn';warn.textContent='⚠ 可能還在終端機開著：先關掉那個終端機，避免對話分岔';b.append(warn);}
      b.onclick=async()=>{$('dev-list').hidden=true;try{devState=await post('/api/dev/attach',{engine:s.engine,id:s.id});renderDev();}catch(error){line(error.message,'note');}};return b;})
      :[Object.assign(document.createElement('p'),{className:'hint',textContent:'找不到 Claude Code 或 Codex 的工作階段。'})]));}
  catch(error){$('dev-list').textContent=error.message;}
};
$('dev-stop').onclick=()=>post('/api/dev/interrupt',{}).catch(error=>line(error.message,'note'));
$('dev-leave').onclick=()=>post('/api/dev/leave',{}).then(state=>{devState=state;renderDev();}).catch(error=>line(error.message,'note'));
function devCard(a){
  const el=line('','approval');el.dataset.request=a.requestId;el.replaceChildren();
  const title=document.createElement('b');title.textContent=`🔐 ${a.question}`;el.append(title);
  const detail=[a.command?`$ ${a.command}`:null,a.diff||null,!a.command&&!a.diff?(a.detail||(a.files||[]).join('\n')||null):null].filter(Boolean).join('\n');
  if(detail){const pre=document.createElement('pre');pre.textContent=detail;el.append(pre);}
  const row=document.createElement('div');row.className='actions';
  for(const [label,allow,cls] of [['允許',true,'allow'],['拒絕',false,'deny']]){const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;
    b.onclick=()=>{for(const x of row.children)x.disabled=true;post('/api/dev/answer',{requestId:a.requestId,allow}).then(r=>{if(!r.ok){line(r.error,'note');for(const x of row.children)x.disabled=false;}}).catch(error=>{line(error.message,'note');for(const x of row.children)x.disabled=false;});};row.append(b);}
  el.append(row);return el;
}
function onDev(event){
  if(event.state){devState=event.state;renderDev();}
  if(event.type==='attached')line(`已接入「${event.state.attached.project}」的 ${DEV_ENGINE[event.state.attached.engine]} 工作階段。`,'note');
  if(event.type==='left')line(`已離開開發工作階段。${event.resumeCommand?`之後可以在終端機用 ${event.resumeCommand} 接著做。`:''}`,'note');
  // a line typed on the Mac or another phone (the server does not send a phone its own line back)
  if(event.type==='user')line(event.source==='phone'?`📱 ${event.text}`:event.text,'user');
  if(event.type==='tool')devStatus(event.label);
  if(event.type==='approval'){devStatus('等你決定：允許或拒絕');devCard(event.approval);say(event.approval.question);}
  if(event.type==='resolved'){const card=document.querySelector(`.msg.approval[data-request="${CSS.escape(event.requestId)}"]`);if(card){card.querySelector('.actions')?.remove();const r=document.createElement('small');r.textContent=event.result==='allowed'?'✓ 已允許':event.result==='denied'?'✕ 已拒絕':'（這個請求已經不需要了）';card.append(r);card.dataset.result=event.result;}}
  if(event.type==='reply'){line(event.text);say(event.spoken||event.text);}
  if(event.type==='turn'){devStatus('');if(event.status==='failed')line(`這一輪沒有完成${event.error?`：${event.error}`:''}`,'note');if(event.status==='interrupted')line('已停下來。','note');}
  if(event.type==='error')line(`開發夥伴：${event.message}`,'note');
}
