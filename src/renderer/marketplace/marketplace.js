const $=id=>document.getElementById(id);
const bridge=window.marketplace;Avatars.setAssetLoader(async url=>{const [,modId,file]=url.match(/^mods\/([^/]+)\/([^/]+)$/);const data=await bridge.modAsset(decodeURIComponent(modId),decodeURIComponent(file));return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);});
Avatars.setLive2dCore({url:()=>bridge.live2dCore(),install:()=>bridge.installLive2dCore()});
let catalog=[],current,queue=Promise.resolve();
const views=new Map();
const aliases={miso:'cat 貓 猫 小貓 小猫',byte:'robot 機器人 机器人',annie:'annie girl 女生 女孩 Q版 安妮','vrm-sample':'blocky 方塊 方块 3d vrm'};
const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase();
function report(error){$('error').textContent=error.message;$('error').hidden=false;}
function select(value){queue=queue.then(async()=>{try{accept(await window.marketplace.select(value));$('error').hidden=true;}catch(error){report(error);if(current)$('personality').value=current.personaId;}});return queue;}
function filter(){
  const words=normalize($('search').value).trim().split(/\s+/).filter(Boolean);let found=0;
  for(const mod of catalog){const view=views.get(mod.id);const match=words.every(word=>view.searchText.includes(word));view.card.hidden=!match;if(match)found++;}
  $('count').textContent=t('marketplace.count',{found,total:catalog.length,count:catalog.length});$('empty').hidden=found>0;
}
function build(){
  // your own characters (drawn from photos) come first
  for(const mod of [...catalog].sort((a,b)=>Number(Boolean(b.private))-Number(Boolean(a.private)))){
    const card=document.createElement('article');card.className='mod-card';card.dataset.modId=mod.id;
    const preview=document.createElement('div');preview.className='preview';card.append(preview);
    const name=document.createElement('h3');const title=document.createElement('span');title.translate=false;title.textContent=mod.name;name.append(title);card.append(name);
    const desc=document.createElement('p');desc.className='description';desc.translate=false;desc.textContent=mod.description;card.append(desc);
    const skins=document.createElement('div');skins.className='skins';card.append(skins);
    const view={card,preview,skinId:mod.defaultSkin,renderedSkin:null,skins,searchText:normalize([mod.id,mod.name,mod.description,mod.author,mod.model,aliases[mod.id]||'',...mod.skins.map(s=>s.name+' '+s.id),...mod.personas.map(p=>p.name+' '+p.id)].join(' '))};
    for(const skin of mod.skins){const button=document.createElement('button');button.className='skin';button.dataset.skinId=skin.id;button.setAttribute('aria-label',mod.name+' '+skin.name);const dot=document.createElement('span');dot.className='skin-dot';if(skin.palette)dot.style.backgroundColor=skin.palette.body;else if(skin.image)dot.style.backgroundImage=`url(mods/${encodeURIComponent(mod.id)}/${encodeURIComponent(skin.image)})`;else dot.classList.add('skin-dot-3d');const label=document.createElement('span');label.translate=false;label.textContent=skin.name;button.append(dot,label);button.onclick=()=>{view.skinId=skin.id;select({modId:mod.id,skinId:skin.id});};skins.append(button);}
    const apply=document.createElement('button');apply.className='apply';apply.onclick=()=>select({modId:mod.id,skinId:view.skinId});card.append(apply);view.apply=apply;
    // characters drawn from photos are private and can be revised with Codex
    if(mod.private){card.classList.add('private');const badge=document.createElement('span');badge.className='badge';name.append(' ',badge);view.badge=badge;}
    // every character can be edited with Codex: your own in place, the others as your own copy of the skin shown
    const edit=document.createElement('button');edit.className='edit-person';view.edit=edit;view.private=Boolean(mod.private);
    edit.onclick=()=>window.marketplace.editPerson(mod.id,view.skinId).catch(report);card.append(edit);
    views.set(mod.id,view);$('cards').append(card);
  }
  labelCards();
}
// the card labels this page writes (names, descriptions and skins come from the Mods as they are)
function labelCards(){for(const view of views.values()){if(view.badge)view.badge.textContent=t('marketplace.card.private');view.edit.textContent=t(view.private?'marketplace.card.editDesign':'marketplace.card.makeMine');if(view.selected!==undefined)view.apply.textContent=t(view.selected?'marketplace.card.active':'marketplace.card.apply');}}
// 3D / Live2D previews each hold a WebGL context, and Chromium only keeps a handful alive (with many 3D characters, or on a
// small GPU, older ones are lost). So they are drawn only while their card is on screen and released when it scrolls away.
const live=new Map();
const onScreen=new IntersectionObserver(entries=>{for(const entry of entries){const view=[...views.values()].find(v=>v.preview===entry.target);if(!view?.pending)continue;
  const {mod,skin}=view.pending;if(entry.isIntersecting){if(!live.has(view)){Avatars.mount(view.preview,mod,skin,`market-${mod.id}`);live.set(view,skin.id);}}
  else if(live.has(view)){Avatars.unmount(view.preview);live.delete(view);view.preview.dataset.waiting='3D';}}},{rootMargin:'200px'});
