// What the assisted download window does with a downloaded file, in a private temporary folder:
//  unpack   — zip with our own reader (Japanese zips often have Shift-JIS names without the UTF-8 flag), 7z / rar with macOS's bsdtar;
//             at most 500 MB unpacked, no paths outside the folder (zip-slip), no symlinks
//  discover — usable characters: .vrm / .glb, Live2D and MMD (through model-formats.cjs when it is there), .psd, .png / .jpg, and motions
//  terms    — readme / 利用規約 / license text files (Shift-JIS or UTF-8), and the VRM's own licence metadata
//  psd      — flattened to PNG: Photoshop's saved composite, or the visible layers when the file has none
const fs=require('node:fs');const path=require('node:path');const zlib=require('node:zlib');const {spawnSync}=require('node:child_process');
const LIMIT=500*1024*1024,MAX_ENTRIES=20000;
const fail=(message,code)=>Object.assign(new Error(message),{code});

// --- text: BOM, then strict UTF-8, then Shift-JIS (Windows-31J), then EUC-JP
function decodeText(buffer){
  const b=Buffer.from(buffer);
  if(b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf)return b.subarray(3).toString('utf8');
  if(b[0]===0xff&&b[1]===0xfe)return new TextDecoder('utf-16le').decode(b.subarray(2));
  if(b[0]===0xfe&&b[1]===0xff)return new TextDecoder('utf-16be').decode(b.subarray(2));
  for(const enc of ['utf-8','shift_jis','euc-jp'])try{return new TextDecoder(enc,{fatal:true}).decode(b);}catch{}
  return new TextDecoder('shift_jis').decode(b);
}
const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
function htmlText(html){return String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi,'\n').replace(/<[^>]+>/g,'')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi,(m,e)=>e[0]==='#'?String.fromCodePoint(parseInt(e[1]==='x'||e[1]==='X'?e.slice(2):e.slice(1),e[1]==='x'||e[1]==='X'?16:10)):ENTITIES[e.toLowerCase()]??m).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();}

