// Voice engine "cosyvoice": zero-shot cloning from ~10 s of reference audio and its transcript, with CosyVoice
// (FunAudioLLM, Apache-2.0 code and weights). Runs locally as a Python sidecar started on demand; nothing leaves this Mac.
// Default model CosyVoice2-0.5B (zh / en / ja / ko / yue, cross-lingual). Fun-CosyVoice3-0.5B-2512 is newer and
// better in Chinese but twice the download and needs Japanese written in katakana, so it is opt-in (params.model).
// Profile files: reference.wav (the reference clip, 24 kHz mono) and reference.txt (what is said in it).
// Params: {model, refText, lang: 'zh'|'en'|'ja'|'ko', speed: 0.7–1.4}
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {createPythonEnv,torchIndex,detectGpu}=require('./python-env.cjs');const L=require('../src/main/locales.cjs');const {t}=L;const {createSidecar}=require('./sidecar.cjs');

const SOURCE={commit:'074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc',url:'https://codeload.github.com/FunAudioLLM/CosyVoice/tar.gz/074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc',
  submodules:[{path:'third_party/Matcha-TTS',url:'https://codeload.github.com/shivammehta25/Matcha-TTS/tar.gz/dd9105b34bf2be2230f4aa1e4769fb586a3c824e'}]};
// Upstream requirements.txt at that commit, minus training/serving/CUDA-only packages (deepspeed, tensorrt, gradio, grpc, pyworld…).
const PACKAGES=['torch==2.3.1','torchaudio==2.3.1','numpy==1.26.4','conformer==0.3.2','diffusers==0.29.0','hydra-core==1.3.2','HyperPyYAML==1.2.3',
  'inflect==7.3.1','librosa==0.10.2','lightning==2.2.4','matplotlib==3.7.5','modelscope==1.20.0','networkx==3.1','omegaconf==2.3.0','onnx==1.16.0','onnxruntime==1.18.0',
  'openai-whisper==20231117','protobuf==4.25.8','pydantic==2.7.0','pyarrow==18.1.0','rich==13.7.1','soundfile==0.12.1','transformers==4.51.3','x-transformers==2.11.24','wetext==0.0.4','tqdm','gdown==5.1.0','wget==3.2','pyworld==0.3.5',
  'setuptools==80.9.0'];  // lightning still imports pkg_resources at run time
// Training-only and TensorRT files are skipped: CosyVoice 2 is ~4.1 GB instead of 4.9 GB.
const SKIP=/^\.|README|^asset\/|\.batch\.onnx$|flow\.decoder\.estimator|llm\.rl\.pt$/;
const MODELS={
  'CosyVoice2-0.5B':{repo:'FunAudioLLM/CosyVoice2-0.5B',revision:'eec1ae6c79877dbd9379285cf8789c9e0879293d',modelscope:'iic/CosyVoice2-0.5B',size:4.1e9,label:'CosyVoice 2 · 0.5B'},
  'Fun-CosyVoice3-0.5B-2512':{repo:'FunAudioLLM/Fun-CosyVoice3-0.5B-2512',revision:'29e01c4e8d000f4bcd70751be16fa94bf3d85a18',modelscope:'FunAudioLLM/Fun-CosyVoice3-0.5B-2512',size:5.4e9,label:'Fun-CosyVoice 3 · 0.5B'}
};
// Text normalisation grammars (wetext, Apache-2.0) for numbers and dates in zh / en. wetext would fetch its whole repo from
// ModelScope at run time (into ~/.cache, and some files answer 403), so the four files it uses are fetched here instead.
const WETEXT=[['en/tn/tagger.fst',5645674,'245e2dc9174cdd007a8e9e50f3339773d1adbbc7535b71cf67478dc1683cc3ec'],['en/tn/verbalizer.fst',6398822,'03155c88f317b2795969e264c19f87faf98b9853d5ac631e419bacdc3b3ee15a'],
  ['zh/tn/tagger.fst',527178,'cf341314c51f7ce59049f3b2c42f0ce8fd71e6d08d4d6969613aad384a5e2ae8'],['zh/tn/verbalizer.fst',1069758,'5a13cd679dd54637d12d2bd1bd33ee2165d91c867e14468c93195af02256e5da']]
  .map(([file,size,sha256])=>({path:`models/wetext/${file}`,url:`https://www.modelscope.cn/models/pengzhendong/wetext/resolve/master/${file}`,size,sha256}));
