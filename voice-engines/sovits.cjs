// Voice engine "sovits": GPT-SoVITS (RVC-Boss, MIT), the best quality for anime-style voices. Two ways in:
//  (a) fine-tune on 1–10 minutes of one person's recordings — a background job: slice → transcribe → features →
//      train GPT → train SoVITS, with progress, a time estimate and cancel;
//  (b) import a community voice pack (.ckpt GPT + .pth SoVITS + a reference clip and its text). Packs are usually
//      trained on dubbed anime/game voices, so they are always personal use only and never leave this Mac.
// Version: v2Pro (June 2025) — v2's speed with better timbre; v3/v4 need a large extra vocoder and are slow on a CPU.
// Inference runs as a Python sidecar on the CPU (MPS optional); training is CPU-only on Macs (upstream: MPS training
// degrades quality). Profile files: gpt.ckpt, sovits.pth, reference.wav, reference.txt.
// Params: {version, refText, refLang, textLang, speed, topK, temperature, source: 'trained'|'pack'}
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {createPythonEnv,fetchToFile,run,torchIndex,detectGpu}=require('./python-env.cjs');const {venvSitePackages,tarCommand}=require('../platform.cjs');const {createSidecar,PREFIX}=require('./sidecar.cjs');
const {scanCheckpoint}=require('./pickle-scan.cjs');const L=require('../locales.cjs');const {t}=L;const audio=require('../voice-audio.cjs');

const SOURCE={commit:'48b1a0169a28582a8984402f82cf438d3bfa6aca',url:'https://codeload.github.com/RVC-Boss/GPT-SoVITS/tar.gz/48b1a0169a28582a8984402f82cf438d3bfa6aca'};
// requirements.txt at that commit with versions pinned, minus the web UI, FunASR / faster-whisper (the app transcribes
// with its own SenseVoice model) and Korean-only packages.
const PACKAGES=['torch==2.6.0','torchaudio==2.6.0','numpy==1.26.4','scipy==1.15.3','librosa==0.10.2','numba==0.61.2','pytorch-lightning==2.5.1','onnxruntime==1.22.0',
  'tqdm','cn2an==0.5.23','pypinyin==0.54.0','pyopenjtalk==0.4.1','g2p_en==2.1.0','modelscope==1.27.1','sentencepiece==0.2.0','transformers==4.51.3','peft==0.15.2',
  'chardet==5.2.0','PyYAML==6.0.2','psutil==7.0.0','jieba_fast==0.53','jieba==0.42.1','split-lang==2.1.0','fast_langdetect==0.3.2','wordsegment==1.3.1',
  'rotary_embedding_torch==0.8.6','ToJyutping==3.2.0','g2pk2==0.0.3','ko_pron==1.3','opencc==1.1.9','x_transformers==2.3.12','torchmetrics==1.5.0','pydantic==2.10.6',
  'av==14.4.0','tensorboard==2.19.0','ffmpeg-python==0.2.0','matplotlib==3.10.3','soundfile==0.13.1'];
