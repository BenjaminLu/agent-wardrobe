const $=id=>document.getElementById(id);
const token=location.hash.slice(1)||sessionStorage.getItem('wardrobe-token')||localStorage.getItem('wardrobe-token');
if(token)localStorage.setItem('wardrobe-token',token);
if(location.hash){sessionStorage.setItem('wardrobe-token',token);history.replaceState(null,'',location.pathname);}
let catalog=[],current,choices={},events,mutationQueue=Promise.resolve(),connected=false,connectionKey='wardrobe.connecting';
const cardViews=new Map();
// before the dictionary has arrived (the desktop app is not reachable) the one message that matters is shown in English
const say=(key,vars,fallback)=>{const text=t(key,vars);return text===key&&fallback?fallback:text;};
const offlineError=()=>new Error(say('wardrobe.disconnected',null,'Desktop app is disconnected. Open Agent Wardrobe; this page will reconnect automatically.'));
async function api(route,data){let res;try{res=await fetch(route,{method:data?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(5000)});}catch{throw offlineError();}const result=await res.json();if(!res.ok)throw new Error(result.error);return result;}
function report(error){$('error').textContent=error.message;}
function mutate(route,data){
  if(!connected){report(new Error(t('wardrobe.offline')));return Promise.resolve();}
  mutationQueue=mutationQueue.then(async()=>{accept(await api(route,data));$('error').textContent='';}).catch(error=>{report(error);if(current)$('engine').value=current.provider;});
  return mutationQueue;
}
// the interface language comes from the desktop app (its uiLanguage setting); it is fetched again when the app announces a change
async function loadLanguage(){const {lang,dict}=await api('/api/i18n');i18n.set(lang,dict);}
function localized(){
  $('connection').textContent=t(connectionKey);
  $('count').textContent=t('wardrobe.count',{mods:catalog.length,skins:catalog.reduce((n,m)=>n+m.skins.length,0)});
  if(current)renderCards();
}
i18n.onChange(localized);
function renderCards(){
  for(const mod of catalog){
    const selected=current.modId===mod.id;
    const skin=mod.skins.find(s=>s.id===(selected?current.skinId:choices[mod.id]))||mod.skins[0];choices[mod.id]=skin.id;
    let view=cardViews.get(mod.id);
    if(!view){
    const card=document.createElement('article');card.className='card';card.dataset.modId=mod.id;card.tabIndex=0;
    const applyMod=()=>mutate('/api/select',{modId:mod.id,skinId:choices[mod.id]});
    card.onclick=applyMod;card.onkeydown=event=>{if(event.target===card&&['Enter',' '].includes(event.key)){event.preventDefault();applyMod();}};
    const preview=document.createElement('div');preview.className='mini-avatar';card.append(preview);
    const name=document.createElement('h3');name.textContent=mod.name;card.append(name);
    const desc=document.createElement('p');desc.textContent=mod.description;card.append(desc);
    const swatches=document.createElement('div');swatches.className='skin-options';
    for(const option of mod.skins){const button=document.createElement('button');button.className='swatch';button.dataset.skinId=option.id;if(option.palette)button.style.backgroundColor=option.palette.body;else if(option.image)button.style.backgroundImage=`url(mods/${encodeURIComponent(mod.id)}/${encodeURIComponent(option.image)})`;else button.classList.add('swatch-3d');button.title=option.name;button.setAttribute('aria-label',`${mod.name} ${option.name}`);button.onclick=event=>{event.stopPropagation();choices[mod.id]=option.id;mutate('/api/select',{modId:mod.id,skinId:option.id});};swatches.append(button);}card.append(swatches);
    const apply=document.createElement('button');apply.className='apply';apply.translate=true;apply.onclick=event=>{event.stopPropagation();applyMod();};card.append(apply);$('cards').append(card);
    view={card,preview,apply,swatches,skinId:null};cardViews.set(mod.id,view);
    }
    view.card.setAttribute('aria-label',t('wardrobe.applyLabel',{name:mod.name}));
    view.card.classList.toggle('selected',selected);
    if(view.skinId!==skin.id){Avatars.mount(view.preview,mod,skin,`preview-${mod.id}`);view.skinId=skin.id;}
    view.apply.textContent=selected?t('wardrobe.active'):t('wardrobe.applySkin',{skin:skin.name});
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
$('claude-connect').onclick=async()=>{try{const result=await api('/api/claude-connect',{});if(result.connected){connectionKey='wardrobe.claudeConnected';$('connection').textContent=t(connectionKey);}}catch(e){report(e);}};
function connection(on){connected=on;connectionKey=on?'wardrobe.connected':'wardrobe.offline';$('connection').textContent=t(connectionKey);$('connection').classList.toggle('offline',!on);document.body.classList.toggle('disconnected',!on);if(on)$('error').textContent='';}
async function init(){
  await loadLanguage();
  const data=await api('/api/catalog');catalog=data.catalog;localized();connection(true);accept(data.state);
  events=new EventSource(`/api/events?token=${token}`);events.onopen=()=>connection(true);events.onmessage=event=>accept(JSON.parse(event.data));events.onerror=()=>connection(false);
  events.addEventListener('i18n',()=>loadLanguage().catch(report));
}
init().catch(report);
