// VOICEVOX characters (Japanese only) through a local VOICEVOX ENGINE: /audio_query + /synthesis, /speakers, /speaker_info.
const {renameRetry}=require('../src/main/platform.cjs');
// Uses an engine that is already running (the VOICEVOX app starts one on 50021), the engine inside VOICEVOX.app, or the official
// VOICEVOX ENGINE build downloaded once into userData (pinned version, size and SHA-256 checked) and run as a child process.
// Every character has its own terms; the credit ("VOICEVOX:ずんだもん") and the policy text are kept with the profile.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {spawn,spawnSync}=require('node:child_process');
const L=require('../src/main/locales.cjs');const {t}=L;const {detectGpu}=require('./python-env.cjs');

const VERSION='0.25.2';
// Official release assets: .vvpp is a zip of the engine; sizes and digests from the GitHub release. The NVIDIA builds are one
// zip split in two (.001.vvppp + .002.vvppp, byte-concatenated) and run with --use_gpu. Keys: macOS by arch (as before),
// others '<platform>-<arch>' plus '-nvidia' when nvidia-smi finds a GPU.
const vv=(name,size,sha256)=>({file:`voicevox_engine-${name}-${VERSION}.vvpp`,size,sha256});
const split=(name,a,b)=>({file:`voicevox_engine-${name}-${VERSION}.vvpp`,parts:[{file:`voicevox_engine-${name}-${VERSION}.001.vvppp`,size:a[0],sha256:a[1]},{file:`voicevox_engine-${name}-${VERSION}.002.vvppp`,size:b[0],sha256:b[1]}],size:a[0]+b[0],args:['--use_gpu']});
const RELEASES={
  arm64:vv('macos-arm64',1887128088,'1ba776700d2afa81382573de52961ebaa33ee26c2aedc8d3ed78782a4e1538fb'),
  x64:vv('macos-x64',1890344527,'88cabb15d183bf163df37507e70e88acb897de6f5ad0e14ea6cc5f0ce7b3096b'),
  'win32-x64':vv('windows-cpu',1894411533,'cae07cb718866708d8c6148988769966168a2282610f53f002b19778ebea38e9'),
  'win32-x64-nvidia':split('windows-nvidia',[1992294400,'b2da8200aa325af1b809471586a9967de51941eb01d18d591bb5f6b041c9ccdb'],[1069812097,'b016d55560ba1bef9192f7e16f40177b3d67173614fa80b651d42bd5c9534eb1']),
  'linux-x64':vv('linux-cpu-x64',1911613161,'024ce70140d2028638a00014c037b97b82f83f4efd8442cc421bd555e2f122e6'),
  'linux-arm64':vv('linux-cpu-arm64',1907271021,'d22f92195baa802d457ecc50287371e87cb590ab90a99fbfeb97f4d0eb968519'),
  'linux-x64-nvidia':split('linux-nvidia',[1992294400,'8fb22a6e49f990daed4f0c894761145e55d8a4ee1a127228db20aa77b8186f74'],[1071615559,'5cc012c78317d495bb56d9152bacd418cb66b0fa8e658922e150935053194b9c'])
};
function releaseKey({platform=process.platform,arch=process.arch,gpu=detectGpu({platform})}={}){if(platform==='darwin')return arch;const key=`${platform}-${arch}`;return gpu&&RELEASES[`${key}-nvidia`]?`${key}-nvidia`:key;}
const releaseUrl=file=>`https://github.com/VOICEVOX/voicevox_engine/releases/download/${VERSION}/${file}`;
// the engine inside an installed VOICEVOX app
const APP_ENGINE=process.platform==='win32'?path.join(process.env.LOCALAPPDATA||'','Programs','VOICEVOX','vv-engine','run.exe'):'/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run';
const OWN_PORT=50121;
const UUID=/^[0-9a-f-]{8,64}$/i;

function validate(params){
  if(!Number.isInteger(params?.styleId)||params.styleId<0||params.styleId>1e6)throw L.error('voiceEngines.voicevox.badStyle');
  if(typeof params.speakerUuid!=='string'||!UUID.test(params.speakerUuid))throw L.error('voiceEngines.voicevox.badId');
  for(const k of ['speakerName','styleName'])if(typeof params[k]!=='string'||!params[k].trim()||params[k].length>60||/[\x00-\x1f]/.test(params[k]))throw L.error('voiceEngines.voicevox.badName');
  for(const [k,lo,hi] of [['speed',.5,2],['pitch',-.15,.15],['intonation',0,2]])if(params[k]!=null&&!(Number.isFinite(params[k])&&params[k]>=lo&&params[k]<=hi))throw L.error('voiceEngines.voicevox.range',{name:k});
}
const credit=name=>`VOICEVOX:${name}`;
// Japanese text has kana; a reply without any is probably not Japanese, and VOICEVOX would read it oddly.
const isJapanese=text=>/[぀-ヿ]/.test(String(text));

