const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {app,nativeImage}=require('electron');
const formats=require('../src/main/model-formats.cjs');const mods=require('../src/main/mods.cjs');const make=require('../test/fixtures/models/make.cjs');
// Live2D, MMD and a VRM with a .vrma motion in the real companion window, from tiny models built in code. The Live2D one first
// asks before downloading Live2D's Cubism Core; the "download" here is an offline stand-in (LIVE2D_CORE_FIXTURE). Each model must
// draw, play its idle motion (the canvas keeps changing), switch to a reaction, and render a preview picture.
async function run({win,runtime,catalog,personService}){
  const js=code=>win.webContents.executeJavaScript(code),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(fn,what,timeout=20000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error(`Models smoke timed out: ${what} (error: ${await js(`document.querySelector('#bula')?.dataset.error||''`)})`);await sleep(100);}};
  win.webContents.on('console-message',e=>{if(/error|refused|blocked|failed/i.test(e.message))console.log('PAGE',e.message.slice(0,300));});
  win.show();await wait(()=>js('document.body.dataset.ready==="true"'),'companion');
  const userRoot=path.join(app.getPath('userData'),'my-mods'),src=fs.mkdtempSync(path.join(os.tmpdir(),'models-smoke-'));
  const personas=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','annie','mod.json'),'utf8')).personas;
  const states={idle:'neutral',working:'smug',waiting_for_approval:'surprised',speaking:'neutral',success:'happy',error:'nervous'};
  const add=(id,renderer,files)=>{const dir=path.join(userRoot,id);fs.mkdirSync(dir,{recursive:true});const skin=files(dir);
    fs.writeFileSync(path.join(dir,'mod.json'),JSON.stringify({schemaVersion:2,id,name:id,identity:'A test character.',license:'Test fixture made in code.',renderer,defaultSkin:'default',defaultPersona:personas[0].id,personas,skins:[{id:'default',name:'Default',states,...skin}]}));};
  // MMD and Live2D go through the installer the assisted download uses
  add('me-mmd-fixture','mmd',dir=>{const from=path.join(src,'mmd'),{entry}=make.mmdFolder(from);const r=formats.install({srcDir:from,entry,renderer:'mmd',destDir:dir});return {model:r.model,motions:r.motions};});
  add('me-live2d-fixture','live2d',dir=>{const from=path.join(src,'live2d'),{entry}=make.live2dFolder(from);const r=formats.install({srcDir:from,entry,renderer:'live2d',destDir:dir});return {model:r.model,motions:r.motions};});
  add('me-vrm-motion','vrm',dir=>{fs.copyFileSync(path.join(__dirname,'..','mods','vrm-sample','sample.vrm'),path.join(dir,'model.vrm'));fs.mkdirSync(path.join(dir,'motions'));fs.writeFileSync(path.join(dir,'motions','sway.vrma'),make.vrma());
    return {model:'model.vrm',motions:[{file:'motions/sway.vrma',name:'sway',use:'idle',loop:true}]};});
  for(const mod of mods.loadCatalog(userRoot,{personal:true})){mod.private=true;mod.root=userRoot;catalog.push(mod);}
  // pixels of the character canvas; a share of covered pixels, and how much changes between two moments
  const grab=`(()=>{const c=document.querySelector('#bula canvas');const g=document.createElement('canvas');g.width=c.width;g.height=c.height;const x=g.getContext('2d');x.drawImage(c,0,0);return x.getImageData(0,0,g.width,g.height).data;})()`;
  const cover=()=>js(`(()=>{const d=${grab};let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n/(d.length/4);})()`);
  const changed=async(ms=350)=>{await js(`window.__frame=${grab};true`);await sleep(ms);return js(`(()=>{const a=window.__frame,b=${grab};let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+3]-b[i+3])>24)n++;return n/(a.length/4);})()`);};
  const motion=()=>js(`Avatars.motion(document.querySelector('#bula'))`);
  const result={};
  async function check(id,renderer,{idle,reaction}){
    runtime.select({modId:id});await wait(()=>js(`document.querySelector('#bula')?.dataset.renderer===${JSON.stringify(renderer)}&&Boolean(document.querySelector('#bula canvas'))`),`${id} canvas`);
    await js(`Avatars.ready(document.querySelector('#bula'))`);await wait(async()=>await motion()===idle,`${id} idle motion ${idle} (now ${await motion()})`);await sleep(600);
    assert.equal(await js(`document.querySelector('#bula').dataset.error||''`),'',`${id}: no load error`);
    const covered=await cover();assert.ok(covered>.02,`${id} drew (${covered.toFixed(3)} of the canvas)`);
    const moving=await changed();assert.ok(moving>.002,`${id}: the idle motion moves the canvas (${moving.toFixed(4)} changed)`);
    fs.writeFileSync(path.join(__dirname,'..','evidence',`mod-${renderer}.png`),(await win.webContents.capturePage()).toPNG());
    // the shared interaction API, then a poke plays a reaction motion
    await js(`(()=>{const el=document.querySelector('#bula');Avatars.blink(el);Avatars.look(el,.5,-.3);return true;})()`);runtime.speaking(true);await sleep(300);runtime.speaking(false);
    if(reaction){await js(`Avatars.react(document.querySelector('#bula'),'surprised',600);true`);await wait(async()=>await motion()===reaction,`${id} reaction ${reaction} (now ${await motion()})`,5000);
      await wait(async()=>await motion()===idle,`${id} back to ${idle}`,8000);}
    // the preview picture made in a hidden window (person-service) is not blank
    const mod=catalog.find(m=>m.id===id),bitmap=nativeImage.createFromBuffer(await personService.render(mod)).toBitmap();let ink=0;for(let i=0;i<bitmap.length;i+=4)if(bitmap[i]<235||bitmap[i+1]<235||bitmap[i+2]<235)ink++;
    assert.ok(ink/(bitmap.length/4)>.02,`${id} preview is not blank (${(ink/(bitmap.length/4)).toFixed(3)})`);
    result[id]={covered:+covered.toFixed(3),moving:+moving.toFixed(4),idle,reaction:reaction||null};
  }
  fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});
  await check('me-mmd-fixture','mmd',{idle:'待機',reaction:'wave'});
  // Live2D: nothing is downloaded until the user agrees in the window
  const corePath=path.join(app.getPath('userData'),'live2d','live2dcubismcore.min.js');assert.ok(!fs.existsSync(corePath),'no Cubism Core before consent');
  runtime.select({modId:'me-live2d-fixture'});await wait(()=>js(`Boolean(document.querySelector('#bula .live2d-consent button'))`),'Live2D consent');
  assert.equal(await js(`document.querySelector('#bula').dataset.needs`),'live2d-core');assert.match(await js(`document.querySelector('#bula .live2d-consent').textContent`),/Live2D.*授權/);
  assert.ok(!fs.existsSync(corePath)&&!await js('Boolean(window.Live2DCubismCore)'),'still nothing downloaded while asking');
  await js(`document.querySelector('#bula .live2d-consent button').click();true`);await wait(()=>js(`Boolean(document.querySelector('#bula canvas'))`),'Live2D after consent');
  assert.ok(fs.existsSync(corePath)&&await js('window.Live2DCubismCore.standIn===true'),'Cubism Core saved in userData and loaded');
  await check('me-live2d-fixture','live2d',{idle:'Idle',reaction:'TapBody'});
  await check('me-vrm-motion','vrm',{idle:'sway'});
  runtime.select({modId:'annie'});fs.rmSync(src,{recursive:true,force:true});
  console.log('MODELS_SMOKE',JSON.stringify(result));
}
module.exports={run};