const LANGS=['zh','en','ja','ko'];
const license=()=>t('voiceEngines.cosyvoice.license');

// The language a text is mostly written in: kana → ja, hangul → ko, CJK → zh, otherwise en.
function detectLang(text){const s=String(text);if(/[぀-ヿ]/.test(s))return 'ja';if(/[가-힯]/.test(s))return 'ko';if(/[㐀-鿿]/.test(s))return 'zh';return 'en';}
// Same language as the reference and a transcript: zero-shot (closest timbre and prosody). Otherwise cross-lingual.
function modeFor(text,params){return params.refText&&(!params.lang||detectLang(text)===params.lang)?'zero_shot':'cross_lingual';}

function validate(params={}){
  const p={model:MODELS[params.model]?params.model:'CosyVoice2-0.5B',refText:String(params.refText||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,300),
    lang:LANGS.includes(params.lang)?params.lang:null,speed:Number.isFinite(+params.speed)?Math.max(.7,Math.min(1.4,+params.speed)):1,
    // 'fast' (default): 4 flow steps, about 40% quicker with words still clear; 'best': the full 10 steps
    quality:params.quality==='best'?'best':'fast'};
  if(!p.lang)p.lang=p.refText?detectLang(p.refText):'zh';
  return p;
}

// CosyVoice was trained on Simplified Chinese: Traditional input comes out garbled (measured with SenseVoice: 「收到好友
// H T O N方记起…」 for Traditional, the exact sentence for Simplified), so Chinese text is converted before synthesis.
const STEPS={fast:4,best:10};
// a short line in the voice's own language, said once to load the model (never played)
const WARM_TEXT={en:'Hi.',ja:'こんにちは。',zh:'你好。',ko:'안녕하세요.'};
let simplify=null;
const forModel=text=>detectLang(text)==='zh'?(simplify||=require('opencc-js').Converter({from:'t',to:'cn'}))(text):text;
// 8 threads measured fastest on an M3 Max (RTF ~2 against ~3–4 with PyTorch's default); MPS produced garbage, so CPU it is.
const THREADS=Math.min(8,Math.max(2,Math.floor(os.cpus().length/2)));
// Where the Python engines can run: macOS (CPU), Windows x64 and Linux x64 / arm64 (CUDA with an NVIDIA GPU, otherwise CPU).
const engineHost=()=>process.platform==='win32'&&process.arch!=='x64'?t('voiceEngines.armUnsupported',{name:'CosyVoice'}):null;