function client(base,{fetchImpl=fetch}={}){
  const call=async(pathname,{method='GET',body,signal,timeout=30000,binary=false}={})=>{
    let res;try{res=await fetchImpl(`${base()}${pathname}`,{method,signal:signal||AbortSignal.timeout(timeout),redirect:'error',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}
    catch(error){if(error.name==='AbortError'&&signal?.aborted)throw error;throw L.error('voiceEngines.voicevox.offline');}
    if(!res.ok)throw L.error('voiceEngines.voicevox.httpError',{status:res.status});
    return binary?Buffer.from(await res.arrayBuffer()):res.json();
  };
  return {
    version:()=>call('/version',{timeout:1500}),
    speakers:async()=>(await call('/speakers')).map(s=>({name:String(s.name),uuid:String(s.speaker_uuid),styles:(s.styles||[]).filter(t=>!t.type||t.type==='talk').map(t=>({id:t.id,name:String(t.name)}))})),
    // portraits are left out (resource_format=url); only the policy text is kept
    policy:async uuid=>{if(!UUID.test(uuid))throw L.error('voiceEngines.voicevox.badId');return String((await call(`/speaker_info?speaker_uuid=${encodeURIComponent(uuid)}&resource_format=url`)).policy||'').slice(0,64*1024);},
    async synthesize(text,{styleId,speed=1,pitch=0,intonation=1},signal){
      const query=await call(`/audio_query?text=${encodeURIComponent(String(text).slice(0,1000))}&speaker=${styleId}`,{method:'POST',signal});
      Object.assign(query,{speedScale:speed,pitchScale:pitch,intonationScale:intonation});
      return call(`/synthesis?speaker=${styleId}`,{method:'POST',body:query,signal,timeout:60000,binary:true});
    }
  };
}

function createVoicevox({dir,fetchImpl=fetch,spawnImpl=spawn,appEngine=APP_ENGINE,external='http://127.0.0.1:50021',ownPort=OWN_PORT,arch=process.arch,key=null,releases=RELEASES,urlFor=releaseUrl,onWarn=()=>{}}={}){
  let child=null,base=external,starting=null,installing=null;
  const pick=()=>releases[key||releaseKey({arch})]||releases[arch]||null;
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
      const run=executable();if(!run)throw L.error('voiceEngines.voicevox.missing');
      base=`http://127.0.0.1:${ownPort}`;
      const gpu=installed()&&run===runFile()&&fs.existsSync(path.join(dir,'.gpu'));
      child=spawnImpl(run,['--host','127.0.0.1','--port',String(ownPort),...(gpu?['--use_gpu']:[])],{cwd:path.dirname(run),stdio:'ignore',detached:false,windowsHide:true});
      let exited=false;child.on('exit',()=>{exited=true;child=null;});child.on('error',()=>{exited=true;child=null;});
      const until=Date.now()+90000;while(!await alive(base)){if(exited)throw L.error('voiceEngines.voicevox.startFailed');if(Date.now()>until){stop();throw L.error('voiceEngines.voicevox.startTimeout');}await new Promise(r=>setTimeout(r,300));}
      return base;
    })().finally(()=>{starting=null;});
  }
  function stop(){if(child){try{child.kill();}catch{}child=null;}}
  async function status(){
    const running=await find();
    return {running:Boolean(running),own:Boolean(child),installed:installed(),app:fs.existsSync(appEngine),version:VERSION,download:pick()?{size:pick().size,file:pick().file}:null,downloading:Boolean(installing)};
  }
  // Downloads the pinned engine build (each part checked for size and SHA-256 while streaming), unpacks it (ditto on macOS,
  // the app's own ZIP64-capable reader elsewhere), and swaps it in.
  function install(onProgress=()=>{},{signal}={}){
    return installing||=(async()=>{
      const release=pick();if(!release)throw L.error('voiceEngines.voicevox.noRelease');
      const parts=release.parts||[release];
      // an interrupted download is kept and resumed with a Range request (the hash is rebuilt from the part already on disk)
      const temp=`${dir}.partial`;fs.mkdirSync(temp,{recursive:true});fs.rmSync(path.join(temp,'engine'),{recursive:true,force:true});
      for(const name of fs.readdirSync(temp))if(!parts.some(p=>p.file===name))fs.rmSync(path.join(temp,name),{recursive:true,force:true});
      try{
        let before=0;
        for(const part of parts){
          const file=path.join(temp,part.file);
          const hash=crypto.createHash('sha256');let have=fs.existsSync(file)?fs.statSync(file).size:0;if(have>part.size){fs.rmSync(file);have=0;}
          if(have)for await(const chunk of fs.createReadStream(file))hash.update(chunk);
          let done=have;const report=()=>onProgress(Math.min(.99,(before+done)/release.size),{done:before+done,total:release.size});report();
          if(have<part.size){
            const res=await fetchImpl(urlFor(part.file),{signal,redirect:'follow',headers:have?{Range:`bytes=${have}-`}:{}});
            if(!res.ok)throw L.error('voiceEngines.voicevox.downloadFailed',{status:res.status});
            if(have&&res.status!==206){hash.destroy?.();throw L.error('voiceEngines.voicevox.noResume');}
            const out=fs.createWriteStream(file,{flags:have?'a':'w'});
            // the file is closed (and what arrived is on disk) even when the connection drops
            try{for await(const chunk of res.body){hash.update(chunk);done+=chunk.length;if(done>part.size)throw L.error('voiceEngines.voicevox.size');if(!out.write(chunk))await new Promise(r=>out.once('drain',r));report();}}
            finally{await new Promise((resolve,reject)=>out.end(error=>error?reject(error):resolve()));}
          }
          if(done!==part.size||hash.digest('hex')!==part.sha256){fs.rmSync(file,{force:true});throw L.error('voiceEngines.voicevox.hash');}
          before+=part.size;
        }
        // split builds: the parts are one zip, joined byte for byte
        const archive=path.join(temp,parts.length>1?release.file:parts[0].file);
        if(parts.length>1){fs.rmSync(archive,{force:true});for(const part of parts){await require('node:stream/promises').pipeline(fs.createReadStream(path.join(temp,part.file)),fs.createWriteStream(archive,{flags:'a'}));fs.rmSync(path.join(temp,part.file));}}
        if(process.platform==='darwin'){
          const unpack=spawnSync('/usr/bin/ditto',['-x','-k',archive,path.join(temp,'engine')],{encoding:'utf8',timeout:20*60000});
          if(unpack.status!==0)throw L.error('voiceEngines.voicevox.unpack',{error:String(unpack.stderr).trim().slice(0,120)});
        }else{
          try{await require('../src/main/archive.cjs').unzipLarge(archive,path.join(temp,'engine'),{links:true});}
          catch(error){throw L.error('voiceEngines.voicevox.unpack',{error:error.message.slice(0,120)});}
        }
        fs.rmSync(archive,{force:true});if(release.args?.includes('--use_gpu'))fs.writeFileSync(path.join(temp,'.gpu'),'nvidia');
        // no links pointing outside the engine folder
        const root=path.join(temp,'engine');for(const entry of fs.readdirSync(root,{recursive:true})){const full=path.join(root,entry);const st=fs.lstatSync(full);if(st.isSymbolicLink()){const target=path.resolve(path.dirname(full),fs.readlinkSync(full));if(!target.startsWith(root+path.sep))fs.rmSync(full);}}
        fs.writeFileSync(path.join(temp,'.complete'),VERSION);stop();fs.rmSync(dir,{recursive:true,force:true});renameRetry(temp,dir);
        const run=runFile();if(!fs.existsSync(run))throw L.error('voiceEngines.voicevox.incomplete');fs.chmodSync(run,0o755);
        onProgress(1,{done:release.size,total:release.size});return status();
      }catch(error){fs.rmSync(path.join(temp,'engine'),{recursive:true,force:true});throw error;}  // the downloaded part stays for a resume
    })().finally(()=>{installing=null;});
  }
  return {
    id:'voicevox',get label(){return t('voiceEngines.voicevox.label');},
    async available(){if(await find()||executable())return {ok:true};return {ok:false,reason:t('voiceEngines.voicevox.need',{version:VERSION,size:Math.round((pick()?.size||0)/1e8)/10}),install:true};},
    install,start,stop,status,validate,
    speakers:async()=>{await start();return api.speakers();},
    async profile(params){
      validate(params);await start();const policy=await api.policy(params.speakerUuid).catch(()=>'');
      return {license:{label:t('voiceEngines.voicevox.license',{credit:credit(params.speakerName)}),commercial:false,credit:credit(params.speakerName),tier:'rules'},files:policy?{'policy.md':Buffer.from(policy)}:{}};
    },
    async speak({text,profile,signal}){
      validate(profile.params);if(!isJapanese(text))onWarn(t('voiceEngines.voicevox.japaneseOnly'));
      await start();return {audio:await api.synthesize(text,profile.params,signal),mime:'audio/wav'};
    },
    get base(){return base;},get child(){return child;}
  };
}
module.exports={releaseKey,createVoicevox,client,validate,credit,isJapanese,VERSION,RELEASES,releaseUrl,OWN_PORT};
