// Draws the app icon from the Annie Mod with the app's own renderer, then builds build/icon.png and build/icon.icns.
// Usage: npx electron scripts/make-icon.cjs
const {app,BrowserWindow}=require('electron');const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),build=path.join(root,'build');
app.whenReady().then(async()=>{
  const mod=require('../src/main/mods.cjs').loadCatalog().find(m=>m.id==='annie'),skin=mod.skins.find(s=>s.id===mod.defaultSkin);
  const win=new BrowserWindow({width:1024,height:1024,show:false,transparent:true,frame:false,backgroundColor:'#00000000',useContentSize:true,webPreferences:{offscreen:true,sandbox:true}});
  await win.loadFile(path.join(build,'icon.html'));
  await win.webContents.executeJavaScript(`(()=>{const el=Avatars.mount(document.querySelector('#pet'),${JSON.stringify(mod)},${JSON.stringify(skin)},'icon');
    Avatars.update(el,{activity:'idle',emotion:'happy',speaking:false,displayState:'idle'});return true;})()`);
  await new Promise(r=>setTimeout(r,800));
  const image=(await win.webContents.capturePage()).resize({width:1024,height:1024});
  fs.writeFileSync(path.join(build,'icon.png'),image.toPNG());
  // iconutil wants every size in an .iconset folder
  const set=path.join(build,'icon.iconset');fs.rmSync(set,{recursive:true,force:true});fs.mkdirSync(set);
  for(const size of [16,32,128,256,512])for(const scale of [1,2]){const px=size*scale;fs.writeFileSync(path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`),image.resize({width:px,height:px,quality:'best'}).toPNG());}
  execFileSync('/usr/bin/iconutil',['-c','icns',set,'-o',path.join(build,'icon.icns')]);fs.rmSync(set,{recursive:true,force:true});
  // menu bar and phone home-screen icons
  fs.writeFileSync(path.join(build,'icon-256.png'),image.resize({width:256,height:256,quality:'best'}).toPNG());
  console.log('ICON_DONE',path.join(build,'icon.icns'));app.quit();
});
