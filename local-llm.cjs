// Built-in local brain: llama.cpp's llama-server plus a Qwen model the user picks and downloads once.
// Everything runs on this Mac; the server listens on 127.0.0.1 with a per-launch key.
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const net=require('node:net');const crypto=require('node:crypto');
const {spawn,execFile}=require('node:child_process');
const {installAsr:installFiles}=require('./voice-input.cjs');

const RUNTIME={tag:'b11378',name:'llama.tgz',url:'https://github.com/ggml-org/llama.cpp/releases/download/b11378/llama-b11378-bin-macos-arm64.tar.gz',size:11917702,sha256:'d17911a00ba2023fab962167f4f49db5de9177ccae87dcdd99a018eddd184077'};
const hf=(repo,rev,file)=>`https://huggingface.co/${repo}/resolve/${rev}/${file}`;
const qwen=(id,name,repo,rev,model,mmproj,minRam,hint,hintEn)=>({id,name,hint,hintEn,minRam,files:[
  {name:'model.gguf',url:hf(repo,rev,model[0]),size:model[1],sha256:model[2]},
  {name:'mmproj.gguf',url:hf(repo,rev,'mmproj-F16.gguf'),size:mmproj[0],sha256:mmproj[1]}]});
// Qwen3.5 / 3.6 (Apache-2.0, can read screenshots). minRam is the Mac memory in GB the model needs to run comfortably.
const MODELS=[
  qwen('qwen3.5-2b','Qwen3.5 2B','unsloth/Qwen3.5-2B-GGUF','f6d5376be1edb4d416d56da11e5397a961aca8ae',['Qwen3.5-2B-Q4_K_M.gguf',1280835840,'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223'],[668227264,'7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7'],8,'最快最小，適合聊天','Smallest and fastest; good for chat'),
  qwen('qwen3.5-4b','Qwen3.5 4B','unsloth/Qwen3.5-4B-GGUF','e87f176479d0855a907a41277aca2f8ee7a09523',['Qwen3.5-4B-Q4_K_M.gguf',2740937888,'00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4'],[672423616,'cd88edcf8d031894960bb0c9c5b9b7e1fea6ebee02b9f7ce925a00d12891f864'],8,'聊天流暢，能做簡單網頁任務','Smooth chat and simple web tasks'),
  qwen('qwen3.5-9b','Qwen3.5 9B','unsloth/Qwen3.5-9B-GGUF','3885219b6810b007914f3a7950a8d1b469d598a5',['Qwen3.5-9B-Q4_K_M.gguf',5680522464,'03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8'],[918166080,'f70dc3509053962b0d0d3ee8a7eacebf5d60aa560cad78254ae8698516ae029f'],16,'網頁任務比較穩','Steadier on web tasks'),
  qwen('qwen3.6-35b-a3b','Qwen3.6 35B-A3B','unsloth/Qwen3.6-35B-A3B-GGUF','a483e9e6cbd595906af30beda3187c2663a1118c',['Qwen3.6-35B-A3B-UD-Q4_K_M.gguf',22134528992,'ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61'],[899283680,'8971ee4f331ff0a4c609374f32984b3d4e6dc086c0aa35f1d637fad1829e887f'],48,'最聰明，下載最大','Smartest; largest download')
];
const sizeOf=model=>model.files.reduce((n,f)=>n+f.size,0);
function recommended(ramBytes=os.totalmem()){const gb=ramBytes/2**30;return gb<12?'qwen3.5-2b':gb<24?'qwen3.5-4b':'qwen3.5-9b';}
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});

