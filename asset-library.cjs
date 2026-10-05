// The avatar store's open libraries, focused on anime, game and VTuber characters:
//  featured  — hand-picked characters with clear terms (VRoid's own sample models, Seed-san) plus official characters
//              (Unity-chan, Zundamon, Live2D samples…) that are fetched through the assisted download window
//  vroid     — VRoid Hub (pixiv): anime VRM avatars whose authors allow use in other apps (needs the user's VRoid sign-in)
//  vrm       — Open Source Avatars (mostly CC0 VRM)
//  sketchfab — downloadable CC0 / CC BY character models (plain glTF; download needs the user's Sketchfab API token)
//  booru     — Safebooru anime pictures (general rating only): fan art, used only as a reference for Codex to redraw
// Every result carries its terms: tier 'open' (CC0/CC BY), 'rules' (the owner's own terms) or 'personal' (fan art / non-commercial).
const fs=require('node:fs');const path=require('node:path');
const OSA='https://raw.githubusercontent.com/ToxSam/open-source-avatars/main/data';
const SAMPLES='https://raw.githubusercontent.com/madjin/vrm-samples/master';
const VROID='https://hub.vroid.com';
const HOSTS=['raw.githubusercontent.com','arweave.net','dweb.link','ipfs.io','gateway.pinata.cloud','hub.vroid.com','api.sketchfab.com','media.sketchfab.com','safebooru.org'];
const HOST_SUFFIXES=['.pximg.net'];
const REFERERS={'pximg.net':'https://hub.vroid.com/'};

// {id,label,commercial,credit,shareAlike,tier} for open licences we accept, or null.
function license(text){
  const t=String(text||'').replace(/<[^>]+>/g,'').trim();
  if(/^(cc0|public domain|pd)\b/i.test(t))return {id:'cc0',label:/^cc0/i.test(t)?'CC0':'Public domain',commercial:true,credit:false,shareAlike:false,tier:'open'};
  if(/\b(nc|nd)\b|noncommercial|noderiv/i.test(t))return null;
  if(/^cc[- ]by[- ]sa\b/i.test(t))return {id:'cc-by-sa',label:t.replace(/^cc[- ]by[- ]sa/i,'CC BY-SA'),commercial:true,credit:true,shareAlike:true,tier:'open'};
  if(/^cc[- ]by\b/i.test(t))return {id:'cc-by',label:t.replace(/^cc[- ]by/i,'CC BY'),commercial:true,credit:true,shareAlike:false,tier:'open'};
  if(/^oga[- ]by\b/i.test(t))return {id:'oga-by',label:t.toUpperCase(),commercial:true,credit:true,shareAlike:false,tier:'open'};
  return null;
}
// Sketchfab names its licences in words.
const SKETCHFAB_LICENSES={'CC0 Public Domain':'CC0','CC Attribution':'CC BY 4.0','CC Attribution-ShareAlike':'CC BY-SA 4.0'};
// VRoid Hub: each model has its author's own conditions; 'default' means the stricter choice.
function vroidLicense(l={}){
  const personal=l.personal_commercial_use,corporate=l.corporate_commercial_use==='allow',credit=l.credit==='necessary';
  const parts=[personal==='profit'?'個人營利可':personal==='nonprofit'?'個人非營利可':'個人非商用',corporate?'法人可':null,l.modification==='allow'?'可改造':'不可改造',credit?'需標註':null].filter(Boolean);
  return {id:'vroid',label:`VRoid 條件：${parts.join('・')}`,commercial:personal==='profit'||corporate,credit,shareAlike:false,tier:'rules',modification:l.modification==='allow'};
}
const FANART={id:'fanart',label:'同人圖・僅供參考',commercial:false,credit:true,shareAlike:false,tier:'personal'};
const RULES=(label,commercial,credit=true)=>({id:'rules',label,commercial,credit,shareAlike:false,tier:'rules'});