function create({dir,fetchImpl=fetch,sidecar=null,idleMs=30*60*1000,threads=THREADS}={}){
  // Windows / Linux: torch from the CUDA index when nvidia-smi finds a GPU (CosyVoice then runs on it), the CPU index otherwise
  const envFor=model=>createPythonEnv({dir,python:'3.10',packages:PACKAGES,buildConstraints:['setuptools<81'],source:SOURCE,files:WETEXT,fetchImpl,torchFrom:torchIndex({cuda:'cu121'}),
    models:[{name:model,repo:MODELS[model].repo,revision:MODELS[model].revision,include:name=>!SKIP.test(name),
      mirrors:[name=>`https://modelscope.cn/models/${MODELS[model].modelscope}/resolve/master/${name}`]}]});
  const sidecars=new Map();let installing=null;
  // tests and the smoke pass {command,args} for a stand-in process that speaks the same protocol
  function sidecarFor(model){
    if(!sidecars.has(model)){
      const env=envFor(model);
      const spec=sidecar||{command:env.python,args:[path.join(__dirname,'cosyvoice_sidecar.py'),'--src',env.srcDir,'--model',path.join(env.modelsDir,model),'--wetext',path.join(env.modelsDir,'wetext'),...(threads?['--threads',String(threads)]:[])],cwd:env.srcDir,
        env:{HOME:path.join(dir,'home'),MODELSCOPE_CACHE:path.join(dir,'modelscope'),HF_HOME:path.join(dir,'huggingface'),HF_HUB_OFFLINE:'1',MPLCONFIGDIR:path.join(dir,'home','mpl')}};  // libraries' caches stay in this folder
      sidecars.set(model,createSidecar({...spec,name:'CosyVoice',idleMs}));
    }
    return sidecars.get(model);
  }
  const engine={
    id:'cosyvoice',get label(){return t('voiceEngines.cosyvoice.label');},get license(){return license();},models:MODELS,
    async available(model='CosyVoice2-0.5B'){
      if(sidecar)return {ok:true};
      if(engineHost())return {ok:false,reason:engineHost()};
      if(installing)return {ok:false,reason:t('voiceEngines.installing',{name:'CosyVoice'}),installing:true};
      return envFor(model).installed()?{ok:true}:{ok:false,reason:t('voiceEngines.notInstalled',{name:'CosyVoice',size:(MODELS[model].size/1e9+1.5).toFixed(1)}),install:true};
    },
    install(onProgress=()=>{},{signal,model='CosyVoice2-0.5B'}={}){
      if(sidecar)return Promise.resolve({ok:true});
      installing||=envFor(model).install({onProgress,signal}).finally(()=>{installing=null;});
      return installing;
    },
    validate,
    // Writes the reference clip and transcript into a profile folder; returns the files and params for the profile.
    prepare({wav,refText,lang,model,dir:target}){
      fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'reference.wav'),wav,{mode:0o600});
      const params=validate({model,refText,lang});fs.writeFileSync(path.join(target,'reference.txt'),params.refText,{mode:0o600});
      return {files:['reference.wav','reference.txt'],params};
    },
    async speak({text,profile,dir:profileDir,signal}){
      const params=validate(profile?.params);const ref=path.join(profileDir,'reference.wav');
      if(!fs.existsSync(ref))throw L.error('voiceEngines.cosyvoice.referenceMissing');
      const clean=String(text||'').trim().slice(0,1000);if(!clean)throw L.error('voiceEngines.noText');
      const out=path.join(os.tmpdir(),`agent-wardrobe-cosyvoice-${process.pid}-${crypto.randomBytes(6).toString('hex')}.wav`);
      try{
        await sidecarFor(params.model).request('speak',{text:forModel(clean),ref,refText:forModel(params.refText),mode:modeFor(clean,params),speed:params.speed,steps:STEPS[params.quality],out},{signal});
        return {audio:fs.readFileSync(out),mime:'audio/wav'};
      }finally{fs.rmSync(out,{force:true});}
    },
    // Start the engine and prepare this voice ahead of time (the first sentence after a cold start otherwise waits ~1 min)
    async warm({profile,dir:profileDir}){
      const params=validate(profile?.params);const ref=path.join(profileDir,'reference.wav');if(!fs.existsSync(ref)||(!sidecar&&!envFor(params.model).installed()))return false;
      const out=path.join(os.tmpdir(),`agent-wardrobe-cosyvoice-${process.pid}-warm-${crypto.randomBytes(4).toString('hex')}.wav`);
      try{await sidecarFor(params.model).request('warm',{text:WARM_TEXT[params.lang]||WARM_TEXT.zh,ref,refText:forModel(params.refText),mode:'zero_shot',speed:params.speed,steps:STEPS[params.quality],out});return true;}
      catch{return false;}finally{fs.rmSync(out,{force:true});}
    },
    stop(options){for(const s of sidecars.values())s.stop(options);},
    get running(){return [...sidecars.values()].some(s=>s.running);},
    size:(model='CosyVoice2-0.5B')=>envFor(model).size()
  };
  return engine;
}
module.exports={gpu:()=>detectGpu(),create,validate,detectLang,modeFor,MODELS,PACKAGES,SOURCE,get LICENSE(){return license();}};
