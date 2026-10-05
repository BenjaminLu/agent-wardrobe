// 萌系混音: new voices blended from Kokoro v1.0 speakers, with pitch and speed.
// sherpa-onnx reads Kokoro's voices.bin as raw float32 [speakers][510][256] and refuses a file whose size does not match the model's
// speaker count, so a mix is a copy of voices.bin with speaker 0's style replaced by the weighted blend, spoken as sid 0.
// Pitch is shifted afterwards on the PCM in pure JS (WSOLA time-stretch, then resampling back to the original length).
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const kokoro=require('../kokoro.cjs');

const ROWS=510,DIM=256,PER=ROWS*DIM;
const PRESETS=[
  {id:'moe',name:'萌系少女',mix:[['zf_xiaoyi',.6],['zf_xiaobei',.4]],pitch:3,speed:1.05},
  {id:'genki',name:'元氣妹妹',mix:[['zf_xiaobei',.7],['zf_xiaoxiao',.3]],pitch:4,speed:1.15},
  {id:'onee',name:'溫柔姊姊',mix:[['zf_xiaoxiao',.7],['zf_xiaoni',.3]],pitch:-1,speed:.92},
  {id:'tsundere',name:'傲嬌',mix:[['zf_xiaoni',.6],['zf_xiaoyi',.4]],pitch:2,speed:1.08},
  {id:'shonen',name:'少年',mix:[['zm_yunxi',.7],['zf_xiaobei',.3]],pitch:2,speed:1.05}
].map(p=>({...p,mix:p.mix.map(([voice,weight])=>({voice,weight}))}));
const LICENSE={label:'Kokoro-82M 混音（Apache-2.0）',commercial:true,credit:null,tier:'open'};

function validate(params){
  const mix=params?.mix;
  if(!Array.isArray(mix)||!mix.length||mix.length>4)throw new Error('混音要選 1 到 4 個聲音。');
  for(const m of mix){if(!kokoro.VOICES.some(v=>v.name===m?.voice))throw new Error(`不認得的 Kokoro 聲音：${String(m?.voice).slice(0,40)}`);if(!(Number.isFinite(m.weight)&&m.weight>=0&&m.weight<=1))throw new Error('混音比例要在 0 到 100% 之間。');}
  if(!(mix.reduce((n,m)=>n+m.weight,0)>0))throw new Error('混音比例加起來不能是 0。');
  if(params.pitch!=null&&!(Number.isFinite(params.pitch)&&params.pitch>=-8&&params.pitch<=8))throw new Error('音高要在 -8 到 +8 半音之間。');
  if(params.speed!=null&&!(Number.isFinite(params.speed)&&params.speed>=.6&&params.speed<=1.6))throw new Error('語速要在 0.6× 到 1.6× 之間。');
}
// Weighted average of the speakers' style tables, weights normalised to 1.
function blend(voices,mix){
  const f=voices instanceof Float32Array?voices:new Float32Array(voices.buffer,voices.byteOffset,voices.length>>2);
  const speakers=f.length/PER;if(!Number.isInteger(speakers))throw new Error('voices.bin 的大小不是 Kokoro 的格式。');
  const total=mix.reduce((n,m)=>n+m.weight,0),out=new Float32Array(PER);
  for(const {sid,weight} of mix){if(sid>=speakers)throw new Error('voices.bin 裡沒有這個聲音。');const w=weight/total,base=sid*PER;for(let i=0;i<PER;i++)out[i]+=w*f[base+i];}
  return out;
}
// The derived voices file: the original with speaker 0 replaced.
function derive(voices,style){const copy=Buffer.from(voices);Buffer.from(style.buffer,style.byteOffset,style.byteLength).copy(copy,0);return copy;}

