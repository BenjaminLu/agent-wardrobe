const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {app}=require('electron');
// First run: the guide appears instead of the chat, walks four steps, saves the choices and never returns.
async function run({win}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=15000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Onboarding smoke timed out');await new Promise(r=>setTimeout(r,100));}};
  win.show();await wait(()=>js(`!document.querySelector('#onboarding').hidden`));
  assert.equal(await js(`getComputedStyle(document.querySelector('#panel')).display`),'none','chat panel waits behind the guide');
  assert.equal(await js(`document.querySelectorAll('#ob-brains input').length`),4);
  assert.equal(await js(`document.querySelectorAll('#ob-llm-models input').length`),4,'local model choices are listed');
  // each subscription brain shows its sign-in state, or a button that opens the official installer and sign-in
  for(const name of ['codex','claude'])assert.equal(await js(`(()=>{const label=document.querySelector('#ob-brains input[value=${name}]').closest('label');return /✓/.test(label.textContent)||Boolean(label.querySelector('button'))})()`),true,name);
  const click=async selector=>{const p=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await new Promise(r=>setTimeout(r,150));};
  await click('#ob-brains input[value=builtin]');assert.equal(await js(`document.querySelector('#ob-llm').hidden`),false,'picking the built-in brain shows the model list');
  fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','onboarding-brain.png'),(await win.webContents.capturePage()).toPNG());
  assert.equal(await js(`(()=>{const r=document.querySelector('#ob-next').getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0})()`),true,'next button stays on screen with the model list open');
  await click('#ob-brains input[value=claude]');assert.equal(await js(`document.querySelector('#ob-llm').hidden`),true);await click('#ob-next');
  await click('input[name=ob-voice][value=off]');await click('#ob-next');
  assert.match(await js(`document.querySelector('#ob-wake-word').textContent`),/嘿|Hey/);
  await js(`document.querySelector('#ob-wake').checked=false;document.querySelector('#ob-asr').checked=false;true`);await click('#ob-next');
  assert.equal(await js(`document.querySelector('#ob-next').textContent`),await js(`t('onboarding.getStarted')`));
  // in English no Chinese is left in the guide (the wake word is the user's own)
  if(await js(`i18n.lang==='en'`))for(let step=0;step<4;step++){const han=await js(`(()=>{const page=document.querySelector('.ob-page[data-step="${step}"]').cloneNode(true);page.querySelector('#ob-wake-word')?.remove();return [...(page.textContent+document.querySelector('.ob-nav').textContent).matchAll(/[\u4e00-\u9fff]+/g)].map(m=>m[0])})()`);assert.deepEqual(han,[],`step ${step} is fully translated`);}assert.equal(await js(`document.querySelector('#ob-skip').hidden`),true);
  await click('#ob-back');await click('#ob-next');await click('#ob-next');
  await wait(()=>js(`document.querySelector('#onboarding').hidden && getComputedStyle(document.querySelector('#panel')).display!=='none'`));
  const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'bula-settings.json'),'utf8'));
  assert.equal(saved.onboarded,true);assert.equal(saved.provider,'claude');assert.equal(saved.voiceProvider,'off');assert.equal(saved.wakeEnabled,false);
  // reopening from settings works and skipping keeps the saved choices
  await js(`document.querySelector('#settings-toggle').click();document.querySelector('#show-onboarding').click();true`);await wait(()=>js(`!document.querySelector('#onboarding').hidden`));
  await click('#ob-skip');await wait(()=>js(`document.querySelector('#onboarding').hidden`));
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'bula-settings.json'),'utf8')).provider,'claude','skip keeps choices');
  fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});
  console.log('ONBOARDING_SMOKE',JSON.stringify({shownOnFirstRun:true,steps:4,saved:{provider:saved.provider,voice:saved.voiceProvider,wake:saved.wakeEnabled},reopen:true,skip:true}));
}
module.exports={run};
