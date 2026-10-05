// Validation for files a Mod ships in its own folder. Mods are untrusted contributions:
// SVG parts are reduced to plain shapes, images must be real PNG/WebP, VRM models must be
// self-contained and allow redistribution; Live2D and MMD folders keep to safe paths and known file types. Nothing from a Mod is ever executed.
const fs=require('node:fs');const path=require('node:path');

const TAGS=new Set(['g','path','circle','ellipse','rect','line','polyline','polygon']);
const ATTRS=new Set(['d','cx','cy','r','rx','ry','x','y','width','height','x1','y1','x2','y2','points','fill','stroke','stroke-width','stroke-opacity','fill-opacity','opacity','stroke-linecap','stroke-linejoin','transform','class']);
// The face and body contract the app's CSS and interactions drive (see MODS.md).
const CLASSES=new Set(['eyes','pupils','blink','joy-eyes','brows','cheeks','smile','open-mouth','sad-mouth','sweat','tears','wink','love-eyes','hands','legs']);
const VARS=new Set(['body','bodyLight','belly','accent','ink','cheek']);
const LIMIT=200000;

function attrValue(name,value){
  if(/[<>&\\]|javascript:|expression\(|@import/i.test(value))throw new Error(`Unsafe SVG attribute ${name}`);
  for(const match of value.matchAll(/url\(([^)]*)\)/gi))if(match[1].trim()!=='#body-gradient')throw new Error('SVG may only reference url(#body-gradient)');
  for(const match of value.matchAll(/var\(--([A-Za-z]+)\)/g))if(!VARS.has(match[1]))throw new Error(`Unknown palette variable ${match[1]}`);
  if(name==='class')for(const cls of value.split(/\s+/).filter(Boolean))if(!CLASSES.has(cls))throw new Error(`Unknown SVG class ${cls}`);
  if(name==='transform'&&!/^(\s*(translate|rotate|scale|matrix)\([-\d.,\s e]+\)\s*)+$/i.test(value))throw new Error('Unsupported SVG transform');
}
// Accepts a fragment of SVG shape elements and returns it unchanged, or throws.
function sanitizeSvg(markup){
  if(typeof markup!=='string'||markup.length>LIMIT)throw new Error('SVG part too large');
  const stack=[];let rest=markup;
  while(rest.length){
    const text=rest.match(/^[^<]+/);if(text){if(text[0].trim())throw new Error('SVG parts may not contain text');rest=rest.slice(text[0].length);continue;}
    const close=rest.match(/^<\/([a-zA-Z]+)\s*>/);
    if(close){if(stack.pop()!==close[1])throw new Error('Unbalanced SVG');rest=rest.slice(close[0].length);continue;}
    const open=rest.match(/^<([a-zA-Z]+)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>/);
    if(!open)throw new Error('Malformed or unsupported SVG markup');
    const [whole,tag,attrs,selfClosing]=open;if(!TAGS.has(tag))throw new Error(`SVG element <${tag}> is not allowed`);
    for(const [,name,value] of attrs.matchAll(/\s+([a-zA-Z-]+)="([^"]*)"/g)){if(!ATTRS.has(name))throw new Error(`SVG attribute ${name} is not allowed`);attrValue(name,value);}
    if(!selfClosing)stack.push(tag);rest=rest.slice(whole.length);
  }
  if(stack.length)throw new Error('Unbalanced SVG');
  return markup;
}
function assetName(name){
  if(typeof name!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}\.(png|webp|vrm|glb)$/i.test(name))throw new Error(`Invalid asset name ${name}`);
  return name;
}
function readAsset(dir,name,max){
  assetName(name);const file=path.join(dir,name);let stat;
  try{stat=fs.lstatSync(file);}catch{throw new Error(`Missing asset ${name}`);}
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`Asset ${name} must be a regular file`);
  if(stat.size>max)throw new Error(`Asset ${name} is too large`);
  return fs.readFileSync(file);
}
function checkPng(dir,name){
  const data=readAsset(dir,name,4*1024*1024);
  const isPng=data.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  const isWebp=data.subarray(0,4).toString('latin1')==='RIFF'&&data.subarray(8,12).toString('latin1')==='WEBP';
  if(!(name.endsWith('.png')?isPng:isWebp))throw new Error(`Asset ${name} is not a valid image`);
  return name;
}
// A binary glTF 2.0 file with everything embedded: an external URI would make the app fetch from wherever the Mod says.
function readGlb(dir,name,max){
  const data=readAsset(dir,name,max);
  if(data.subarray(0,4).toString('latin1')!=='glTF'||data.readUInt32LE(4)!==2)throw new Error(`${name} is not a binary glTF 2.0 file`);
  const length=data.readUInt32LE(12);if(data.subarray(16,20).toString('latin1')!=='JSON')throw new Error(`${name} has no JSON chunk`);
  const json=JSON.parse(data.subarray(20,20+length).toString('utf8'));
  for(const key of ['buffers','images'])for(const item of json[key]||[])if(item.uri&&!/^data:/.test(item.uri))throw new Error(`${name} references external ${key}`);
  return json;
}
// Shared Mods must allow redistribution; your own private copies (personal) only have to be valid.
function checkVrm(dir,name,{personal=false}={}){
  if(!name.endsWith('.vrm'))throw new Error('Models must be .vrm files');
  const json=readGlb(dir,name,(personal?80:40)*1024*1024);
  const vrm1=json.extensions?.VRMC_vrm?.meta,vrm0=json.extensions?.VRM?.meta;
  if(!vrm1&&!vrm0)throw new Error(`${name} has no VRM metadata`);
  const license=vrm1?{name:String(vrm1.name||''),authors:(vrm1.authors||[]).map(String),url:String(vrm1.licenseUrl||''),redistribution:vrm1.allowRedistribution===true}
    :{name:String(vrm0.title||''),authors:[String(vrm0.author||'')],url:String(vrm0.otherPermissionUrl||vrm0.licenseName||''),redistribution:vrm0.licenseName!=='Redistribution_Prohibited'};
  if(!license.redistribution&&!personal)throw new Error(`${name} does not allow redistribution`);
  return {name,license};
}
// A plain 3D model (no VRM humanoid), e.g. from Sketchfab: shown as a statue that sways.
function checkGltf(dir,name,{personal=false}={}){
  if(!name.endsWith('.glb'))throw new Error('Models must be .glb files');
  readGlb(dir,name,(personal?80:40)*1024*1024);return {name};
}
// --- Multi-file models (Live2D, MMD) and motion files. They keep their folder structure, so names may contain '/':
// relative only, no '..', no hidden or absolute parts, no links, known file types and a size cap for the whole folder.
const MODEL_TYPES=/\.(json|moc3|png|jpe?g|webp|gif|tga|bmp|spa|sph|toon|pmx|vmd|vrma|txt)$/i;
const MOTION_TYPES={vrm:/\.(vrma|vmd)$/i,mmd:/\.vmd$/i,live2d:/\.motion3\.json$/i};
function assetPath(name){
  if(typeof name!=='string'||!name||name.length>240||/[\\:\0-\x1f]/.test(name)||name.split('/').some(part=>!part||part.startsWith('.')||part.length>120)||!MODEL_TYPES.test(name))throw new Error(`Invalid asset path ${name}`);
  return name;
}
// every file in a Mod folder (except mod.json), or an error for links, unknown types or too much data
function modelFiles(dir,{personal=false}={}){
  const max=(personal?150:60)*1024*1024,files=[];let total=0;
  const walk=(rel,depth)=>{
    if(depth>8)throw new Error('Model folders are nested too deep');
    for(const entry of fs.readdirSync(path.join(dir,rel),{withFileTypes:true})){
      const name=rel?`${rel}/${entry.name}`:entry.name;
      if(entry.name.startsWith('.')||(!rel&&entry.name==='mod.json'))continue;
      if(entry.isSymbolicLink())throw new Error(`${name} is a link`);
      if(entry.isDirectory()){walk(name,depth+1);continue;}
      if(!entry.isFile())throw new Error(`${name} is not a regular file`);
      assetPath(name);total+=fs.lstatSync(path.join(dir,name)).size;files.push(name);
      if(total>max)throw new Error(`The model is larger than ${max/1024/1024} MB`);if(files.length>4000)throw new Error('The model has too many files');
    }
  };
  walk('',0);return files;
}
// Paths a model3.json points at, resolved against its own folder; null for one that leaves the Mod folder.
function live2dRefs(json,model){
  const refs=json?.FileReferences;if(!refs||typeof refs!=='object')throw new Error(`${model} has no FileReferences`);
  const list=[refs.Moc,...(refs.Textures||[]),refs.Physics,refs.Pose,refs.DisplayInfo,refs.UserData,...(refs.Expressions||[]).map(e=>e?.File),...Object.values(refs.Motions||{}).flat().map(m=>m?.File)].filter(Boolean);
  const base=path.posix.dirname(model);
  return [...new Set(list.map(ref=>{if(typeof ref!=='string'||/^[a-z]+:|^\//i.test(ref))return null;const full=path.posix.normalize(path.posix.join(base,ref.replace(/\\/g,'/')));return full.startsWith('../')||full==='..'?null:full;}))];
}
function readJson(dir,name,max=1024*1024){const stat=fs.lstatSync(path.join(dir,name));if(!stat.isFile()||stat.size>max)throw new Error(`${name} is too large`);return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));}
const head=(dir,name,n)=>{const fd=fs.openSync(path.join(dir,name),'r');try{const b=Buffer.alloc(n);fs.readSync(fd,b,0,n,0);return b;}finally{fs.closeSync(fd);}};
// A Live2D (Cubism 3+) or MMD model folder; returns every file the renderer may load.
function checkModel(dir,model,renderer,{personal=false}={}){
  assetPath(model);const files=modelFiles(dir,{personal}),set=new Set(files);
  if(!set.has(model))throw new Error(`Missing model ${model}`);
  if(renderer==='live2d'){
    if(!/\.model3\.json$/i.test(model))throw new Error('Live2D models must be .model3.json files');
    const json=readJson(dir,model),refs=live2dRefs(json,model);
    if(!/\.moc3$/i.test(json.FileReferences.Moc||''))throw new Error(`${model} has no .moc3`);
    for(const ref of refs){if(!ref||!set.has(ref))throw new Error(`${model} references a missing or outside file ${ref||''}`.trim());}
    const moc=refs.find(r=>/\.moc3$/i.test(r));if(head(dir,moc,4).toString('latin1')!=='MOC3')throw new Error(`${moc} is not a Cubism 3+ moc3 file`);
  }else if(renderer==='mmd'){
    if(!/\.pmx$/i.test(model))throw new Error('MMD models must be .pmx files');
    if(head(dir,model,4).toString('latin1')!=='PMX ')throw new Error(`${model} is not a PMX file`);
  }else throw new Error('Unsupported model renderer');
  return {name:model,files};
}
// skin.motions: [{file,name,loop,use}] with motion files of the renderer's own kind; 'idle' loops, 'react' / 'talk' play on events
function checkMotions(dir,motions,renderer,{personal=false}={}){
  if(motions===undefined)return [];
  if(!Array.isArray(motions)||motions.length>40)throw new Error('Invalid motions');
  if(!MOTION_TYPES[renderer])throw new Error(`${renderer} models play their own animations; motions are not supported`);
  return motions.map(motion=>{
    if(!motion||typeof motion!=='object'||Object.keys(motion).some(k=>!['file','name','loop','use'].includes(k)))throw new Error('Unsupported motion field');
    const file=assetPath(motion.file);if(!MOTION_TYPES[renderer].test(file))throw new Error(`${file} is not a motion for ${renderer}`);
    if(typeof motion.name!=='string'||motion.name.length>80)throw new Error('Invalid motion name');
    if(motion.loop!==undefined&&typeof motion.loop!=='boolean')throw new Error('Invalid motion loop');
    if(!['idle','react','talk'].includes(motion.use))throw new Error('Invalid motion use');
    let stat;try{stat=fs.lstatSync(path.join(dir,file));}catch{throw new Error(`Missing motion ${file}`);}
    if(!stat.isFile())throw new Error(`Motion ${file} must be a regular file`);if(stat.size>50*1024*1024)throw new Error(`Motion ${file} is too large`);
    if(/\.vmd$/i.test(file)&&!head(dir,file,20).toString('latin1').startsWith('Vocaloid Motion Data'))throw new Error(`${file} is not a VMD motion`);
    if(/\.vrma$/i.test(file)){const data=fs.readFileSync(path.join(dir,file));if(data.subarray(0,4).toString('latin1')!=='glTF')throw new Error(`${file} is not a VRM animation`);const json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString('utf8'));
      if(!json.extensionsUsed?.includes('VRMC_vrm_animation'))throw new Error(`${file} is not a VRM animation`);for(const key of ['buffers','images'])for(const item of json[key]||[])if(item.uri&&!/^data:/.test(item.uri))throw new Error(`${file} references external ${key}`);}
    if(/\.motion3\.json$/i.test(file)&&!readJson(dir,file,8*1024*1024).Curves)throw new Error(`${file} is not a Live2D motion`);
    return file;
  });
}
module.exports={sanitizeSvg,checkPng,checkVrm,checkGltf,checkModel,checkMotions,modelFiles,live2dRefs,assetName,assetPath,MODEL_TYPES,MOTION_TYPES,CLASSES,VARS};