// --- paths: every name is made relative and checked before anything is written
function safeRelative(name){
  const clean=String(name).normalize('NFC').replace(/\\/g,'/');
  if(/^\//.test(clean)||/^[a-z]:/i.test(clean)||/[\0-\x1f]/.test(clean))throw fail(`壓縮檔裡有不安全的路徑：${clean.slice(0,80)}`,'ZIP_SLIP');
  const parts=clean.split('/').filter(p=>p&&p!=='.');
  if(parts.includes('..'))throw fail(`壓縮檔裡有不安全的路徑：${clean.slice(0,80)}`,'ZIP_SLIP');
  return parts.join('/');
}
const junk=rel=>/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(rel);
function inside(root,rel){const target=path.resolve(root,rel);if(target!==path.resolve(root)&&!target.startsWith(path.resolve(root)+path.sep))throw fail('壓縮檔裡有不安全的路徑。','ZIP_SLIP');return target;}

// --- zip: central directory → local headers; stored and deflate only, no encryption, no ZIP64
function decodeName(raw,utf8,extra){
  // Info-ZIP Unicode Path extra field (0x7075) carries the real name next to a legacy one
  for(let i=0;i+4<=extra.length;){const id=extra.readUInt16LE(i),size=extra.readUInt16LE(i+2);if(id===0x7075&&size>5)return extra.subarray(i+9,i+4+size).toString('utf8');i+=4+size;}
  if(utf8||raw.every(b=>b<0x80))return raw.toString('utf8');
  for(const enc of ['utf-8','shift_jis'])try{return new TextDecoder(enc,{fatal:true}).decode(raw);}catch{}
  return new TextDecoder('shift_jis').decode(raw);
}
function zipEntries(buf){
  let end=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(buf.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw fail('ZIP 檔不完整，請重新下載。','ZIP_BROKEN');
  const count=buf.readUInt16LE(end+10),offset=buf.readUInt32LE(end+16);
  if(count===0xffff||offset===0xffffffff)throw fail('這個 ZIP 用了 ZIP64 格式，目前不支援。','ZIP64');
  const entries=[];let p=offset;
  for(let n=0;n<count;n++){
    if(p+46>buf.length||buf.readUInt32LE(p)!==0x02014b50)throw fail('ZIP 目錄損壞，請重新下載。','ZIP_BROKEN');
    const flags=buf.readUInt16LE(p+8),method=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),size=buf.readUInt32LE(p+24),nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32);
    const host=buf.readUInt16LE(p+4)>>8,mode=buf.readUInt32LE(p+38)>>>16,local=buf.readUInt32LE(p+42);
    const name=decodeName(buf.subarray(p+46,p+46+nl),Boolean(flags&0x800),buf.subarray(p+46+nl,p+46+nl+el));
    entries.push({name,flags,method,csize,size,local,symlink:host===3&&(mode&0o170000)===0o120000,dir:name.endsWith('/')||name.endsWith('\\')});p+=46+nl+el+cl;
  }
  return entries;
}
function unzip(file,dest,{limit=LIMIT}={}){
  const buf=fs.readFileSync(file),entries=zipEntries(buf);
  if(entries.length>MAX_ENTRIES)throw fail('壓縮檔裡的檔案太多。','TOO_MANY');
  if(entries.reduce((sum,e)=>sum+e.size,0)>limit)throw fail(`解開後超過 ${Math.round(limit/1048576)} MB，太大了。`,'TOO_BIG');
  const skipped=[];let total=0;
  for(const e of entries){
    const rel=safeRelative(e.name);if(!rel||junk(rel))continue;
    if(e.symlink){skipped.push(rel);continue;}
    if(e.dir){fs.mkdirSync(inside(dest,rel),{recursive:true});continue;}
    if(e.flags&1)throw fail('這個壓縮檔有密碼，請先在 Mac 上解開。','ZIP_PASSWORD');
    if(buf.readUInt32LE(e.local)!==0x04034b50)throw fail('ZIP 檔損壞，請重新下載。','ZIP_BROKEN');
    const start=e.local+30+buf.readUInt16LE(e.local+26)+buf.readUInt16LE(e.local+28),raw=buf.subarray(start,start+e.csize);
    let data;
    if(e.method===0)data=raw;
    else if(e.method===8){try{data=zlib.inflateRawSync(raw,{maxOutputLength:Math.max(1,e.size)});}catch{throw fail(`ZIP 裡的「${rel}」解不開（可能損壞或大小不符）。`,'ZIP_BROKEN');}}
    else throw fail(`ZIP 用了不支援的壓縮方式（${e.method}），請先在 Mac 上解開。`,'ZIP_METHOD');
    if(data.length!==e.size)throw fail(`ZIP 裡的「${rel}」大小不符。`,'ZIP_BROKEN');
    if((total+=data.length)>limit)throw fail('解開後太大了。','TOO_BIG');
    const target=inside(dest,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data,{mode:0o600});
  }
  return {skipped};
}

// --- 7z / rar: macOS's bsdtar (libarchive) lists first, refuses unsafe paths, then extracts; links are removed afterwards
function untar(file,dest,{limit=LIMIT,tar='/usr/bin/tar'}={}){
  const list=spawnSync(tar,['-tvf',file],{encoding:'utf8',maxBuffer:64e6,timeout:60000});
  if(list.status!==0)throw fail(`這個壓縮檔解不開（${String(list.stderr).trim().split('\n')[0]||'格式不支援'}）。請改下載 .zip 版本，或先用 Mac 的「封存工具程式」或 The Unarchiver 解開。`,'ARCHIVE_UNSUPPORTED');
  const lines=list.stdout.split('\n').filter(Boolean);if(lines.length>MAX_ENTRIES)throw fail('壓縮檔裡的檔案太多。','TOO_MANY');
  let declared=0;for(const line of lines){const m=line.match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(.*)$/);if(!m)continue;declared+=Number(m[1]);safeRelative(m[2].replace(/ -> .*$/,''));}
  if(declared>limit)throw fail(`解開後超過 ${Math.round(limit/1048576)} MB，太大了。`,'TOO_BIG');
  const run=spawnSync(tar,['-xf',file,'-C',dest,'--no-same-owner'],{encoding:'utf8',timeout:10*60000});
  if(run.status!==0)throw fail(`這個壓縮檔解不開（${String(run.stderr).trim().split('\n')[0]}）。請改下載 .zip 版本，或先在 Mac 上解開。`,'ARCHIVE_UNSUPPORTED');
  const skipped=[];let total=0;
  for(const {file:f,rel,stat} of walk(dest,{links:true})){if(stat.isSymbolicLink()||!stat.isFile()){skipped.push(rel);fs.rmSync(f,{force:true});continue;}if((total+=stat.size)>limit)throw fail('解開後太大了。','TOO_BIG');}
  return {skipped};
}