const credit=(item)=>`Based on "${item.title}"${item.author?` by ${item.author}`:''} (${item.license.label}), ${item.page||item.download}`;
const decode=s=>String(s).replace(/&amp;/g,'&').replace(/&#039;|&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');

// Chinese words people type, as the English words / booru tags the libraries use.
const WORDS={'貓耳':'cat_ears','猫耳':'cat_ears','狐耳':'fox_ears','狐狸':'fox_ears','兔耳':'rabbit_ears','獸耳':'animal_ears','女僕':'maid','女仆':'maid','魔法少女':'magical_girl',
  '女生':'1girl','女孩':'1girl','少女':'1girl','男生':'1boy','男孩':'1boy','少年':'1boy','精靈':'elf','精灵':'elf','吸血鬼':'vampire','機器人':'robot','机器人':'robot','偶像':'idol','和服':'kimono',
  '水手服':'serafuku','制服':'school_uniform','眼鏡':'glasses','眼镜':'glasses','雙馬尾':'twintails','双马尾':'twintails','馬尾':'ponytail','马尾':'ponytail','短髮':'short_hair','长发':'long_hair','長髮':'long_hair',
  '金髮':'blonde_hair','白髮':'white_hair','銀髮':'silver_hair','Q版':'chibi','q版':'chibi','惡魔':'demon','恶魔':'demon','天使':'angel','騎士':'knight','骑士':'knight','忍者':'ninja','巫女':'miko',
  '修女':'nun','兔女郎':'playboy_bunny','護士':'nurse','龍':'dragon','龙':'dragon','鯨魚':'whale','貓':'cat','猫':'cat','狗':'dog','角色':'character','動漫':'anime','动漫':'anime'};
function translate(q){let rest=String(q);const tags=[];for(const [zh,en] of Object.entries(WORDS).sort((a,b)=>b[0].length-a[0].length))if(rest.includes(zh)){tags.push(en);rest=rest.split(zh).join(' ');}
  return [...tags,...rest.split(/\s+/).filter(Boolean)];}

// Hand-picked characters. 'vrm' ones download straight away; 'assisted' ones open the official page in the assisted download window.
// Only the CC0 samples have a bundled thumbnail (library-thumbs/); the others show their preview once downloaded.
const vroidSample=(file,title,cc0=true)=>({kind:'vrm',source:'VRoid 官方樣本',title,author:'pixiv / VRoid',...(cc0?{thumb:`local:${file}`}:{previewAfterDownload:true}),
  license:cc0?{...license('CC0'),label:'CC0'}:RULES('VRoid 樣本條款（可商用）',true,false),download:`${SAMPLES}/vroid/${cc0?'beta':'stable'}/${file}.vrm`,
  page:cc0?'https://vroid.pixiv.help/hc/en-us/articles/4402614652569':'https://vroid.pixiv.help/hc/en-us/articles/4402394424089',tags:'anime vroid 3d vtuber'});
const FEATURED=[
  vroidSample('Sendagaya_Shino','千駄ヶ谷 篠 Shino'),vroidSample('Sendagaya_Shibu','千駄ヶ谷 渋 Shibu'),vroidSample('Sakurada_Fumiriya','桜田 フミリヤ Fumiriya'),
  vroidSample('Vita','Vita'),vroidSample('Vivi','Vivi'),vroidSample('Victoria_Rubin','Victoria Rubin'),vroidSample('Darkness_Shibu','闇の 渋 Darkness Shibu'),
  vroidSample('AvatarSample_A','AvatarSample A',false),vroidSample('AvatarSample_B','AvatarSample B',false),vroidSample('AvatarSample_C','AvatarSample C',false),
  {kind:'vrm',source:'VRM 官方範例',title:'Seed-san',author:'VirtualCast, Inc.',previewAfterDownload:true,license:RULES('VRM Public License 1.0（需標註）',true),download:`${SAMPLES}/Seed-san/vrm/Seed-san.vrm`,page:'https://vrm.dev/licenses/1.0/',tags:'anime vrm 3d'},
  {kind:'assisted',site:'unitychan',source:'Unity Technologies Japan',title:'Unity-chan ユニティちゃん',author:'UTJ/UCL',license:RULES('UCL 2.0：個人／小團體可商用，需標示',true),page:'https://unity-chan.com/download/',tags:'game anime 3d unity ユニティちゃん'},
  {kind:'assisted',site:'zunko',source:'東北ずん子・ずんだもん',title:'ずんだもん Zundamon',author:'SSS合同会社',license:RULES('角色規約：依規約可商用',true),page:'https://zunko.jp/con_illust.html',tags:'vtuber anime 2d live2d voicevox ずんだもん 東北'},
  {kind:'assisted',site:'live2d',source:'Live2D 官方範例',title:'Hiyori・Mao・Haru 等',author:'Live2D Inc.',license:RULES('Live2D 無償素材ライセンス：個人／小團體可用',true),page:'https://www.live2d.com/en/learn/sample/',tags:'vtuber live2d anime 2d'},
  {kind:'assisted',site:'alicia',source:'ニコニ立体',title:'アリシア・ソリッド Alicia Solid',author:'dwango',license:RULES('ニコニ立体ちゃん規約',false),page:'https://3d.nicovideo.jp/alicia/',tags:'anime 3d vrm mmd'}
];

// IPFS files are reachable through several public gateways; a busy one (429) or a miss is retried on the next.
const IPFS_GATEWAYS=['https://dweb.link','https://ipfs.io','https://gateway.pinata.cloud'];
function alternatives(url){const m=String(url).match(/^https:\/\/(?:dweb\.link|ipfs\.io|gateway\.pinata\.cloud)(\/ipfs\/.+)$/);return m?IPFS_GATEWAYS.map(g=>g+m[1]):[url];}

// accounts: {vroid:{token():Promise<string|null>}, sketchfab:{token():string|null}} — sign-ins kept by the app, never by the window.
function createLibrary({fetchImpl=fetch,now=()=>Date.now(),shrink=null,accounts={},thumbDir=path.join(__dirname,'library-thumbs')}={}){
  const cache=new Map(),results=new Map(),thumbs=new Map();
  // at most three thumbnails download at once, so hosts do not rate-limit us
  let active=0;const waiting=[];const slot=()=>new Promise(r=>{if(active<3){active++;r();}else waiting.push(r);});const release=()=>{const next=waiting.shift();if(next)next();else active--;};
  const allowed=url=>{try{const u=new URL(url);return u.protocol==='https:'&&(HOSTS.includes(u.hostname)||HOST_SUFFIXES.some(s=>u.hostname.endsWith(s)));}catch{return false;}};
  async function get(url,{as='json',limit=2e6,timeout=15000,headers={},method='GET',body}={}){
    if(!allowed(url))throw new Error('不允許的下載來源。');
    const referer=Object.entries(REFERERS).find(([host])=>new URL(url).hostname.endsWith(host))?.[1];
    let response,lastError;
    for(const candidate of alternatives(url)){
      try{response=await fetchImpl(candidate,{method,body,redirect:'follow',signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'AgentWardrobe/0.1 (desktop companion; avatar store)',...(referer?{Referer:referer}:{}),...headers}});}
      catch(error){lastError=error;continue;}
      if(response.ok)break;lastError=Object.assign(new Error(`下載失敗（${response.status}）`),{status:response.status});response=null;
    }
    if(!response)throw lastError||new Error('下載失敗');
    const data=Buffer.from(await response.arrayBuffer());if(data.length>limit)throw new Error('檔案太大。');
    return as==='json'?JSON.parse(data.toString('utf8')):as==='text'?data.toString('utf8'):data;
  }
  async function cached(key,fn,ttl=24*3600e3){const hit=cache.get(key);if(hit&&now()-hit.at<ttl)return hit.value;const value=await fn();cache.set(key,{at:now(),value});return value;}
  const matches=(text,q)=>{const words=translate(q).map(w=>w.toLowerCase().replace(/_/g,' ').replace(/^1(girl|boy)$/,''));return words.filter(Boolean).every(w=>text.includes(w));};

  function searchFeatured(q){return FEATURED.filter(item=>!q||matches([item.title,item.source,item.tags].join(' ').toLowerCase(),q));}

  // 3D: the whole Open Source Avatars index (about 500 avatars) is small enough to search locally.
  async function avatars(){
    return cached('osa',async()=>{const projects=await get(`${OSA}/projects.json`);const out=[];
      for(const project of projects.filter(p=>p.is_public)){const lic=license(project.license);if(!lic)continue;
        const list=await get(`${OSA}/${project.avatar_data_file}`).catch(()=>[]);
        for(const a of list)if(a.is_public&&!a.is_draft&&/vrm/i.test(a.format||'')&&allowed(a.model_file_url))
          out.push({kind:'vrm',source:'Open Source Avatars',title:a.name,author:project.creator_id||project.name,license:lic,thumb:a.thumbnail_url,download:a.model_file_url,page:'https://www.opensourceavatars.com',
            text:[a.name,a.description,project.name,...(a.metadata?.attributes||[]).map(x=>x.value)].join(' ').toLowerCase()});}
      return out;});
  }
  async function searchVrm(q){return (await avatars()).filter(a=>matches(a.text,q)).slice(0,24);}

  // VRoid Hub: only models whose authors allow other apps to use them, never age-restricted ones.
  const vroidHeaders=token=>({'X-Api-Version':'11',Authorization:`Bearer ${token}`});
  async function vroidToken(){const token=await accounts.vroid?.token?.();if(!token)throw Object.assign(new Error('VRoid Hub 還沒連結：按「連結 VRoid Hub」登入一次。'),{code:'VROID_LOGIN'});return token;}
  async function searchVroid(q){
    const token=await vroidToken();
    const url=q?`${VROID}/api/search/character_models?${new URLSearchParams({keyword:q,count:'40'})}`:`${VROID}/api/staff_picks?count=40`;
    let data;try{data=await get(url,{headers:vroidHeaders(token)});}catch(error){if(error.status===401){await accounts.vroid?.expired?.();throw Object.assign(new Error('VRoid Hub 登入過期了，請再連結一次。'),{code:'VROID_LOGIN'});}throw error;}
    return (data.data||[]).filter(m=>m.is_downloadable&&m.is_other_users_available&&!m.age_limit?.is_r18&&!m.age_limit?.is_r15&&!m.age_limit?.is_adult).slice(0,24).map(m=>({
      kind:'vrm',source:'VRoid Hub',vroidId:m.id,title:m.name||m.character?.name||'VRoid',author:m.character?.user?.name||'',license:vroidLicense(m.license),
      thumb:m.portrait_image?.sq300?.url||m.full_body_image?.w300?.url,page:`${VROID}/characters/${m.character?.id}/models/${m.id}`}));
  }

  // Sketchfab: downloadable character models under CC0 / CC BY / CC BY-SA.
  async function searchSketchfab(q){
    const words=translate(q).map(w=>w.replace(/_/g,' ').replace(/^1(girl|boy)$/,m=>m==='1girl'?'girl':'boy'));
    const data=await get(`https://api.sketchfab.com/v3/search?${new URLSearchParams({type:'models',q:[...words,...(words.some(w=>/anime|chibi|vtuber/i.test(w))?[]:['anime'])].join(' '),downloadable:'true',categories:'characters-creatures',count:'24'})}`);
    return (data.results||[]).flatMap(r=>{const lic=license(SKETCHFAB_LICENSES[r.license?.label]);if(!lic||r.isAgeRestricted)return [];
      const thumb=(r.thumbnails?.images||[]).filter(i=>i.width<=640).sort((a,b)=>b.width-a.width)[0]?.url;
      return [{kind:'glb',source:'Sketchfab',sketchfabId:r.uid,title:r.name,author:r.user?.displayName||'',license:lic,thumb,page:r.viewerUrl}];});
  }

  // Safebooru: anime pictures in the general rating; each one is somebody's art, so it is only a reference for a redraw.
  async function searchBooru(q){
    const tags=[...new Set([...translate(q).map(w=>w.toLowerCase()),'solo'])].slice(0,6).join(' ');
    const list=await get(`https://safebooru.org/index.php?${new URLSearchParams({page:'dapi',s:'post',q:'index',json:'1',limit:'40',tags})}`).catch(()=>[]);
    return (Array.isArray(list)?list:[]).filter(p=>p.rating==='general'&&/\.(png|jpe?g)$/i.test(p.image||'')).slice(0,24).map(p=>({
      kind:'image',source:'Safebooru',title:String(p.tags||'').split(' ').filter(t=>!/^(1girl|1boy|solo|commentary.*|highres|absurdres)$/.test(t)).slice(0,3).join(' ').replace(/_/g,' ')||`#${p.id}`,
      author:'',license:FANART,thumb:p.preview_url,download:p.sample_url&&p.sample?p.sample_url:p.file_url,page:`https://safebooru.org/index.php?page=post&s=view&id=${p.id}`}));
  }

  const SOURCES={featured:searchFeatured,vroid:searchVroid,vrm:searchVrm,sketchfab:searchSketchfab,booru:searchBooru};
  // Results are kept here; the window refers to them by key, so it can never make the app fetch an arbitrary address.
  // A source that needs a sign-in reports it in `needs` instead of failing the whole search.
  async function search(q,sources=['featured','vroid','vrm','sketchfab']){
    const query=String(q||'').trim().slice(0,80),needs=[];
    const lists=await Promise.all(sources.filter(s=>SOURCES[s]&&(query||['featured','vroid'].includes(s))).map(s=>Promise.resolve().then(()=>SOURCES[s](query)).catch(error=>{if(error.code)needs.push(error.code);return [];})));
    const items=lists.flat().map(item=>{const key=`r${results.size+1}-${Math.random().toString(36).slice(2,8)}`;results.set(key,item);
      return {key,kind:item.kind,source:item.source,title:item.title,author:item.author,license:item.license,page:item.page,site:item.site,...(item.previewAfterDownload?{previewAfterDownload:true}:{})};});
    return {items,needs};
  }
  // Thumbnails are shrunk on this Mac (some libraries serve multi-megabyte previews) and kept for the session.
  async function thumbnail(key){
    const item=results.get(key);if(!item?.thumb)return null;if(thumbs.has(item.thumb))return thumbs.get(item.thumb);
    if(item.thumb.startsWith('local:')){const file=path.join(thumbDir,`${item.thumb.slice(6)}.png`);const url=fs.existsSync(file)?`data:image/png;base64,${fs.readFileSync(file).toString('base64')}`:null;thumbs.set(item.thumb,url);return url;}
    await slot();
    try{const data=await get(item.thumb,{as:'buffer',limit:5e6,timeout:20000});
      const type=data[0]===0x89?'image/png':data[0]===0xff?'image/jpeg':data[0]===0x47?'image/gif':data.slice(0,4).toString()==='RIFF'?'image/webp':null;if(!type)return null;
      const small=shrink&&type!=='image/gif'?shrink(data):null;const url=small?`data:image/png;base64,${small.toString('base64')}`:data.length<700e3?`data:${type};base64,${data.toString('base64')}`:null;
      thumbs.set(item.thumb,url);return url;}
    finally{release();}
  }
  async function download(key){
    const item=results.get(key);if(!item)throw new Error('找不到這個搜尋結果，請重新搜尋。');
    if(item.kind==='assisted')throw new Error('這個角色要從官方網站下載，請用「AI 輔助下載」。');
    const big={as:'buffer',limit:80e6,timeout:180000};
    if(item.source==='VRoid Hub'){
      // a download licence is issued for this user, then the hub redirects to the file
      const token=await vroidToken(),headers=vroidHeaders(token);
      const issued=await get(`${VROID}/api/download_licenses`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({character_model_id:item.vroidId})});
      const data=await get(`${VROID}/api/download_licenses/${encodeURIComponent(issued.data.id)}/download`,{...big,headers});
      if(data.subarray(0,4).toString('latin1')!=='glTF')throw new Error('VRoid Hub 給的不是一般的 VRM 檔，這個模型可能只能在官方認證的 App 使用。');
      return {item,credit:credit(item),data};
    }
    if(item.source==='Sketchfab'){
      const token=accounts.sketchfab?.token?.();if(!token)throw Object.assign(new Error('下載 Sketchfab 模型要先設定 Sketchfab API token。'),{code:'SKETCHFAB_TOKEN'});
      const links=await get(`https://api.sketchfab.com/v3/models/${encodeURIComponent(item.sketchfabId)}/download`,{headers:{Authorization:`Token ${token}`}});
      const url=links.glb?.url;if(!/^https:\/\//.test(url||''))throw new Error('這個 Sketchfab 模型沒有 GLB 版本可以下載。');
      // the link Sketchfab hands back is a signed storage address; it is trusted because it came from the API itself
      const response=await fetchImpl(url,{redirect:'follow',signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error(`下載失敗（${response.status}）`);
      const data=Buffer.from(await response.arrayBuffer());if(data.length>80e6)throw new Error('檔案太大。');
      return {item,credit:credit(item),data};
    }
    return {item,credit:credit(item),data:await get(item.download,item.kind==='vrm'?big:{as:'buffer',limit:8e6,timeout:30000})};
  }
  return {search,thumbnail,download,results};
}
module.exports={createLibrary,license,vroidLicense,credit,translate,FEATURED};
