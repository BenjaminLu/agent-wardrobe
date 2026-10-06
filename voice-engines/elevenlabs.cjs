// Voice engine "elevenlabs" (cloud, the user's own paid account): Instant Voice Cloning from recordings, Voice Design
// from a text prompt, and speech. The API key lives encrypted in Secrets ('elevenlabs'); it is only ever sent in the
// xi-api-key header to api.elevenlabs.io (never in a URL, never to a page), and provider messages are not echoed back.
// Endpoints (docs checked 2026-10): POST /v1/voices/add, POST /v1/text-to-voice/design, POST /v1/text-to-voice,
// POST /v1/text-to-speech/{voice_id}, DELETE /v1/voices/{voice_id}, GET /v1/user.
// Params: {voiceId, model, stability, similarity, style, speed, source: 'clone'|'design'}
const L=require('../locales.cjs');const {t}=L;
const BASE='https://api.elevenlabs.io';
// eleven_v4 (Sep 2026) is the most expressive multilingual model; multilingual_v2 is the long-standing default.
const MODELS=['eleven_v4','eleven_multilingual_v2','eleven_flash_v2_5','eleven_v3'];
const DESIGN_MODELS=['eleven_multilingual_ttv_v2','eleven_ttv_v3'];
const MAX_TEXT=5000;
const license=()=>t('voiceEngines.elevenlabs.license');

const looksLikeKey=value=>typeof value==='string'&&/^(sk_[A-Za-z0-9]{20,120}|[a-f0-9]{32})$/.test(value);
const voiceIdOk=value=>typeof value==='string'&&/^[A-Za-z0-9]{8,64}$/.test(value);

async function call(path,{key,base=BASE,method='GET',json,form,signal,timeout=60000,expect='json'}){
  if(!key)throw L.error('voiceEngines.elevenlabs.noKey');
  const headers={'xi-api-key':key,...(json?{'Content-Type':'application/json'}:{})};
  let response;
  try{response=await fetch(`${base}${path}`,{method,headers,body:json?JSON.stringify(json):form,redirect:'error',signal:signal||AbortSignal.timeout(timeout)});}
  catch(error){if(error.name==='AbortError')throw error;throw L.error('voiceEngines.elevenlabs.offline');}
  if(!response.ok){
    // Only the status code from the error body is used; its message could quote what was sent.
    let status='';try{status=String((await response.json())?.detail?.status||'');}catch{}
    if(response.status===401&&status!=='missing_permissions')throw L.error('voiceEngines.elevenlabs.badKey',null,{status:401});
    if(response.status===401)throw L.error('voiceEngines.elevenlabs.permissions',null,{status:401,code:status});
    if(response.status===402||/quota|credits/.test(status))throw L.error('voiceEngines.elevenlabs.quota',null,{status:response.status,code:status});
    if(/voice_limit/.test(status))throw L.error('voiceEngines.elevenlabs.voiceLimit',null,{status:response.status,code:status});
    if(response.status===429)throw L.error('voiceEngines.elevenlabs.rateLimit',null,{status:429,code:status});
    if(response.status===422||response.status===400)throw L.error(status?'voiceEngines.elevenlabs.rejectedCode':'voiceEngines.elevenlabs.rejected',{code:status},{status:response.status,code:status});
    throw L.error('voiceEngines.elevenlabs.serviceError',{status:response.status},{status:response.status,code:status});
  }
  return expect==='buffer'?Buffer.from(await response.arrayBuffer()):response.json();
}