const PRETRAINED={name:'pretrained',repo:'lj1995/GPT-SoVITS',revision:'1cdb10a4f2b13b3e8103b873c4c70c9d54d92c85',
  include:name=>/^(chinese-hubert-base|chinese-roberta-wwm-ext-large)\//.test(name)||['s1v3.ckpt','v2Pro/s2Gv2Pro.pth','v2Pro/s2Dv2Pro.pth','v2Pro/s2Gv2ProPlus.pth','sv/pretrained_eres2netv2w24s4ep4.ckpt'].includes(name)};
// Chinese G2P model, NLTK data (English) and the OpenJTalk dictionary (Japanese), as upstream's install.sh fetches them.
const EXTRAS_REPO='https://huggingface.co/XXXXRT/GPT-SoVITS-Pretrained/resolve/0c47645e02a7bc3688d7b263b0042c81e3cd82cd';
const EXTRAS=[{file:'G2PWModel.zip',into:'src/GPT_SoVITS/text',check:'src/GPT_SoVITS/text/G2PWModel'},{file:'nltk_data.zip',into:'venv',check:'venv/nltk_data'},
  {file:'open_jtalk_dic_utf_8-1.11.tar.gz',into:path.join(venvSitePackages('venv','3.10'),'pyopenjtalk'),check:path.join(venvSitePackages('venv','3.10'),'pyopenjtalk','open_jtalk_dic_utf_8-1.11')}];  // venv/Lib/site-packages on Windows
const license=()=>t('voiceEngines.sovits.license');
const PACK_NOTE_KEY='voiceEngines.sovits.packNote';
const LANGS=['zh','ja','en','ko','yue'];
const FILES={gpt:'gpt.ckpt',sovits:'sovits.pth',ref:'reference.wav',refText:'reference.txt'};

function validate(params={}){
  const clean=v=>String(v||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,300);
  return {version:['v1','v2','v2Pro','v2ProPlus'].includes(params.version)?params.version:'v2Pro',refText:clean(params.refText),
    refLang:LANGS.includes(params.refLang)?params.refLang:'zh',textLang:LANGS.includes(params.textLang)?params.textLang:'auto',
    speed:Number.isFinite(+params.speed)?Math.max(.6,Math.min(1.5,+params.speed)):1,topK:Number.isInteger(+params.topK)?Math.max(1,Math.min(50,+params.topK)):15,
    temperature:Number.isFinite(+params.temperature)?Math.max(.3,Math.min(1.5,+params.temperature)):1,source:params.source==='pack'?'pack':'trained'};
}

// Rough CPU time on an Apple Silicon Mac (seconds) for `minutes` of speech: features ~1×, GPT 15 epochs ~3×, SoVITS 8 epochs ~5×.
function estimateTraining(minutes){const m=Math.max(.5,minutes);return Math.round(60+m*(6+30+60+180+300));}
// stage labels are locale keys (jobs.cjs shows them in the interface language)
const STAGES=[{id:'slice',weight:1},{id:'asr',weight:3},{id:'features',weight:10},{id:'gpt',weight:30},{id:'sovits',weight:50}].map(s=>({...s,key:`voiceEngines.sovits.stage.${s.id}`}));

// What version a SoVITS weights file is, from GPT-SoVITS's own header bytes (process_ckpt.py) or its size.
function sovitsVersion(file){
  const fd=fs.openSync(file,'r'),head=Buffer.alloc(2);fs.readSync(fd,head,0,2,0);fs.closeSync(fd);const size=fs.statSync(file).size;
  const marker=head.toString('latin1');
  if(marker==='PK')return size<82978*1024?'v1':size<700*1024*1024?'v2':'v3';
  return {'00':'v1','01':'v2','02':'v3','03':'v3','04':'v4','05':'v2Pro','06':'v2ProPlus'}[marker]||null;
}
// Checks a community pack and copies it into `dest` under fixed names. files: [{path, name}] (a folder's contents).
// The tier is always 'personal', whatever the pack says about itself.
async function importPack({files,dest,name,refText,refLang,convert=audio.convertToWav}){
  const pick=re=>files.filter(f=>re.test(f.name||f.path));
  const gpts=pick(/\.ckpt$/i),sovits=pick(/\.pth$/i),refs=pick(/\.(wav|mp3|m4a|flac|ogg|aac)$/i),texts=pick(/\.(txt|lab|list)$/i);
  if(gpts.length!==1||sovits.length!==1)throw L.error('voiceEngines.sovits.packFiles');
  if(!refs.length)throw L.error('voiceEngines.sovits.packRef');
  for(const f of [gpts[0],sovits[0]]){const size=fs.statSync(f.path).size;if(size<1e6||size>2e9)throw L.error('voiceEngines.sovits.packSize',{file:path.basename(f.path)});}
  const version=sovitsVersion(sovits[0].path);
  if(!version)throw L.error('voiceEngines.sovits.packVersion');
  if(['v3','v4'].includes(version))throw L.error('voiceEngines.sovits.packV3',{version});
  scanCheckpoint(gpts[0].path);scanCheckpoint(sovits[0].path);
  // reference text: a .txt / .lab next to it, the transcript in a .list line, or the clip's own file name (a common convention)
  const ref=refs[0];let text=String(refText||'').trim();
  if(!text&&texts.length){const raw=fs.readFileSync(texts[0].path,'utf8');const line=raw.split(/\r?\n/).find(l=>l.trim())||'';text=line.includes('|')?line.split('|').at(-1):line;}
  if(!text)text=path.basename(ref.name||ref.path).replace(/\.[^.]+$/,'');
  fs.mkdirSync(dest,{recursive:true});
  fs.copyFileSync(gpts[0].path,path.join(dest,FILES.gpt));fs.copyFileSync(sovits[0].path,path.join(dest,FILES.sovits));
  await convert(ref.path,path.join(dest,FILES.ref),{rate:32000});
  const params=validate({version,refText:text,refLang:refLang||guessLang(text),source:'pack'});fs.writeFileSync(path.join(dest,FILES.refText),params.refText,{mode:0o600});
  return {files:Object.values(FILES),params,license:{label:t('voiceEngines.sovits.packLicense',{note:t(PACK_NOTE_KEY)}),commercial:false,credit:String(name||t('voiceEngines.sovits.packCredit')),tier:'personal'},note:t(PACK_NOTE_KEY),noteKey:PACK_NOTE_KEY};
}
const guessLang=text=>/[぀-ヿ]/.test(text)?'ja':/[가-힯]/.test(text)?'ko':/[㐀-鿿]/.test(text)?'zh':'en';

// device: 'cpu' on macOS; 'cuda' on Windows / Linux when nvidia-smi finds a GPU (torch then comes from the CUDA index)
function create({dir,fetchImpl=fetch,sidecar=null,trainer=null,transcribe=null,idleMs=10*60*1000,device=detectGpu()?'cuda':'cpu'}={}){
  const env=createPythonEnv({dir,python:'3.10',packages:PACKAGES,source:SOURCE,models:[PRETRAINED],fetchImpl,torchFrom:torchIndex({cuda:'cu124'})});
  const extrasDone=()=>EXTRAS.every(e=>fs.existsSync(path.join(dir,e.check)));
  let side=null,installing=null;
  const sidecarProc=()=>side||=createSidecar({...(sidecar||{command:env.python,args:[path.join(__dirname,'sovits_sidecar.py'),'--src',env.srcDir,'--device',device],cwd:env.srcDir}),name:'GPT-SoVITS',idleMs});
  async function install(onProgress=()=>{},{signal}={}){
    if(sidecar)return {ok:true};
    await env.install({signal,onProgress:p=>onProgress({...p,progress:p.progress*.85})});
    // pretrained weights are where upstream's scripts look for them
    // a junction on Windows: a folder link that needs no administrator rights
    const link=path.join(env.srcDir,'GPT_SoVITS','pretrained_models');if(!fs.existsSync(path.join(link,'s1v3.ckpt'))){fs.rmSync(link,{recursive:true,force:true});fs.symlinkSync(path.join(env.modelsDir,'pretrained'),link,process.platform==='win32'?'junction':undefined);}
    for(const [i,extra] of EXTRAS.entries()){
      if(fs.existsSync(path.join(dir,extra.check)))continue;
      onProgress({stage:'extras',progress:.85+.15*i/EXTRAS.length,detail:t('voiceEngines.install.file',{file:extra.file})});
      const file=path.join(dir,'downloads',extra.file);await fetchToFile(`${EXTRAS_REPO}/${extra.file}`,file,{fetchImpl,signal});
      const into=path.join(dir,extra.into);fs.mkdirSync(into,{recursive:true});
      // zips with the app's own reader (GNU tar on Linux cannot read them), the dictionary tarball with the system tar
      if(file.endsWith('.zip'))await require('../archive.cjs').unzipLarge(file,into);else await run(tarCommand(),['-xf',file,'-C',into,'--no-same-owner'],{signal});fs.rmSync(file,{force:true});
    }
    onProgress({stage:'done',progress:1,detail:t('voiceEngines.install.done')});return {ok:true};
  }
  // Training: the takes are sliced at pauses, transcribed (SenseVoice on this Mac, or the script the user read), and
  // handed to sovits_train.py. Everything happens in workDir (a private temp folder the caller deletes afterwards).
  async function train({takes,workDir,outDir,lang='zh',epochs={gpt:15,sovits:8}},ctx){
    const wavs=path.join(workDir,'slices');fs.mkdirSync(wavs,{recursive:true,mode:0o700});
    ctx.stage('slice',t('voiceEngines.sovits.sliceDetail'));
    const slices=[];
    for(const [n,take] of takes.entries()){
      const {samples,sampleRate}=audio.parseWav(fs.readFileSync(take.file));
      for(const [i,piece] of audio.sliceOnSilence(samples,sampleRate,{min:3,max:10}).entries()){
        const file=path.join(wavs,`t${n}-${String(i).padStart(3,'0')}.wav`);fs.writeFileSync(file,audio.encodeWav(piece,sampleRate),{mode:0o600});
        slices.push({file,samples:piece,sampleRate,fallback:take.text||''});
      }
      ctx.progress((n+1)/takes.length);ctx.check();
    }
    if(slices.length<4)throw L.error('voiceEngines.sovits.tooFew');
    ctx.stage('asr',t('voiceEngines.sovits.asrDetail'));
    const lines=[];
    for(const [i,slice] of slices.entries()){
      let text='';
      try{text=transcribe?String(await transcribe(audio.resample(slice.samples,slice.sampleRate,16000))||'').trim():'';}catch{}
      text||=slice.fallback;  // a take read from a single prompt line
      if(text)lines.push(`${slice.file}|voice|${lang}|${text.replace(/[|\r\n]/g,' ')}`);
      ctx.progress((i+1)/slices.length,t('voiceEngines.sovits.sentences',{n:i+1,count:slices.length}));ctx.check();
    }
    if(lines.length<4)throw L.error('voiceEngines.sovits.asrFew');
    const list=path.join(workDir,'voice.list');fs.writeFileSync(list,lines.join('\n')+'\n',{mode:0o600});
    ctx.stage('features',t('voiceEngines.sovits.featuresDetail'));
    const cmd=trainer||{command:env.python,args:[path.join(__dirname,'sovits_train.py')],cwd:env.srcDir};
    let result=null,fatal=null;
    await run(cmd.command,[...cmd.args,'--src',env.srcDir,'--list',list,'--wavs',wavs,'--work',path.join(workDir,'exp'),'--out',outDir,'--gpt-epochs',String(epochs.gpt),'--sovits-epochs',String(epochs.sovits)],
      {cwd:cmd.cwd,signal:ctx.signal,env:{PYTHONUNBUFFERED:'1'},onLine:line=>{
        if(!line.startsWith(PREFIX))return;let m;try{m=JSON.parse(line.slice(PREFIX.length));}catch{return;}
        if(m.fatal)fatal=m.fatal;if(m.done)result=m;
        if(m.stage&&STAGES.some(s=>s.id===m.stage)){ctx.stage(m.stage,m.detail);ctx.progress(m.progress,m.detail);}
      }}).catch(error=>{if(error.name==='AbortError')throw error;throw L.error('voiceEngines.sovits.trainFailed',{error:fatal||error.message});});
    if(!result||!fs.existsSync(path.join(outDir,FILES.gpt))||!fs.existsSync(path.join(outDir,FILES.sovits)))throw L.error(fatal?'voiceEngines.sovits.noModelDetail':'voiceEngines.sovits.noModel',{error:fatal||''});
    // the clearest 3–10 s slice becomes the reference clip
    const best=slices.map((s,i)=>({s,i,a:audio.analyze(s.samples,s.sampleRate)})).filter(x=>x.a.duration>=3&&x.a.duration<=10&&lines[x.i])
      .sort((x,y)=>y.a.speechRatio-x.a.speechRatio)[0]||{s:slices[0],i:0};
    fs.writeFileSync(path.join(outDir,FILES.ref),audio.encodeWav(best.s.samples,best.s.sampleRate),{mode:0o600});
    const refText=(lines[best.i]||'').split('|').slice(3).join('|');
    const params=validate({version:'v2Pro',refText,refLang:lang,source:'trained'});fs.writeFileSync(path.join(outDir,FILES.refText),params.refText,{mode:0o600});
    return {files:Object.values(FILES),params};
  }
  return {
    id:'sovits',get label(){return t('voiceEngines.sovits.label');},get license(){return license();},STAGES,estimateTraining,
    maxFileBytes:1e9,  // trained / community weights are 80–200 MB each
    async available(){
      if(sidecar)return {ok:true};
      if(process.platform==='win32'&&process.arch!=='x64')return {ok:false,reason:t('voiceEngines.armUnsupported',{name:'GPT-SoVITS'})};
      if(installing)return {ok:false,reason:t('voiceEngines.installing',{name:'GPT-SoVITS'}),installing:true};
      return env.installed()&&extrasDone()?{ok:true}:{ok:false,reason:t('voiceEngines.notInstalled',{name:'GPT-SoVITS',size:'4.5'}),install:true};
    },
    install(onProgress,options){installing||=install(onProgress,options).finally(()=>{installing=null;});return installing;},
    validate,importPack,train,
    async speak({text,profile,dir:profileDir,signal}){
      const p=validate(profile?.params);
      for(const f of [FILES.gpt,FILES.sovits,FILES.ref])if(!fs.existsSync(path.join(profileDir,f)))throw L.error('voiceEngines.sovits.modelMissing');
      const clean=String(text||'').trim().slice(0,1000);if(!clean)throw L.error('voiceEngines.noText');
      const out=path.join(os.tmpdir(),`agent-wardrobe-sovits-${process.pid}-${crypto.randomBytes(6).toString('hex')}.wav`);
      try{
        await sidecarProc().request('speak',{text:clean,textLang:p.textLang==='auto'?guessLang(clean):p.textLang,gpt:path.join(profileDir,FILES.gpt),sovits:path.join(profileDir,FILES.sovits),
          ref:path.join(profileDir,FILES.ref),refText:p.refText,refLang:p.refLang,speed:p.speed,topK:p.topK,temperature:p.temperature,out},{signal});
        return {audio:fs.readFileSync(out),mime:'audio/wav'};
      }finally{fs.rmSync(out,{force:true});}
    },
    stop(options){side?.stop(options);},
    get running(){return Boolean(side?.running);}
  };
}
module.exports={create,validate,importPack,sovitsVersion,estimateTraining,STAGES,get PACK_NOTE(){return t(PACK_NOTE_KEY);},get LICENSE(){return license();},FILES,SOURCE,PACKAGES};