// zip / 7z / rar are unpacked; any other file (a .vrm, .psd or picture straight from the site) is used as it is
function kindOf(file){const fd=fs.openSync(file,'r'),head=Buffer.alloc(8);fs.readSync(fd,head,0,8,0);fs.closeSync(fd);
  if(head.readUInt32LE(0)===0x04034b50||head.readUInt32LE(0)===0x06054b50)return 'zip';
  if(head.subarray(0,6).equals(Buffer.from([0x37,0x7a,0xbc,0xaf,0x27,0x1c])))return '7z';
  if(head.subarray(0,4).toString('latin1')==='Rar!')return 'rar';return 'file';}
function unpack(file,dest,{limit=LIMIT,name=path.basename(file)}={}){
  const size=fs.statSync(file).size;if(size>limit)throw fail(`檔案超過 ${Math.round(limit/1048576)} MB，太大了。`,'TOO_BIG');
  fs.mkdirSync(dest,{recursive:true,mode:0o700});const kind=kindOf(file);
  if(kind==='zip')return {kind,...unzip(file,dest,{limit})};
  if(kind==='7z'||kind==='rar')return {kind,...untar(file,dest,{limit})};
  const rel=safeRelative(path.basename(name))||'download';fs.copyFileSync(file,inside(dest,rel));return {kind,skipped:[]};
}

// regular files only, never following links; bounded depth and count
function* walk(root,{depth=12,links=false}={}){
  let seen=0;const stack=[[root,0]];
  while(stack.length){const [dir,d]=stack.pop();
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(++seen>MAX_ENTRIES)return;const file=path.join(dir,entry.name),rel=path.relative(root,file).split(path.sep).join('/');if(junk(rel))continue;
      const stat=fs.lstatSync(file);if(stat.isDirectory()){if(d<depth)stack.push([file,d+1]);continue;}
      if(stat.isFile()||links)yield {file,rel,stat};}}
}