function showPreview(view,mod,skin){
  if(!Avatars.MODELS.includes(mod.renderer)){Avatars.mount(view.preview,mod,skin,`market-${mod.id}`);return;}
  view.pending={mod,skin};if(live.has(view)){Avatars.mount(view.preview,mod,skin,`market-${mod.id}`);live.set(view,skin.id);}else onScreen.observe(view.preview);
}
function accept(state){
  if(current&&current.instanceId===state.instanceId&&state.revision<current.revision)return;
  const modChanged=!current||current.modId!==state.modId;current=state;
  $('active-name').textContent=`${state.mod.name} · ${state.skin.name}`;
  if(modChanged)$('personality').replaceChildren(...state.mod.personas.map(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.name;return option;}));$('personality').value=state.personaId;
  for(const mod of catalog){const view=views.get(mod.id);const selected=state.modId===mod.id;if(selected)view.skinId=state.skinId;view.card.classList.toggle('selected',selected);const skin=mod.skins.find(s=>s.id===view.skinId)||mod.skins[0];
    if(view.renderedSkin!==skin.id){view.renderedSkin=skin.id;showPreview(view,mod,skin);}
    view.selected=selected;view.apply.textContent=t(selected?'marketplace.card.active':'marketplace.card.apply');
    for(const button of view.skins.children)button.setAttribute('aria-pressed',String(button.dataset.skinId===skin.id));
  }
}
$('search').oninput=filter;
$('clear').onclick=()=>{$('search').value='';filter();$('search').focus();};
$('personality').onchange=()=>select({modId:current.modId,personaId:$('personality').value});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();focusSearch();}if(event.key==='Escape')window.marketplace.close();});
window.marketplace.onState(state=>{if(catalog.length)accept(state);});
// a character was drawn, edited or deleted: rebuild the cards
window.marketplace.onRefresh(async()=>{const data=await window.marketplace.data();catalog=data.catalog;for(const view of live.keys())Avatars.unmount(view.preview);live.clear();onScreen.disconnect();views.clear();$('cards').replaceChildren();build();current=null;accept(data.state);filter();});
$('new-person').onclick=()=>window.marketplace.newPerson().catch(report);
const focusSearch=()=>{const box=$('library').hidden?$('search'):$('library-query');box.focus();box.select();};
window.marketplace.onFocusSearch(focusSearch);
async function init(){const data=await window.marketplace.data();catalog=data.catalog;
  build();accept(data.state);filter();$('search').focus();
  let page='installed';try{page=localStorage.getItem('market-page')||page;}catch{}
  showPage(page==='store'?'store':'installed');
}
// two pages: the characters on this Mac, and the avatar store (loaded the first time it is opened)
let storeLoaded=false;
function showPage(name){
  for(const tab of document.querySelectorAll('#pages button'))tab.setAttribute('aria-selected',String(tab.dataset.page===name));
  $('page-installed').hidden=name!=='installed';$('library').hidden=name!=='store';
  try{localStorage.setItem('market-page',name);}catch{}
  if(name==='store'&&!storeLoaded){storeLoaded=true;showAccounts();searchLibrary();$('library-query').focus();}
  if(name==='installed')$('search').focus();
}
for(const tab of document.querySelectorAll('#pages button'))tab.onclick=()=>showPage(tab.dataset.page);
init().catch(report);

