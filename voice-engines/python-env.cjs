// Shared installer for the local voice engines that run as Python sidecars (CosyVoice, GPT-SoVITS).
const {renameRetry}=require('../platform.cjs');
// Everything lives in one folder under userData: a pinned uv, a Python venv with pinned packages, the engine's
// source at a pinned commit, and model files from a pinned Hugging Face revision (ModelScope as a fallback).
// Model files are hash-checked against the LFS sha256 Hugging Face publishes; downloads resume after an interruption.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {spawn,execFileSync}=require('node:child_process');
const {which,killTree,tarCommand,venvPython}=require('../platform.cjs');
const L=require('../locales.cjs');const {t}=L;

// uv 0.12.23 per platform (GitHub release assets and their SHA-256). Tarballs hold uv-<target>/uv; the Windows zips hold uv.exe at the top.
const uvAsset=(target,sha256)=>({version:'0.12.23',url:`https://github.com/astral-sh/uv/releases/download/0.12.23/uv-${target}.${target.includes('windows')?'zip':'tar.gz'}`,sha256});
const UVS={'darwin-arm64':uvAsset('aarch64-apple-darwin','50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544'),'darwin-x64':uvAsset('x86_64-apple-darwin','960da44cb4b73685206ddd250b19e0a117fa41095710c1038f081f5cb613efb4'),
  'win32-x64':uvAsset('x86_64-pc-windows-msvc','75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90'),'win32-arm64':uvAsset('aarch64-pc-windows-msvc','13294e232ececbe709c06b74e6ced06f2a225ea5591476685362f22be56a50d5'),
  'linux-x64':uvAsset('x86_64-unknown-linux-gnu','9167d72b3319674b6303c4cbe071854bba13ebdf3d76b1a7cbdc175471fb66d6'),'linux-arm64':uvAsset('aarch64-unknown-linux-gnu','6524bd338177ed50d035d39354e12545e993bbeba2ecbddf0480c5b3a81d313f')};
const UV=UVS[`${process.platform}-${process.arch}`]||null;
const aborted=()=>L.error('voiceEngines.cancelled',null,{name:'AbortError'});

// Runs a command; stdout/stderr lines go to onLine. Aborting kills the whole process group.
function run(cmd,args,{cwd,env,signal,onLine=()=>{},timeout=0}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(aborted());return;}
    // its own process group on macOS / Linux so cancelling ends the children too; on Windows taskkill /T does that
    const child=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
    let tail='';const take=chunk=>{const text=String(chunk);tail=(tail+text).slice(-4000);for(const line of text.split(/\r?\n|\r/))if(line.trim())onLine(line);};
    child.stdout.on('data',take);child.stderr.on('data',take);
    const kill=()=>{killTree(child,'SIGTERM');if(process.platform!=='win32')setTimeout(()=>killTree(child,'SIGKILL'),3000).unref();};
    const onAbort=()=>kill();signal?.addEventListener('abort',onAbort,{once:true});
    const timer=timeout?setTimeout(kill,timeout):null;
    child.on('error',error=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);reject(error);});
    child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
      if(signal?.aborted)reject(aborted());else if(code===0)resolve(tail);else reject(L.error('voiceEngines.install.commandFailed',{command:path.basename(cmd),code,log:tail.trim().split('\n').slice(-3).join(' ').slice(0,400)},{code,tail}));});
  });
}

async function sha256(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}

// Streams a URL into a file, resuming a partial download with a Range request.
async function fetchToFile(url,target,{fetchImpl=fetch,signal,size=0,onBytes=()=>{}}={}){
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const partial=`${target}.part`;let have=fs.existsSync(partial)?fs.statSync(partial).size:0;
  if(size&&have>size){fs.rmSync(partial);have=0;}
  const response=await fetchImpl(url,{signal,redirect:'follow',headers:have?{Range:`bytes=${have}-`}:{}});
  if(!response.ok&&response.status!==206)throw L.error('voiceEngines.install.downloadFailed',{status:response.status,file:path.basename(target)},{status:response.status});
  if(have&&response.status!==206)have=0;  // the server ignored Range: start again
  onBytes(have);
  const out=fs.createWriteStream(partial,{flags:have?'a':'w',mode:0o600});
  try{for await(const chunk of response.body){if(signal?.aborted)throw aborted();if(!out.write(chunk))await new Promise(r=>out.once('drain',r));onBytes(chunk.length);}}
  finally{await new Promise(r=>out.end(r));}
  if(size&&fs.statSync(partial).size!==size)throw L.error('voiceEngines.install.incomplete',{file:path.basename(target)});
  renameRetry(partial,target);
}

