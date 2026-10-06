// Voice profiles: a voice the character can speak with, made by a pluggable engine (Kokoro mix, VOICEVOX, cloning engines…).
// Each profile lives in root/<id>/voice.json with its own files beside it. Packs (.zip) carry a profile and its files, never secrets,
// and a voice cloned from a real person (consent != null) never leaves this Mac.
//
// Engine: {id, label, available(): Promise<{ok, reason?, install?: true}>, install?(onProgress), speak({text, profile, dir, signal}) => {audio, mime},
//          validate?(params) (throws on bad params), profile?(params) => Promise<{license?, files?: {name: Buffer}}> (optional: fills licence/extra files on save)}
const L=require('./locales.cjs');const {t}=L;
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const zlib=require('node:zlib');

const ID=/^v-[a-z0-9]+(?:-[a-z0-9]+)*$/;const ENGINE_ID=/^[a-z0-9][a-z0-9-]{0,31}$/;const MOD_ID=/^[a-z0-9][a-z0-9_-]{0,63}$/i;
const FILE=/^[A-Za-z0-9_][A-Za-z0-9._-]{0,79}(\/[A-Za-z0-9_][A-Za-z0-9._-]{0,79})?$/;
const TIERS=['open','rules','personal'];const MIMES=['audio/wav','audio/mpeg'];
const LIMITS={name:40,files:32,file:50*1024*1024,pack:200*1024*1024,params:16*1024};
const SECRET=/key|token|secret|password/i;
// errors meant for people: a locale key under voices.error and its values
const fail=(key,vars)=>{throw L.error(`voices.error.${key}`,vars);};
// what: the locale key naming the field (voices.field.*)
const text=(value,max,what,{empty=false}={})=>{if(typeof value!=='string'||/[\x00-\x1f\x7f]/.test(value)||value.length>max||(!empty&&!value.trim()))fail('field',{field:t(`voices.field.${what}`),max});return value.trim();};
const slug=name=>String(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,20)||'voice';
const newId=name=>`v-${slug(name)}-${crypto.randomBytes(4).toString('hex')}`;
// API keys and tokens belong in the encrypted Secrets store; any that slipped into params are dropped from lists and packs.
const stripSecrets=profile=>({...profile,params:Object.fromEntries(Object.entries(profile.params||{}).filter(([k])=>!SECRET.test(k)))});
const isDate=v=>typeof v==='string'&&v.length<=40&&!Number.isNaN(Date.parse(v));

function validate(p,{dir,engine}={}){
  if(!p||typeof p!=='object'||Array.isArray(p))fail('profile');
  if(typeof p.id!=='string'||p.id.length>48||!ID.test(p.id))fail('id');
  const name=text(p.name,LIMITS.name,'name');
  if(typeof p.engine!=='string'||!ENGINE_ID.test(p.engine))fail('engine');
  const params=p.params??{};if(typeof params!=='object'||Array.isArray(params)||JSON.stringify(params).length>LIMITS.params)fail('params');
  const files=p.files??[];if(!Array.isArray(files)||files.length>LIMITS.files)fail('fileCount',{max:LIMITS.files});
  for(const f of files){if(typeof f!=='string'||!FILE.test(f)||f.split('/').some(part=>part==='..'||part.startsWith('.'))||f==='voice.json')fail('fileName',{file:String(f).slice(0,80)});
    if(dir){let st;try{st=fs.lstatSync(path.join(dir,f));}catch{fail('fileMissing',{file:f});}if(!st.isFile())fail('fileUnsafe',{file:f});const max=engine?.maxFileBytes||LIMITS.file;if(st.size>max)fail('fileSize',{file:f,mb:Math.round(max/1048576)});}}
  if(new Set(files).size!==files.length)fail('fileDuplicate');
  const l=p.license;if(!l||typeof l!=='object')fail('license');
  const license={label:text(l.label,120,'license'),commercial:l.commercial===true,credit:l.credit==null||l.credit===''?null:text(l.credit,200,'credit'),tier:TIERS.includes(l.tier)?l.tier:fail('tier')};
  let consent=null;if(p.consent!=null){const c=p.consent;if(typeof c!=='object')fail('consent');consent={person:text(c.person,80,'person'),at:isDate(c.at)?c.at:fail('consentAt'),note:c.note==null?'':text(c.note,500,'note',{empty:true})};}
  const modId=p.modId==null?null:typeof p.modId==='string'&&MOD_ID.test(p.modId)?p.modId:fail('modId');
  const createdAt=p.createdAt==null?new Date().toISOString():isDate(p.createdAt)?p.createdAt:fail('createdAt');
  engine?.validate?.(params);
  return {id:p.id,name,engine:p.engine,params,files:[...files],license,consent,modId,createdAt};
}