class LocalLlm{
  constructor(root,{idleMs=15*60*1000,ramBytes=os.totalmem(),fetchImpl=fetch}={}){this.root=root;this.idleMs=idleMs;this.ramBytes=ramBytes;this.fetchImpl=fetchImpl;this.child=null;this.download=null;}
  runtimeDir(){return path.join(this.root,`llama-${RUNTIME.tag}`);}
  modelDir(id){return path.join(this.root,id);}
  runtimeInstalled(){return fs.existsSync(path.join(this.runtimeDir(),'llama-server'));}
  installed(id){const dir=this.modelDir(id);return fs.existsSync(path.join(dir,'.complete'))&&fs.existsSync(path.join(dir,'model.gguf'));}
  status(){
    const gb=this.ramBytes/2**30;
    return {ramGb:Math.round(gb),recommended:recommended(this.ramBytes),running:this.child?this.modelId:null,downloading:this.download?{id:this.download.id,progress:this.download.progress}:null,
      models:MODELS.map(m=>({id:m.id,name:m.name,hint:m.hint,hintEn:m.hintEn,bytes:sizeOf(m),minRam:m.minRam,fits:gb>=m.minRam-.5,installed:this.installed(m.id)}))};
  }
  // One download at a time; the runtime (≈12 MB) comes along with the first model.
  install(id,onProgress=()=>{}){
    const model=MODELS.find(m=>m.id===id);if(!model)return Promise.reject(new Error('Unknown model'));
    if(this.download)return this.download.id===id?this.download.promise:Promise.reject(new Error('另一個模型正在下載，請等它完成。'));
    const total=sizeOf(model)+(this.runtimeInstalled()?0:RUNTIME.size);let base=0;
    const state={id,progress:0};const report=p=>{state.progress=Math.min(1,p);onProgress(state.progress);};
    state.promise=(async()=>{
      fs.mkdirSync(this.root,{recursive:true});
      if(!this.runtimeInstalled()){
        const dl=`${this.runtimeDir()}-download`;await installFiles(dl,{files:[RUNTIME],fetchImpl:this.fetchImpl,onProgress:p=>report(p*RUNTIME.size/total)});
        const out=`${this.runtimeDir()}.partial`;fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out);
        await new Promise((resolve,reject)=>execFile('/usr/bin/tar',['-xzf',path.join(dl,RUNTIME.name),'-C',out,'--strip-components','1'],error=>error?reject(error):resolve()));
        if(!fs.existsSync(path.join(out,'llama-server')))throw new Error('llama.cpp 套件內容不完整。');
        fs.rmSync(this.runtimeDir(),{recursive:true,force:true});fs.renameSync(out,this.runtimeDir());fs.rmSync(dl,{recursive:true,force:true});base=RUNTIME.size;
      }
      if(!this.installed(id))await installFiles(this.modelDir(id),{files:model.files,fetchImpl:this.fetchImpl,onProgress:p=>report((base+p*sizeOf(model))/total)});
      report(1);
    })().finally(()=>{this.download=null;});
    this.download=state;return state.promise;
  }
  remove(id){if(!MODELS.some(m=>m.id===id))throw new Error('Unknown model');if(this.modelId===id)this.stop();if(this.download?.id===id)throw new Error('模型正在下載。');fs.rmSync(this.modelDir(id),{recursive:true,force:true});fs.rmSync(`${this.modelDir(id)}.partial`,{recursive:true,force:true});}
  // Start (or reuse) the server for this model; returns an OpenAI-compatible base, model name and key.
  async ensure(id){
    this.touch();
    if(this.child&&this.modelId===id)return this.ready;
    if(!MODELS.some(m=>m.id===id)||!this.installed(id)||!this.runtimeInstalled())throw new Error('內建模型還沒下載。請到「設定 → AI 大腦」選一個模型下載。');
    this.stop();
    const port=await freePort(),key=crypto.randomBytes(24).toString('hex'),dir=this.modelDir(id);
    const args=['-m',path.join(dir,'model.gguf'),'--mmproj',path.join(dir,'mmproj.gguf'),'--host','127.0.0.1','--port',String(port),'--api-key',key,'--alias',id,
      '-c','16384','-np','1','--jinja','--reasoning-budget','0','--no-webui','--offline'];
    const child=spawn(path.join(this.runtimeDir(),'llama-server'),args,{cwd:this.runtimeDir(),stdio:['ignore','ignore','pipe']});
    this.child=child;this.modelId=id;let log='';child.stderr.on('data',d=>{log=(log+d).slice(-4000);});
    const exited=new Promise(resolve=>child.once('exit',code=>{if(this.child===child){this.child=null;this.modelId=null;}resolve(code);}));
    const info={base:`http://127.0.0.1:${port}/v1`,model:id,key};
    this.ready=(async()=>{
      const until=Date.now()+180000;
      while(Date.now()<until){
        if(this.child!==child)throw new Error(`內建模型啟動失敗：${log.trim().split('\n').slice(-3).join(' ')||'程式結束'}`);
        try{const r=await this.fetchImpl(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(2000)});if(r.ok)return info;}catch{}
        await Promise.race([new Promise(r=>setTimeout(r,300)),exited]);
      }
      this.stop();throw new Error('內建模型載入逾時。');
    })();
    this.ready.catch(()=>{});return this.ready;
  }
  // Free the memory when the companion has been quiet for a while.
  touch(){clearTimeout(this.idle);this.idle=setTimeout(()=>this.stop(),this.idleMs);this.idle.unref?.();}
  stop(){clearTimeout(this.idle);const child=this.child;this.child=null;this.modelId=null;if(child&&child.exitCode===null)child.kill();}
}
module.exports={LocalLlm,MODELS,RUNTIME,recommended,sizeOf};