// uv already installed (Homebrew, the official installer, winget, PATH) or a pinned, hash-checked copy downloaded into the engines folder.
function findUv(){
  if(process.platform==='darwin')for(const candidate of ['/opt/homebrew/bin/uv','/usr/local/bin/uv',path.join(process.env.HOME||'','.local','bin','uv'),path.join(process.env.HOME||'','.cargo','bin','uv')])if(fs.existsSync(candidate))return candidate;
  return which('uv');
}
async function ensureUv(dir,{fetchImpl=fetch,signal,uv=UV}={}){
  const found=findUv();if(found)return found;
  const bin=path.join(dir,'uv',process.platform==='win32'?'uv.exe':'uv');if(fs.existsSync(bin))return bin;
  if(!uv)throw L.error('voiceEngines.install.needUv');
  const archive=path.join(dir,uv.url.endsWith('.zip')?'uv.zip':'uv.tar.gz');await fetchToFile(uv.url,archive,{fetchImpl,signal});
  if(await sha256(archive)!==uv.sha256){fs.rmSync(archive,{force:true});throw L.error('voiceEngines.install.uvHash');}
  fs.mkdirSync(path.dirname(bin),{recursive:true});
  if(uv.url.endsWith('.zip'))await require('../archive.cjs').unzipLarge(archive,path.dirname(bin));  // Windows: uv.exe at the top of the zip
  else execFileSync(tarCommand(),['-xzf',archive,'-C',path.dirname(bin),'--strip-components=1']);
  fs.rmSync(archive,{force:true});
  return bin;
}

// A GitHub source tarball at a pinned commit, unpacked into dest (replacing it).
async function fetchSource({url,dest,fetchImpl=fetch,signal}){
  const archive=`${dest}.tar.gz`;await fetchToFile(url,archive,{fetchImpl,signal});
  const temp=`${dest}.unpack`;fs.rmSync(temp,{recursive:true,force:true});fs.mkdirSync(temp,{recursive:true});
  execFileSync(tarCommand(),['-xzf',archive,'-C',temp,'--strip-components=1','--no-same-owner'],{windowsHide:true});
  fs.rmSync(dest,{recursive:true,force:true});renameRetry(temp,dest);fs.rmSync(archive,{force:true});
}

// Lists a pinned Hugging Face revision (sizes and LFS hashes) and downloads the files `include` accepts.
// Files are fetched from Hugging Face first, then from the mirrors (e.g. ModelScope) when a source fails.
async function fetchModel({repo,revision,dir,include=()=>true,mirrors=[],fetchImpl=fetch,signal,onProgress=()=>{},listUrl}){
  const response=await fetchImpl(listUrl||`https://huggingface.co/api/models/${repo}/revision/${revision}?blobs=true`,{signal});
  if(!response.ok)throw L.error('voiceEngines.install.modelList',{status:response.status});
  const files=(await response.json()).siblings.map(f=>({name:f.rfilename,size:f.size||f.lfs?.size||0,sha256:f.lfs?.sha256||null}))
    .filter(f=>include(f.name)&&!/(^|\/)\.\.(\/|$)|^\/|\\/.test(f.name));
  const total=files.reduce((n,f)=>n+f.size,0)||1;let done=0;const tick=n=>{done+=n;onProgress(Math.min(1,done/total),done,total);};
  for(const file of files){
    const target=path.join(dir,file.name);if(!path.resolve(target).startsWith(path.resolve(dir)+path.sep))throw new Error('Unsafe model path');
    if(fs.existsSync(target)&&fs.statSync(target).size===file.size){tick(file.size);continue;}
    const sources=[`https://huggingface.co/${repo}/resolve/${revision}/${file.name.split('/').map(encodeURIComponent).join('/')}`,...mirrors.map(m=>m(file.name))];
    let lastError;
    for(const url of sources){
      const before=done;
      try{await fetchToFile(url,target,{fetchImpl,signal,size:file.size,onBytes:tick});lastError=null;break;}
      catch(error){if(signal?.aborted)throw aborted();lastError=error;done=before;}
    }
    if(lastError)throw lastError;
    if(file.sha256&&await sha256(target)!==file.sha256){fs.rmSync(target,{force:true});throw L.error('voiceEngines.install.hash',{file:file.name});}
  }
  return {files:files.length,bytes:total};
}

