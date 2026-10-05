// "Make a character from a photo": a small window takes a photo (camera or file), Codex draws a brand-new chibi character
// of that person in Annie's style (SVG that animates like Annie), the user asks for changes, and a private Mod is saved.
// The photo stays in memory; it is written only to a private temporary folder while Codex looks at it, then deleted.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {BrowserWindow,session}=require('electron');
const mods=require('./mods.cjs');
const {drawCharacter}=require('./person-draw.cjs');

const STATES={idle:'neutral',working:'smug',waiting_for_approval:'surprised',speaking:'neutral',success:'happy',error:'nervous'};
function slug(name){const base=String(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,24);return `me-${base||'friend'}-${Date.now().toString(36).slice(-5)}`;}

// A Codex drawing becomes an ordinary schema-2 SVG Mod, placed exactly like Annie.
// origin: 'photo' (a real person), 'copy' (your version of an app character) or 'library' (an open-licence work)
const ORIGIN={photo:'用照片畫的私人角色',copy:'我的版本',library:'依開放資源重畫'};
function modFiles(drawing,{name,id,annie,personas,credit=null,origin='photo',basedOn=null}){
  const parts={transform:annie.transform,shadowY:annie.shadowY,mouth:drawing.mouth,rig:drawing.rig,face:drawing.face,accessories:{outfit:{svg:drawing.outfit.svg,...(drawing.outfit.hide?.length?{hide:drawing.outfit.hide}:{})}}};
  const manifest={schemaVersion:2,id,name,description:`${name}：${drawing.summary}（${ORIGIN[origin]||ORIGIN.photo}）`,author:'You',
    license:credit?`${credit}. Redrawn as a chibi with Codex.`:origin==='copy'&&basedOn?`Your own version of "${basedOn.name}", made with Codex. Original: ${basedOn.license}`:'Private character drawn from a photo of a real person. Keep it on this Mac; share only with that person\'s consent.',
    identity:`An original chibi desktop companion based on ${name}, a friend of the user: ${drawing.summary}. Friendly, playful and warm.`,
    renderer:'svg',parts:'parts.json',defaultSkin:'everyday',defaultPersona:personas[0].id,
    skins:[{id:'everyday',name:'日常',palette:drawing.palette,accessory:'outfit',states:STATES}],personas};
  return {manifest,parts};
}
function writeMod(root,files){const dir=path.join(root,files.manifest.id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'mod.json'),JSON.stringify(files.manifest,null,1));fs.writeFileSync(path.join(dir,'parts.json'),JSON.stringify(files.parts));return dir;}

