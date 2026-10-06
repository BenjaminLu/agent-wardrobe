// Watch mode: the user plays any game; the character looks at that window every few seconds and comments.
// Before watching it looks the game up (Wikipedia: summary and gameplay only, never the story), keeps short notes of how far
// the player has got, and is told never to reveal anything beyond what has been on screen.
const fs=require('node:fs');const path=require('node:path');const L=require('./locales.cjs');

// Sections that describe the story are dropped before the model ever sees them.
const SPOILER=/plot|story|synopsis|ending|characters|劇情|剧情|故事|情節|情节|結局|结局|角色|登場人物|登场人物|設定|世界觀|世界观/i;
const NOISE=/reference|external|notes|see also|soundtrack|參考|参考|外部|注釋|注释|腳注|脚注|相關|相关|原聲|原声/i;
function spoilerFree(extract,{lead=400,section=1600}={}){
  const lines=String(extract).split('\n');let keep=[],skipLevel=0,current='lead';const parts={lead:[]};
  for(const line of lines){
    const heading=line.match(/^(=+)\s*(.+?)\s*=+$/);
    if(heading){const level=heading[1].length;if(skipLevel&&level>skipLevel)continue;skipLevel=0;
      if(SPOILER.test(heading[2])||NOISE.test(heading[2])){skipLevel=level;continue;}current=heading[2];parts[current]??=[];continue;}
    if(skipLevel)continue;parts[current]?.push(line);
  }
  // The summary keeps only its first paragraph (studio, genre, platforms); later paragraphs often retell the premise.
  for(const [name,body] of Object.entries(parts)){const text=body.join('\n').replace(/\n{2,}/g,'\n').trim();if(!text)continue;keep.push(name==='lead'?text.split('\n')[0].slice(0,lead):`【${name}】${text.slice(0,section)}`);}
  return keep.join('\n').slice(0,3200);
}

