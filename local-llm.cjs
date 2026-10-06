// Built-in local brain: llama.cpp's llama-server plus a Qwen model the user picks and downloads once.
const {renameRetry}=require('./platform.cjs');const L=require('./locales.cjs');
// Everything runs on this computer; the server listens on 127.0.0.1 with a per-launch key.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const net=require('node:net');const crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {installAsr:installFiles}=require('./voice-input.cjs');const {tarCommand}=require('./platform.cjs');

// llama.cpp b11378 builds per platform (GitHub release assets, sizes and SHA-256 from the release). macOS: Metal.
// Windows x64 and Linux x64 use the Vulkan build when the system has a Vulkan loader (any recent NVIDIA / AMD / Intel
// driver installs one), so the model runs on the GPU; otherwise the CPU build. CUDA builds are not used: they are
// 0.4–0.8 GB more (cudart) for a modest gain over Vulkan on NVIDIA cards.
const TAG='b11378',asset=(file,size,sha256,format=file.endsWith('.zip')?'zip':'tgz')=>({tag:TAG,file,name:format==='zip'?'llama.zip':'llama.tgz',format,size,sha256,url:`https://github.com/ggml-org/llama.cpp/releases/download/${TAG}/${file}`});
const RUNTIMES={
  'darwin-arm64':{cpu:asset('llama-b11378-bin-macos-arm64.tar.gz',11917702,'d17911a00ba2023fab962167f4f49db5de9177ccae87dcdd99a018eddd184077')},
  'darwin-x64':{cpu:asset('llama-b11378-bin-macos-x64.tar.gz',11472235,'1040550248b6c081cfcb9ad07e4a32893f0e4352a158d54de98063b0b660f125')},
  'win32-x64':{cpu:asset('llama-b11378-bin-win-cpu-x64.zip',19351877,'11bcb3aea659bce73f62305e3812764f935d90f44de1e70cd2b68aa3c9f41b8d'),
    vulkan:asset('llama-b11378-bin-win-vulkan-x64.zip',33272526,'8a856ec574da8b0f69c61e1dd2f9ff894b751ffaac9e442aac4711e72c9fb8eb')},
  'win32-arm64':{cpu:asset('llama-b11378-bin-win-cpu-arm64.zip',12206730,'701e0b42286ad59430c6404447f044110effcbc43d1374376d4e508cf0a98015')},
  'linux-x64':{cpu:asset('llama-b11378-bin-ubuntu-x64.tar.gz',17658800,'0241f12a0fe64bb26683158d32ca0a8a61a3d1fcfd856b22d6d62b93bacbdaef'),
    vulkan:asset('llama-b11378-bin-ubuntu-vulkan-x64.tar.gz',31601913,'199e1810b044cb8c298a0b11d28899600822362ce290d2bcb3bd95be6672e766')},
  'linux-arm64':{cpu:asset('llama-b11378-bin-ubuntu-arm64.tar.gz',13686225,'4d9c1187ae7bd3acb2555815424adbc6238aed6e666f6ae12c9c3c6dac297dbb')}
};
// Is a Vulkan loader installed? (vulkan-1.dll on Windows, libvulkan.so.1 on Linux)
function hasVulkan(platform=process.platform,exists=fs.existsSync){
  if(platform==='win32')return exists(path.join(process.env.SystemRoot||'C:\\Windows','System32','vulkan-1.dll'));
  if(platform==='linux')return ['/usr/lib/x86_64-linux-gnu','/usr/lib64','/usr/lib','/lib/x86_64-linux-gnu'].some(dir=>exists(path.join(dir,'libvulkan.so.1')));
  return false;
}
function runtimeFor({platform=process.platform,arch=process.arch,vulkan=hasVulkan(platform)}={}){const builds=RUNTIMES[`${platform}-${arch}`];if(!builds)return null;return vulkan&&builds.vulkan?builds.vulkan:builds.cpu;}
const RUNTIME=runtimeFor()||RUNTIMES['darwin-arm64'].cpu;
const SERVER=process.platform==='win32'?'llama-server.exe':'llama-server';
const hf=(repo,rev,file)=>`https://huggingface.co/${repo}/resolve/${rev}/${file}`;
// hintKey: the locale key of the one-line description shown next to the model
const qwen=(id,name,repo,rev,model,mmproj,minRam,hintKey)=>({id,name,hintKey,minRam,files:[
  {name:'model.gguf',url:hf(repo,rev,model[0]),size:model[1],sha256:model[2]},
  {name:'mmproj.gguf',url:hf(repo,rev,'mmproj-F16.gguf'),size:mmproj[0],sha256:mmproj[1]}]});