function createPerson({app,handle,ipcMain,systemPreferences,catalog,onSaved,root=__dirname,draw=drawCharacter,live2dCore=null}){
  const userRoot=()=>path.join(app.getPath('userData'),'my-mods'),annieDir=path.join(root,'mods','annie');
  const annie=()=>JSON.parse(fs.readFileSync(path.join(annieDir,'parts.json'),'utf8')),personas=()=>JSON.parse(fs.readFileSync(path.join(annieDir,'mod.json'),'utf8')).personas;
  let window=null,windowEditor=null;
  const send=(channel,value)=>{if(window&&!window.isDestroyed())window.webContents.send(channel,value);};
  // the app's own sanitiser and face contract decide whether a drawing is usable
  function validate(candidate,name='preview',id='preview'){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'person-check-'));
    try{writeMod(dir,modFiles(candidate,{name,id,annie:annie(),personas:personas()}));const mod=mods.loadCatalog(dir)[0];
      if(!/class="eyes"/.test(candidate.face)||!/class="pupils"/.test(candidate.face))throw new Error('face needs <g class="eyes"> with <g class="pupils"> inside');return mod;}
    finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
  // a render of the drawing, so Codex can compare it with the photo
  async function render(mod){
    // a hidden ordinary window, not an offscreen one: offscreen rendering has no WebGL, so 3D (VRM) characters came out blank
    const view=new BrowserWindow({width:340,height:300,show:false,paintWhenInitiallyHidden:true,backgroundColor:'#ffffff',webPreferences:{sandbox:true,backgroundThrottling:false}});
    if(process.env.RENDER_DEBUG)view.webContents.on('console-message',e=>console.log('RENDER_CONSOLE',String(e.message).slice(0,240)));
    try{await view.loadFile(path.join(root,'person','render.html'));
      // PNG, 3D and Live2D Mods read their files through the asset loader; hand them over as data, one file at a time
      // (a Live2D or MMD folder can be large), keyed by the exact URL the renderer asks for
      await view.webContents.executeJavaScript(`(()=>{window.__assets={};Avatars.setAssetLoader(async url=>{const b=atob(window.__assets[url]||'');const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer;});Avatars.setLive2dCore({kit:'../vendor/live2d-kit.js',url:async()=>${JSON.stringify(live2dCore?.url()||null)}});return true;})()`);
      for(const file of mod.assets||[])await view.webContents.executeJavaScript(`window.__assets[${JSON.stringify(`mods/${encodeURIComponent(mod.id)}/${encodeURIComponent(file)}`)}]=${JSON.stringify(fs.readFileSync(path.join(mod.root||path.join(root,'mods'),mod.id,file)).toString('base64'))};true`);
      await view.webContents.executeJavaScript(`(()=>{const el=Avatars.mount(document.querySelector('#pet'),${JSON.stringify(mod)},${JSON.stringify(mod.skins[0])},'render');Avatars.update(el,{activity:'idle',emotion:'neutral',displayState:'idle'});return Promise.resolve(Avatars.ready?.(el)).then(()=>true,()=>true);})()`);
      await new Promise(r=>setTimeout(r,{vrm:1200,gltf:1200,mmd:2000,live2d:2000}[mod.renderer]||(mod.assets?.length?600:300)));return (await view.webContents.capturePage()).toPNG();}
    finally{view.destroy();}
  }
  // One editing session: what is being drawn or changed, the photo or reference (memory only) and the current drawing.
  // The Mac window and the phone each get their own, so they never step on each other.
  function createEditor({onProgress=()=>{},onClosed=()=>{}}={}){
    let photo=null,drawing=null,busy=false,editId=null,source=null,reference=null,kept=null,outfit=false,base=null;
    async function withPhoto(fn){
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),'person-photo-'));fs.chmodSync(dir,0o700);const file=path.join(dir,photo[0]===0x89?'reference.png':'photo.jpg');
      try{fs.writeFileSync(file,photo,{mode:0o600});return await fn(file);}finally{fs.rmSync(dir,{recursive:true,force:true});}
    }
    async function run(options){
      if(busy)throw new Error('還在畫，請稍等。');if(!photo&&!options.current)throw new Error('先拍一張或選一張照片。');busy=true;
      try{const result=await (photo?withPhoto:fn=>fn(null))(file=>draw({photo:file,annie:annie(),validate,render,onProgress,...options}));
        drawing=result.drawing;return {mod:result.mod,summary:drawing.summary,gender:drawing.gender};}
      finally{busy=false;}
    }
    // your own characters are edited in place; bundled ones are copied, never changed
    // outfit: a photo of clothes becomes a new skin of this character (same face and hair, new clothes and colours)
    function begin({edit=null,skinId=null,image=null,outfit:wantOutfit=false}={}){
      const target=edit?catalog.find(m=>m.id===edit):null;if(edit&&!target)throw new Error('找不到這個角色。');
      if(wantOutfit&&!(target?.renderer==='svg'&&target.parts?.rig))throw new Error('這個角色不是用可編輯的 SVG 畫的：先按「做我的版本」請 Codex 重畫一份，之後就能拍照換造型。');
      const skin=target?(target.skins.find(s=>s.id===skinId)||target.skins.find(s=>s.id===target.defaultSkin)||target.skins[0]):null;
      reference=image;editId=target?.private?edit:null;source=target&&!target.private?{mod:target,skin}:null;photo=null;drawing=null;outfit=Boolean(wantOutfit);base=null;kept=editId?{skinId:skin.id}:null;
    }
    // What editing starts from. A saved photo character is edited in place; Annie-style SVG Mods load as an editable copy;
    // built-in, PNG and VRM characters (and pictures from the open libraries) are first redrawn by Codex, then edited as a copy.
    async function loaded(){
      if(editId){const dir=path.join(userRoot(),editId),parts=JSON.parse(fs.readFileSync(path.join(dir,'parts.json'),'utf8')),manifest=JSON.parse(fs.readFileSync(path.join(dir,'mod.json'),'utf8'));
        // a character can have several skins; the one picked is edited and the others are kept as they are
        const skin=manifest.skins.find(s=>s.id===kept?.skinId)||manifest.skins[0],look=parts.accessories?.[skin.accessory]||{svg:'',hide:[]};
        drawing={gender:'neutral',summary:String(manifest.description||'').replace(/^[^：]*：/,'').replace(/（[^（）]*）$/,''),palette:skin.palette,rig:parts.rig,face:parts.face,outfit:{svg:look.svg,hide:look.hide||[]},mouth:parts.mouth||[171,180]};
        kept={origin:Object.keys(ORIGIN).find(k=>String(manifest.description||'').endsWith(`（${ORIGIN[k]}）`))||'photo',license:manifest.license,manifest,parts,skinId:skin.id};base=drawing;
        if(outfit)return {outfit:true,name:manifest.name,skinName:skin.name,mod:validate(drawing,manifest.name,editId)};
        return {mod:validate(drawing,manifest.name,editId),summary:drawing.summary,name:manifest.name};}
      if(reference)return {redraw:true,name:reference.name,image:`data:image/png;base64,${reference.png.toString('base64')}`,credit:reference.credit};
      if(!source)return null;
      const {mod,skin}=source,name=`${mod.name}（我的版本）`;
      if(mod.renderer==='svg'&&mod.parts?.rig){const accessory=mod.parts.accessories?.[skin.accessory]||{svg:'',hide:[]};
        drawing={gender:'neutral',summary:`${mod.name} 的 ${skin.name}`,palette:skin.palette,rig:mod.parts.rig,face:mod.parts.face,outfit:{svg:accessory.svg||'',hide:accessory.hide||[]},mouth:mod.parts.mouth||[171,180]};base=drawing;
        if(outfit)return {outfit:true,name,skinName:skin.name,mod:validate(drawing,name)};
        return {mod:validate(drawing,name),summary:drawing.summary,name,copy:true};}
      return {redraw:true,name,image:`data:image/png;base64,${(await render({...mod,skins:[skin,...mod.skins.filter(s=>s!==skin)]})).toString('base64')}`};
    }
    function drawPhoto(dataUrl){
      const match=typeof dataUrl==='string'&&dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);if(!match||dataUrl.length>6e6)throw new Error('照片格式不對或太大。');
      photo=Buffer.from(match[1],'base64');drawing=null;return run({});
    }
    async function redraw(){
      if(!source&&!reference)throw new Error('沒有要重畫的角色。');
      photo=reference?reference.png:await render({...source.mod,skins:[source.skin,...source.mod.skins.filter(s=>s!==source.skin)]});drawing=null;
      try{return await run({reference:'character'});}finally{photo=null;}
    }
    // the clothes in the photo are drawn onto this character; its body, face and hair are kept exactly
    async function outfitPhoto(dataUrl){
      if(!outfit||!base)throw new Error('先選一個角色再拍衣服。');
      const match=typeof dataUrl==='string'&&dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);if(!match||dataUrl.length>6e6)throw new Error('照片格式不對或太大。');
      photo=Buffer.from(match[1],'base64');
      try{await run({current:base,reference:'outfit',instruction:'Redesign ONLY outfit.svg, outfit.hide and palette so the character wears the clothes in the FIRST image (a photo): garment types, colours, patterns, collars, sleeves, skirt or trousers, shoes, and accessories such as hats or bags. Return rig, face and mouth exactly unchanged.'});}
      finally{photo=null;}
      drawing={...drawing,rig:base.rig,face:base.face,mouth:base.mouth};
      return {mod:validate(drawing,'preview'),summary:drawing.summary,outfit:true};
    }
    function revise(instruction){if(!drawing)throw new Error('還沒有畫好的角色。');const text=String(instruction||'').trim().slice(0,300);if(!text)throw new Error('寫下想怎麼改。');
      if(outfit)return run({current:drawing,reference:'outfit',instruction:`${text} (change only the outfit and palette; keep rig, face and mouth exactly)`}).then(()=>{drawing={...drawing,rig:base.rig,face:base.face,mouth:base.mouth};return {mod:validate(drawing,'preview'),summary:drawing.summary,outfit:true};});
      return run({current:drawing,instruction:text});}
    function save(name){
      if(!drawing)throw new Error('還沒有畫好的角色。');const title=String(name||'').trim().slice(0,24);if(!title)throw new Error(outfit?'幫這套造型取個名字吧。':'幫角色取個名字吧。');
      if(outfit)return saveOutfit(title);
      if(kept?.manifest&&!reference&&!source)return saveInPlace(title);
      const id=editId||slug(title);validate(drawing,title,id);const files=modFiles(drawing,{name:title,id,annie:annie(),personas:personas(),credit:reference?.credit||null,origin:reference?'library':source?'copy':kept?.origin||'photo',basedOn:source?.mod});
      if(kept&&!reference&&!source)files.manifest.license=kept.license;  // editing in place keeps the licence it was saved with
      const dir=writeMod(userRoot(),files);
      const mod=mods.loadCatalog(userRoot(),{personal:true}).find(m=>m.id===id);if(!mod){fs.rmSync(dir,{recursive:true,force:true});throw new Error('角色沒有通過檢查，沒有存下來。');}
      // an edited character replaces its old entry; 'updated' tells open windows to redraw it
      mod.private=true;mod.root=userRoot();mod.updated=Date.now();const index=catalog.findIndex(m=>m.id===id);if(index>=0)catalog[index]=mod;else catalog.push(mod);
      onSaved(mod);reset();onClosed();return {id,name:title};
    }
    // writes a whole multi-skin character and swaps it into the catalog
    function store(manifest,parts,skinId){
      const dir=writeMod(userRoot(),{manifest,parts});
      const mod=mods.loadCatalog(userRoot(),{personal:true}).find(m=>m.id===manifest.id);if(!mod)throw new Error('造型沒有通過檢查，沒有存下來。');
      mod.private=true;mod.root=userRoot();mod.updated=Date.now();const index=catalog.findIndex(m=>m.id===mod.id);if(index>=0)catalog[index]=mod;else catalog.push(mod);
      onSaved(mod,{skinId});reset();onClosed();return {id:mod.id,name:manifest.name,skinId,dir};
    }
    // editing one skin of your own character: shared body and face change, the other skins stay
    function saveInPlace(title){
      const manifest=structuredClone(kept.manifest),parts=structuredClone(kept.parts),skin=manifest.skins.find(s=>s.id===kept.skinId)||manifest.skins[0];
      Object.assign(parts,{rig:drawing.rig,face:drawing.face,mouth:drawing.mouth});parts.accessories[skin.accessory]={svg:drawing.outfit.svg,...(drawing.outfit.hide?.length?{hide:drawing.outfit.hide}:{})};
      skin.palette=drawing.palette;manifest.name=title;manifest.description=`${title}：${drawing.summary}（${ORIGIN[kept.origin]||ORIGIN.photo}）`;return store(manifest,parts,skin.id);
    }
    // a new skin from a photo of clothes: added to your own character, or to your own copy of a bundled one (all its skins come along)
    function saveOutfit(title){
      let manifest,parts;
      if(kept?.manifest){manifest=structuredClone(kept.manifest);parts=structuredClone(kept.parts);}
      else{const {mod}=source,files=modFiles(base,{name:`${mod.name}（我的版本）`,id:slug(mod.name),annie:annie(),personas:personas(),origin:'copy',basedOn:mod});
        manifest=files.manifest;parts={...files.parts,transform:mod.parts.transform??files.parts.transform,shadowY:mod.parts.shadowY??files.parts.shadowY,accessories:structuredClone(mod.parts.accessories)};
        manifest.skins=mod.skins.map(s=>({id:s.id,name:s.name,palette:s.palette,accessory:s.accessory,states:s.states||STATES}));manifest.defaultSkin=mod.defaultSkin;manifest.personas=mod.personas||manifest.personas;manifest.defaultPersona=mod.defaultPersona||manifest.defaultPersona;}
      if(manifest.skins.length>=20)throw new Error('這個角色的造型已經 20 套了，先刪掉一些。');
      let n=manifest.skins.length;while(manifest.skins.some(s=>s.id===`look-${n}`))n++;const id=`look-${n}`;
      parts.accessories[id]={svg:drawing.outfit.svg,...(drawing.outfit.hide?.length?{hide:drawing.outfit.hide}:{})};
      manifest.skins.push({id,name:title,palette:drawing.palette,accessory:id,states:STATES});
      return store(manifest,parts,id);
    }
    function reset(){photo=null;drawing=null;editId=null;source=null;reference=null;kept=null;outfit=false;base=null;}
    return {begin,loaded,drawPhoto,outfitPhoto,redraw,revise,save,reset,get busy(){return busy;}};
  }
  const from=fn=>(event,...args)=>{if(!window||event.sender!==window.webContents)throw new Error('Unknown window');return fn(...args);};
  ipcMain.handle('person:draw',from(dataUrl=>windowEditor.drawPhoto(dataUrl)));
  ipcMain.handle('person:revise',from(text=>windowEditor.revise(text)));
  ipcMain.handle('person:save',from(name=>windowEditor.save(name)));
  ipcMain.handle('person:close',from(()=>window?.close()));
  ipcMain.handle('person:loaded',from(()=>windowEditor.loaded()));
  ipcMain.handle('person:redraw',from(()=>windowEditor.redraw()));
  // characters made from photos live in userData/my-mods and load with the bundled ones
  function loadSaved(onError){try{for(const mod of mods.loadCatalog(userRoot(),{onError,personal:true})){mod.private=true;mod.root=userRoot();catalog.push(mod);}}catch{}}
  function remove(id){
    if(!/^me-[a-z0-9-]+$/.test(String(id)))throw new Error('只能刪除自己用照片做的角色。');
    const index=catalog.findIndex(m=>m.id===id);if(index>=0)catalog.splice(index,1);fs.rmSync(path.join(userRoot(),id),{recursive:true,force:true});return true;
  }
  handle('bula:person-list',()=>catalog.filter(m=>m.private).map(m=>({id:m.id,name:m.name})));
  async function open(language='zh',{edit=null,skinId=null,image=null}={}){
    if(window&&!window.isDestroyed())window.close();
    windowEditor=createEditor({onProgress:p=>send('person:progress',p),onClosed:()=>window?.close()});windowEditor.begin({edit,skinId,image});
    if(process.platform==='darwin'&&systemPreferences.getMediaAccessStatus('camera')!=='granted')await systemPreferences.askForMediaAccess('camera').catch(()=>false);
    // its own session, so the camera is allowed here and nowhere else
    const camera=session.fromPartition('person-camera');
    const allowed=(contents,permission,details)=>contents===window?.webContents&&permission==='media'&&(details?.mediaTypes?details.mediaTypes.every(type=>type==='video'):true);
    camera.setPermissionRequestHandler((contents,permission,callback,details)=>callback(allowed(contents,permission,details)));
    camera.setPermissionCheckHandler((contents,permission,_origin,details)=>allowed(contents,permission,details));
    window=new BrowserWindow({width:820,height:720,minWidth:680,minHeight:600,title:language.startsWith('zh')?'用照片做角色':'Character from a photo',backgroundColor:'#f6fafd',show:false,
      webPreferences:{preload:path.join(root,'person','person-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,session:camera}});
    const opened=window;opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));opened.webContents.on('will-navigate',event=>event.preventDefault());
    opened.once('ready-to-show',()=>opened.show());opened.on('closed',()=>{if(window===opened){window=null;windowEditor?.reset();}});
    await opened.loadFile(path.join(root,'person','person.html'));return opened;
  }
  return {open,loadSaved,remove,validate,render,createEditor,getWindow:()=>window};
}
module.exports={createPerson,modFiles};
