const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {app}=require('electron');
// Avatar store (fixture data shaped like the real libraries): featured characters on open; add a VRoid Hub model and a Sketchfab glTF and wear them;
// send an anime picture to Codex (stand-in binary) to redraw as an editable character; the credit line is kept with the character.
async function run({runtime,openWardrobe,getMarket,personService}){
  process.env.LIBRARY_FIXTURE='1';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'library-smoke-')),fake=path.join(dir,'fake-codex.cjs');
  const annie=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','annie','parts.json'),'utf8'));
  const drawing={gender:'neutral',summary:'戴頭盔的小騎士',palette:{body:'#8a96a8',bodyLight:'#c9d2de',belly:'#ffffff',accent:'#4a5568',ink:'#2a2a33',cheek:'#f4a9a3'},rig:annie.rig,face:annie.face,outfit:{svg:annie.accessories['lace-collar'].svg,hide:[]},mouth:annie.mouth};
  fs.writeFileSync(fake,`let p='';process.stdin.on('data',d=>p+=d).on('end',()=>console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(${JSON.stringify(drawing)})}})));`);
  process.env.CODEX_BIN=require('./fake-bin.cjs').fakeBin(dir,'codex',fake);
  const wait=async(fn,timeout=30000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until){const st=await getMarket()?.webContents.executeJavaScript(`JSON.stringify({status:document.querySelector('#library-status')?.textContent,cards:document.querySelectorAll('.lib-card').length,bg:document.querySelector('.lib-card .thumb')?.style.backgroundImage?.slice(0,40),btn:document.querySelector('.lib-card button')?.textContent})`).catch(e=>e.message);throw new Error('Library smoke timed out '+st+' mod='+runtime.state.modId);}await new Promise(r=>setTimeout(r,150));}};
  await openWardrobe();await wait(()=>getMarket()&&!getMarket().isDestroyed());const pageErrors=[];getMarket().webContents.on('console-message',e=>{if(e.level==='error'||/error/i.test(e.message))pageErrors.push(e.message.slice(0,200));});
  // a script that throws says which one, and what the page logged
  const mk=code=>getMarket().webContents.executeJavaScript(code).catch(error=>{throw new Error(`${error.message} in: ${code.slice(0,200)} | page: ${pageErrors.slice(-3).join(' / ')}`);});
  await wait(()=>mk(`Boolean(document.querySelector('#library-form'))`).catch(()=>false));
  // the store is its own page next to the installed characters, loaded when first opened
  assert.equal(await mk(`document.querySelector('#library').hidden&&!document.querySelector('#page-installed').hidden`),true);
  await mk(`document.querySelector('[data-page=store]').click();true`);assert.equal(await mk(`document.querySelector('#page-installed').hidden`),true);
  const only=(sources,query)=>mk(`for(const i of document.querySelectorAll('#library-form input[name=source]'))i.checked=${JSON.stringify(sources)}.includes(i.value);document.querySelector('#library-query').value=${JSON.stringify(query)};document.querySelector('#library-form').requestSubmit();true`);
  const card=title=>`[...document.querySelectorAll('.lib-card')].find(c=>c.querySelector('h4').textContent.includes(${JSON.stringify(title)}))`;
  // the store opens on featured characters (VRoid's own samples, official characters) and VRoid Hub staff picks
  await wait(()=>mk(`Boolean(${card('Shino')})&&Boolean(${card('Staff Pick Girl')})&&Boolean(${card('Unity-chan')})`));
  // the cards can be replaced while a search is still settling, so each check waits for a stable card instead of reading once
  await wait(()=>mk(`${card('Shino')}?.querySelector('.lic')?.textContent==='CC0'`));
  await wait(()=>mk(`/AI 輔助下載|Assisted download/i.test(${card('Unity-chan')}?.querySelector('button')?.textContent||'')`));
  // VRoid Hub: only the model other apps may use; its author's conditions are shown and kept with the character
  await only(['vroid'],'miko');await wait(()=>mk(`document.querySelectorAll('.lib-card').length===1&&document.querySelector('.lib-card .thumb').style.backgroundImage.includes('data:image/png')`));
  assert.equal(await mk(`document.querySelector('.lib-card .lic').textContent`),'VRoid 條件：個人營利可・可改造・需標註');
  await mk(`document.querySelector('.lib-card button').click();true`);await wait(()=>runtime.state.modId.startsWith('me-shrine-miko'));
  const vrmDir=path.join(app.getPath('userData'),'my-mods',runtime.state.modId);assert.ok(fs.existsSync(path.join(vrmDir,'model.vrm')));
  assert.match(JSON.parse(fs.readFileSync(path.join(vrmDir,'mod.json'),'utf8')).license,/Based on "Shrine Miko" by Miko Maker \(VRoid 條件/);
  await wait(()=>mk(`[...document.querySelectorAll('.mod-card.private h3')].some(h=>h.textContent.includes('Shrine Miko'))`),10000);
  // Sketchfab: a plain glTF character is added and worn as a 3D model
  await only(['sketchfab'],'knight');await wait(()=>mk(`Boolean(${card('Anime Knight Girl')})`));
  await mk(`${card('Anime Knight Girl')}.querySelector('button').click();true`);await wait(()=>runtime.state.modId.startsWith('me-anime-knight-girl'));
  const glbDir=path.join(app.getPath('userData'),'my-mods',runtime.state.modId);assert.equal(JSON.parse(fs.readFileSync(path.join(glbDir,'mod.json'),'utf8')).renderer,'gltf');
  // 3D previews draw only while their card is on screen: none while the store page is shown, the new one once its card is in view
  assert.equal(await mk(`document.querySelectorAll('#page-installed .avatar-3d canvas').length`),0,'3D previews are released on the store page');
  // previews draw only while visible; a window hidden behind others (the other suites' windows) isn't, so bring it forward
  getMarket().show();getMarket().focus();
  await mk(`document.querySelector('[data-page=installed]').click();true`);
  // the cards are rebuilt after an import, so wait for the new one before scrolling to it
  await wait(()=>mk(`(()=>{const c=[...document.querySelectorAll('.mod-card.private')].find(c=>c.querySelector('h3')?.textContent.includes('Anime Knight'));c?.scrollIntoView();return Boolean(c);})()`));
  await wait(()=>mk(`(()=>{const c=[...document.querySelectorAll('.mod-card.private')].find(c=>c.querySelector('h3').textContent.includes('Anime Knight'));return Boolean(c?.querySelector('.avatar-3d canvas'))&&!c.querySelector('.avatar-3d').dataset.error;})()`),15000);
  await mk(`document.querySelector('[data-page=store]').click();true`);
  fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','library.png'),(await getMarket().webContents.capturePage()).toPNG());
  // anime pictures are reference-only fan art: Codex redraws one as an editable character and the source is credited
  await only(['booru'],'貓耳');await wait(()=>mk(`document.querySelectorAll('.lib-card').length===1`));
  assert.match(await mk(`document.querySelector('.lib-card').textContent`),/僅供參考|Reference only/);
  await mk(`document.querySelector('.lib-card button').click();true`);
  await wait(()=>personService.getWindow()&&!personService.getWindow().isDestroyed());const pw=personService.getWindow(),p=code=>pw.webContents.executeJavaScript(code);
  await wait(()=>p(`!document.querySelector('#redraw').hidden&&document.querySelector('#pet img.reference')?.naturalWidth>100`));
  await p(`document.querySelector('#redraw').click();true`);await wait(()=>p(`document.querySelectorAll('#expressions figure').length===10`));
  await p(`document.querySelector('#save').click();true`);await wait(()=>!personService.getWindow());
  const id=runtime.state.modId;assert.ok(id.startsWith('me-'));const manifest=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'my-mods',id,'mod.json'),'utf8'));
  assert.match(manifest.license,/Based on "animal ears cat ears smile" \(同人圖・僅供參考\), https:\/\/safebooru\.org\/index\.php\?page=post&s=view&id=1\. Redrawn as a chibi with Codex\./);
  console.log('LIBRARY_SMOKE',JSON.stringify({featured:true,vroidAdded:true,gltfWorn:true,termsShown:true,imageRedrawn:true,creditKept:true}));
}
module.exports={run};