// --- pitch: stretch the sound by r without changing its pitch (WSOLA), then play it r times faster → same length, pitch × r.
function stretch(x,factor,rate){
  const N=Math.max(64,Math.round(rate*.03))&~1,hs=N>>1,ha=hs/factor,tol=Math.round(rate*.008),win=new Float32Array(N);
  for(let i=0;i<N;i++)win[i]=.5-.5*Math.cos(2*Math.PI*i/N);
  const frames=Math.ceil(x.length*factor/hs)+1,out=new Float32Array(frames*hs+N),norm=new Float32Array(out.length);
  const at=i=>i>=0&&i<x.length?x[i]:0;let prev=0;
  for(let k=0;k<frames;k++){
    const nominal=Math.round(k*ha);let best=nominal;
    if(k>0){let score=-Infinity;const natural=prev+hs;
      for(let d=-tol;d<=tol;d+=2){const s=nominal+d;let c=0;for(let j=0;j<hs;j+=2)c+=at(natural+j)*at(s+j);if(c>score){score=c;best=s;}}}
    for(let j=0;j<N;j++){out[k*hs+j]+=win[j]*at(best+j);norm[k*hs+j]+=win[j];}
    prev=best;
  }
  for(let i=0;i<out.length;i++)if(norm[i]>1e-3)out[i]/=norm[i];
  return out.subarray(0,Math.round(x.length*factor));
}
function pitchShift(samples,rate,semitones){
  if(!semitones)return samples;
  const r=2**(semitones/12),long=stretch(samples,r,rate),out=new Float32Array(samples.length);
  for(let i=0;i<out.length;i++){const p=i*r,a=Math.floor(p),t=p-a;out[i]=(long[a]||0)*(1-t)+(long[a+1]||0)*t;}
  return out;
}

function createKokoroMix({modelDir,cacheDir,sherpa,install}){
  let loaded=null;  // one derived model at a time: {hash, tts}
  const dir=()=>typeof modelDir==='function'?modelDir():modelDir;
  function ttsFor(params){
    if(!kokoro.installed(dir()))throw new Error('萌系混音需要本機 Kokoro 語音模型。到 AI 設定 → 語音 → 本機 AI 語音 → 下載。');
    const mix=params.mix.map(m=>({sid:kokoro.VOICES.find(v=>v.name===m.voice).sid,weight:m.weight}));
    const hash=crypto.createHash('sha256').update(JSON.stringify(mix)).digest('hex').slice(0,16);
    if(loaded?.hash===hash)return loaded.tts;
    const voices=fs.readFileSync(path.join(dir(),'voices.bin'));const file=path.join(cacheDir,`voices-${hash}.bin`);
    fs.mkdirSync(cacheDir,{recursive:true});
    // only the file in use is kept; each derived copy is as big as voices.bin (~28 MB)
    for(const name of fs.readdirSync(cacheDir))if(/^voices-[0-9a-f]+\.bin$/.test(name)&&name!==path.basename(file))fs.rmSync(path.join(cacheDir,name),{force:true});
    if(!fs.existsSync(file)){const temp=`${file}.tmp`;fs.writeFileSync(temp,derive(voices,blend(voices,mix)));fs.renameSync(temp,file);}
    const S=sherpa||require('sherpa-onnx-node'),d=name=>path.join(dir(),name);
    const tts=new S.OfflineTts({model:{kokoro:{model:d('model.onnx'),voices:file,tokens:d('tokens.txt'),dataDir:d('espeak-ng-data'),dictDir:d('dict'),lexicon:`${d('lexicon-us-en.txt')},${d('lexicon-zh.txt')}`},numThreads:2,provider:'cpu'},ruleFsts:`${d('date-zh.fst')},${d('phone-zh.fst')},${d('number-zh.fst')}`,maxNumSentences:1});
    loaded={hash,tts};return tts;
  }
  return {
    id:'kokoro-mix',label:'萌系混音（Kokoro 本機）',presets:PRESETS,
    available:async()=>kokoro.installed(dir())?{ok:true}:{ok:false,reason:'要先下載本機 Kokoro 語音模型（約 400 MB）。',install:true},
    install:install?onProgress=>install(onProgress):undefined,
    validate,
    profile:async()=>({license:LICENSE}),
    async speak({text,profile,signal}){
      validate(profile.params);const tts=ttsFor(profile.params);
      const audio=await tts.generateAsync({text:String(text).slice(0,2000),sid:0,speed:profile.params.speed||1,enableExternalBuffer:false});
      if(signal?.aborted){const error=new Error('aborted');error.name='AbortError';throw error;}
      return {audio:kokoro.wav(pitchShift(audio.samples,audio.sampleRate,profile.params.pitch||0),audio.sampleRate),mime:'audio/wav'};
    },
    get loadedHash(){return loaded?.hash||null;}
  };
}
module.exports={createKokoroMix,blend,derive,pitchShift,stretch,validate,PRESETS,LICENSE,PER};
