// The operating system's own voice, for the 「系統語音」 setting:
//  macOS   say, streaming straight to the speakers (speech.cjs keeps that path; it starts speaking fastest)
//  Windows SAPI through PowerShell's System.Speech, one long-lived process that writes each sentence to a WAV
//  Linux   espeak-ng writing a WAV (played in the app like every other voice), or spd-say speaking directly
// Voices follow the text: kana → Japanese, CJK → Chinese (Taiwan first), otherwise the system language or English.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');const {spawn,spawnSync}=require('node:child_process');
const {which}=require('./platform.cjs');const L=require('./locales.cjs');

const langOf=text=>/[぀-ヿ]/.test(text)?'ja':/[㐀-鿿]/.test(text)?'zh':'en';
const MAC_VOICES={ja:'Kyoko',zh:'Eddy (Chinese (Taiwan))'};
// SAPI culture preferences per language.
const CULTURES={zh:['zh-TW','zh-HK','zh-CN'],ja:['ja-JP'],en:['en-US','en-GB','en-AU','en-IN']};
function pickSapi(voices,lang,fallback='en-US'){
  for(const c of [...(CULTURES[lang]||[]),fallback,...CULTURES.en]){const v=voices.find(x=>String(x.culture).toLowerCase()===c.toLowerCase());if(v)return v.name;}
  return voices.find(x=>String(x.culture).toLowerCase().startsWith(lang))?.name||voices[0]?.name||null;
}
// espeak-ng voice names (cmn = Mandarin).
const ESPEAK={zh:'cmn',ja:'ja',en:'en-us'};

const SAPI_SCRIPT=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$s=New-Object System.Speech.Synthesis.SpeechSynthesizer
$v=@($s.GetInstalledVoices()|Where-Object{$_.Enabled}|ForEach-Object{@{name=$_.VoiceInfo.Name;culture=$_.VoiceInfo.Culture.Name}})
'@voices '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -Compress -InputObject $v)))
while(($line=[Console]::In.ReadLine()) -ne $null){
  $r=$line|ConvertFrom-Json
  try{if($r.voice){$s.SelectVoice($r.voice)};$s.Rate=[int]$r.rate;$s.SetOutputToWaveFile($r.out);$s.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($r.text)));$s.SetOutputToNull();'@done '+$r.id}
  catch{$s.SetOutputToNull();'@error '+$r.id+' '+$_.Exception.Message}
}`;

// One PowerShell for the app's lifetime (it takes about a second to start), started on first use.
function createSapi({spawnImpl=spawn,temp=os.tmpdir()}={}){
  let child=null,ready=null,next=1,buffer='';const pending=new Map();
  function start(){
    if(ready)return ready;
    ready=new Promise((resolve,reject)=>{
      const encoded=Buffer.from(SAPI_SCRIPT,'utf16le').toString('base64');
      const proc=spawnImpl('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',encoded],{stdio:['pipe','pipe','pipe'],windowsHide:true});child=proc;
      let err='';proc.stderr.on('data',d=>{err=(err+d).slice(-2000);});proc.stdin.on('error',()=>{});
      proc.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);
        if(line.startsWith('@voices ')){let list=[];try{list=JSON.parse(Buffer.from(line.slice(8),'base64').toString('utf8'));}catch{}resolve(Array.isArray(list)?list:[list]);continue;}
        const m=line.match(/^@(done|error) (\d+) ?(.*)$/);if(!m)continue;const job=pending.get(Number(m[2]));if(!job)continue;pending.delete(Number(m[2]));
        m[1]==='done'?job.resolve():job.reject(L.error('systemVoice.sapiFailed',{reason:m[3].slice(0,160)}));}});
      const gone=code=>{if(child===proc){child=null;ready=null;}const error=err.trim()?L.error('systemVoice.sapiNotStartedReason',{code,reason:err.trim().split('\n').slice(-1)[0].slice(0,160)}):L.error('systemVoice.sapiNotStarted',{code});reject(error);for(const job of pending.values())job.reject(error);pending.clear();};
      proc.on('error',error=>gone(error.message));proc.on('exit',gone);
    });
    ready.catch(()=>{});return ready;
  }
  async function synthesize(text,{lang=langOf(text),locale='en-US',rate=0,signal}={}){
    const voices=await start();const voice=pickSapi(voices,lang,locale);
    if(!voice)throw L.error('systemVoice.noSapiVoices');
    const id=next++,out=path.join(temp,`agent-wardrobe-sapi-${process.pid}-${id}-${crypto.randomBytes(4).toString('hex')}.wav`);
    // a sentence that is already being written is let finish (SAPI cannot be interrupted mid-file), then dropped
    try{
      await new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,voice,rate,out,text:Buffer.from(String(text).slice(0,2000)).toString('base64')})+'\n');});
      if(signal?.aborted)throw Object.assign(new Error('aborted'),{name:'AbortError'});
      return fs.readFileSync(out);
    }finally{fs.rmSync(out,{force:true});}
  }
  return {synthesize,voices:start,stop(){const proc=child;child=null;ready=null;if(proc){try{proc.stdin.end();}catch{}try{proc.kill();}catch{}}},get running(){return Boolean(child);}};
}

// Linux: espeak-ng to a WAV on stdout; null when it is not installed.
function espeak({find=which}={}){
  const bin=find('espeak-ng')||find('espeak');if(!bin)return null;
  return {bin,synthesize:(text,{lang=langOf(text),signal}={})=>new Promise((resolve,reject)=>{
    const child=spawn(bin,['-v',ESPEAK[lang]||'en-us','-s','170','--stdout'],{stdio:['pipe','pipe','pipe'],signal});const chunks=[];let err='';
    child.stdout.on('data',d=>chunks.push(d));child.stderr.on('data',d=>{err=(err+d).slice(-500);});child.stdin.on('error',()=>{});
    child.on('error',reject);child.on('close',code=>code===0&&chunks.length?resolve(Buffer.concat(chunks)):reject(L.error('systemVoice.espeakFailed',{reason:err.trim().slice(0,160)||code})));
    child.stdin.end(String(text).slice(0,2000));})};
}
// LINUX_MISSING: the notice for a Linux without espeak-ng / spd-say, in the interface language at the moment it is read
module.exports={langOf,pickSapi,createSapi,espeak,MAC_VOICES,CULTURES,ESPEAK,SAPI_SCRIPT,get LINUX_MISSING(){return L.t('systemVoice.linuxMissing');}};
