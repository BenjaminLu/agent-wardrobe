// Live2D and MMD models from an unpacked archive: find them, then copy exactly what one model needs into a Mod folder.
// Plain Node (no Electron), so the assisted download and the tests can use it directly.
//   detect(dir)                               -> [{renderer:'live2d'|'mmd', entry, title, motions:[{file, name, use, loop}]}]
//   detectMotions(dir, renderer)              -> [{file, name, use, loop}]  (.vrma/.vmd for vrm, .vmd for mmd, .motion3.json for live2d)
//   install({srcDir, entry, renderer, destDir}) -> {model, files, motions:[{file, name, use, loop}]}
// All paths are relative with '/' separators. Archives made on Windows are sloppy, so texture names from a PMX
// match files regardless of case, slash direction and Unicode normalisation.
const fs=require('node:fs');const path=require('node:path');
const {assetPath,live2dRefs,checkModel,MODEL_TYPES,MOTION_TYPES}=require('./mod-assets.cjs');
const L=require('./locales.cjs');

const SKIP=name=>name.startsWith('.')||name==='__MACOSX';
const key=rel=>rel.replace(/\\/g,'/').normalize('NFC').toLowerCase();
function walk(dir){
  const files=[];
  const visit=(rel,depth)=>{if(depth>12)return;for(const entry of fs.readdirSync(path.join(dir,rel),{withFileTypes:true})){
    if(SKIP(entry.name)||entry.isSymbolicLink())continue;const name=rel?`${rel}/${entry.name}`:entry.name;
    if(entry.isDirectory())visit(name,depth+1);else if(entry.isFile())files.push(name);}};
  visit('',0);return files.sort();
}
const under=(file,folder)=>folder==='.'||file.startsWith(`${folder}/`);
const base=file=>path.posix.basename(file).replace(/\.(model3\.json|motion3\.json|pmx|vmd|vrma)$/i,'');

// --- PMX: just enough of the format to read the model name and the texture table.
function pmxInfo(data){
  if(data.subarray(0,4).toString('latin1')!=='PMX ')throw L.error('modelFormats.notPmx');
  let at=8;const count=data[at++],globals=[...data.subarray(at,at+count)];at+=count;
  const [encoding,extraUv,vertexSize,textureSize,,boneSize]=globals;
  const text=()=>{const length=data.readInt32LE(at);at+=4;if(length<0||at+length>data.length)throw L.error('modelFormats.pmxBroken');const value=encoding===0?data.subarray(at,at+length).toString('utf16le'):data.subarray(at,at+length).toString('utf8');at+=length;return value;};
  const name=text(),english=text();text();text();
  const vertices=data.readInt32LE(at);at+=4;
  for(let i=0;i<vertices;i++){
    at+=32+16*extraUv;const type=data[at++];
    at+=[boneSize,2*boneSize+4,4*boneSize+16,2*boneSize+4+36,4*boneSize+16][type]??NaN;at+=4;
    if(!(at<=data.length))throw L.error('modelFormats.pmxBroken');
  }
  const indices=data.readInt32LE(at);at+=4+indices*vertexSize;
  const textures=[];const textureCount=data.readInt32LE(at);at+=4;for(let i=0;i<textureCount;i++)textures.push(text());
  return {name:name.trim()||english.trim(),textures,textureSize};
}

function live2dJson(dir,entry){try{return JSON.parse(fs.readFileSync(path.join(dir,entry),'utf8'));}catch{throw L.error('modelFormats.live2dUnreadable',{file:entry});}}
// motion3.json files a model3.json lists, with their group names
function live2dMotions(json,entry){
  const folder=path.posix.dirname(entry),list=[];
  for(const [group,items] of Object.entries(json?.FileReferences?.Motions||{}))for(const item of Array.isArray(items)?items:[])if(typeof item?.File==='string')list.push({file:path.posix.normalize(path.posix.join(folder,item.File.replace(/\\/g,'/'))),group});
  return list;
}

function detectMotions(dir,renderer){
  const type=MOTION_TYPES[renderer];if(!type)return [];
  return motionList(walk(dir).filter(file=>type.test(file)),renderer);
}
// motions next to or under the model; an archive that keeps them in a sibling folder falls back to the whole archive
function nearMotions(dir,entry,renderer,files=walk(dir)){
  const type=MOTION_TYPES[renderer],folder=path.posix.dirname(entry),all=files.filter(file=>type.test(file)),near=all.filter(file=>under(file,folder));
  return near.length?near:renderer==='live2d'?[]:all;
}
const GENERIC=/^(model|models|index|main|runtime|live2d|data)$/i;
function detect(dir){
  const files=walk(dir),found=[];
  for(const entry of files){
    if(/\.model3\.json$/i.test(entry)){
      const json=(()=>{try{return live2dJson(dir,entry);}catch{return null;}})();if(!json?.FileReferences?.Moc)continue;
      const name=base(entry),folder=path.posix.dirname(entry).split('/').reverse().find(part=>part!=='.'&&!GENERIC.test(part));
      const listed=live2dMotions(json,entry).filter(m=>files.includes(m.file)),groups=Object.fromEntries(listed.map(m=>[m.file,m.group]));
      found.push({renderer:'live2d',entry,title:GENERIC.test(name)&&folder?folder:name,motions:motionList([...new Set([...listed.map(m=>m.file),...nearMotions(dir,entry,'live2d',files)])],'live2d',groups)});
    }else if(/\.pmx$/i.test(entry)){
      let title=base(entry);try{const head=fs.readFileSync(path.join(dir,entry));title=pmxInfo(head).name||title;}catch{continue;}
      found.push({renderer:'mmd',entry,title,motions:motionList(nearMotions(dir,entry,'mmd',files),'mmd')});
    }
  }
  return found;
}