// A key is accepted when /v1/user answers, or when it is refused only for lacking the user_read permission.
async function verifyKey({key,base}){
  try{await call('/v1/user',{key,base,timeout:15000});return {ok:true};}
  catch(error){if(error.code==='missing_permissions')return {ok:true,restricted:true};throw error;}
}
// Instant Voice Cloning: recordings (WAV) are uploaded once; ElevenLabs keeps the voice in the user's account.
async function cloneVoice({key,base,name,files,description='',removeNoise=false,signal}){
  if(!files?.length)throw L.error('voiceEngines.elevenlabs.noFiles');
  const form=new FormData();form.append('name',String(name).slice(0,100));if(description)form.append('description',String(description).slice(0,500));
  form.append('remove_background_noise',removeNoise?'true':'false');
  for(const file of files)form.append('files',new Blob([file.data],{type:file.mime||'audio/wav'}),file.name||'sample.wav');
  const data=await call('/v1/voices/add',{key,base,method:'POST',form,signal,timeout:180000});
  if(!voiceIdOk(data.voice_id))throw L.error('voiceEngines.elevenlabs.noVoiceId');
  return {voiceId:data.voice_id,requiresVerification:Boolean(data.requires_verification)};
}
// A sample text in the prompt's language (Voice Design needs 100–1000 characters): what the preview voices say, not interface text.
const SAMPLES={
  zh:'嗨！我是你的桌面小夥伴。今天想做什麼呢？我們可以一起整理檔案、查資料，或者只是聊聊天。累了就休息一下，喝杯水、看看窗外的風景吧。不管是開心的事還是煩惱的事，都可以跟我說喔。我會一直在這裡陪著你，有需要的時候隨時叫我就好！',
  ja:'こんにちは！あなたのデスクトップの相棒だよ。今日は何をしようか？ファイルを整理したり、調べものをしたり、ただおしゃべりするのもいいね。疲れたら少し休んで、お水を飲んでね。いつでもここにいるから、呼んでね！',
  en:'Hi there! I am your little desktop companion. What shall we do today? We could tidy up some files, look something up, or simply chat for a while. If you get tired, take a short break and drink some water. I will be right here whenever you need me!'
};
const langOf=text=>/[぀-ヿ]/.test(text)?'ja':/[㐀-鿿]/.test(text)?'zh':'en';
// Voice Design: a description → up to three preview voices (audio + generated id). Nothing is saved until one is picked.
async function designVoice({key,base,prompt,text,model='eleven_multilingual_ttv_v2',signal}){
  let description=String(prompt||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,1000);
  if(!description)throw L.error('voiceEngines.elevenlabs.describe');
  if(description.length<20)description=`Voice character: ${description}. Natural, clear and expressive speech.`;
  const sample=String(text||'').trim().length>=100?String(text).trim().slice(0,1000):SAMPLES[langOf(prompt)];
  const data=await call('/v1/text-to-voice/design?output_format=mp3_44100_128',{key,base,method:'POST',json:{voice_description:description,model_id:DESIGN_MODELS.includes(model)?model:DESIGN_MODELS[0],text:sample},signal,timeout:180000});
  const previews=(data.previews||[]).filter(p=>p&&typeof p.audio_base_64==='string'&&voiceIdOk(p.generated_voice_id)).slice(0,5)
    .map(p=>({generatedVoiceId:p.generated_voice_id,audio:Buffer.from(p.audio_base_64,'base64'),mime:p.media_type||'audio/mpeg',duration:p.duration_secs||null}));
  if(!previews.length)throw L.error('voiceEngines.elevenlabs.noPreviews');
  return {previews,text:data.text||sample,description};
}
async function saveDesignedVoice({key,base,generatedVoiceId,name,description,signal}){
  if(!voiceIdOk(generatedVoiceId))throw new Error('Unknown preview voice');
  const data=await call('/v1/text-to-voice',{key,base,method:'POST',json:{voice_name:String(name).slice(0,100),voice_description:String(description).slice(0,1000),generated_voice_id:generatedVoiceId},signal,timeout:60000});
  if(!voiceIdOk(data.voice_id))throw L.error('voiceEngines.elevenlabs.noVoiceId');
  return {voiceId:data.voice_id};
}
async function textToSpeech({key,base,voiceId,text,model='eleven_v4',settings={},signal}){
  if(!voiceIdOk(voiceId))throw new Error('Unknown ElevenLabs voice');
  const body={text:String(text).slice(0,MAX_TEXT),model_id:MODELS.includes(model)?model:MODELS[0]};
  const vs={};for(const [k,api] of [['stability','stability'],['similarity','similarity_boost'],['style','style'],['speed','speed']])if(Number.isFinite(settings[k]))vs[api]=settings[k];
  if(Object.keys(vs).length)body.voice_settings=vs;
  return call(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,{key,base,method:'POST',json:body,signal,expect:'buffer',timeout:90000});
}
async function deleteVoice({key,base,voiceId}){if(!voiceIdOk(voiceId))throw new Error('Unknown ElevenLabs voice');await call(`/v1/voices/${voiceId}`,{key,base,method:'DELETE',timeout:20000});return true;}

function validate(params={}){
  if(!voiceIdOk(params.voiceId))throw L.error('voiceEngines.elevenlabs.badVoiceId');
  const clamp=(v,lo,hi)=>Number.isFinite(+v)?Math.max(lo,Math.min(hi,+v)):undefined;
  return {voiceId:params.voiceId,model:MODELS.includes(params.model)?params.model:MODELS[0],source:params.source==='design'?'design':'clone',
    stability:clamp(params.stability,0,1),similarity:clamp(params.similarity,0,1),style:clamp(params.style,0,1),speed:clamp(params.speed,.7,1.2)};
}
// getKey() reads Secrets at call time; base is only overridable for tests and the smoke's local stand-in.
function create({getKey,base=BASE}={}){
  const key=()=>getKey?.()||null;
  return {
    id:'elevenlabs',get label(){return t('voiceEngines.elevenlabs.label');},get license(){return license();},models:MODELS,
    async available(){return key()?{ok:true}:{ok:false,reason:t('voiceEngines.elevenlabs.needKey')};},
    validate,
    async speak({text,profile,signal}){
      const p=validate(profile?.params);
      return {audio:await textToSpeech({key:key(),base,voiceId:p.voiceId,text,model:p.model,settings:p,signal}),mime:'audio/mpeg'};
    },
    // removing the profile also removes the voice from the user's ElevenLabs account
    async remove({profile}){if(profile?.params?.voiceId&&key())await deleteVoice({key:key(),base,voiceId:profile.params.voiceId}).catch(()=>{});},
    verifyKey:k=>verifyKey({key:k,base}),
    clone:options=>cloneVoice({key:key(),base,...options}),
    design:options=>designVoice({key:key(),base,...options}),
    saveDesign:options=>saveDesignedVoice({key:key(),base,...options})
  };
}
module.exports={create,validate,verifyKey,cloneVoice,designVoice,saveDesignedVoice,textToSpeech,deleteVoice,looksLikeKey,MODELS,DESIGN_MODELS,BASE,get LICENSE(){return license();}};
