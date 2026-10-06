// Hands-free input: a local wake word ("嘿安妮" / "Hey Annie"), then local speech recognition of what follows.
const {renameRetry}=require('./platform.cjs');
const L=require('./locales.cjs');
// Audio is processed in memory on this Mac and never stored or sent anywhere.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {pinyin}=require('pinyin-pro');

const INITIALS=['zh','ch','sh','b','p','m','f','d','t','n','l','g','k','h','j','q','x','r','z','c','s','y','w'];
// One syllable with tone marks -> keyword-spotter tokens: initial + toned final ("ān" stays one token).
function syllableTokens(syllable){const initial=INITIALS.find(i=>syllable.startsWith(i)&&syllable.length>i.length);return initial?[initial,syllable.slice(initial.length)]:[syllable];}
const TONES={a:'āáǎàa',e:'ēéěèe',i:'īíǐìi',o:'ōóǒòo',u:'ūúǔùu',ü:'ǖǘǚǜü'};
const PLAIN=Object.fromEntries(Object.entries(TONES).flatMap(([base,forms])=>[...forms].map(f=>[f,base])));
// Every tone of a toned final ("ān" -> ān án ǎn àn an), keeping only forms the model knows.
function toneForms(final,tokens){
  const i=[...final].findIndex(ch=>PLAIN[ch]&&PLAIN[ch]!==ch);if(i<0)return [final];
  const chars=[...final],base=PLAIN[chars[i]];
  return [...new Set([...TONES[base]].map(t=>{const c=[...chars];c[i]=t;return c.join('');}))].filter(f=>tokens.has(f));
}
function loadEnglish(file){const map=new Map();for(const line of fs.readFileSync(file,'utf8').split('\n')){const [word,...phones]=line.trim().split(/\s+/);if(word&&phones.length&&!map.has(word))map.set(word,phones.join(' '));}return map;}
// A wake phrase may mix Chinese characters and English words; every token must exist in the model.
function keywordLine(phrase,ctx){return keywordLines(phrase,{...ctx,tones:false})[0];}
// All spellings of a phrase the spotter should accept; tone variants are capped to keep the graph small.
function keywordLines(phrase,{tokens,english,tones=true}){
  const text=String(phrase).trim();if(!text||text.length>30)throw L.error('wake.phraseLength');
  const out=[];
  for(const part of text.match(/[㐀-鿿]+|[A-Za-z']+/g)||[]){
    if(/[A-Za-z]/.test(part)){const phones=english.get(part.toUpperCase());if(!phones)throw L.error('wake.unknownEnglishWord',{word:part});out.push(...phones.split(' '));}
    else for(const syllable of pinyin(part,{type:'array'}))out.push(...syllableTokens(syllable));
  }
  if(!out.length)throw L.error('wake.needLetters');
  const missing=out.filter(token=>!tokens.has(token));if(missing.length)throw L.error('wake.unsupportedSounds',{sounds:missing.join(' ')});
  const label=`@${text.replace(/\s+/g,'_')}`;
  let variants=[[]];
  for(const token of out){const forms=tones?toneForms(token,tokens):[token];const next=[];for(const v of variants)for(const f of forms)next.push([...v,f]);variants=next.length>200?variants.map(v=>[...v,token]):next;}
  return variants.map(v=>`${v.join(' ')} ${label}`);
}
function loadTokens(file){return new Set(fs.readFileSync(file,'utf8').split('\n').map(line=>line.trim().split(/\s+/)[0]).filter(Boolean));}

class WakeWord{
  constructor(dir,{sherpa,keywordsFile}){this.dir=dir;this.sherpa=sherpa||require('sherpa-onnx-node');this.keywordsFile=keywordsFile;this.spotter=null;this.stream=null;}
  configure(phrases,sensitivity='high'){
    const d=name=>path.join(this.dir,name);
    const tokens=loadTokens(d('tokens.txt'));this.english||=loadEnglish(d('en.phone'));
    const lines=phrases.flatMap(p=>keywordLines(p,{tokens,english:this.english}));
    fs.writeFileSync(this.keywordsFile,lines.join('\n')+'\n');
    this.spotter=new this.sherpa.KeywordSpotter({featConfig:{sampleRate:16000,featureDim:80},
      modelConfig:{transducer:{encoder:d('encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx'),decoder:d('decoder-epoch-13-avg-2-chunk-16-left-64.onnx'),joiner:d('joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx')},tokens:d('tokens.txt'),numThreads:1,provider:'cpu'},
      keywordsFile:this.keywordsFile,...(sensitivity==='high'?{keywordsThreshold:.08,keywordsScore:2.5}:{keywordsThreshold:.15,keywordsScore:1.5}),numTrailingBlanks:1});
    this.stream=this.spotter.createStream();return lines;
  }
  // Feed 16 kHz mono samples; returns the phrase when it was just spoken.
  accept(samples){
    if(!this.spotter)return null;this.stream.acceptWaveform({samples,sampleRate:16000});
    while(this.spotter.isReady(this.stream)){this.spotter.decode(this.stream);const result=this.spotter.getResult(this.stream);if(result.keyword){this.spotter.reset(this.stream);return result.keyword.replace(/_/g,' ');}}
    return null;
  }
}

// After the wake word: wait for speech, stop at a pause, then transcribe the whole utterance.
class Dictation{
  constructor(dir,{sherpa,convert}={}){this.dir=dir;this.sherpa=sherpa||require('sherpa-onnx-node');this.convert=convert||(text=>text);this.vad=null;this.recognizer=null;}
  load(){
    if(this.recognizer)return;const d=name=>path.join(this.dir,name);
    this.recognizer=new this.sherpa.OfflineRecognizer({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{senseVoice:{model:d('model.int8.onnx'),language:'auto',useInverseTextNormalization:1},tokens:d('tokens.txt'),numThreads:2,provider:'cpu'}});
    this.vadConfig={sileroVad:{model:d('silero_vad.onnx'),threshold:.5,minSpeechDuration:.25,minSilenceDuration:.8,maxSpeechDuration:20,windowSize:512},sampleRate:16000,numThreads:1,provider:'cpu'};
  }
  begin(){this.load();this.vad=new this.sherpa.Vad(this.vadConfig,30);this.pending=new Float32Array(0);this.heard=false;}
  // Returns {done:true,text} once a full utterance ended; the caller handles timeouts for silence.
  accept(samples){
    const all=new Float32Array(this.pending.length+samples.length);all.set(this.pending);all.set(samples,this.pending.length);
    let offset=0;for(;offset+512<=all.length;offset+=512)this.vad.acceptWaveform(all.subarray(offset,offset+512));
    this.pending=all.slice(offset);if(this.vad.isDetected())this.heard=true;
    if(!this.vad.isEmpty()){const segment=this.vad.front(false);this.vad.pop();return {done:true,text:this.transcribe(segment.samples)};}
    return {done:false,heard:this.heard};
  }
  finish(){this.vad?.flush();if(this.vad&&!this.vad.isEmpty()){const segment=this.vad.front(false);this.vad.pop();return this.transcribe(segment.samples);}return '';}
  transcribe(samples){
    const stream=this.recognizer.createStream();stream.acceptWaveform({samples,sampleRate:16000});this.recognizer.decode(stream);
    const text=String(this.recognizer.getResult(stream).text||'').trim();return text?this.convert(text):'';
  }
}
// Speech recognition model (SenseVoice int8, multilingual) + Silero VAD: downloaded once, pinned and hash-checked.
const ASR_FILES=[
  {name:'model.int8.onnx',url:'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/355f4d4884d8afd08aef04b9007a8556d7b463b2/model.int8.onnx',size:237115547,sha256:'12ca1a2ae7ecf3e0019ef2822307ee0b5cadc9196569e379b4c4026f8205276d'},
  {name:'tokens.txt',url:'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09/resolve/355f4d4884d8afd08aef04b9007a8556d7b463b2/tokens.txt',size:315894},
  {name:'silero_vad.onnx',url:'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',size:643854,sha256:'9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6'}
];
function asrInstalled(dir){return fs.existsSync(path.join(dir,'.complete'))&&ASR_FILES.every(f=>fs.existsSync(path.join(dir,f.name)));}
async function installAsr(dir,{onProgress=()=>{},files=ASR_FILES,fetchImpl=fetch}={}){
  const temp=`${dir}.partial`;fs.mkdirSync(temp,{recursive:true});const total=files.reduce((n,f)=>n+f.size,0);let done=0;
  for(const file of files){
    const target=path.join(temp,file.name);
    if(!(fs.existsSync(target)&&fs.statSync(target).size===file.size)){
      const response=await fetchImpl(file.url,{redirect:'follow'});if(!response.ok)throw L.error('speech.asrDownloadFailed',{name:file.name,status:response.status});
      const out=fs.createWriteStream(target);for await(const chunk of response.body){out.write(chunk);done+=chunk.length;onProgress(Math.min(1,done/total));}
      await new Promise((resolve,reject)=>out.end(error=>error?reject(error):resolve()));
    }else{done+=file.size;onProgress(done/total);}
    if(file.sha256){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(target))hash.update(chunk);if(hash.digest('hex')!==file.sha256){fs.rmSync(temp,{recursive:true,force:true});throw L.error('speech.verifyFailed',{name:file.name});}}
  }
  fs.writeFileSync(path.join(temp,'.complete'),'ok');fs.rmSync(dir,{recursive:true,force:true});renameRetry(temp,dir);
}
module.exports={keywordLines,toneForms,installAsr,asrInstalled,ASR_FILES,WakeWord,Dictation,keywordLine,syllableTokens,loadTokens,loadEnglish};
