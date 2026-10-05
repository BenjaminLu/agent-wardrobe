const $=id=>document.getElementById(id);
const token=location.hash.slice(1)||sessionStorage.getItem('wardrobe-token')||localStorage.getItem('wardrobe-token');
if(token)localStorage.setItem('wardrobe-token',token);
if(location.hash){sessionStorage.setItem('wardrobe-token',token);history.replaceState(null,'',location.pathname);}
let catalog=[],current,choices={},language='en',events,mutationQueue=Promise.resolve(),connected=false;
const cardViews=new Map();
const strings={en:{connected:'● Desktop connected',offline:'○ Desktop disconnected',apply:'Apply Mod',active:'On your desktop',brain:'AI engine',personality:'Personality'},zh:{connected:'● 桌面已連線',offline:'○ 桌面已離線',apply:'套用 Mod',active:'桌面使用中',brain:'AI 引擎',personality:'個性'}};
let t=strings.en;
async function api(route,data){let res;try{res=await fetch(route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(5000)});}catch{throw new Error(language.startsWith('zh')?'桌面 App 未連線。請開啟 Agent Wardrobe，控制台會自動重新連線。':'Desktop app is disconnected. Open Agent Wardrobe; this page will reconnect automatically.');}const result=await res.json();if(!res.ok)throw new Error(result.error);return result;}
function report(error){$('error').textContent=error.message;}
function mutate(route,data){
  if(!connected){report(new Error(t.offline));return Promise.resolve();}
  mutationQueue=mutationQueue.then(async()=>{accept(await api(route,data));$('error').textContent='';}).catch(error=>{report(error);if(current)$('engine').value=current.provider;});
  return mutationQueue;
}
function localized(){
  t=language.startsWith('zh')?strings.zh:strings.en;document.documentElement.lang=language;
  $('engine-label').textContent=t.brain;$('persona-label').textContent=t.personality;
  if(language.startsWith('zh')){
    $('eyebrow').textContent='你的 AI，你選角色';$('headline').textContent='讓你的 Agent，活起來。';$('lede').textContent='同一個夥伴，不同 AI 大腦。隨時換角色、外觀與個性。';$('engine-note').textContent='切換下一次對話的引擎，各引擎保留獨立聊天紀錄。';$('library-title').textContent='人物與 Skin 收藏';$('live-label').textContent='桌面即時同步';$('sync-note').textContent='套用立即同步桌面。控制台開啟時人物會讓滑鼠穿透；按 ⌘⇧B 恢復聊天操作。';$('notice-text').textContent='內建預覽庫，沒有購買或下載。內建角色都是本專案的原創人物。';$('footer-note').textContent='換 Agent，不換夥伴。';
  }else{
    $('sync-note').textContent='Changes sync instantly. Desktop clicks pass through while controlling your character. Press ⌘⇧B to restore chat controls.';
  }
}
function renderCards(){
  for(const mod of catalog){
    const selected=current.modId===mod.id;
    const skin=mod.skins.find(s=>s.id===(selected?current.skinId:choices[mod.id]))||mod.skins[0];choices[mod.id]=skin.id;
    let view=cardViews.get(mod.id);
    if(!view){
    const card=document.createElement('article');card.className='card';card.dataset.modId=mod.id;card.tabIndex=0;card.setAttribute('aria-label',`${t.apply}: ${mod.name}`);
    const applyMod=()=>mutate('/api/select',{modId:mod.id,skinId:choices[mod.id]});
    card.onclick=applyMod;card.onkeydown=event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();applyMod();}};
    const preview=document.createElement('div');preview.className='mini-avatar';card.append(preview);
    const name=document.createElement('h3');name.textContent=mod.name;card.append(name);
    const desc=document.createElement('p');desc.textContent=mod.description;card.append(desc);
    const swatches=document.createElement('div');swatches.className='skin-options';
    for(const option of mod.skins){const button=document.createElement('button');button.className='swatch';button.dataset.skinId=option.id;if(option.palette)button.style.backgroundColor=option.palette.body;else if(option.image)button.style.backgroundImage=`url(mods/${encodeURIComponent(mod.id)}/${encodeURIComponent(option.image)})`;else button.classList.add('swatch-3d');button.title=option.name;button.setAttribute('aria-label',`${mod.name} ${option.name}`);button.onclick=event=>{event.stopPropagation();choices[mod.id]=option.id;mutate('/api/select',{modId:mod.id,skinId:option.id});};swatches.append(button);}card.append(swatches);
    const apply=document.createElement('button');apply.className='apply';apply.onclick=event=>{event.stopPropagation();applyMod();};card.append(apply);$('cards').append(card);
    view={card,preview,apply,swatches,skinId:null};cardViews.set(mod.id,view);
    }
    view.card.classList.toggle('selected',selected);
    if(view.skinId!==skin.id){Avatars.mount(view.preview,mod,skin,`preview-${mod.id}`);view.skinId=skin.id;}
    view.apply.textContent=selected?t.active:`${t.apply} · ${skin.name}`;
    for(const button of view.swatches.children){const active=button.dataset.skinId===skin.id;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  }
}
function accept(state){
  if(current&&state.instanceId===current.instanceId&&state.revision<=current.revision)return;
  const change=!current||current.modId!==state.modId||current.skinId!==state.skinId;
  const modChanged=!current||current.modId!==state.modId;
  current=state;$('engine').value=state.provider;$('active-name').textContent=state.mod.name;$('active-skin').textContent=`${state.skin.name} · ${state.persona.name}`;$('activity').textContent=state.displayState;
  if(change)Avatars.mount($('hero-avatar'),state.mod,state.skin,'hero');
  Avatars.update($('hero'),state);
  if(modChanged)$('persona').replaceChildren(...state.mod.personas.map(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.name;return option;}));$('persona').value=state.personaId;
  $('engine').disabled=['working','waiting_for_approval'].includes(state.activity);
  $('claude-connect').hidden=state.provider!=='claude';
  renderCards();
}
$('engine').onchange=()=>mutate('/api/provider',{provider:$('engine').value});
$('persona').onchange=()=>mutate('/api/select',{personaId:$('persona').value});
$('claude-connect').onclick=async()=>{try{const result=await api('/api/claude-connect',{});if(result.connected)$('connection').textContent='Claude hooks installed · Restart Claude in the selected project';}catch(e){report(e);}};
function connection(on){connected=on;$('connection').textContent=on?t.connected:t.offline;$('connection').classList.toggle('offline',!on);document.body.classList.toggle('disconnected',!on);if(on)$('error').textContent='';}
async function init(){const data=await api('/api/catalog');catalog=data.catalog;language=data.language;localized();$('count').textContent=`${catalog.length} Mods · ${catalog.reduce((n,m)=>n+m.skins.length,0)} Skins`;connection(true);accept(data.state);events=new EventSource(`/api/events?token=${token}`);events.onopen=()=>connection(true);events.onmessage=event=>accept(JSON.parse(event.data));events.onerror=()=>connection(false);}
init().catch(report);