// --- zip: stored or deflated entries, no ZIP64 (packs are capped at 200 MB)
function zip(entries){
  const locals=[],centrals=[];let offset=0;
  for(const {name,data} of entries){
    const n=Buffer.from(name,'utf8'),body=zlib.deflateRawSync(data),crc=zlib.crc32(data)>>>0;
    const head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50,0);head.writeUInt16LE(20,4);head.writeUInt16LE(0x800,6);head.writeUInt16LE(8,8);head.writeUInt32LE(crc,14);head.writeUInt32LE(body.length,18);head.writeUInt32LE(data.length,22);head.writeUInt16LE(n.length,26);
    const cen=Buffer.alloc(46);cen.writeUInt32LE(0x02014b50,0);cen.writeUInt16LE(20,4);cen.writeUInt16LE(20,6);cen.writeUInt16LE(0x800,8);cen.writeUInt16LE(8,10);cen.writeUInt32LE(crc,16);cen.writeUInt32LE(body.length,20);cen.writeUInt32LE(data.length,24);cen.writeUInt16LE(n.length,28);cen.writeUInt32LE(offset,42);
    locals.push(head,n,body);centrals.push(cen,n);offset+=30+n.length+body.length;
  }
  const dir=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,dir,end]);
}
function unzip(buf){
  let end=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)fail('packZip');
  const count=buf.readUInt16LE(end+10);if(count>LIMITS.files+2)fail('packCount');
  const out=new Map();let p=buf.readUInt32LE(end+16),total=0;
  for(let i=0;i<count;i++){
    if(p+46>buf.length||buf.readUInt32LE(p)!==0x02014b50)fail('packBroken');
    const flags=buf.readUInt16LE(p+8),method=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),size=buf.readUInt32LE(p+24),nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),local=buf.readUInt32LE(p+42);
    const name=buf.subarray(p+46,p+46+nl).toString('utf8');p+=46+nl+el+cl;
    if(name.endsWith('/'))continue;if(flags&1)fail('packPassword');
    if(size>LIMITS.file||(total+=size)>LIMITS.pack)fail('packSize');
    if(local+30>buf.length||buf.readUInt32LE(local)!==0x04034b50)fail('packBroken');
    const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28),raw=buf.subarray(start,start+csize);
    let data;if(method===0)data=raw;else if(method===8){try{data=zlib.inflateRawSync(raw,{maxOutputLength:Math.max(1,size)});}catch{fail('packEntry',{name});}}else fail('packMethod');
    if(data.length!==size)fail('packEntrySize',{name});out.set(name,data);
  }
  return out;
}

