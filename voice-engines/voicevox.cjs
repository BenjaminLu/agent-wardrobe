// VOICEVOX characters (Japanese only) through a local VOICEVOX ENGINE: /audio_query + /synthesis, /speakers, /speaker_info.
// Uses an engine that is already running (the VOICEVOX app starts one on 50021), the engine inside VOICEVOX.app, or the official
// VOICEVOX ENGINE build downloaded once into userData (pinned version, size and SHA-256 checked) and run as a child process.
// Every character has its own terms; the credit ("VOICEVOX:ずんだもん") and the policy text are kept with the profile.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {spawn,spawnSync}=require('node:child_process');

const VERSION='0.25.2';
// Official release assets: .vvpp is a zip of the engine; sizes and digests from the GitHub release.
const RELEASES={
  arm64:{file:`voicevox_engine-macos-arm64-${VERSION}.vvpp`,size:1887128088,sha256:'1ba776700d2afa81382573de52961ebaa33ee26c2aedc8d3ed78782a4e1538fb'},
  x64:{file:`voicevox_engine-macos-x64-${VERSION}.vvpp`,size:1890344527,sha256:'88cabb15d183bf163df37507e70e88acb897de6f5ad0e14ea6cc5f0ce7b3096b'}
};
const releaseUrl=file=>`https://github.com/VOICEVOX/voicevox_engine/releases/download/${VERSION}/${file}`;
const APP_ENGINE='/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run';
const OWN_PORT=50121;
const UUID=/^[0-9a-f-]{8,64}$/i;

function validate(params){
  if(!Number.isInteger(params?.styleId)||params.styleId<0||params.styleId>1e6)throw new Error('VOICEVOX 的聲音風格不合法。');
  if(typeof params.speakerUuid!=='string'||!UUID.test(params.speakerUuid))throw new Error('VOICEVOX 角色 ID 不合法。');
  for(const k of ['speakerName','styleName'])if(typeof params[k]!=='string'||!params[k].trim()||params[k].length>60||/[\x00-\x1f]/.test(params[k]))throw new Error('VOICEVOX 角色名稱不合法。');
  for(const [k,lo,hi] of [['speed',.5,2],['pitch',-.15,.15],['intonation',0,2]])if(params[k]!=null&&!(Number.isFinite(params[k])&&params[k]>=lo&&params[k]<=hi))throw new Error(`VOICEVOX 的 ${k} 超出範圍。`);
}
const credit=name=>`VOICEVOX:${name}`;
// Japanese text has kana; a reply without any is probably not Japanese, and VOICEVOX would read it oddly.
const isJapanese=text=>/[぀-ヿ]/.test(String(text));