// Qwen3.5 / 3.6 (Apache-2.0, can read screenshots). minRam is the Mac memory in GB the model needs to run comfortably.
const MODELS=[
  qwen('qwen3.5-2b','Qwen3.5 2B','unsloth/Qwen3.5-2B-GGUF','f6d5376be1edb4d416d56da11e5397a961aca8ae',['Qwen3.5-2B-Q4_K_M.gguf',1280835840,'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'],[668227264,'7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7'],8,'llm.hint.qwen2b'),
  qwen('qwen3.5-4b','Qwen3.5 4B','unsloth/Qwen3.5-4B-GGUF','e87f176479d0855a907a41277aca2f8ee7a09523',['Qwen3.5-4B-Q4_K_M.gguf',2740937888,'00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'],[672423616,'cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864'],8,'llm.hint.qwen4b'),
  qwen('qwen3.5-9b','Qwen3.5 9B','unsloth/Qwen3.5-9B-GGUF','3885219b6810b007914f3a7950a8d1b469d598a5',['Qwen3.5-9B-Q4_K_M.gguf',5680522464,'03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8'],[918166080,'f70dc3509053962b0d0d3ee8a7eacebf5d60aa560cad78254ae8698516ae029f'],16,'llm.hint.qwen9b'),
  qwen('qwen3.6-35b-a3b','Qwen3.6 35B-A3B','unsloth/Qwen3.6-35B-A3B-GGUF','a483e9e6cbd595906af30beda3187c2663a1118c',['Qwen3.6-35B-A3B-UD-Q4_K_M.gguf',22134528992,'ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61'],[899283680,'8971ee4f331ff0a4c609374f32984b3d4e6dc086c0aa35f1d637fad1829e887f'],48,'llm.hint.qwen35b')
];
const sizeOf=model=>model.files.reduce((n,f)=>n+f.size,0);
function recommended(ramBytes=os.totalmem()){const gb=ramBytes/2**30;return gb<12?'qwen3.5-2b':gb<24?'qwen3.5-4b':'qwen3.5-9b';}
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});

