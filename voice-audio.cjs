// Audio helpers for the voice studio: WAV read/write, the recording quality check (length, loudness, clipping,
// silence), trimming, resampling, slicing a long recording at pauses, and converting imported files with afconvert.
// Everything works on mono Float32 samples in memory.
const fs=require('node:fs');const {execFile}=require('node:child_process');

// PCM 8/16/24/32-bit and 32-bit float WAV (incl. WAVE_FORMAT_EXTENSIBLE); channels are mixed to mono.
function parseWav(buf){
  if(buf.length<44||buf.toString('ascii',0,4)!=='RIFF'||buf.toString('ascii',8,12)!=='WAVE')throw new Error('不是 WAV 檔。');
  let p=12,fmt=null,data=null;
  while(p+8<=buf.length){const id=buf.toString('ascii',p,p+4),size=buf.readUInt32LE(p+4),body=p+8;
    if(id==='fmt '){let format=buf.readUInt16LE(body);if(format===0xfffe&&size>=26)format=buf.readUInt16LE(body+24);fmt={format,channels:buf.readUInt16LE(body+2),sampleRate:buf.readUInt32LE(body+4),bits:buf.readUInt16LE(body+14)};}
    else if(id==='data'){data=buf.subarray(body,Math.min(buf.length,body+size));break;}
    p=body+size+(size&1);}
  if(!fmt||!data)throw new Error('WAV 檔不完整。');
  const {format,channels,bits,sampleRate}=fmt,bytes=bits/8;
  if(!channels||![1,3].includes(format)||![8,16,24,32].includes(bits)||(format===3&&bits!==32))throw new Error('不支援這種 WAV 格式。');
  const frames=Math.floor(data.length/(bytes*channels)),samples=new Float32Array(frames);
  const read=format===3?o=>data.readFloatLE(o):bits===16?o=>data.readInt16LE(o)/32768:bits===24?o=>data.readIntLE(o,3)/8388608:bits===32?o=>data.readInt32LE(o)/2147483648:o=>(data[o]-128)/128;
  for(let i=0;i<frames;i++){let sum=0;for(let c=0;c<channels;c++)sum+=read((i*channels+c)*bytes);samples[i]=sum/channels;}
  return {sampleRate,channels,samples};
}
// 16-bit PCM mono WAV.
function encodeWav(samples,sampleRate){
  const out=Buffer.alloc(44+samples.length*2);
  out.write('RIFF',0,'ascii');out.writeUInt32LE(36+samples.length*2,4);out.write('WAVE',8,'ascii');out.write('fmt ',12,'ascii');out.writeUInt32LE(16,16);
  out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(sampleRate,24);out.writeUInt32LE(sampleRate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);
  out.write('data',36,'ascii');out.writeUInt32LE(samples.length*2,40);
  for(let i=0;i<samples.length;i++){const s=Math.max(-1,Math.min(1,samples[i]));out.writeInt16LE(Math.round(s<0?s*32768:s*32767),44+i*2);}
  return out;
}
const db=x=>x>0?20*Math.log10(x):-120;
// Loudness per 20 ms frame; a frame counts as voiced above -45 dBFS.
function frames(samples,sampleRate,ms=20){const n=Math.max(1,Math.round(sampleRate*ms/1000)),out=[];for(let i=0;i<samples.length;i+=n){let sum=0;const end=Math.min(samples.length,i+n);for(let j=i;j<end;j++)sum+=samples[j]*samples[j];out.push(Math.sqrt(sum/Math.max(1,end-i)));}return {rms:out,size:n};}
const VOICED_DB=-45;
function analyze(samples,sampleRate){
  let peak=0,sum=0,clipped=0;for(let i=0;i<samples.length;i++){const a=Math.abs(samples[i]);if(a>peak)peak=a;sum+=a*a;if(a>=.999)clipped++;}
  const {rms,size}=frames(samples,sampleRate),voiced=rms.filter(r=>db(r)>VOICED_DB);
  const speechRms=voiced.length?Math.sqrt(voiced.reduce((a,r)=>a+r*r,0)/voiced.length):0;
  return {duration:samples.length/sampleRate,peakDb:+db(peak).toFixed(1),rmsDb:+db(Math.sqrt(sum/Math.max(1,samples.length))).toFixed(1),speechDb:+db(speechRms).toFixed(1),
    clippedRatio:samples.length?clipped/samples.length:0,speechSeconds:+(voiced.length*size/sampleRate).toFixed(2),speechRatio:rms.length?voiced.length/rms.length:0};
}
// What each engine needs from one recording (seconds of actual speech).
const NEEDS={cosyvoice:{min:3,ideal:[5,15],max:30},sovits:{min:3,ideal:[5,600],max:900},elevenlabs:{min:10,ideal:[30,180],max:600}};
// {ok, issues:[{code,message}]}: an issue blocks using the take; a warning (level 'warn') does not.
function qualityCheck(a,engine='cosyvoice'){
  const need=NEEDS[engine]||NEEDS.cosyvoice,issues=[];
  const add=(code,message,level='error')=>issues.push({code,message,level});
  if(a.speechSeconds<.5||a.peakDb<-50)add('silent','幾乎沒有聲音：麥克風有收到嗎？');
  else{
    if(a.speechDb<-35)add('too-quiet','太小聲了：靠近麥克風一點，或把輸入音量調大。');
    else if(a.speechDb<-28)add('quiet','有點小聲，靠近一點會更好。','warn');
    if(a.clippedRatio>.001)add('clipping','爆音了（聲音太大被削掉）：離麥克風遠一點，或調低輸入音量。');
    else if(a.peakDb>-.5)add('hot','音量接近上限，小心爆音。','warn');
    if(a.speechSeconds<need.min)add('too-short',`太短了：至少要說 ${need.min} 秒（現在約 ${a.speechSeconds.toFixed(1)} 秒）。`);
    else if(a.speechSeconds<need.ideal[0])add('short',`再長一點更好（建議 ${need.ideal[0]} 秒以上）。`,'warn');
    if(a.duration>need.max)add('too-long',`太長了：這個方式最多 ${need.max} 秒。`);
    else if(a.speechSeconds>need.ideal[1]&&engine==='cosyvoice')add('long',`會只用最清楚的前 ${need.ideal[1]} 秒左右。`,'warn');
    if(a.speechRatio<.3&&a.duration>3)add('mostly-silent','大部分是安靜的：開始後直接念，念完就停。','warn');
  }
  return {ok:!issues.some(i=>i.level==='error'),issues};
}
// Cuts leading and trailing silence, keeping a little padding.
function trimSilence(samples,sampleRate,{pad=.15}={}){
  const {rms,size}=frames(samples,sampleRate),voiced=rms.map(r=>db(r)>VOICED_DB);
  const first=voiced.indexOf(true),last=voiced.lastIndexOf(true);if(first<0)return samples.subarray(0,0);
  const p=Math.round(pad*sampleRate);return samples.subarray(Math.max(0,first*size-p),Math.min(samples.length,(last+1)*size+p));
}
// Keeps at most `seconds`, ending at a pause when there is one.
function limitLength(samples,sampleRate,seconds){
  const max=Math.round(seconds*sampleRate);if(samples.length<=max)return samples;
  const {rms,size}=frames(samples,sampleRate);let cut=max;
  for(let f=Math.floor(max/size);f>Math.floor(max/size*.6);f--)if(db(rms[f])<VOICED_DB){cut=f*size;break;}
  return samples.subarray(0,cut);
}
function resample(samples,from,to){
  if(from===to)return samples;const ratio=from/to,out=new Float32Array(Math.floor(samples.length/ratio));
  for(let i=0;i<out.length;i++){const pos=i*ratio,j=Math.floor(pos),f=pos-j;out[i]=samples[j]+((j+1<samples.length?samples[j+1]:samples[j])-samples[j])*f;}
  return out;
}
// Splits a long recording at pauses (≥ 300 ms quiet) into pieces of min–max seconds, for GPT-SoVITS training.
function sliceOnSilence(samples,sampleRate,{min=2,max=10,gap=.3}={}){
  const {rms,size}=frames(samples,sampleRate),quiet=rms.map(r=>db(r)<=VOICED_DB),need=Math.round(gap*1000/20);
  const cuts=[0];let run=0;
  for(let f=0;f<quiet.length;f++){run=quiet[f]?run+1:0;const at=(f-Math.floor(run/2))*size,len=(at-cuts.at(-1))/sampleRate;
    if((run>=need&&len>=min)||len>=max){cuts.push(at);run=0;}}
  cuts.push(samples.length);
  const pieces=[];for(let i=0;i+1<cuts.length;i++){const piece=trimSilence(samples.subarray(cuts[i],cuts[i+1]),sampleRate,{pad:.1});if(piece.length/sampleRate>=Math.min(1.5,min))pieces.push(piece);}
  return pieces;
}
// Imported audio (wav, mp3, m4a, aac, aiff, caf…) → 16-bit mono WAV at `rate`, with macOS's afconvert.
function convertToWav(input,output,{rate=24000,afconvert='/usr/bin/afconvert',timeout=120000}={}){
  return new Promise((resolve,reject)=>execFile(afconvert,['-f','WAVE','-d',`LEI16@${rate}`,'-c','1',input,output],{timeout},(error,_out,stderr)=>{
    if(error){fs.rmSync(output,{force:true});reject(new Error(`這個音檔轉不了（${String(stderr||error.message).trim().split('\n')[0].slice(0,120)}）。請用 wav、mp3 或 m4a。`));}else resolve(output);}));
}
module.exports={parseWav,encodeWav,analyze,qualityCheck,trimSilence,limitLength,resample,sliceOnSilence,convertToWav,NEEDS};