// --- discovery
const title=rel=>path.basename(rel).replace(/\.(model3\.json|[a-z0-9]+)$/i,'').replace(/[_]+/g,' ').trim()||rel;
const MODEL_DIR=/\.(pmx|pmd|moc3|fbx|model3\.json|unitypackage)$/i,TEXTURE_DIR=/(^|\/)(tex|texs|texture|textures|tga|spa|sph|toon|[^/]+\.fbm)(\/|$)/i;
const motionUse=name=>/idle|待機|stand|loop|breath|呼吸|wait|ループ/i.test(name)?'idle':'react';
// Motions next to a VRM: .vrma (VRM animation) and .vmd (MMD motion)
function findMotions(dir,{formats=null,renderer='vrm'}={}){
  if(formats?.detectMotions)try{return (formats.detectMotions(dir,renderer)||[]).map(m=>({file:safeRelative(m.file),name:String(m.name||title(m.file)).slice(0,80),use:['idle','react','talk'].includes(m.use)?m.use:motionUse(m.name||m.file),loop:m.loop??(m.use==='idle')}));}catch{}
  return [...walk(dir)].filter(f=>/\.(vrma|vmd)$/i.test(f.rel)&&f.stat.size<=50e6).slice(0,40).map(f=>{const use=motionUse(f.rel);return {file:f.rel,name:title(f.rel).slice(0,80),use,loop:use==='idle'};});
}
// formats: model-formats.cjs ({detect(dir) → [{renderer,entry,title,motions}]}) or null when it is not installed
function findModels(dir,{formats=null}={}){
  const files=[...walk(dir)],out=[];let id=0;const add=c=>out.push({id:`c${++id}`,available:true,...c});
  const modelDirs=new Set(files.filter(f=>MODEL_DIR.test(f.rel)).map(f=>path.posix.dirname(f.rel)));
  const underModel=rel=>{const dir=path.posix.dirname(rel);return [...modelDirs].some(d=>d==='.'||dir===d||dir.startsWith(d+'/'));};
  for(const f of files){
    if(/\.vrm$/i.test(f.rel))add({kind:'vrm',file:f.rel,title:title(f.rel),size:f.stat.size});
    else if(/\.glb$/i.test(f.rel))add({kind:'glb',file:f.rel,title:title(f.rel),size:f.stat.size});
  }
  let detected=null;if(formats?.detect)try{detected=formats.detect(dir)||[];}catch{detected=null;}
  if(detected)for(const m of detected){if(!['live2d','mmd'].includes(m.renderer))continue;const entry=safeRelative(m.entry);add({kind:m.renderer,renderer:m.renderer,file:entry,entry,title:String(m.title||title(entry)).slice(0,80),motions:Array.isArray(m.motions)?m.motions:[]});}
  else for(const f of files){
    // without the Live2D / MMD module they are listed, but cannot be added yet
    if(/\.model3\.json$/i.test(f.rel))add({kind:'live2d',renderer:'live2d',file:f.rel,entry:f.rel,title:title(f.rel),available:false});
    else if(/\.pmx$/i.test(f.rel))add({kind:'mmd',renderer:'mmd',file:f.rel,entry:f.rel,title:title(f.rel),available:false});
  }
  for(const f of files)if(/\.psd$/i.test(f.rel)&&f.stat.size<=300e6)add({kind:'psd',file:f.rel,title:title(f.rel),size:f.stat.size});
  // pictures, but not a model's textures (anything inside a folder that holds an MMD / Live2D / FBX model, or a texture folder)
  const pictures=files.filter(f=>/\.(png|jpe?g)$/i.test(f.rel)&&f.stat.size>=20e3&&f.stat.size<=30e6&&!TEXTURE_DIR.test(f.rel)&&!underModel(f.rel));
  for(const f of pictures.sort((a,b)=>b.stat.size-a.stat.size).slice(0,8))add({kind:'image',file:f.rel,title:title(f.rel),size:f.stat.size});
  return out;
}