const IDLE=/idle|待機|stand|wait|loop|breath|呼吸|default/i;
function motionList(files,renderer,groups={}){
  const list=files.map(file=>{const group=groups[file],title=base(file).replace(/_+/g,' ').trim()||base(file),name=group?`${group}: ${title}`:title;
    const use=renderer==='live2d'?(/^idle$/i.test(group||'')?'idle':IDLE.test(group||name)?'idle':'react'):IDLE.test(name)?'idle':'react';
    return {file,name:name.slice(0,60),use,...(use==='idle'?{loop:true}:{})};});
  if(list.length&&!list.some(m=>m.use==='idle')&&renderer!=='live2d')Object.assign(list[0],{use:'idle',loop:true});
  return list;
}

function install({srcDir,entry,renderer,destDir}){
  if(!['live2d','mmd'].includes(renderer))throw L.error('modelFormats.onlyLive2dMmd');
  if(typeof entry!=='string'||path.isAbsolute(entry)||entry.replace(/\\/g,'/').split('/').includes('..'))throw L.error('modelFormats.badPath');
  entry=entry.replace(/\\/g,'/');const files=walk(srcDir),byKey=new Map(files.map(file=>[key(file),file]));
  const find=rel=>files.includes(rel)?rel:byKey.get(key(rel));
  if(!find(entry))throw L.error('modelFormats.notFound',{file:entry});entry=find(entry);
  const folder=path.posix.dirname(entry),need=new Set([entry]),missing=[];let groups={};
  if(renderer==='live2d'){
    if(!/\.model3\.json$/i.test(entry))throw L.error('modelFormats.live2dNeedsModel3');
    const json=live2dJson(srcDir,entry);if(!json.FileReferences?.Moc)throw L.error('modelFormats.notCubism3',{file:entry});
    for(const ref of live2dRefs(json,entry)){const file=ref&&find(ref);if(file)need.add(file);else missing.push(ref||L.t('modelFormats.outsideFolder'));}
    for(const m of live2dMotions(json,entry)){const file=find(m.file);if(file)groups[file]=m.group;}
  }else{
    if(!/\.pmx$/i.test(entry))throw L.error('modelFormats.mmdNeedsPmx');
    const {textures}=pmxInfo(fs.readFileSync(path.join(srcDir,entry)));
    for(const texture of textures){
      const rel=path.posix.normalize(path.posix.join(folder,texture.replace(/\\/g,'/').trim()));const file=!rel.startsWith('../')&&find(rel);
      if(file)need.add(file);else if(!/^toon(0\d|10)\.bmp$/i.test(path.posix.basename(rel)))missing.push(texture);  // toon01-10.bmp are MMD's shared toon textures
    }
  }
  if(missing.length){const files=missing.slice(0,8).join(L.t('modelFormats.listSeparator'));throw missing.length>8?L.error('modelFormats.missingFilesMore',{files,count:missing.length}):L.error('modelFormats.missingFiles',{files});}
  const motionFiles=[...new Set([...Object.keys(groups),...nearMotions(srcDir,entry,renderer,files)])];for(const file of motionFiles)need.add(file);
  // keep the structure below the deepest folder that holds everything the model needs
  let root=folder==='.'?'':folder;while(root&&![...need].every(file=>under(file,root)))root=path.posix.dirname(root)==='.'?'':path.posix.dirname(root);
  const out=file=>root?file.slice(root.length+1):file;let total=0;
  for(const file of need){
    if(!MODEL_TYPES.test(file))throw L.error('modelFormats.unsupportedType',{file});
    try{assetPath(out(file));}catch{throw L.error('modelFormats.badName',{file});}
    const stat=fs.lstatSync(path.join(srcDir,file));if(!stat.isFile())throw L.error('modelFormats.notRegularFile',{file});total+=stat.size;
  }
  if(total>150*1024*1024)throw L.error('modelFormats.tooBig');
  for(const file of need){const target=path.join(destDir,...out(file).split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(srcDir,file),target);}
  const model=out(entry);
  try{checkModel(destDir,model,renderer,{personal:true});}catch(error){throw L.error('modelFormats.checkFailed',{reason:error.message});}
  return {model,files:[...need].map(out).sort(),motions:motionList(motionFiles.map(out),renderer,Object.fromEntries(Object.entries(groups).map(([f,g])=>[out(f),g])))};
}
module.exports={detect,detectMotions,install,pmxInfo};
