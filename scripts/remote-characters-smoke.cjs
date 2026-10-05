const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {BrowserWindow,app}=require('electron');
// The phone's Characters tab: change skin, make "my version" of Annie with Codex, add a 3D avatar from the open library,
// have a library picture redrawn, and make a character from a phone photo. Stand-in Codex and fixture library data.
async function run({win,startRemote,runtime}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'remote-chars-')),fake=path.join(dir,'fake-codex.cjs'),bin=path.join(dir,'codex');
  const annie=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','annie','parts.json'),'utf8'));
  const drawing={gender:'neutral',summary:'手機畫的角色',palette:{body:'#e58fb0',bodyLight:'#f6c6d6',belly:'#ffffff',accent:'#a3416a',ink:'#2a2a33',cheek:'#f4a9a3'},rig:annie.rig,face:annie.face,outfit:{svg:annie.accessories['lace-collar'].svg,hide:[]},mouth:annie.mouth};
  fs.writeFileSync(fake,`let p='';process.stdin.on('data',d=>p+=d).on('end',()=>{const d=${JSON.stringify(drawing)};if(p.includes('粉紅'))d.summary='粉紅版';console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(d)}}));});`);
  fs.writeFileSync(bin,`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${fake}" "$@"\n`,{mode:0o755});process.env.CODEX_BIN=bin;
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=30000,label='')=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Remote characters smoke timed out '+label);await new Promise(r=>setTimeout(r,150));}};
  await startRemote();const info=await js(`window.bula.remotePair()`);
  const phone=new BrowserWindow({width:390,height:820,show:true,webPreferences:{contextIsolation:true,sandbox:true,partition:'remote-chars-phone'}});
  try{
    await phone.loadURL(info.link);const p=code=>phone.webContents.executeJavaScript(code);
    await wait(()=>p(`!document.querySelector('#app').hidden&&document.querySelector('#link').classList.contains('on')`),20000,'pair');
    await p(`document.querySelector('#tabs [data-tab=characters]').click();true`);
    await wait(()=>p(`document.querySelectorAll('#char-list .char').length>=5`),20000,'list');
    // change skin from the phone
    await p(`document.querySelector('.char[data-id=miso] .skins button[data-skin=midnight]').click();true`);
    await wait(()=>runtime.state.modId==='miso'&&runtime.state.skinId==='midnight',10000,'skin');
    // edit Annie → my version (SVG copy, no redraw) → revise with Codex → save
    await p(`document.querySelector('.char[data-id=annie] .edit').click();true`);
    await wait(()=>p(`document.querySelectorAll('#ed-looks figure').length===5&&!document.querySelector('#ed-revise-form').hidden`),20000,'annie editor');
    await p(`document.querySelector('#ed-revise').value='衣服改粉紅';document.querySelector('#ed-revise-form').requestSubmit();true`);
    await wait(()=>p(`document.querySelector('#ed-status').textContent.includes('粉紅版')`),30000,'revise');
    await p(`document.querySelector('#ed-name').value='安妮粉紅';document.querySelector('#ed-save-form').requestSubmit();true`);
    await wait(()=>runtime.snapshot().mod.name==='安妮粉紅',10000,'save');
    { const copy=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'my-mods',runtime.state.modId,'mod.json'),'utf8'));assert.match(copy.description,/（我的版本）$/);assert.match(copy.license,/^Your own version of "Annie"/); }
    fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','remote-characters.png'),(await phone.webContents.capturePage()).toPNG());
    // open library: a 3D avatar is added and worn
    // the store tab scrolls on its own (a long list must not be cut off)
    assert.equal(await p(`getComputedStyle(document.querySelector('#tab-store')).overflowY`),'auto');
    await p(`for(const i of document.querySelectorAll('.lib-sources input'))i.checked=i.value==='vrm';document.querySelector('#lib-q').value='elf';document.querySelector('#lib-form').requestSubmit();true`);
    await wait(()=>p(`document.querySelectorAll('#lib-results .lib').length===1`),20000,'lib vrm');
    await p(`document.querySelector('#lib-results .lib button').click();true`);await wait(()=>runtime.snapshot().mod.renderer==='vrm'&&runtime.state.modId.startsWith('me-elel'),30000,'vrm worn');
    // open library: a picture is redrawn by Codex in the phone editor
    await p(`for(const i of document.querySelectorAll('.lib-sources input'))i.checked=i.value==='booru';document.querySelector('#lib-q').value='cat ears';document.querySelector('#lib-form').requestSubmit();true`);
    await wait(()=>p(`document.querySelector('#lib-results .lib b')?.textContent==='animal ears cat ears smile'`),20000,'lib image');
    await p(`document.querySelector('#lib-results .lib button').click();true`);await wait(()=>p(`!document.querySelector('#editor').hidden&&!document.querySelector('#ed-redraw').hidden`),20000,'redraw offered');
    await p(`document.querySelector('#ed-redraw').click();true`);await wait(()=>p(`document.querySelectorAll('#ed-looks figure').length===5`),30000,'redrawn');
    await p(`document.querySelector('#ed-save-form').requestSubmit();true`);await wait(()=>runtime.snapshot().mod.name.startsWith('animal ears'),10000,'saved redraw');
    assert.match(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'my-mods',runtime.state.modId,'mod.json'),'utf8')).license,/Based on "animal ears cat ears smile" \(同人圖/);
    // a photo from the phone
    await p(`(()=>{const c=document.createElement('canvas');c.width=300;c.height=400;const g=c.getContext('2d');g.fillStyle='#f1c9ac';g.fillRect(0,0,300,400);
      const photo=c.toDataURL('image/jpeg',.9);openEditor(async()=>{await job('/api/edit/photo',{photo},'交給 Codex 畫…');return null;},'用照片做角色');return true;})()`);
    await wait(()=>p(`document.querySelectorAll('#ed-looks figure').length===5&&document.querySelector('#ed-status').textContent.includes('手機畫的角色')`),30000,'photo drawn');
    await p(`document.querySelector('#ed-name').value='手機朋友';document.querySelector('#ed-save-form').requestSubmit();true`);await wait(()=>runtime.snapshot().mod.name==='手機朋友',10000,'saved photo');
    // a photo of clothes adds a skin: in place on your own character (its other skins stay), on a copy for a bundled one
    const friend=runtime.state.modId,manifest=id=>JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'my-mods',id,'mod.json'),'utf8'));
    await p(`loadCharacters();true`);await wait(()=>p(`[...document.querySelectorAll('.char')].some(c=>c.dataset.id==='annie'&&[...c.querySelectorAll('button')].some(b=>b.textContent.includes('拍照換造型')))`),10000,'outfit button');
    assert.equal(await p(`[...document.querySelectorAll('.char')].filter(c=>[...c.querySelectorAll('button')].some(b=>b.textContent.includes('拍照換造型'))).some(c=>c.querySelector('.mini').textContent==='3D 角色')`),false,'no outfit photos for 3D characters');
    const dress=(modId,skinId,name)=>p(`(()=>{const c=document.createElement('canvas');c.width=300;c.height=400;const g=c.getContext('2d');g.fillStyle='#2b6cb0';g.fillRect(0,0,300,400);const photo=c.toDataURL('image/jpeg',.9);
      openEditor(async()=>{await post('/api/edit/start',{modId:${JSON.stringify(modId)},skinId:${JSON.stringify(skinId)},outfit:true});await job('/api/edit/outfit',{photo},'換衣服…');return null;},'拍照換造型');return true;})()`)
      .then(()=>wait(()=>p(`document.querySelectorAll('#ed-looks figure').length===5&&!document.querySelector('#ed-save-form').hidden`),30000,'outfit drawn'))
      .then(()=>p(`document.querySelector('#ed-name').value=${JSON.stringify(name)};document.querySelector('#ed-save-form').requestSubmit();true`));
    await dress(friend,'everyday','雨衣');await wait(()=>runtime.state.modId===friend&&runtime.state.skinId==='look-1',10000,'outfit skin worn');
    assert.deepEqual(manifest(friend).skins.map(s=>s.name),['日常','雨衣']);
    await dress('annie','everyday','藍色洋裝');await wait(()=>runtime.state.modId.startsWith('me-annie'),10000,'annie outfit copy');
    const annieCopy=manifest(runtime.state.modId);assert.equal(annieCopy.skins.length,2,'Annie\'s lace outfit plus the new one');assert.equal(annieCopy.skins.find(s=>s.id===runtime.state.skinId).name,'藍色洋裝');
    const mine=fs.readdirSync(path.join(app.getPath('userData'),'my-mods'));assert.equal(mine.length,5,'Annie copy, 3D avatar, redrawn picture, photo character, Annie outfit copy');
    assert.ok(mine.every(id=>!fs.readdirSync(path.join(app.getPath('userData'),'my-mods',id)).some(f=>/\.(jpe?g)$/i.test(f))),'no photo is kept');
    console.log('REMOTE_CHARACTERS_SMOKE',JSON.stringify({skinFromPhone:true,editCopy:true,libraryVrm:true,libraryRedraw:true,photoCharacter:true,outfitSkins:true,photoNotKept:true}));
  }finally{phone.destroy();}
}
module.exports={run};
