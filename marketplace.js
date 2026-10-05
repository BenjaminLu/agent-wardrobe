const $=id=>document.getElementById(id);
const bridge=window.marketplace;Avatars.setAssetLoader(async url=>{const [,modId,file]=url.match(/^mods\/([^/]+)\/([^/]+)$/);const data=await bridge.modAsset(decodeURIComponent(modId),decodeURIComponent(file));return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);});
Avatars.setLive2dCore({url:()=>bridge.live2dCore(),install:()=>bridge.installLive2dCore()});
let catalog=[],current,queue=Promise.resolve(),zh=false;
const views=new Map();
const aliases={miso:'cat 貓 猫 小貓 小猫',byte:'robot 機器人 机器人',annie:'annie girl 女生 女孩 Q版 安妮','vrm-sample':'blocky 方塊 方块 3d vrm'};
const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase();
function report(error){$('error').textContent=error.message;$('error').hidden=false;}
function select(value){queue=queue.then(async()=>{try{accept(await window.marketplace.select(value));$('error').hidden=true;}catch(error){report(error);if(current)$('personality').value=current.personaId;}});return queue;}
function filter(){
  const words=normalize($('search').value).trim().split(/\s+/).filter(Boolean);let found=0;
  for(const mod of catalog){const view=views.get(mod.id);const match=words.every(word=>view.searchText.includes(word));view.card.hidden=!match;if(match)found++;}
  $('count').textContent=zh?`${found} / ${catalog.length} 個 Mod`:`${found} of ${catalog.length} Mods`;$('empty').hidden=found>0;
}
function build(){
  // your own characters (drawn from photos) come first
  for(const mod of [...catalog].sort((a,b)=>Number(Boolean(b.private))-Number(Boolean(a.private)))){
    const card=document.createElement('article');card.className='mod-card';card.dataset.modId=mod.id;
    const preview=document.createElement('div');preview.className='preview';card.append(preview);
    const name=document.createElement('h3');name.textContent=mod.name;card.append(name);
    const desc=document.createElement('p');desc.className='description';desc.textContent=mod.description;card.append(desc);
    const skins=document.createElement('div');skins.className='skins';card.append(skins);
    const view={card,preview,skinId:mod.defaultSkin,renderedSkin:null,skins,searchText:normalize([mod.id,mod.name,mod.description,mod.author,mod.model,aliases[mod.id]||'',...mod.skins.map(s=>s.name+' '+s.id),...mod.personas.map(p=>p.name+' '+p.id)].join(' '))};
    for(const skin of mod.skins){const button=document.createElement('button');button.className='skin';button.dataset.skinId=skin.id;button.setAttribute('aria-label',mod.name+' '+skin.name);const dot=document.createElement('span');dot.className='skin-dot';if(skin.palette)dot.style.backgroundColor=skin.palette.body;else if(skin.image)dot.style.backgroundImage=`url(mods/${encodeURIComponent(mod.id)}/${encodeURIComponent(skin.image)})`;else dot.classList.add('skin-dot-3d');const label=document.createElement('span');label.textContent=skin.name;button.append(dot,label);button.onclick=()=>{view.skinId=skin.id;select({modId:mod.id,skinId:skin.id});};skins.append(button);}
    const apply=document.createElement('button');apply.className='apply';apply.onclick=()=>select({modId:mod.id,skinId:view.skinId});card.append(apply);view.apply=apply;
    // characters drawn from photos are private and can be revised with Codex
    if(mod.private){card.classList.add('private');const badge=document.createElement('span');badge.className='badge';badge.textContent=zh?'私人':'Private';name.append(' ',badge);}
    // every character can be edited with Codex: your own in place, the others as your own copy of the skin shown
    const edit=document.createElement('button');edit.className='edit-person';edit.textContent=mod.private?(zh?'✏️ 修改造型':'✏️ Edit design'):(zh?'✏️ 做我的版本':'✏️ Make my version');
    edit.onclick=()=>window.marketplace.editPerson(mod.id,view.skinId).catch(report);card.append(edit);
    views.set(mod.id,view);$('cards').append(card);
  }
}
function accept(state){
  if(current&&current.instanceId===state.instanceId&&state.revision<current.revision)return;
  const modChanged=!current||current.modId!==state.modId;current=state;
  $('active-name').textContent=`${state.mod.name} · ${state.skin.name}`;
  if(modChanged)$('personality').replaceChildren(...state.mod.personas.map(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.name;return option;}));$('personality').value=state.personaId;
  for(const mod of catalog){const view=views.get(mod.id);const selected=state.modId===mod.id;if(selected)view.skinId=state.skinId;view.card.classList.toggle('selected',selected);const skin=mod.skins.find(s=>s.id===view.skinId)||mod.skins[0];
    if(view.renderedSkin!==skin.id){Avatars.mount(view.preview,mod,skin,`market-${mod.id}`);view.renderedSkin=skin.id;}
    view.apply.textContent=selected?(zh?'桌面使用中':'On your desktop'):(zh?'套用 Mod':'Apply Mod');
    for(const button of view.skins.children)button.setAttribute('aria-pressed',String(button.dataset.skinId===skin.id));
  }
}
$('search').oninput=filter;
$('clear').onclick=()=>{$('search').value='';filter();$('search').focus();};
$('personality').onchange=()=>select({modId:current.modId,personaId:$('personality').value});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();focusSearch();}if(event.key==='Escape')window.marketplace.close();});
window.marketplace.onState(state=>{if(catalog.length)accept(state);});
// a character was drawn, edited or deleted: rebuild the cards
window.marketplace.onRefresh(async()=>{const data=await window.marketplace.data();catalog=data.catalog;views.clear();$('cards').replaceChildren();build();current=null;accept(data.state);filter();});
$('new-person').onclick=()=>window.marketplace.newPerson().catch(report);
const focusSearch=()=>{const box=$('library').hidden?$('search'):$('library-query');box.focus();box.select();};
window.marketplace.onFocusSearch(focusSearch);
async function init(){const data=await window.marketplace.data();catalog=data.catalog;zh=data.language.startsWith('zh');document.documentElement.lang=data.language;
  if(zh){$('new-person').textContent='📷 用照片做新角色';$('library-label').textContent='角色商店';$('library-query').placeholder='搜尋動漫、遊戲、VTuber 角色…（例如：貓耳、女僕、魔法少女、vtuber）';$('library-go').textContent='搜尋';for(const el of document.querySelectorAll('#library [data-zh]'))el.textContent=el.dataset.zh;$('title').textContent='Mod 市集';$('eyebrow').textContent='你的 AI，你選角色';$('lede').textContent='搜尋你的角色，選擇 Skin，讓 Agent 活起來。';$('search').placeholder='搜尋 Mod、角色、Skin 或個性…';$('search').setAttribute('aria-label','搜尋 Mod');$('clear').textContent='清除';$('active-label').textContent='桌面使用中';$('personality-label').textContent='個性';$('results-label').textContent='探索 Mod';$('empty').textContent='找不到符合的 Mod，試試其他角色或 Skin 名稱。';$('scope').textContent='本機收藏 · 內建 3 個 Mod、6 套 Skin。線上上架、購買與下載尚未接入。';}
  build();accept(data.state);filter();$('search').focus();
  let page='installed';try{page=localStorage.getItem('market-page')||page;}catch{}
  if(zh){document.querySelector('[data-page=installed]').textContent='我的角色';document.querySelector('[data-page=store]').textContent='角色商店';}
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
const TIER_NOTE={open:['可商用','Commercial use OK'],rules:['依原作者條款使用','Follow the owner’s terms'],personal:['僅供參考，請勿商用','Reference only, no commercial use']};
let accounts={vroid:{},sketchfab:{}};
async function searchLibrary(event){
  event?.preventDefault();const query=$('library-query').value.trim();
  const sources=[...document.querySelectorAll('#library-form input[name=source]:checked')].map(i=>i.value);
  $('library-status').textContent=zh?(query?'搜尋中…':'載入精選角色…'):'Searching…';$('library-results').replaceChildren();
  try{const {items,needs}=await window.marketplace.librarySearch(query,sources);
    if(needs.includes('VROID_LOGIN'))showAccounts(true);
    $('library-status').textContent=items.length?(zh?`${query?'找到':'精選'} ${items.length} 個角色${needs.includes('VROID_LOGIN')?'（連結 VRoid Hub 後會有更多）':''}`:`${items.length} characters`):(zh?'沒有找到，換個關鍵字試試（例如：貓耳、女僕、vtuber）':'Nothing found; try other words');
    $('library-results').replaceChildren(...items.map(libraryCard));}
  catch(error){$('library-status').textContent=clean(error);}
}
const clean=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
function libraryCard(item){
  const card=document.createElement('article');card.className=`lib-card tier-${item.license.tier}`;const thumb=document.createElement('div');thumb.className='thumb';
  const none=()=>{thumb.classList.add('none');thumb.textContent=item.kind==='assisted'?'🌐':item.previewAfterDownload?(zh?'預覽要下載後才看得到':'Preview appears after download'):(zh?'沒有預覽圖':'No preview');};
  if(item.kind==='assisted'||item.previewAfterDownload)none();else window.marketplace.libraryThumb(item.key).then(url=>{if(url)thumb.style.backgroundImage=`url("${url}")`;else none();}).catch(none);
  const title=document.createElement('h4');const link=document.createElement('a');link.href='#';link.textContent=item.title;link.title=item.page||'';link.onclick=e=>{e.preventDefault();if(item.page)window.marketplace.openPage(item.page);};title.append(link);
  const meta=document.createElement('div');meta.className='meta';
  const lic=document.createElement('span');lic.className='lic';lic.textContent=item.license.label;
  const kind={vrm:'3D VRM',glb:'3D',image:'2D',assisted:zh?'官方下載':'Official'}[item.kind];
  meta.append(lic,` ${kind} · ${item.source}${item.author?` · ${item.author}`:''}`);
  const note=document.createElement('div');note.className='meta note';const [nz,ne]=TIER_NOTE[item.license.tier]||TIER_NOTE.rules;
  note.textContent=(zh?nz:ne)+(item.license.credit?(zh?'・需標註作者（會自動寫進角色資料）':' · credit kept with the character'):'');
  const action=document.createElement('button');
  action.textContent=item.kind==='image'?(zh?'請 Codex 畫成角色':'Have Codex draw it'):item.kind==='assisted'?(zh?'AI 輔助下載':'Assisted download'):(zh?'加入我的角色':'Add to my characters');
  action.onclick=async()=>{
    // official characters: their page opens in the app's assisted download window, where the AI reads the terms
    if(item.kind==='assisted'){window.marketplace.assistOpen({site:item.site,page:item.page}).catch(error=>{$('library-status').textContent=clean(error);});return;}
    action.disabled=true;action.textContent=zh?(item.kind==='image'?'準備中…':'下載中…（3D 檔案較大）'):'Working…';
    try{const result=await window.marketplace.libraryImport(item.key);action.textContent=result.opened==='worn'?(zh?'已加入並換上 ✓':'Added ✓'):(zh?'已開啟編輯視窗':'Editor opened');}
    catch(error){action.disabled=false;action.textContent=zh?'重試':'Retry';const message=clean(error);$('library-status').textContent=message;
      if(/Sketchfab API token/.test(message))tokenPrompt(card,action);if(/VRoid Hub/.test(message)&&/連結|登入/.test(message))showAccounts(true);}};
  card.append(thumb,title,meta,note,action);return card;
}
// Sketchfab downloads need the user's own API token: asked for right on the card, then the download is retried.
function tokenPrompt(card,action){
  if(card.querySelector('.token'))return;$('library-status').textContent='';
  const box=document.createElement('div');box.className='token';
  const text=document.createElement('p');const link=document.createElement('a');link.href='#';link.textContent=zh?'到 Sketchfab 複製你的 API token':'Copy your Sketchfab API token';
  link.onclick=e=>{e.preventDefault();window.marketplace.openPage('https://sketchfab.com/settings/password');};
  text.append(zh?'Sketchfab 規定下載要用你自己的帳號：':'Sketchfab downloads need your own account: ',link,zh?'（登入後在頁面最下方），貼在這裡就會開始下載。':' (bottom of the page after signing in), paste it here and the download starts.');
  const input=document.createElement('input');input.type='password';input.placeholder='API token';input.autocomplete='off';input.spellcheck=false;
  const save=document.createElement('button');save.type='button';save.textContent=zh?'儲存並下載':'Save and download';
  save.onclick=async()=>{save.disabled=true;try{await window.marketplace.sketchfabToken(input.value.trim());input.value='';box.remove();showAccounts();action.click();}catch(error){text.textContent=clean(error);save.disabled=false;}};
  box.append(text,input,save);card.insertBefore(box,action);input.focus();
}
// VRoid Hub and Sketchfab sign-ins. The keys go straight to the app's encrypted store; this window never reads them back.
async function showAccounts(open=false,focus=null){
  accounts=await window.marketplace.accounts().catch(()=>accounts);const box=$('accounts');box.replaceChildren();
  const row=(cls,...children)=>{const el=document.createElement('div');el.className=cls;el.append(...children);return el;};
  const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(error){$('library-status').textContent=clean(error);}finally{b.disabled=false;}};return b;};
  const input=(placeholder,secret)=>{const i=document.createElement('input');i.placeholder=placeholder;if(secret)i.type='password';i.autocomplete='off';i.spellcheck=false;return i;};
  const pageLink=(text,url)=>{const a=document.createElement('a');a.href='#';a.textContent=text;a.onclick=e=>{e.preventDefault();window.marketplace.openPage(url);};return a;};
  // VRoid Hub
  const v=accounts.vroid||{};
  if(v.connected)box.append(row('account ok',`✓ ${zh?'VRoid Hub 已連結':'VRoid Hub connected'}`,button(zh?'中斷連結':'Disconnect',async()=>{await window.marketplace.vroidDisconnect();showAccounts();})));
  else if(v.configured)box.append(row('account',zh?'VRoid Hub：搜尋動漫 3D 角色':'VRoid Hub: anime 3D characters',button(zh?'連結 VRoid Hub':'Connect VRoid Hub',async()=>{$('library-status').textContent=zh?'請在跳出的視窗登入並按「許可」…':'Sign in in the new window…';await window.marketplace.vroidConnect();await showAccounts();searchLibrary();}),
    button(zh?'重設 App':'Reset app',async()=>{await window.marketplace.vroidConfigure({});})));
  else if(open||focus==='vroid'){
    const id=input('Application ID'),secret=input('Secret',true);const redirect=document.createElement('code');redirect.textContent='agentwardrobe://vroid-callback';
    const steps=document.createElement('ol');
    const step=(...parts)=>{const li=document.createElement('li');li.append(...parts);steps.append(li);};
    step(zh?'到 ':'Open ',pageLink(zh?'VRoid Hub 開發者 App 頁面':'VRoid Hub developer apps','https://hub.vroid.com/oauth/applications'),zh?' 註冊開發者並「建立新 App」（要用你自己的 pixiv 帳號，條款要你本人同意）':' and register a new app (with your own pixiv account)');
    step(zh?'Redirect URI 填 ':'Set the redirect URI to ',redirect,zh?'，Scope 填 default':', scope default');
    step(zh?'把 Application ID 和 Secret 貼在這裡：':'Paste the Application ID and Secret here:');
    box.append(row('account setup',zh?'連結 VRoid Hub（只需設定一次）':'Connect VRoid Hub (one-time setup)',steps,row('fields',id,secret,button(zh?'儲存並連結':'Save and connect',async()=>{await window.marketplace.vroidConfigure({clientId:id.value,clientSecret:secret.value});id.value=secret.value='';await showAccounts();$('library-status').textContent=zh?'請在跳出的視窗登入並按「許可」…':'Sign in in the new window…';await window.marketplace.vroidConnect();await showAccounts();searchLibrary();}))));
  }else box.append(row('account',zh?'VRoid Hub 有最多動漫 3D 角色':'VRoid Hub has the most anime 3D characters',button(zh?'設定 VRoid Hub':'Set up VRoid Hub',()=>showAccounts(true))));
  // Sketchfab (only needed for downloads)
  const sf=accounts.sketchfab||{};
  if(sf.configured)box.append(row('account ok',`✓ ${zh?'Sketchfab 已設定':'Sketchfab ready'}`,button(zh?'移除 token':'Remove token',async()=>{await window.marketplace.sketchfabToken('');showAccounts();})));
  else if(focus==='sketchfab'){const token=input('Sketchfab API token',true);
    box.append(row('account setup',zh?'下載 Sketchfab 模型要你的 API token（':'Downloading Sketchfab models needs your API token (',pageLink(zh?'在這裡複製':'copy it here','https://sketchfab.com/settings/password'),zh?'，登入後頁面最下方）':')',row('fields',token,button(zh?'儲存':'Save',async()=>{await window.marketplace.sketchfabToken(token.value);token.value='';await showAccounts();$('library-status').textContent=zh?'已儲存，再按一次「加入我的角色」':'Saved; try adding it again';}))));}
}
$('library-form').onsubmit=searchLibrary;
// "在 Booth / nizima / 模之屋 … 找": the assisted download window searches that site for the current query
const ASSIST_SITES=[['booth','Booth'],['nizima','nizima'],['aplaybox','模之屋'],['nico3d','ニコニ立体'],['bowlroll','BowlRoll'],['gumroad','Gumroad'],['vroid','VRoid Hub'],['picrew','Picrew'],['zunko','ずんだもん'],['unitychan','Unity-chan'],['live2d','Live2D 範例']];
for(const [site,name] of ASSIST_SITES){const b=document.createElement('button');b.type='button';b.dataset.site=site;b.textContent=`在 ${name} 找`;
  b.onclick=()=>window.marketplace.assistOpen({site,query:$('library-query').value.trim()}).catch(error=>{$('library-status').textContent=clean(error);});$('assist-row').append(b);}
