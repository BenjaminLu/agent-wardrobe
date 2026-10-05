// The 「聲音」 settings: voice profiles (voices.cjs) with the Kokoro mix and VOICEVOX engines, bindings to characters
// (settings.characterVoices {modId: profileId}), previews, packs, and the phone's /api/voices routes.
// Voice cloning engines (cosyvoice, sovits, elevenlabs) and the recording window plug in through registerEngine() and openVoiceLab.
const fs=require('node:fs');const path=require('node:path');
const {createVoices,boundProfile}=require('./voices.cjs');
const {createKokoroMix,PRESETS}=require('./voice-engines/kokoro-mix.cjs');
const {createVoicevox,isJapanese}=require('./voice-engines/voicevox.cjs');
const kokoro=require('./kokoro.cjs');

function createVoiceService({app,handle,dialog,getWin,getSettings,persist,getRuntime,speech,secrets,kokoroDir,sherpa,remoteEvent=()=>{}}){
  const root=path.join(app.getPath('userData'),'voices');
  const send=(channel,value)=>{const win=getWin();if(win&&!win.isDestroyed())win.webContents.send(channel,value);};
  let warned=false;
  const voicevox=createVoicevox({dir:path.join(app.getPath('userData'),'voicevox-engine'),onWarn:message=>{if(!warned){warned=true;send('bula:notice',message);}}});
  const mix=createKokoroMix({modelDir:kokoroDir,cacheDir:path.join(root,'.kokoro-mix'),sherpa});
  const voices=createVoices({root,secrets:typeof secrets==='function'?null:secrets,engines:[mix,voicevox]});
  const bindings=()=>{const s=getSettings();return s.characterVoices&&typeof s.characterVoices==='object'?s.characterVoices:(s.characterVoices={});};
  const worn=()=>getRuntime()?.state.modId;
  const summary=p=>({id:p.id,name:p.name,engine:p.engine,license:p.license,cloned:Boolean(p.consent),consent:p.consent?{person:p.consent.person,at:p.consent.at}:null,params:p.engine==='kokoro-mix'||p.engine==='voicevox'?p.params:p.engine==='cosyvoice'?{speed:p.params?.speed||1,quality:p.params?.quality||'fast'}:{speed:p.params?.speed||1},createdAt:p.createdAt});
  async function snapshot(){
    const modId=worn();
    return {profiles:voices.list().map(summary),engines:await voices.engines(),bindings:{...bindings()},bound:boundProfile(bindings(),modId,voices),modId,
      replyLanguage:getSettings().replyLanguage,presets:PRESETS,kokoroVoices:kokoro.VOICES.filter(v=>v.lang==='zh')};
  }
  function bind(profileId,modId=worn()){
    if(profileId!=null&&!voices.get(profileId))throw new Error('找不到這個聲音。');
    const map=bindings();if(profileId)map[modId]=profileId;else delete map[modId];persist();remoteEvent('voices',{});warmBound();return snapshot();
  }
  function remove(id){voices.remove(id);const map=bindings();for(const [mod,pid] of Object.entries(map))if(pid===id)delete map[mod];persist();remoteEvent('voices',{});return snapshot();}
  // a draft from the sliders is checked like a saved profile but not written anywhere
  const draft=data=>({id:'v-draft-0',name:String(data?.name||'試聽').slice(0,40)||'試聽',engine:String(data?.engine||''),params:data?.params||{},files:[],license:{label:'draft',commercial:false,credit:null,tier:'personal'},consent:null,modId:null,createdAt:new Date().toISOString()});
  function preview(data){
    const name=getRuntime()?.snapshot().mod.name||'Annie';
    const engine=data?.profileId?voices.get(data.profileId)?.engine:data?.engine;
    const text=String(data?.text||(engine==='voicevox'?`こんにちは、${name}です！この声、どうかな？`:`嗨，我是 ${name}！這是我的新聲音，喜歡嗎？`)).slice(0,300);
    if(data?.profileId){if(!voices.get(data.profileId))throw new Error('找不到這個聲音。');speech.speak(text,{voiceProfile:data.profileId,volume:true,voiceProvider:'profile'});return true;}
    const d=draft(data);if(!voices.engine(d.engine))throw new Error('不認得這個聲音引擎。');voices.engine(d.engine).validate?.(d.params);
    speech.speak(text,{voiceDraft:d,volume:true,voiceProvider:'profile'});return true;
  }
  async function save(data){
    const engine=String(data?.engine||'');if(!['kokoro-mix','voicevox'].includes(engine))throw new Error('這裡只能新增萌系混音或 VOICEVOX 聲音。');
    const profile=await voices.save({name:data?.name,engine,params:data?.params||{}});
    if(data?.bind)bind(profile.id);remoteEvent('voices',{});return {profile:summary(profile),...await snapshot()};
  }
  handle('bula:voices',snapshot);
  handle('bula:voice-save',save);
  handle('bula:voice-preview',preview);
  handle('bula:voice-bind',id=>bind(id==null?null:String(id)));
  // a voice's speaking speed (and, for cloned CosyVoice voices, fast or best quality), kept in its profile; each engine clamps it
  async function setSpeed(id,speed,quality){const p=voices.get(String(id));if(!p)throw new Error('找不到這個聲音。');const value=Math.max(.7,Math.min(1.5,Number(speed)||p.params?.speed||1));
    const saved=await voices.save({...p,params:{...p.params,speed:Math.round(value*100)/100,...(quality?{quality:quality==='best'?'best':'fast'}:{})}});remoteEvent('voices',{});warmBound();return {id:saved.id,speed:saved.params.speed,quality:saved.params.quality||null};}
  // the worn character's own voice is prepared in the background, so its first sentence doesn't wait for the engine to start
  let warming=null;
  function warmBound(){const id=boundProfile(bindings(),worn(),voices);if(!id||warming===id)return;warming=id;voices.warm(id).catch(()=>{}).finally(()=>{if(warming===id)warming=null;});}
  {let lastMod=null;getRuntime()?.on?.('change',s=>{if(s.modId!==lastMod){lastMod=s.modId;warmBound();}});setTimeout(warmBound,3000).unref?.();}
  handle('bula:voice-speed',(id,speed,quality)=>setSpeed(id,speed,quality));
  handle('bula:voice-remove',id=>remove(String(id)));
  handle('bula:voice-policy',id=>{const p=voices.get(String(id));if(!p)throw new Error('找不到這個聲音。');const file=p.files.includes('policy.md')?path.join(root,p.id,'policy.md'):null;return {license:p.license,policy:file?fs.readFileSync(file,'utf8').slice(0,64*1024):null};});
  handle('bula:voice-export',async id=>{
    const p=voices.get(String(id));if(!p)throw new Error('找不到這個聲音。');const pack=voices.exportPack(p.id);  // a cloned voice is refused here, before any dialog
    const result=await dialog.showSaveDialog(getWin(),{title:'匯出聲音包',defaultPath:path.join(app.getPath('downloads'),`${p.name.replace(/[\\/:*?"<>|]/g,'_')}.voice.zip`),filters:[{name:'聲音包',extensions:['zip']}]});
    if(result.canceled||!result.filePath)return {canceled:true};fs.writeFileSync(result.filePath,pack);return {saved:result.filePath};
  });
  handle('bula:voice-import',async()=>{
    const result=await dialog.showOpenDialog(getWin(),{title:'匯入聲音包',properties:['openFile'],filters:[{name:'聲音包',extensions:['zip']}]});
    if(result.canceled||!result.filePaths?.[0])return {canceled:true};
    const file=result.filePaths[0];if(fs.statSync(file).size>200*1024*1024)throw new Error('聲音包太大。');
    const profile=await voices.importPack(fs.readFileSync(file));remoteEvent('voices',{});return {profile:summary(profile),...await snapshot()};
  });
  handle('bula:voicevox-status',()=>voicevox.status());
  handle('bula:voicevox-speakers',()=>voicevox.speakers());
  handle('bula:voicevox-install',()=>{let last=0;return voicevox.install((p,bytes={})=>{const now=Date.now();if(now-last>=1000||p===1){last=now;send('bula:voicevox-progress',{p,...bytes,at:now});}});});  // once a second, with bytes for speed and time left
  // VOICEVOX speaks Japanese only: the settings panel offers to switch the reply language for the worn character
  handle('bula:voice-japanese',()=>{const s=getSettings();s.replyLanguage='ja';persist();return {replyLanguage:'ja'};});

  const routes={
    'GET /api/voices':async()=>{const s=await snapshot();return {profiles:s.profiles.map(({id,name,engine,license,cloned,params})=>({id,name,engine,license,cloned,params:{speed:params?.speed||1}})),bound:s.bound,modId:s.modId,modName:getRuntime()?.snapshot().mod.name};},
    'POST /api/voices/speed':({body})=>setSpeed(body.id,body.speed,body.quality),
    'POST /api/stop-speech':()=>{speech.stop();return {stopped:true};},
    'POST /api/voices/bind':async({body})=>{await bind(body.id==null?null:String(body.id));return routes['GET /api/voices']();},
    // where: 'phone' returns the audio for the phone to play; 'mac' plays it on the Mac
    'POST /api/voices/preview':async({body})=>{
      const p=voices.get(String(body.id||''));if(!p)throw new Error('找不到這個聲音。');
      const name=getRuntime()?.snapshot().mod.name||'Annie',text=p.engine==='voicevox'?`こんにちは、${name}です！`:`嗨，我是 ${name}！這是我的聲音。`;
      if(body.where==='mac'){speech.speak(text,{voiceProfile:p.id,volume:true,voiceProvider:'profile'});return {played:'mac'};}
      const out=await voices.speak(p.id,text);if(out.audio.length>4*1024*1024)throw new Error('試聽太長了。');
      return {played:'phone',mime:out.mime,audio:out.audio.toString('base64')};
    },
    // 錄音做聲音 (voice-lab.cjs): reading prompts and which engines are ready, then one recording — a WAV the phone
    // built from its MediaRecorder take — with the same consent step → a CosyVoice or ElevenLabs voice
    'GET /api/voices/record':async()=>{const l=needLab();return {prompts:require('./voice-lab.cjs').PROMPTS.short,engines:{cosyvoice:await voices.engine('cosyvoice').available(),elevenlabs:await voices.engine('elevenlabs').available()},modName:getRuntime()?.snapshot().mod.name,ready:Boolean(l)};},
    'POST /api/voices/record':{limit:16e6,fn:async({body})=>{
      const result=await needLab().fromPhone({wav:body.audio,engine:String(body.engine||''),name:String(body.name||'').slice(0,40)||'我的聲音',transcript:String(body.transcript||'').slice(0,300),lang:String(body.lang||''),consent:body.consent,bind:body.bind===true});
      if(!result.ok)return result;remoteEvent('voices',{});return {ok:true,profile:summary(result.profile),bound:result.bound,quality:result.quality};
    }}
  };
  let lab=null;const needLab=()=>lab||(()=>{throw new Error('這版 App 還沒有錄音複製。');})();
  return {voices,voicevox,mix,routes,snapshot,bind,attachLab:value=>{lab=value;},stop:()=>voicevox.stop(),warnLanguage:text=>!isJapanese(text)};
}
module.exports={createVoiceService};