function folderSize(dir){let n=0;const walk=d=>{let list=[];try{list=fs.readdirSync(d,{withFileTypes:true});}catch{return;}for(const e of list){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(e.isFile())n+=fs.statSync(f).size;}};walk(dir);return n;}

// An engine's environment: {dir, python version, packages, source, models}. install() reports
// {stage, progress (0–1 overall), detail} and can be cancelled; a finished install writes .complete with its spec hash.
// NVIDIA GPU on Windows / Linux, from nvidia-smi: {name, memoryMb, driver} or null. macOS never has one (Apple Silicon: CPU).
let gpuCache;
function detectGpu({platform=process.platform,exec=execFileSync}={}){
  if(platform==='darwin')return null;
  if(gpuCache!==undefined&&exec===execFileSync)return gpuCache;
  let found=null;
  try{const line=String(exec('nvidia-smi',['--query-gpu=name,memory.total,driver_version','--format=csv,noheader,nounits'],{encoding:'utf8',timeout:5000,windowsHide:true})).trim().split(/\r?\n/)[0];
    const [name,memory,driver]=line.split(',').map(v=>v.trim());if(name&&Number(memory)>0)found={name,memoryMb:Number(memory),driver};}catch{}
  if(exec===execFileSync)gpuCache=found;return found;
}
// Which PyTorch wheel index to install torch from: CUDA builds when there is an NVIDIA GPU (a driver older than 525
// cannot run CUDA 12, so it gets the CUDA 11.8 build), CPU-only builds otherwise (Linux's default wheels would pull
// ~3 GB of CUDA libraries for nothing). macOS: null, the default wheels (unchanged).
function torchIndex({cuda='cu121',platform=process.platform,gpu=detectGpu({platform})}={}){
  if(platform==='darwin')return null;
  if(!gpu)return 'https://download.pytorch.org/whl/cpu';
  return `https://download.pytorch.org/whl/${parseInt(gpu.driver,10)<525?'cu118':cuda}`;
}
function createPythonEnv({dir,python='3.10',packages=[],buildConstraints=[],source=null,models=[],files=[],fetchImpl=fetch,uvPath=null,torchFrom=null}){
  // torchFrom only enters the spec when set, so an existing macOS install keeps its marker
  const spec=crypto.createHash('sha256').update(JSON.stringify({python,packages,source,buildConstraints,models:models.map(m=>[m.repo,m.revision]),files:files.map(f=>f.sha256),...(torchFrom?{torchFrom}:{})})).digest('hex').slice(0,16);
  const venv=path.join(dir,'venv'),pythonBin=venvPython(venv),srcDir=path.join(dir,'src'),modelsDir=path.join(dir,'models');
  const marker=path.join(dir,`.complete-${spec}`);
  const installed=()=>fs.existsSync(marker)&&fs.existsSync(pythonBin);
  async function install({onProgress=()=>{},signal}={}){
    fs.mkdirSync(dir,{recursive:true});
    // weights: tools and packages are a small share of the bytes, the models most of it
    const report=(stage,from,to,f,detail)=>onProgress({stage,progress:from+(to-from)*Math.max(0,Math.min(1,f)),detail});
    report('uv',0,.02,0,t('voiceEngines.install.tools'));const uv=uvPath||await ensureUv(dir,{fetchImpl,signal});
    if(source&&!fs.existsSync(path.join(srcDir,'.source-'+source.commit))){
      report('source',.02,.04,0,t('voiceEngines.install.source'));await fetchSource({url:source.url,dest:srcDir,fetchImpl,signal});
      for(const sub of source.submodules||[])await fetchSource({url:sub.url,dest:path.join(srcDir,sub.path),fetchImpl,signal});
      fs.writeFileSync(path.join(srcDir,'.source-'+source.commit),'');
    }
    if(!fs.existsSync(pythonBin)){report('python',.04,.06,0,t('voiceEngines.install.python',{version:python}));await run(uv,['venv','-q','--python',python,venv],{signal});}
    report('packages',.06,.25,0,t('voiceEngines.install.packagesFirst'));
    // old sdists (openai-whisper) still import pkg_resources while building, so the build may need an older setuptools
    const constraints=path.join(dir,'build-constraints.txt');fs.writeFileSync(constraints,buildConstraints.join('\n')+'\n');
    // uv splits a --build-constraints path at spaces ("Application Support"), so it runs inside dir with a relative name
    let lines=0;
    // torch / torchaudio first from the chosen PyTorch index; the pins below then match those builds (2.3.1+cu121 satisfies ==2.3.1)
    const torch=packages.filter(p=>/^(torch|torchaudio)==/.test(p));
    if(torchFrom&&torch.length)await run(uv,['pip','install','--python',pythonBin,'--index-url',torchFrom,...torch],{cwd:dir,signal,onLine:()=>report('packages',.06,.25,Math.min(.5,++lines/400),t('voiceEngines.install.torch'))});
    await run(uv,['pip','install','--python',pythonBin,'--build-constraints',path.basename(constraints),...packages],{cwd:dir,signal,onLine:()=>report('packages',.06,.25,Math.min(.95,++lines/400),t('voiceEngines.install.packages'))});
    const totals=models.map(()=>0);
    for(const [i,model] of models.entries()){
      await fetchModel({...model,dir:path.join(modelsDir,model.name),fetchImpl,signal,onProgress:(p,done,total)=>{totals[i]=p;report('models',.25,1,totals.reduce((a,b)=>a+b,0)/models.length,t('voiceEngines.install.model',{name:model.name,done:(done/1e9).toFixed(2),total:(total/1e9).toFixed(2)}));}});
    }
    // single files with a known size and sha256 (e.g. text-normalisation grammars from ModelScope)
    for(const file of files){const target=path.join(dir,file.path);if(fs.existsSync(target)&&fs.statSync(target).size===file.size)continue;
      report('files',.98,1,0,t('voiceEngines.install.file',{file:path.basename(file.path)}));
      for(let attempt=1;;attempt++){try{await fetchToFile(file.url,target,{fetchImpl,signal,size:file.size});break;}catch(error){if(signal?.aborted||attempt>=3)throw error;await new Promise(r=>setTimeout(r,1500*attempt));}}  // ModelScope's CDN sometimes answers 403 once
      if(await sha256(target)!==file.sha256){fs.rmSync(target,{force:true});throw L.error('voiceEngines.install.hash',{file:path.basename(file.path)});}}
    for(const name of fs.readdirSync(dir))if(name.startsWith('.complete-'))fs.rmSync(path.join(dir,name),{force:true});  // an older spec's marker
    fs.writeFileSync(marker,new Date().toISOString());report('done',1,1,1,t('voiceEngines.install.done'));
    return {python:pythonBin,size:folderSize(dir)};
  }
  return {dir,python:pythonBin,srcDir,modelsDir,installed,install,spec,size:()=>folderSize(dir)};
}

module.exports={UVS,detectGpu,torchIndex,createPythonEnv,fetchModel,fetchToFile,fetchSource,ensureUv,findUv,run,sha256,folderSize,UV};