class LocalLlm{
  constructor(root,{idleMs=15*60*1000,ramBytes=os.totalmem(),fetchImpl=fetch}={}){this.root=root;this.idleMs=idleMs;this.ramBytes=ramBytes;this.fetchImpl=fetchImpl;this.child=null;this.download=null;}
  runtimeDir(){return path.join(this.root,`llama-${RUNTIME.tag}`);}
  modelDir(id){return path.join(this.root,id);}
  runtimeInstalled(){return fs.existsSync(path.join(this.runtimeDir(),SERVER));}
  installed(id){const dir=this.modelDir(id);return fs.existsSync(path.join(dir,'.complete'))&&fs.existsSync(path.join(dir,'model.gguf'));}
  status(){
    const gb=this.ramBytes/2**30;
    return {ramGb:Math.round(gb),recommended:recommended(this.ramBytes),running:this.child?this.modelId:null,downloading:this.download?{id:this.download.id,progress:this.download.progress}:null,
      models:MODELS.map(m=>({id:m.id,name:m.name,hint:L.t(m.hintKey),hintKey:m.hintKey,hintEn:L.t.in('en')(m.hintKey),bytes:sizeOf(m),minRam:m.minRam,fits:gb>=m.minRam-.5,installed:this.installed(m.id)}))};
  }
  // One download at a time; the runtime (≈12 MB) comes along with the first model.
  install(id,onProgress=()=>{}){
    const model=MODELS.find(m=>m.id===id);if(!model)return Promise.reject(new Error('Unknown model'));
    if(this.download)return this.download.id===id?this.download.promise:Promise.reject(L.error('llm.busy'));
    const total=sizeOf(model)+(this.runtimeInstalled()?0:RUNTIME.size);let base=0;
    const state={id,progress:0};const report=p=>{state.progress=Math.min(1,p);onProgress(state.progress);};
    state.promise=(async()=>{
      fs.mkdirSync(this.root,{recursive:true});
      if(!this.runtimeInstalled()){
        const dl=`${this.runtimeDir()}-download`;await installFiles(dl,{files:[RUNTIME],fetchImpl:this.fetchImpl,onProgress:p=>report(p*RUNTIME.size/total)});
        const out=`${this.runtimeDir()}.partial`;fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
        // Windows: a flat zip (llama-server.exe beside its DLLs); macOS / Linux: a tarball with one top folder and library symlinks
        if(RUNTIME.format==='zip')await require('./archive.cjs').unzipLarge(path.join(dl,RUNTIME.name),out);
        else await new Promise((resolve,reject)=>execFile(tarCommand(),['-xzf',path.join(dl,RUNTIME.name),'-C',out,'--strip-components','1'],error=>error?reject(error):resolve()));
        if(!fs.existsSync(path.join(out,SERVER)))throw L.error('llm.runtimeIncomplete');
        fs.rmSync(this.runtimeDir(),{recursive:true,force:true});renameRetry(out,this.runtimeDir());fs.rmSync(dl,{recursive:true,force:true});base=RUNTIME.size;
      }
      if(!this.installed(id))await installFiles(this.modelDir(id),{files:model.files,fetchImpl:this.fetchImpl,onProgress:p=>report((base+p*sizeOf(model))/total)});
      report(1);
    })().finally(()=>{this.download=null;});
    this.download=state;return state.promise;
  }
  remove(id){if(!MODELS.some(m=>m.id===id))throw new Error('Unknown model');if(this.modelId===id)this.stop();if(this.download?.id===id)throw L.error('llm.downloading');fs.rmSync(this.modelDir(id),{recursive:true,force:true});fs.rmSync(`${this.modelDir(id)}.partial`,{recursive:true,force:true});}
  // Start (or reuse) the server for this model; returns an OpenAI-compatible base, model name and key.
  async ensure(id){
    this.touch();
    if(this.child&&this.modelId===id)return this.ready;
    if(!MODELS.some(m=>m.id===id)||!this.installed(id)||!this.runtimeInstalled())throw L.error('llm.notDownloaded');
    this.stop();
    const port=await freePort(),key=crypto.randomBytes(24).toString('hex'),dir=this.modelDir(id);
    const args=['-m',path.join(dir,'model.gguf'),'--mmproj',path.join(dir,'mmproj.gguf'),'--host','127.0.0.1','--port',String(port),'--api-key',key,'--alias',id,
      '-c','16384','-np','1','--jinja','--reasoning-budget','0','--no-webui','--offline'];
    const child=spawn(path.join(this.runtimeDir(),SERVER),args,{cwd:this.runtimeDir(),stdio:['ignore','ignore','pipe'],windowsHide:true});
    this.child=child;this.modelId=id;let log='';child.stderr.on('data',d=>{log=(log+d).slice(-4000);});
    const exited=new Promise(resolve=>child.once('exit',code=>{if(this.child===child){this.child=null;this.modelId=null;}resolve(code);}));
    const info={base:`http://127.0.0.1:${port}/v1`,model:id,key};
    this.ready=(async()=>{
      const until=Date.now()+180000;
      while(Date.now()<until){
        if(this.child!==child)throw L.error('llm.startFailed',{reason:log.trim().split('\n').slice(-3).join(' ')||L.t('llm.exited')});
        try{const r=await this.fetchImpl(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(2000)});if(r.ok)return info;}catch{}
        await Promise.race([new Promise(r=>setTimeout(r,300)),exited]);
      }
      this.stop();throw L.error('llm.loadTimeout');
    })();
    this.ready.catch(()=>{});return this.ready;
  }
  // Free the memory when the companion has been quiet for a while.
  touch(){clearTimeout(this.idle);this.idle=setTimeout(()=>this.stop(),this.idleMs);this.idle.unref?.();}
  stop(){clearTimeout(this.idle);const child=this.child;this.child=null;this.modelId=null;if(child&&child.exitCode===null)child.kill();}
}
module.exports={LocalLlm,MODELS,RUNTIME,RUNTIMES,runtimeFor,hasVulkan,SERVER,recommended,sizeOf};