const WIKI=lang=>`https://${lang}.wikipedia.org/w/api.php`;
async function wikiLookup(game,{fetchImpl=fetch,langs=['zh','en']}={}){
  for(const lang of langs){
    const get=async params=>(await fetchImpl(`${WIKI(lang)}?${new URLSearchParams({format:'json',...params})}`,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'AgentWardrobe/0.1 (desktop companion)'}})).json();
    const [,titles]=await get({action:'opensearch',search:game,limit:'1'});if(!titles?.[0])continue;
    const data=await get({action:'query',prop:'extracts',explaintext:'1',exsectionformat:'wiki',redirects:'1',titles:titles[0],...(lang==='zh'?{variant:'zh-tw'}:{})});
    const page=Object.values(data.query?.pages||{})[0];if(!page?.extract)continue;
    return {title:page.title,lang,source:`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,brief:spoilerFree(page.extract)};
  }
  return null;
}

// A tiny grey thumbnail is enough to tell whether the screen changed.
function signature(image){const small=image.resize({width:32,height:18});const bitmap=small.toBitmap();const out=new Uint8Array(32*18);for(let i=0;i<out.length;i++)out[i]=(bitmap[i*4]+bitmap[i*4+1]+bitmap[i*4+2])/3;return out;}
// Small models repeat themselves; a line that shares most character pairs with a recent one is not spoken again.
function similar(a,b){const pairs=t=>{const s=String(t).replace(/\s+/g,''),set=new Set();for(let i=0;i<s.length-1;i++)set.add(s.slice(i,i+2));return set;};
  const x=pairs(a),y=pairs(b);if(!x.size||!y.size)return false;let both=0;for(const p of x)if(y.has(p))both++;return both/Math.min(x.size,y.size)>.6;}
function changed(a,b,threshold=6){if(!a||!b||a.length!==b.length)return true;let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length>threshold;}

// Small models follow a language name, not a code.
const LANGUAGE_NAMES={'zh-Hant':'Traditional Chinese (繁體中文)','zh-Hans':'Simplified Chinese (简体中文)',en:'English',ja:'Japanese (日本語)'};
function languageName({replyLanguage,language=''}){
  if(LANGUAGE_NAMES[replyLanguage])return LANGUAGE_NAMES[replyLanguage];
  return /^zh-(TW|HK|MO|Hant)/i.test(language)?LANGUAGE_NAMES['zh-Hant']:/^zh/i.test(language)?LANGUAGE_NAMES['zh-Hans']:/^ja/i.test(language)?LANGUAGE_NAMES.ja:LANGUAGE_NAMES.en;
}
const SCHEMA={type:'object',properties:{speak:{type:'boolean'},text:{type:'string'},emotion:{type:'string',enum:['neutral','smug','happy','surprised','nervous','sad']},progress:{type:'string'}},required:['speak','text','emotion','progress']};
function watchPrompt({persona,game,brief,progress,recent,language}){
  return `${persona}
You are watching the user play "${game}" live and react like a funny co-streamer: short, playful, specific to what is on screen (1–2 sentences, at most 60 characters in Chinese).
What you know about the game (no story):
${brief||'(nothing found; rely on the screen)'}
How far the player has got, from what you have seen so far: ${progress.length?progress.join(' → '):'just started'}.
Your recent comments (do not repeat them): ${recent.length?recent.join(' / '):'none'}.
Spoiler rules: never mention story events, characters, bosses, areas, twists or endings that have not appeared on screen; do not hint at what comes next; if you are not sure something is a spoiler, do not say it.
Reply in ${language}. Return JSON only: {"speak": true|false, "text": "...", "emotion": "neutral|smug|happy|surprised|nervous|sad", "progress": "where the player is now in a few words, from the screen only, in the same language"}.
Set speak to false when nothing interesting changed. Each comment must be about something new on this screen, not a variation of your recent comments.`;
}

function createWatch({desktopCapturer,app,handle,getWin,getSettings,getRuntime,getPrompt,speak,localModel,fetchImpl=fetch,capture}){
  const briefDir=()=>path.join(app.getPath('userData'),'game-briefs');
  let timer=null,session=null;
  const send=(channel,value)=>{const win=getWin();if(win&&!win.isDestroyed())win.webContents.send(channel,value);};
  async function brief(game){
    const file=path.join(briefDir(),`${Buffer.from(game.toLowerCase()).toString('hex').slice(0,80)}.json`);
    try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const found=await wikiLookup(game,{fetchImpl}).catch(()=>null);
    const value=found||{title:game,brief:'',source:null};fs.mkdirSync(briefDir(),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));return value;
  }
  const grab=capture||(async id=>{const sources=await desktopCapturer.getSources({types:[id.startsWith('screen:')?'screen':'window'],thumbnailSize:{width:768,height:480},fetchWindowIcons:false});return sources.find(s=>s.id===id)?.thumbnail||null;});
  async function look(force=false){
    const s=session;if(!s||s.busy)return;
    const image=await grab(s.sourceId);if(!image||image.isEmpty()){send('bula:watch',{state:'lost'});return;}
    const sig=signature(image);if(!force&&!changed(sig,s.last))return;s.last=sig;
    if(!force&&Date.now()<s.quietUntil)return;
    s.busy=true;
    try{
      const settings=getSettings(),model=await localModel();
      const system=watchPrompt({persona:getPrompt(),game:s.game,brief:s.brief.brief,progress:s.progress.slice(-5),recent:s.recent.slice(-4),language:languageName(settings)});
      const jpeg=image.toJPEG(70).toString('base64');
      const response=await fetchImpl(`${model.base}/chat/completions`,{method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json',...model.headers},body:JSON.stringify({model:model.model,temperature:.8,max_tokens:model.structured?300:1500,
        messages:[{role:'system',content:system},{role:'user',content:[{type:'text',text:'Current screen:'},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${jpeg}`}}]}],
        ...(model.structured?{response_format:{type:'json_schema',json_schema:{name:'comment',schema:SCHEMA}}}:{})})});
      if(!response.ok)throw L.error('game.watch.modelStatus',{status:response.status,body:(await response.text()).slice(0,160)});
      const content=(await response.json()).choices?.[0]?.message?.content||'';
      const reply=JSON.parse(content.replace(/<think>[\s\S]*?<\/think>/g,'').replace(/^[^{]*/,'').replace(/[^}]*$/,''));
      if(reply.progress&&reply.progress!==s.progress.at(-1))s.progress.push(String(reply.progress).slice(0,60));
      if(reply.speak&&reply.text?.trim()&&!s.recent.slice(-6).some(line=>similar(line,reply.text))){
        const text=String(reply.text).trim().slice(0,160);s.recent.push(text);s.quietUntil=Date.now()+s.cooldown;
        try{getRuntime().activity('success',reply.emotion);}catch{}
        send('bula:watch',{state:'comment',text,emotion:reply.emotion,progress:s.progress.at(-1)});speak(text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu,'').trim());
      }
    }catch(error){send('bula:watch',{state:'error',error:error.message});}
    finally{s.busy=false;}
  }
  function stop(){clearInterval(timer);timer=null;session=null;send('bula:watch',{state:'stopped'});}
  // macOS lists only windows visible on the current desktop; a full-screen game lives in its own Space, so whole screens are offered too.
  handle('bula:watch-sources',async()=>(await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0},fetchWindowIcons:false}))
    .filter(s=>s.id.startsWith('screen:')||(!/Agent Wardrobe|Electron/i.test(s.name)&&s.name.trim())).map(s=>({id:s.id,name:s.name,screen:s.id.startsWith('screen:')})));
  handle('bula:watch-start',async({sourceId,game,interval=6})=>{
    if(typeof sourceId!=='string'||typeof game!=='string'||!game.trim())throw L.error('game.watch.pickWindow');
    stop();send('bula:watch',{state:'research',game});
    const info=await brief(game.trim().slice(0,80));
    session={sourceId,game:game.trim().slice(0,80),brief:info,progress:[],recent:[],last:null,quietUntil:0,busy:false,cooldown:20000};
    const seconds=Math.max(3,Math.min(30,+interval||6));timer=setInterval(()=>look().catch(()=>{}),seconds*1000);look(true).catch(()=>{});
    send('bula:watch',{state:'watching',game:session.game,source:info.source,title:info.title,found:Boolean(info.brief)});
    return {title:info.title,source:info.source,found:Boolean(info.brief)};
  });
  handle('bula:watch-stop',()=>{stop();return true;});
  return {stop,look,session:()=>session};
}
module.exports={createWatch,spoilerFree,wikiLookup,watchPrompt,changed,similar,languageName};