// --- Avatar store: anime, game and VTuber characters from several libraries, each with its terms.
// 3D ones are added as they are; pictures are redrawn by Codex; official characters come through the assisted download.
let accounts={vroid:{},sketchfab:{}};
async function searchLibrary(event){
  event?.preventDefault();const query=$('library-query').value.trim();
  const sources=[...document.querySelectorAll('#library-form input[name=source]:checked')].map(i=>i.value);
  $('library-status').textContent=t(query?'marketplace.store.searching':'marketplace.store.loadingFeatured');$('library-results').replaceChildren();
  try{const {items,needs}=await window.marketplace.librarySearch(query,sources);
    if(needs.includes('VROID_LOGIN'))showAccounts(true);
    $('library-status').textContent=items.length?t(query?'marketplace.store.found':'marketplace.store.featuredCount',{count:items.length})+(needs.includes('VROID_LOGIN')?t('marketplace.store.moreWithVroid'):''):t('marketplace.store.nothing');
    $('library-results').replaceChildren(...items.map(libraryCard));}
  catch(error){$('library-status').textContent=clean(error);}
}
const clean=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
function libraryCard(item){
  const card=document.createElement('article');card.className=`lib-card tier-${item.license.tier}`;const thumb=document.createElement('div');thumb.className='thumb';
  const none=()=>{thumb.classList.add('none');thumb.textContent=item.kind==='assisted'?'🌐':t(item.previewAfterDownload?'marketplace.store.previewAfterDownload':'marketplace.store.noPreview');};
  if(item.kind==='assisted'||item.previewAfterDownload)none();else window.marketplace.libraryThumb(item.key).then(url=>{if(url)thumb.style.backgroundImage=`url("${url}")`;else none();}).catch(none);
  const title=document.createElement('h4');title.translate=false;const link=document.createElement('a');link.href='#';link.textContent=item.title;link.title=item.page||'';link.onclick=e=>{e.preventDefault();if(item.page)window.marketplace.openPage(item.page);};title.append(link);
  const meta=document.createElement('div');meta.className='meta';
  const lic=document.createElement('span');lic.className='lic';lic.textContent=item.license.label;
  const kind={vrm:'3D VRM',glb:'3D',image:'2D',assisted:t('marketplace.store.kindOfficial')}[item.kind];
  meta.append(lic,` ${kind} · ${item.source}${item.author?` · ${item.author}`:''}`);
  const note=document.createElement('div');note.className='meta note';
  note.textContent=t(`marketplace.tier.${['open','rules','personal'].includes(item.license.tier)?item.license.tier:'rules'}`)+(item.license.credit?t('marketplace.tier.credit'):'');
  const action=document.createElement('button');
  action.textContent=t(item.kind==='image'?'marketplace.action.draw':item.kind==='assisted'?'marketplace.action.assisted':'marketplace.action.add');
  action.onclick=async()=>{
    // official characters: their page opens in the app's assisted download window, where the AI reads the terms
    if(item.kind==='assisted'){window.marketplace.assistOpen({site:item.site,page:item.page}).catch(error=>{$('library-status').textContent=clean(error);});return;}
    action.disabled=true;action.textContent=t(item.kind==='image'?'marketplace.action.preparing':'marketplace.action.downloading');
    try{const result=await window.marketplace.libraryImport(item.key);action.textContent=t(result.opened==='worn'?'marketplace.action.worn':'marketplace.action.editorOpened');}
    catch(error){action.disabled=false;action.textContent=t('marketplace.action.retry');const message=clean(error);$('library-status').textContent=message;
      // the store's own errors arrive in the interface language, so they are recognised by their translated text
      if(message.includes(t('library.error.sketchfabToken')))tokenPrompt(card,action);if(message.includes(t('library.error.vroidNotConnected'))||message.includes(t('library.error.vroidExpired')))showAccounts(true);}};
  card.append(thumb,title,meta,note,action);return card;
}
// Sketchfab downloads need the user's own API token: asked for right on the card, then the download is retried.
function tokenPrompt(card,action){
  if(card.querySelector('.token'))return;$('library-status').textContent='';
  const box=document.createElement('div');box.className='token';
  const text=document.createElement('p');const link=document.createElement('a');link.href='#';link.textContent=t('marketplace.token.copyLink');
  link.onclick=e=>{e.preventDefault();window.marketplace.openPage('https://sketchfab.com/settings/password');};
  text.append(t('marketplace.token.before'),link,t('marketplace.token.after'));
  const input=document.createElement('input');input.type='password';input.placeholder='API token';input.autocomplete='off';input.spellcheck=false;
  const save=document.createElement('button');save.type='button';save.textContent=t('marketplace.token.save');
  save.onclick=async()=>{save.disabled=true;try{await window.marketplace.sketchfabToken(input.value.trim());input.value='';box.remove();showAccounts();action.click();}catch(error){text.textContent=clean(error);save.disabled=false;}};
  box.append(text,input,save);card.insertBefore(box,action);input.focus();
}
// VRoid Hub and Sketchfab sign-ins. The keys go straight to the app's encrypted store; this window never reads them back.
let accountsView={open:false,focus:null};
// a translated sentence with an element in the place of its {name} placeholder
const around=(key,name,el)=>{const [before,...rest]=t(key).split(`{${name}}`);return [before,el,rest.join(`{${name}}`)].filter(part=>part!=='');};
async function showAccounts(open=false,focus=null){
  accountsView={open,focus};
  accounts=await window.marketplace.accounts().catch(()=>accounts);const box=$('accounts');box.replaceChildren();
  const row=(cls,...children)=>{const el=document.createElement('div');el.className=cls;el.append(...children);return el;};
  const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(error){$('library-status').textContent=clean(error);}finally{b.disabled=false;}};return b;};
  const input=(placeholder,secret)=>{const i=document.createElement('input');i.placeholder=placeholder;if(secret)i.type='password';i.autocomplete='off';i.spellcheck=false;return i;};
  const pageLink=(text,url)=>{const a=document.createElement('a');a.href='#';a.textContent=text;a.onclick=e=>{e.preventDefault();window.marketplace.openPage(url);};return a;};
  const signIn=()=>{$('library-status').textContent=t('marketplace.account.signInWindow');};
  // VRoid Hub
  const v=accounts.vroid||{};
  if(v.connected)box.append(row('account ok',t('marketplace.account.vroidConnected'),button(t('marketplace.account.disconnect'),async()=>{await window.marketplace.vroidDisconnect();showAccounts();})));
  else if(v.configured)box.append(row('account',t('marketplace.account.vroidSearch'),button(t('marketplace.account.connectVroid'),async()=>{signIn();await window.marketplace.vroidConnect();await showAccounts();searchLibrary();}),
    button(t('marketplace.account.resetApp'),async()=>{await window.marketplace.vroidConfigure({});})));
  else if(open||focus==='vroid'){
    const id=input('Application ID'),secret=input('Secret',true);const redirect=document.createElement('code');redirect.textContent='agentwardrobe://vroid-callback';
    const steps=document.createElement('ol');
    const step=(...parts)=>{const li=document.createElement('li');li.append(...parts);steps.append(li);};
    step(...around('marketplace.account.stepOpen','link',pageLink(t('marketplace.account.devAppsLink'),'https://hub.vroid.com/oauth/applications')));
    step(...around('marketplace.account.stepRedirect','uri',redirect));
    step(t('marketplace.account.stepPaste'));
    box.append(row('account setup',t('marketplace.account.vroidSetupTitle'),steps,row('fields',id,secret,button(t('marketplace.account.saveConnect'),async()=>{await window.marketplace.vroidConfigure({clientId:id.value,clientSecret:secret.value});id.value=secret.value='';await showAccounts();signIn();await window.marketplace.vroidConnect();await showAccounts();searchLibrary();}))));
  }else box.append(row('account',t('marketplace.account.vroidMost'),button(t('marketplace.account.setupVroid'),()=>showAccounts(true))));
  // Sketchfab (only needed for downloads)
  const sf=accounts.sketchfab||{};
  if(sf.configured)box.append(row('account ok',t('marketplace.account.sketchfabReady'),button(t('marketplace.account.removeToken'),async()=>{await window.marketplace.sketchfabToken('');showAccounts();})));
  else if(focus==='sketchfab'){const token=input('Sketchfab API token',true);
    box.append(row('account setup',...around('marketplace.account.sketchfabNeeds','link',pageLink(t('marketplace.account.copyHere'),'https://sketchfab.com/settings/password')),row('fields',token,button(t('marketplace.account.save'),async()=>{await window.marketplace.sketchfabToken(token.value);token.value='';await showAccounts();$('library-status').textContent=t('marketplace.account.savedTryAgain');}))));}
}
$('library-form').onsubmit=searchLibrary;
// "Find on Booth / nizima / Aplaybox …": the assisted download window searches that site for the current query.
// Site names are brand names; the ones written in Chinese or Japanese have a name per language.
const ASSIST_SITES=[['booth','Booth'],['nizima','nizima'],['aplaybox'],['nico3d'],['bowlroll','BowlRoll'],['gumroad','Gumroad'],['vroid','VRoid Hub'],['picrew','Picrew'],['zunko'],['unitychan','Unity-chan'],['live2d']];
const assistButtons=ASSIST_SITES.map(([site,name])=>{const b=document.createElement('button');b.type='button';b.dataset.site=site;
  b.label=()=>t('marketplace.store.findOn',{site:name||t(`marketplace.site.${site}`)});b.textContent=b.label();
  b.onclick=()=>window.marketplace.assistOpen({site,query:$('library-query').value.trim()}).catch(error=>{$('library-status').textContent=clean(error);});$('assist-row').append(b);return b;});

// the interface language changed: the static text is re-applied by i18n.js; re-label what this script wrote
i18n.onChange(()=>{
  for(const b of assistButtons)b.textContent=b.label();
  if(catalog.length){labelCards();filter();}
  // results carry their terms in the language they were listed in, so the store is searched again
  if(storeLoaded){showAccounts(accountsView.open,accountsView.focus);searchLibrary();}
});