function client(base,{fetchImpl=fetch}={}){
  const call=async(pathname,{method='GET',body,signal,timeout=30000,binary=false}={})=>{
    let res;try{res=await fetchImpl(`${base()}${pathname}`,{method,signal:signal||AbortSignal.timeout(timeout),redirect:'error',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}
    catch(error){if(error.name==='AbortError'&&signal?.aborted)throw error;throw new Error('連不到 VOICEVOX ENGINE。');}
    if(!res.ok)throw new Error(`VOICEVOX ENGINE 回應錯誤（${res.status}）。`);
    return binary?Buffer.from(await res.arrayBuffer()):res.json();
  };
  return {
    version:()=>call('/version',{timeout:1500}),
    speakers:async()=>(await call('/speakers')).map(s=>({name:String(s.name),uuid:String(s.speaker_uuid),styles:(s.styles||[]).filter(t=>!t.type||t.type==='talk').map(t=>({id:t.id,name:String(t.name)}))})),
    // portraits are left out (resource_format=url); only the policy text is kept
    policy:async uuid=>{if(!UUID.test(uuid))throw new Error('VOICEVOX 角色 ID 不合法。');return String((await call(`/speaker_info?speaker_uuid=${encodeURIComponent(uuid)}&resource_format=url`)).policy||'').slice(0,64*1024);},
    async synthesize(text,{styleId,speed=1,pitch=0,intonation=1},signal){
      const query=await call(`/audio_query?text=${encodeURIComponent(String(text).slice(0,1000))}&speaker=${styleId}`,{method:'POST',signal});
      Object.assign(query,{speedScale:speed,pitchScale:pitch,intonationScale:intonation});
      return call(`/synthesis?speaker=${styleId}`,{method:'POST',body:query,signal,timeout:60000,binary:true});
    }
  };
}

function createVoicevox({dir,fetchImpl=fetch,spawnImpl=spawn,appEngine=APP_ENGINE,external='http://127.0.0.1:50021',ownPort=OWN_PORT,arch=process.arch,releases=RELEASES,urlFor=releaseUrl,onWarn=()=>{}}={}){
  let child=null,base=external,starting=null,installing=null;
  const api=client(()=>base,{fetchImpl});
  const installed=()=>{try{return fs.readFileSync(path.join(dir,'.complete'),'utf8').trim()===VERSION&&fs.existsSync(runFile());}catch{return false;}};
  function runFile(){try{const manifest=JSON.parse(fs.readFileSync(path.join(dir,'engine','engine_manifest.json'),'utf8'));const rel=String(manifest.command||'run');if(/^[A-Za-z0-9._-]+$/.test(rel))return path.join(dir,'engine',rel);}catch{}return path.join(dir,'engine','run');}
  async function alive(url){try{const res=await fetchImpl(`${url}/version`,{signal:AbortSignal.timeout(1500)});return res.ok;}catch{return false;}}
  async function find(){
    if(child&&await alive(base))return base;
    if(await alive(external)){base=external;return base;}
    const own=`http://127.0.0.1:${ownPort}`;if(await alive(own)){base=own;return base;}
    return null;
  }
  const executable=()=>installed()?runFile():fs.existsSync(appEngine)?appEngine:null;
  // Starts the engine as our child on its own port; stop() ends it (also on quit).
  function start(){
    return starting||=(async()=>{
      if(await find())return base;
      const run=executable();if(!run)throw new Error('還沒有 VOICEVOX ENGINE。到 AI 設定 → 聲音 → 新增聲音 → VOICEVOX 角色 下載。');
      base=`http://127.0.0.1:${ownPort}`;
      child=spawnImpl(run,['--host','127.0.0.1','--port',String(ownPort)],{cwd:path.dirname(run),stdio:'ignore',detached:false});
      let exited=false;child.on('exit',()=>{exited=true;child=null;});child.on('error',()=>{exited=true;child=null;});
      const until=Date.now()+90000;while(!await alive(base)){if(exited)throw new Error('VOICEVOX ENGINE 沒有啟動成功。');if(Date.now()>until){stop();throw new Error('VOICEVOX ENGINE 啟動逾時。');}await new Promise(r=>setTimeout(r,300));}
      return base;
    })().finally(()=>{starting=null;});
  }
  function stop(){if(child){try{child.kill();}catch{}child=null;}}
  async function status(){
    const running=await find();
    return {running:Boolean(running),own:Boolean(child),installed:installed(),app:fs.existsSync(appEngine),version:VERSION,download:releases[arch]?{size:releases[arch].size,file:releases[arch].file}:null,downloading:Boolean(installing)};
  }
  // Downloads the pinned engine build, checks its size and SHA-256 while streaming, unpacks it with ditto, and swaps it in.
  function install(onProgress=()=>{},{signal}={}){
    return installing||=(async()=>{
      const release=releases[arch];if(!release)throw new Error('這台 Mac 的處理器沒有對應的 VOICEVOX ENGINE。');
      // an interrupted download is kept and resumed with a Range request (the hash is rebuilt from the part already on disk)
      const temp=`${dir}.partial`,archive=path.join(temp,release.file);fs.mkdirSync(temp,{recursive:true});fs.rmSync(path.join(temp,'engine'),{recursive:true,force:true});
      for(const name of fs.readdirSync(temp))if(name!==release.file)fs.rmSync(path.join(temp,name),{recursive:true,force:true});
      try{
        const hash=crypto.createHash('sha256');let have=fs.existsSync(archive)?fs.statSync(archive).size:0;if(have>release.size){fs.rmSync(archive);have=0;}
        if(have)for await(const chunk of fs.createReadStream(archive))hash.update(chunk);
        let done=have;const report=()=>onProgress(Math.min(.99,done/release.size),{done,total:release.size});report();
        if(have<release.size){
          const res=await fetchImpl(urlFor(release.file),{signal,redirect:'follow',headers:have?{Range:`bytes=${have}-`}:{}});
          if(!res.ok)throw new Error(`VOICEVOX ENGINE 下載失敗（${res.status}）。`);
          if(have&&res.status!==206){hash.destroy?.();throw new Error('伺服器不支援續傳，請重新下載。');}
          const out=fs.createWriteStream(archive,{flags:have?'a':'w'});
          // the file is closed (and what arrived is on disk) even when the connection drops
          try{for await(const chunk of res.body){hash.update(chunk);done+=chunk.length;if(done>release.size)throw new Error('VOICEVOX ENGINE 下載的檔案大小不對。');if(!out.write(chunk))await new Promise(r=>out.once('drain',r));report();}}
          finally{await new Promise((resolve,reject)=>out.end(error=>error?reject(error):resolve()));}
        }
        if(done!==release.size||hash.digest('hex')!==release.sha256){fs.rmSync(archive,{force:true});throw new Error('VOICEVOX ENGINE 沒有通過完整性檢查，請重新下載。');}
        const unpack=spawnSync('/usr/bin/ditto',['-x','-k',archive,path.join(temp,'engine')],{encoding:'utf8',timeout:20*60000});
        if(unpack.status!==0)throw new Error(`VOICEVOX ENGINE 解不開：${String(unpack.stderr).trim().slice(0,120)}`);
        fs.rmSync(archive,{force:true});
        // no links pointing outside the engine folder
        const root=path.join(temp,'engine');for(const entry of fs.readdirSync(root,{recursive:true})){const full=path.join(root,entry);const st=fs.lstatSync(full);if(st.isSymbolicLink()){const target=path.resolve(path.dirname(full),fs.readlinkSync(full));if(!target.startsWith(root+path.sep))fs.rmSync(full);}}
        fs.writeFileSync(path.join(temp,'.complete'),VERSION);stop();fs.rmSync(dir,{recursive:true,force:true});fs.renameSync(temp,dir);
        const run=runFile();if(!fs.existsSync(run))throw new Error('VOICEVOX ENGINE 的內容不完整。');fs.chmodSync(run,0o755);
        onProgress(1,{done:release.size,total:release.size});return status();
      }catch(error){fs.rmSync(path.join(temp,'engine'),{recursive:true,force:true});throw error;}  // the downloaded part stays for a resume
    })().finally(()=>{installing=null;});
  }
  return {
    id:'voicevox',label:'VOICEVOX 角色（日文）',
    async available(){if(await find()||executable())return {ok:true};return {ok:false,reason:`需要 VOICEVOX ENGINE ${VERSION}（約 ${Math.round((releases[arch]?.size||0)/1e8)/10} GB）。`,install:true};},
    install,start,stop,status,validate,
    speakers:async()=>{await start();return api.speakers();},
    async profile(params){
      validate(params);await start();const policy=await api.policy(params.speakerUuid).catch(()=>'');
      return {license:{label:`VOICEVOX:${params.speakerName}（依角色利用規約，使用時須標示）`,commercial:false,credit:credit(params.speakerName),tier:'rules'},files:policy?{'policy.md':Buffer.from(policy)}:{}};
    },
    async speak({text,profile,signal}){
      validate(profile.params);if(!isJapanese(text))onWarn('VOICEVOX 只會說日文；現在的回覆不是日文，聽起來會怪怪的。可以把「AI 回覆語言」改成日本語。');
      await start();return {audio:await api.synthesize(text,profile.params,signal),mime:'audio/wav'};
    },
    get base(){return base;},get child(){return child;}
  };
}
module.exports={createVoicevox,client,validate,credit,isJapanese,VERSION,RELEASES,releaseUrl,OWN_PORT};
