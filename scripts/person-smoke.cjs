const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {app}=require('electron');
// Photo → Codex draws (a stand-in codex binary returns a fixed drawing) → revise → save a private character → it is worn → delete.
// Checks that the photo reaches Codex as a file that is deleted afterwards and is never kept with the character.
async function run({win,personService,runtime,openWardrobe,getMarket}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'person-smoke-')),log=path.join(dir,'calls.jsonl'),fake=path.join(dir,'fake-codex.cjs');
  const annie=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','annie','parts.json'),'utf8'));
  const drawing={gender:'male',summary:'戴眼鏡、短髮的上班族男生',palette:{body:'#273d6b',bodyLight:'#5b7fc0',belly:'#ffffff',accent:'#1b2a4a',ink:'#2a2a33',cheek:'#f4a9a3'},rig:annie.rig,face:annie.face,outfit:{svg:annie.accessories['lace-collar'].svg,hide:[]},mouth:annie.mouth};
  fs.writeFileSync(fake,`const fs=require('fs');const args=process.argv.slice(2);let prompt='';process.stdin.on('data',d=>prompt+=d).on('end',()=>{
const images=args.flatMap((a,i)=>a==='-i'?[args[i+1]]:[]);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({images,exist:images.map(f=>fs.existsSync(f)),revise:prompt.includes('The user asks for this change'),character:prompt.includes('existing app character')})+'\\n');
const d=${JSON.stringify(drawing)};if(prompt.includes('頭髮再短'))d.summary='短髮版';if(prompt.includes('改成紅色上衣'))d.summary='紅衣版';
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(d)}}));});`);
  process.env.CODEX_BIN=require('./fake-bin.cjs').fakeBin(dir,'codex',fake);
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=30000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Person smoke timed out');await new Promise(r=>setTimeout(r,150));}};
  await js(`window.bula.personOpen()`);await wait(()=>Boolean(personService.getWindow()));const pw=personService.getWindow();
  const p=code=>pw.webContents.executeJavaScript(code);await wait(()=>p(`Boolean(window.person)&&document.readyState==='complete'`));
  // a drawn stand-in photo goes through the same path as a camera shot
  await p(`(()=>{const c=document.createElement('canvas');c.width=600;c.height=800;const g=c.getContext('2d');g.fillStyle='#dbe7f0';g.fillRect(0,0,600,800);g.fillStyle='#f1c9ac';g.beginPath();g.arc(300,320,150,0,7);g.fill();useImage(c,600,800);return true;})()`);
  await wait(()=>p(`document.querySelector('#summary').textContent.includes('上班族')`),60000);
  assert.equal(await p(`document.querySelectorAll('#expressions figure').length`),10,'every expression is previewed');
  assert.equal(await p(`document.querySelector('#expressions figure:nth-child(8) .avatar,#expressions figure:nth-child(8) svg')?.closest('.blinking,[class*=blinking]')!==null||document.querySelector('#expressions figure:nth-child(8) .blinking')!==null`),true,'blink look is applied');
  fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','person-preview.png'),(await pw.webContents.capturePage()).toPNG());
  const calls=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(calls.length>=3,`first drawing plus two comparison rounds (${calls.length})`);assert.ok(calls.every(c=>c.exist[0]),'the photo is there while Codex looks');
  assert.ok(calls.slice(1).every(c=>c.images.length===2),'revision rounds also see a render of the drawing');
  assert.ok(calls.every(c=>!fs.existsSync(c.images[0])),'the photo file is deleted afterwards');
  await p(`document.querySelector('#revise').value='頭髮再短一點';document.querySelector('#revise-form').requestSubmit();true`);
  await wait(()=>p(`document.querySelector('#summary').textContent==='短髮版'`));
  assert.ok(fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).at(-1).revise,'the request reaches Codex');
  // a new interface language redraws the open window (status line and look captions too); then back to zh-Hant
  for(const [lang,title,look] of [['en','Character from a photo','Neutral'],['ja','写真からキャラクターを作る','ふつう'],['zh-Hant','用照片做角色','一般']]){
    await js(`window.bula.uiLanguage(${JSON.stringify(lang)})`);
    await wait(()=>p(`document.querySelector('h1').textContent===${JSON.stringify(title)}&&document.querySelector('#expressions figcaption').textContent===${JSON.stringify(look)}`),5000);
    assert.equal(await p(`document.querySelector('#status').textContent`),await p(`t('person.status.drawn')`),`${lang}: the status line is redrawn`);
    if(process.env.PERSON_SHOTS)fs.writeFileSync(path.join(process.env.PERSON_SHOTS,`person-${lang}.png`),(await pw.webContents.capturePage()).toPNG());
  }
  await p(`document.querySelector('#name').value='小明';document.querySelector('#save').click();true`);
  await wait(()=>runtime.state.modId.startsWith('me-'));
  const id=runtime.state.modId,modDir=path.join(app.getPath('userData'),'my-mods',id);
  assert.deepEqual(fs.readdirSync(modDir).sort(),['mod.json','parts.json'],'no photo is kept with the character');
  assert.match(JSON.parse(fs.readFileSync(path.join(modDir,'mod.json'),'utf8')).license,/Private/);
  assert.equal(await js(`window.bula.personList().then(l=>l.length)`),1);
  // the marketplace lists it as private with an edit button, which reopens it for editing
  await openWardrobe();await wait(()=>getMarket()&&!getMarket().isDestroyed());const mk=code=>getMarket().webContents.executeJavaScript(code);
  await wait(()=>mk(`Boolean(document.querySelector('[data-mod-id=${id}] .edit-person'))`).catch(()=>false));
  assert.equal(await mk(`document.querySelector('[data-mod-id=${id}] .badge').textContent`),await mk(`t('marketplace.card.private')`));
  fs.writeFileSync(path.join(__dirname,'..','evidence','person-marketplace.png'),(await getMarket().webContents.capturePage()).toPNG());
  // reopen the saved character from the marketplace and keep editing it (no photo this time: Codex sees only its render)
  await mk(`document.querySelector('[data-mod-id=${id}] .edit-person').click();true`);await wait(()=>personService.getWindow()&&personService.getWindow()!==pw&&!personService.getWindow().isDestroyed());
  const ew=personService.getWindow(),e=code=>ew.webContents.executeJavaScript(code);
  await wait(()=>e(`document.querySelector('#name')?.value==='小明'&&document.querySelectorAll('#expressions figure').length===10`));
  await e(`document.querySelector('#revise').value='改成紅色上衣';document.querySelector('#revise-form').requestSubmit();true`);
  await wait(()=>e(`document.querySelector('#summary').textContent==='紅衣版'`));
  const edit=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).at(-1);assert.equal(edit.images.length,1,'edit without a photo sends only the render');
  await e(`document.querySelector('#save').click();true`);await wait(()=>JSON.parse(fs.readFileSync(path.join(modDir,'mod.json'),'utf8')).description.includes('紅衣版'));
  assert.equal(runtime.state.modId,id,'the same character is updated, not duplicated');
  await wait(()=>mk(`document.querySelector('[data-mod-id=${id}] .description').textContent.includes('紅衣版')`),10000);assert.equal(await js(`window.bula.personList().then(l=>l.length)`),1);
  await js(`window.bula.personDelete(${JSON.stringify(id)})`);assert.equal(fs.existsSync(modDir),false);assert.equal(runtime.state.modId,'annie','deleting the worn character switches back to Annie');
  // any other character: Annie (SVG) loads straight away as an editable copy; Miso (built-in) and Pixel Byte (PNG) are redrawn first
  const annieBefore=fs.readFileSync(path.join(__dirname,'..','mods','annie','parts.json'),'utf8');
  for(const [modId,redraw] of [['annie',false],['miso',true],['pixel-byte',true]]){
    await mk(`document.querySelector('[data-mod-id=${modId}] .edit-person').click();true`);
    await wait(()=>personService.getWindow()&&!personService.getWindow().isDestroyed());const cw=personService.getWindow(),c=code=>cw.webContents.executeJavaScript(code);
    await wait(()=>c(`document.querySelector('#name')?.value.endsWith('（我的版本）')`));
    if(redraw){assert.equal(await c(`!document.querySelector('#redraw').hidden&&document.querySelector('#pet img.reference').naturalWidth>100`),true,`${modId}: a render of the current look is shown`);
      const visible=await c(`(()=>{const i=document.querySelector('#pet img.reference'),cv=document.createElement('canvas');cv.width=i.naturalWidth;cv.height=i.naturalHeight;const g=cv.getContext('2d');g.drawImage(i,0,0);const d=g.getImageData(0,0,cv.width,cv.height).data;let ink=0;for(let k=0;k<d.length;k+=16)if(d[k]<200||d[k+1]<200||d[k+2]<200)ink++;return ink;})()`);
      assert.ok(visible>200,`${modId}: the render is not blank (${visible})`);
      await c(`document.querySelector('#redraw').click();true`);await wait(()=>c(`document.querySelectorAll('#expressions figure').length===10`),30000);
      const call=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).at(-1);assert.ok(call.character&&call.images[0].endsWith('.png'),`${modId}: Codex redraws from the character's render`);}
    else assert.equal(await c(`document.querySelectorAll('#expressions figure').length`),10,'Annie loads without a redraw');
    await c(`document.querySelector('#save').click();true`);await wait(()=>!personService.getWindow());
    await wait(()=>mk(`document.querySelectorAll('.mod-card.private').length`).then(n=>n===({annie:1,miso:2,'pixel-byte':3})[modId]),10000);
  }
  assert.equal(fs.readFileSync(path.join(__dirname,'..','mods','annie','parts.json'),'utf8'),annieBefore,'the bundled Annie is never changed');
  console.log('PERSON_SMOKE',JSON.stringify({codexRounds:calls.length,photoDeleted:true,revise:true,saved:true,worn:true,photoNotKept:true,allExpressions:true,marketplaceEdit:true,editSaved:true,copyBundled:true,redrawBuiltinAndPng:true,deleted:true}));
}
module.exports={run};