// --- terms
const TERMS_NAME=/readme|read_me|read me|license|licence|terms|利用規約|規約|利用条件|使用条件|ライセンス|はじめに|お読み|読んで|注意|説明|使用許諾|规约|規範|kiyaku|rule/i;
function collectTerms(dir,{maxChars=30000,pdfText=defaultPdfText}={}){
  const found=[...walk(dir,{depth:4})].filter(f=>/\.(txt|md|html?|rtf|pdf)$/i.test(f.rel)&&f.stat.size<=2e6)
    .sort((a,b)=>Number(TERMS_NAME.test(b.rel))-Number(TERMS_NAME.test(a.rel))||a.rel.split('/').length-b.rel.split('/').length);
  const files=[],unread=[];let text='';
  for(const f of found.slice(0,12)){
    if(text.length>=maxChars)break;let body=null;
    if(/\.pdf$/i.test(f.rel))body=pdfText(f.file);
    else if(/\.rtf$/i.test(f.rel)){const r=spawnSync('/usr/bin/textutil',['-convert','txt','-stdout',f.file],{encoding:'utf8',timeout:10000});body=r.status===0?r.stdout:null;}
    else{body=decodeText(fs.readFileSync(f.file));if(/\.html?$/i.test(f.rel))body=htmlText(body);}
    if(!body||!body.trim()){unread.push(f.rel);continue;}
    files.push(f.rel);text+=`\n--- ${f.rel} ---\n${body.trim().slice(0,12000)}\n`;
  }
  return {text:text.slice(0,maxChars),files,unread};
}
// PDFs: Spotlight's extracted text when macOS has it; otherwise the file is listed as unread
function defaultPdfText(file){const r=spawnSync('/usr/bin/mdls',['-raw','-name','kMDItemTextContent',file],{encoding:'utf8',timeout:5000});const t=r.status===0?r.stdout.trim():'';return t&&t!=='(null)'?t:null;}
// The licence a VRM carries in its own metadata (VRM 1.0 VRMC_vrm.meta or VRM 0.x VRM.meta)
function vrmMeta(file){
  const fd=fs.openSync(file,'r');try{const head=Buffer.alloc(20);fs.readSync(fd,head,0,20,0);if(head.subarray(0,4).toString('latin1')!=='glTF'||head.subarray(16,20).toString('latin1')!=='JSON')return null;
    const length=head.readUInt32LE(12);if(length>20e6)return null;const json=Buffer.alloc(length);fs.readSync(fd,json,0,length,20);const data=JSON.parse(json.toString('utf8'));
    const meta=data.extensions?.VRMC_vrm?.meta||data.extensions?.VRM?.meta;if(!meta)return null;
    return Object.entries(meta).filter(([k,v])=>!/texture|thumbnail/i.test(k)&&v!==''&&v!=null).map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(', '):typeof v==='object'?JSON.stringify(v):v}`).join('\n').slice(0,3000);}
  catch{return null;}finally{fs.closeSync(fd);}
}

// --- PNG and PSD
const CRC=new Int32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c;});
const crc32=buf=>{let c=-1;for(const b of buf)c=CRC[(c^b)&0xff]^(c>>>8);return (c^-1)>>>0;};
function chunk(type,data){const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'latin1');data.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);return out;}
function encodePng(width,height,rgba){
  const rows=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(rows,y*(width*4+1)+1);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
let psdReady=false;
function readPsd(buffer){
  const psd=require('ag-psd');
  // no canvas in the main process: ag-psd only needs plain image data
  if(!psdReady){psd.initializeCanvas(()=>{throw new Error('canvas not available');},(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}));psdReady=true;}
  return psd.readPsd(buffer,{useImageData:true,skipThumbnail:true,skipLinkedFilesData:true});
}
// Photoshop's saved composite is used when it has a picture; a file saved without one is drawn from its visible layers
// (normal blending, layer opacity and clipping masks; '!' layers are always shown, as in PSDToolKit's convention).
function flattenPsd(buffer){
  const psd=readPsd(buffer),W=psd.width,H=psd.height;
  if(!W||!H||W*H>64e6)throw new Error('PSD 太大或格式不支援。');
  const composite=psd.imageData?.data;
  const blank=d=>{if(!d||d.length!==W*H*4)return true;for(let i=4;i<d.length;i+=4)if(d[i]!==d[0]||d[i+1]!==d[1]||d[i+2]!==d[2]||d[i+3]!==d[3])return false;return true;};
  let rgba;
  if(!blank(composite))rgba=composite;
  else{
    rgba=new Uint8ClampedArray(W*H*4);
    const alphaAt=(layer,x,y)=>{const img=layer.imageData,lx=x-(layer.left||0),ly=y-(layer.top||0);return lx<0||ly<0||lx>=img.width||ly>=img.height?0:img.data[(ly*img.width+lx)*4+3];};
    const draw=(layer,clipTo)=>{const img=layer.imageData,op=layer.opacity??1;if(!img||op<=0)return;const L=layer.left||0,T=layer.top||0;
      for(let y=0;y<img.height;y++){const Y=T+y;if(Y<0||Y>=H)continue;for(let x=0;x<img.width;x++){const X=L+x;if(X<0||X>=W)continue;
        const s=(y*img.width+x)*4;let a=img.data[s+3]/255*op;if(clipTo)a*=alphaAt(clipTo,X,Y)/255;if(a<=0)continue;
        const d=(Y*W+X)*4,da=rgba[d+3]/255,oa=a+da*(1-a);
        for(let c=0;c<3;c++)rgba[d+c]=(img.data[s+c]*a+rgba[d+c]*da*(1-a))/oa;rgba[d+3]=oa*255;}}};
    const visit=(layers,visible)=>{let base=null;
      for(const layer of layers||[]){const shown=visible&&(!layer.hidden||/^!/.test(layer.name||''));
        if(layer.children){visit(layer.children,shown);base=null;continue;}
        if(!layer.clipping){base=shown?layer:null;if(shown)draw(layer,null);}
        else if(shown&&base)draw(layer,base);}};
    visit(psd.children,true);
  }
  return {png:encodePng(W,H,rgba),width:W,height:H};
}
module.exports={LIMIT,decodeText,htmlText,safeRelative,unzip,untar,unpack,walk,findModels,findMotions,motionUse,collectTerms,vrmMeta,encodePng,flattenPsd,crc32};
