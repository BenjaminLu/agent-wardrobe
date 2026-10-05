// A stand-in for the Python voice sidecars: speaks the same stdio protocol (voice-engines/sidecar.cjs) and "speaks"
// by writing a short tone whose length follows the text. Used by unit tests and the --voicelab-smoke run.
//   VOICE_STANDIN_LOG=<file>  each request is appended as a JSON line
//   VOICE_STANDIN_FAIL=start  report a fatal error instead of becoming ready
// A text containing "[slow]" takes 5 s (for cancel tests).
const fs=require('node:fs');
const say=m=>process.stdout.write('@voice '+JSON.stringify(m)+'\n');
if(process.env.VOICE_STANDIN_FAIL==='start'){say({fatal:'stand-in refused to start'});process.exit(1);}
console.log('some library logging that is not protocol');
const cancelled=new Set();
function tone(seconds,rate=24000){
  const n=Math.round(seconds*rate),out=Buffer.alloc(44+n*2);
  out.write('RIFF',0);out.writeUInt32LE(36+n*2,4);out.write('WAVE',8);out.write('fmt ',12);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);
  out.writeUInt32LE(rate,24);out.writeUInt32LE(rate*2,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++)out.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*220*i/rate)),44+i*2);return out;
}
setTimeout(()=>say({ready:true,device:'standin',sampleRate:24000}),50);
let buffer='';
process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);handle(JSON.parse(line));}});
process.stdin.on('end',()=>process.exit(0));
async function handle(m){
  if(process.env.VOICE_STANDIN_LOG)fs.appendFileSync(process.env.VOICE_STANDIN_LOG,JSON.stringify(m)+'\n');
  if(m.op==='quit')process.exit(0);
  if(m.op==='cancel'){cancelled.add(m.id);return;}
  if(m.op!=='speak'){say({id:m.id,ok:m.op==='ping'});return;}
  if(m.ref&&!fs.existsSync(m.ref)){say({id:m.id,ok:false,error:'reference missing'});return;}
  say({id:m.id,progress:1});
  if(String(m.text).includes('[slow]'))await new Promise(r=>setTimeout(r,5000));
  if(cancelled.has(m.id)){say({id:m.id,ok:false,error:'cancelled'});return;}
  fs.writeFileSync(m.out,tone(Math.min(3,.2+String(m.text).length*.02)));
  say({id:m.id,ok:true,out:m.out,sampleRate:24000});
}
