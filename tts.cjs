// AI text-to-speech providers and the encrypted store for their API keys.
// Keys are encrypted with Electron safeStorage (backed by the macOS Keychain), never sent to pages,
// and only ever sent to the provider's own API host.
const fs=require('node:fs');const path=require('node:path');const L=require('./locales.cjs');

const OPENAI_VOICES=['marin','cedar','alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse'];
const OPENAI_MODELS=['gpt-4o-mini-tts','tts-1','tts-1-hd'];
const OPENAI_BASE='https://api.openai.com/v1';
const MAX_INPUT=4096;

class Secrets{
  constructor(file,safeStorage){this.file=file;this.safe=safeStorage;}
  read(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return {};}}
  write(data){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data),{mode:0o600});fs.chmodSync(temp,0o600);fs.renameSync(temp,this.file);}
  has(name){return Boolean(this.read()[name]);}
  get(name){const value=this.read()[name];return value?this.safe.decryptString(Buffer.from(value,'base64')):null;}
  set(name,value){
    if(!this.safe.isEncryptionAvailable())throw L.error(process.platform==='linux'?'tts.keyring.linux':'tts.keyring.unavailable');
    const data=this.read();data[name]=this.safe.encryptString(value).toString('base64');this.write(data);
  }
  clear(name){const data=this.read();delete data[name];this.write(data);}
}
// Project and service-account keys (sk-proj-, sk-svcacct-) can be long; only reject what cannot be a key.
function looksLikeOpenAIKey(value){return typeof value==='string'&&/^sk-[A-Za-z0-9_\-]{16,512}$/.test(value);}

async function openaiSpeech({key,text,voice,model,instructions,base=OPENAI_BASE,signal}){
  if(!key)throw L.error('tts.openai.noKey');
  if(!OPENAI_VOICES.includes(voice))throw new Error(`Unknown OpenAI voice ${voice}`);
  if(!OPENAI_MODELS.includes(model))throw new Error(`Unknown OpenAI speech model ${model}`);
  const body={model,voice,input:String(text).slice(0,MAX_INPUT),response_format:'mp3'};
  // Only gpt-4o-mini-tts understands style instructions.
  if(model==='gpt-4o-mini-tts'&&instructions)body.instructions=String(instructions).slice(0,1000);
  let response;
  try{response=await fetch(`${base}/audio/speech`,{method:'POST',redirect:'error',signal:signal||AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(body)});}
  catch(error){if(error.name==='AbortError')throw error;throw L.error('tts.openai.unreachable');}
  if(!response.ok){
    // The provider's own message can echo the key back; never surface it.
    if(response.status===401)throw L.error('tts.openai.invalidKey');
    if(response.status===403)throw L.error('tts.openai.noPermission');
    if(response.status===429){
      // Only the error code is read from the body; its message may quote the key.
      let code='';try{code=String((await response.json())?.error?.code||'');}catch{}
      const error=L.error(code==='insufficient_quota'?'tts.openai.noQuota':'tts.openai.rateLimit');
      error.code=code||'rate_limit';throw error;
    }
    throw L.error('tts.openai.error',{status:response.status});
  }
  return Buffer.from(await response.arrayBuffer());
}
module.exports={Secrets,openaiSpeech,looksLikeOpenAIKey,OPENAI_VOICES,OPENAI_MODELS};
