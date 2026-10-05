// Local AI voice: Kokoro v1.0 (Apache-2.0) through sherpa-onnx. Runs offline on this Mac.
const {renameRetry}=require('./platform.cjs');
// The ~400 MB model is downloaded once from a pinned Hugging Face revision and its large files are hash-checked.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');

const REPO='csukuangfj/kokoro-multi-lang-v1_0';
const REVISION='f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b';
const HASHES={
  'model.onnx':'b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11',
  'voices.bin':'1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29',
  'lexicon-us-en.txt':'7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14',
  'lexicon-zh.txt':'902bc2d20ac7c449c5ecbbbb23c89d12119c03ed5b8ed27f114f0260c9e35229'
};
const REQUIRED=['model.onnx','voices.bin','tokens.txt','lexicon-us-en.txt','lexicon-zh.txt','date-zh.fst','number-zh.fst','phone-zh.fst'];
// Speaker IDs from the model's metadata; Chinese and English voices are the ones its lexicons cover well.
const VOICES=[
  ['zf_xiaoxiao',47,'zh'],['zf_xiaobei',45,'zh'],['zf_xiaoni',46,'zh'],['zf_xiaoyi',48,'zh'],
  ['zm_yunxi',50,'zh'],['zm_yunjian',49,'zh'],['zm_yunxia',51,'zh'],['zm_yunyang',52,'zh'],
  ['af_heart',3,'en'],['af_bella',2,'en'],['af_nicole',6,'en'],['af_sky',10,'en'],['am_michael',16,'en'],['am_adam',11,'en'],['bf_emma',21,'en'],['bm_george',26,'en']
].map(([name,sid,lang])=>({name,sid,lang}));

const fileUrl=name=>`https://huggingface.co/${REPO}/resolve/${REVISION}/${name.split('/').map(encodeURIComponent).join('/')}`;
function installed(dir){return REQUIRED.every(name=>{try{return fs.statSync(path.join(dir,name)).size>0;}catch{return false;}})&&fs.existsSync(path.join(dir,'.complete'));}
async function sha256(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}

// Downloads into a temporary folder and only swaps it in when every file arrived and verified.
async function install(dir,{onProgress=()=>{},signal,fetchImpl=fetch,hashes=HASHES,fileBase=null,listUrl=`https://huggingface.co/api/models/${REPO}/revision/${REVISION}?blobs=true`}={}){
  const listing=await (await fetchImpl(listUrl,{signal})).json();
  const files=listing.siblings.filter(f=>!/^\.|README|\.py$/.test(f.rfilename)&&!/["\\]|\.\.|^\//.test(f.rfilename)).map(f=>({name:f.rfilename,size:f.size||0}));
  for(const name of REQUIRED)if(!files.some(f=>f.name===name))throw new Error(`Voice model listing is missing ${name}`);
  const total=files.reduce((n,f)=>n+f.size,0);let done=0;
  const temp=`${dir}.partial`;fs.mkdirSync(temp,{recursive:true});
  const queue=[...files];
  async function worker(){
    for(let file=queue.shift();file;file=queue.shift()){
      const target=path.join(temp,file.name);if(!target.startsWith(temp+path.sep))throw new Error('Unsafe model path');
      fs.mkdirSync(path.dirname(target),{recursive:true});
      if(fs.existsSync(target)&&fs.statSync(target).size===file.size&&file.size>0){done+=file.size;onProgress(done/total);continue;}
      const response=await fetchImpl(fileBase?`${fileBase}/${file.name}`:fileUrl(file.name),{signal,redirect:'follow'});
      if(!response.ok){if(REQUIRED.includes(file.name))throw new Error(`Download failed for ${file.name} (${response.status})`);continue;}
      const out=fs.createWriteStream(target);
      for await(const chunk of response.body){out.write(chunk);done+=chunk.length;onProgress(Math.min(1,done/total));}
      await new Promise((resolve,reject)=>out.end(error=>error?reject(error):resolve()));
    }
  }
  await Promise.all(Array.from({length:6},worker));
  for(const [name,hash] of Object.entries(hashes))if(await sha256(path.join(temp,name))!==hash){fs.rmSync(temp,{recursive:true,force:true});throw new Error(`${name} failed its integrity check; download again.`);}
  fs.writeFileSync(path.join(temp,'.complete'),REVISION);
  fs.rmSync(dir,{recursive:true,force:true});renameRetry(temp,dir);
}

class Kokoro{
  constructor(dir,{sherpa}={}){this.dir=dir;this.sherpa=sherpa;this.tts=null;}
  load(){
    if(this.tts)return this.tts;
    if(!installed(this.dir))throw new Error('本機語音模型尚未下載。到 AI 設定 → 語音 → 下載。');
    const sherpa=this.sherpa||require('sherpa-onnx-node');const d=name=>path.join(this.dir,name);
    this.tts=new sherpa.OfflineTts({model:{kokoro:{model:d('model.onnx'),voices:d('voices.bin'),tokens:d('tokens.txt'),dataDir:d('espeak-ng-data'),dictDir:d('dict'),lexicon:`${d('lexicon-us-en.txt')},${d('lexicon-zh.txt')}`},numThreads:2,provider:'cpu'},ruleFsts:`${d('date-zh.fst')},${d('phone-zh.fst')},${d('number-zh.fst')}`,maxNumSentences:1});
    return this.tts;
  }
  // Returns WAV bytes. Async generation keeps the app responsive while the model runs.
  async synthesize(text,voice,speed=1){
    const entry=VOICES.find(v=>v.name===voice)||VOICES[0];const tts=this.load();
    // Electron forbids external ArrayBuffers, so samples are copied into V8 memory.
    const audio=await tts.generateAsync({text:String(text).slice(0,2000),sid:entry.sid,speed:Math.max(.6,Math.min(1.6,Number(speed)||1)),enableExternalBuffer:false});
    return wav(audio.samples,audio.sampleRate);
  }
}
function wav(samples,rate){
  const data=Buffer.alloc(samples.length*2);for(let i=0;i<samples.length;i++)data.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(samples[i]*32767))),i*2);
  const head=Buffer.alloc(44);head.write('RIFF',0);head.writeUInt32LE(36+data.length,4);head.write('WAVE',8);head.write('fmt ',12);head.writeUInt32LE(16,16);head.writeUInt16LE(1,20);head.writeUInt16LE(1,22);head.writeUInt32LE(rate,24);head.writeUInt32LE(rate*2,28);head.writeUInt16LE(2,32);head.writeUInt16LE(16,34);head.write('data',36);head.writeUInt32LE(data.length,40);
  return Buffer.concat([head,data]);
}
// Speak sentence by sentence so the first words play while the rest is still being generated.
function sentences(text){return String(text).replace(/\s*\n\s*/g,'\n').replace(/([.!?])\s+/g,'$1\n').replace(/([。！？；])/g,'$1\n').split('\n').map(s=>s.trim()).filter(Boolean);}
module.exports={Kokoro,install,installed,sentences,wav,VOICES,REQUIRED,REVISION};