function createVoices({root,secrets=null,engines=[]}){
  const registry=new Map();
  const dirOf=id=>{if(typeof id!=='string'||!ID.test(id)||id.length>48)fail('id');return path.join(root,id);};
  function registerEngine(engine){
    if(!engine||!ENGINE_ID.test(engine.id||'')||typeof engine.speak!=='function'||typeof engine.available!=='function')throw new Error('Invalid voice engine');
    registry.set(engine.id,engine);return engine;  // kept as it is: an engine's label can follow the interface language
  }
  for(const engine of engines)registerEngine(engine);
  function read(id){try{const dir=dirOf(id);const p=JSON.parse(fs.readFileSync(path.join(dir,'voice.json'),'utf8'));return p.id===id?validate(p,{dir,engine:registry.get(p.engine)}):null;}catch{return null;}}
  const list=()=>{let names=[];try{names=fs.readdirSync(root);}catch{}return names.filter(n=>ID.test(n)).map(read).filter(Boolean).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(stripSecrets);};
  const get=id=>read(id);
  // extra: {name: Buffer} files to write before validation (an engine's policy text, a recording, a derived file…)
  async function save(input,{extra={}}={}){
    const draft={...input,id:input?.id||newId(input?.name),files:[...(input?.files||[])]};
    const engine=registry.get(draft.engine);
    if(engine?.profile&&!input?.license){const made=await engine.profile(draft.params||{});if(made?.license)draft.license=made.license;Object.assign(extra,made?.files||{});}
    for(const name of Object.keys(extra))if(!draft.files.includes(name))draft.files.push(name);
    validate(draft,{engine});  // shape first, before anything touches the disk
    const dir=dirOf(draft.id);fs.mkdirSync(dir,{recursive:true});
    for(const [name,data] of Object.entries(extra)){if(data.length>LIMITS.file)fail('extraSize',{name});const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data,{mode:0o600});}
    const profile=validate(draft,{dir,engine});
    const temp=path.join(dir,'voice.json.tmp');fs.writeFileSync(temp,JSON.stringify(profile,null,1),{mode:0o600});fs.renameSync(temp,path.join(dir,'voice.json'));
    return profile;
  }
  function remove(id){const dir=dirOf(id);if(!fs.existsSync(path.join(dir,'voice.json')))return false;fs.rmSync(dir,{recursive:true,force:true});return true;}
  async function engineList(){return Promise.all([...registry.values()].map(async e=>{let s;try{s=await e.available();}catch(error){s={ok:false,reason:error.message};}return {id:e.id,label:e.label||e.id,available:Boolean(s?.ok),reason:s?.reason||null,install:Boolean(s?.install&&e.install)};}));}
  // Speak with any validated profile (a saved one, or a draft being tried out with the sliders).
  async function speakProfile(profile,input,{signal}={}){
    const engine=registry.get(profile.engine);
    if(!engine)fail('noEngine',{name:profile.name,engine:profile.engine});
    const said=String(input??'').slice(0,2000);if(!said.trim())fail('nothingToSay');
    const dir=ID.test(profile.id)?path.join(root,profile.id):root;
    const result=await engine.speak({text:said,profile,dir,signal});
    if(!result||!Buffer.isBuffer(result.audio)||!MIMES.includes(result.mime))fail('noAudio',{engine:engine.label||engine.id});
    return result;
  }
  // let the engine get ready for this voice ahead of time (engines without warm-up do nothing)
  async function warm(profileId){const profile=get(profileId);const engine=profile&&registry.get(profile.engine);if(!engine?.warm)return false;return engine.warm({profile,dir:path.join(root,profile.id)});}
  async function speak(profileId,input,options){const profile=get(profileId);if(!profile)fail('gone');return speakProfile(profile,input,options);}
  function exportPack(id){
    const profile=get(id);if(!profile)fail('notFound');
    if(profile.consent)fail('exportCloned',{name:profile.name,person:profile.consent.person});
    // 'personal' voices (e.g. a community GPT-SoVITS model trained on dubbed voices) are for this Mac only
    if(profile.license.tier==='personal')fail('exportPersonal',{name:profile.name,license:profile.license.label});
    const dir=dirOf(id),{params}=stripSecrets(profile);
    const entries=[{name:'voice.json',data:Buffer.from(JSON.stringify({...profile,params,modId:null},null,1))},...profile.files.map(name=>({name,data:fs.readFileSync(path.join(dir,name))}))];
    if(entries.reduce((n,e)=>n+e.data.length,0)>LIMITS.pack)fail('packSize');
    return zip(entries);
  }
  async function importPack(buffer){
    if(!Buffer.isBuffer(buffer)||buffer.length>LIMITS.pack)fail('packInvalid');
    const entries=unzip(buffer);let meta;try{meta=JSON.parse(entries.get('voice.json').toString('utf8'));}catch{fail('packNoMeta');}
    if(meta?.consent!=null)fail('importCloned');
    const files=Array.isArray(meta?.files)?meta.files:[];
    const draft=validate({...meta,id:newId(meta?.name),files,modId:null,consent:null,createdAt:new Date().toISOString()},{engine:registry.get(meta?.engine)});
    const extra={};for(const name of draft.files){const data=entries.get(name);if(!data)fail('packMissing',{name});extra[name]=data;}
    return save({...draft,files:[]},{extra});  // the pack's own licence is kept as it is
  }
  return {list,get,save,remove,registerEngine,engines:engineList,engine:id=>registry.get(id)||null,speak,speakProfile,warm,exportPack,importPack,root,secrets};
}
// Which profile speaks for the worn character: its binding, if that profile still exists; otherwise null (the voiceProvider applies).
function boundProfile(characterVoices,modId,voices){const id=characterVoices&&Object.prototype.hasOwnProperty.call(characterVoices,modId)?characterVoices[modId]:null;return id&&voices.get(id)?id:null;}
module.exports={createVoices,validate,boundProfile,stripSecrets,newId,zip,unzip,LIMITS,ID};
