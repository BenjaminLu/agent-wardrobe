const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {BrowserWindow}=require('electron');
// 聲音工作室 end to end, offline: open it from the companion, consent step (and that nothing works without it), record
// ~10 s from Chromium's fake microphone (a generated "speech" WAV instead of a real mic), quick-clone with a stand-in
// CosyVoice sidecar, preview, save + bind to the worn character, speak through the voice registry; then the same from
// the phone page (MediaRecorder → /api/voices/record). Checks that raw recordings are gone and the voice cannot be exported.
async function run({win,openVoiceLab,getVoiceLab,voices,startRemote,getSettings,runtime}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=30000,label='')=>{if(label)console.log(`voicelab smoke: ${label}`);const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error(`Voice lab smoke timed out: ${label}`);await new Promise(r=>setTimeout(r,120));}};
  const tempDirs=()=>fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('agent-wardrobe-voicelab-'));
  const modId=runtime.state.modId;
  // opened the way the settings button does it
  await wait(()=>js(`document.body.dataset.ready==="true"`),20000,'companion');
  assert.equal(await js(`typeof window.bula.openVoiceLab`),'function');
  await js(`window.bula.openVoiceLab()`);
  await wait(()=>getVoiceLab()?.getWindow(),10000,'window');const lab=getVoiceLab().getWindow(),l=code=>lab.webContents.executeJavaScript(code);
  await wait(()=>l(`document.body.dataset.ready==="true"&&document.body.dataset.step==="method"`),15000,'studio ready');
  assert.equal(await l(`document.querySelectorAll('.method').length`),5,'five ways to make a voice');
  // quick clone → consent first; recording and uploads are refused until it is given
  await l(`document.querySelector('[data-method=quick]').click();true`);await wait(()=>l(`document.body.dataset.step==="consent"`),5000,'consent step');
  assert.equal(await l(`document.querySelector('#step-consent h2').textContent`),'這是誰的聲音？對方同意嗎？');
  assert.equal(await l(`document.querySelector('#consent-next').disabled`),true);
  await l(`document.querySelector('#consent-person').value='測試聲音';document.querySelector('#consent-person').dispatchEvent(new Event('input'));true`);
  assert.equal(await l(`document.querySelector('#consent-next').disabled`),true,'a name alone is not consent');
  const refused=await l(`Promise.all([window.voiceLab.micAccess().then(()=>'ok',e=>e.message),window.voiceLab.addTake({bytes:new ArrayBuffer(100),kind:'mic'}).then(()=>'ok',e=>e.message),window.voiceLab.create({}).then(()=>'ok',e=>e.message),window.voiceLab.consent({person:'測試聲音',agreed:false}).then(()=>'ok',e=>e.message)])`);
  assert.ok(refused.every(m=>/同意/.test(m)),`refused without consent: ${refused.join(' | ')}`);
  assert.equal(await l(`document.querySelector('#mic-on').hidden`),true,'no recording on its own');
  await l(`document.querySelector('#consent-agreed').click();true`);assert.equal(await l(`document.querySelector('#consent-next').disabled`),false);
  await l(`document.querySelector('#consent-next').click();true`);await wait(()=>l(`document.body.dataset.step==="record"`),5000,'record step');
  assert.match(await l(`document.querySelector('#engine-status').textContent`),/已就緒/);
  assert.ok((await l(`document.querySelector('#prompt-text').textContent`)).length>20,'a reading prompt is shown');
  // record ~11 s from the fake microphone
  await l(`document.querySelector('#record').click();true`);
  await wait(()=>l(`!document.querySelector('#mic-on').hidden`),10000,'mic indicator on');
  let peak=0;const until=Date.now()+11000;while(Date.now()<until){peak=Math.max(peak,parseFloat(await l(`document.querySelector('#level').style.width`))||0);await new Promise(r=>setTimeout(r,200));}
  assert.ok(peak>10,`level meter moved (${peak}%)`);
  await l(`document.querySelector('#record').click();true`);
  await wait(()=>l(`document.querySelectorAll('#takes li').length===1`),10000,'take listed');
  assert.equal(await l(`document.querySelector('#mic-on').hidden`),true,'mic indicator off after stop');
  const take=await l(`document.querySelector('#takes li .q').textContent`);assert.match(take,/音質沒問題|!/);assert.doesNotMatch(take,/✗/,`take passes: ${take}`);
  // the record step in English: title, engine line, take notes and buttons are redrawn; then back to zh-Hant
  await js(`window.bula.uiLanguage('en')`);await wait(()=>l(`document.querySelector('#record-title').textContent.startsWith('⚡ Quick clone')`),5000,'record step in en');
  assert.match(await l(`document.querySelector('#engine-status').textContent+document.querySelector('#takes li').textContent+document.querySelector('#create').textContent`),/Ready ✓[\s\S]*(Sound quality is fine|!)[\s\S]*Make the voice/);
  if(process.env.VOICELAB_SHOTS)fs.writeFileSync(path.join(process.env.VOICELAB_SHOTS,'voicelab-record-en.png'),(await lab.webContents.capturePage()).toPNG());
  await js(`window.bula.uiLanguage('zh-Hant')`);await wait(()=>l(`document.querySelector('#record-title').textContent.startsWith('⚡ 快速複製')`),5000,'record step back in zh-Hant');
  const draftDir=getVoiceLab().draft.temp.dir;if(process.platform!=='win32')assert.equal(fs.statSync(draftDir).mode&0o777,0o700,'raw audio folder is private');  // Windows: the folder is in the user's own profile; there are no POSIX modes
  assert.ok(fs.readdirSync(draftDir).some(n=>n.startsWith('take-')),'the take waits in the private temp folder');
  await l(`document.querySelector('#create').click();true`);await wait(()=>l(`document.body.dataset.step==="finish"`),20000,'voice made');
  assert.match(await l(`document.querySelector('#kept').textContent`),/原始錄音會在儲存.*刪除/);
  await l(`document.querySelector('#preview').click();true`);await wait(()=>l(`!document.querySelector('#preview-audio').hidden&&document.querySelector('#preview-audio').src.startsWith('blob:')`),20000,'preview');
  await l(`document.querySelector('#voice-name').value='測試的聲音';document.querySelector('#save').click();true`);
  await wait(()=>l(`Boolean(document.body.dataset.saved)`),10000,'saved');
  const id=await l(`document.body.dataset.saved`),profile=voices.get(id);
  assert.match(await l(`document.querySelector('#saved').textContent`),/原始錄音已刪除/);
  assert.deepEqual([profile.engine,profile.license.tier,profile.consent.person,profile.files.join()],['cosyvoice','personal','測試聲音','reference.wav,reference.txt']);
  assert.deepEqual(fs.readdirSync(path.join(voices.root,id)).sort(),['reference.txt','reference.wav','voice.json'],'only the reference clip is kept');
  assert.equal(fs.existsSync(draftDir),false,'raw takes deleted');assert.deepEqual(tempDirs(),[],'no temp folder left');
  assert.equal(getSettings().characterVoices?.[modId],id,'bound to the worn character');
  const spoken=await voices.speak(id,'嗨，這是我的新聲音。');assert.equal(spoken.mime,'audio/wav');assert.ok(spoken.audio.length>1000);
  assert.throws(()=>voices.exportPack(id),/不能匯出/);
  // a new interface language redraws the open studio in place (what it wrote itself, too), then back to zh-Hant
  for(const [lang,heading,saved] of [['en','Your voice is ready!',/original recordings were deleted/],['ja','声ができました！',/元の録音は削除しました/],['zh-Hant','聲音做好了！',/原始錄音已刪除/]]){
    await js(`window.bula.uiLanguage(${JSON.stringify(lang)})`);
    await wait(()=>l(`document.querySelector('#step-finish h2').textContent===${JSON.stringify(heading)}`),5000,`studio in ${lang}`);
    assert.match(await l(`document.querySelector('#saved').textContent`),saved,`${lang}: the saved note is redrawn`);
    if(process.env.VOICELAB_SHOTS){await new Promise(r=>setTimeout(r,300));fs.writeFileSync(path.join(process.env.VOICELAB_SHOTS,`voicelab-${lang}.png`),(await lab.webContents.capturePage()).toPNG());}
  }
  lab.close();await wait(()=>!getVoiceLab().getWindow(),5000,'closed');

  // the phone: 設定 → 錄音做聲音 with the same consent step, recorded with MediaRecorder from the fake microphone
  await startRemote();const info=await js(`window.bula.remotePair()`);
  const phone=new BrowserWindow({width:390,height:820,show:true,webPreferences:{contextIsolation:true,sandbox:true,partition:'voicelab-phone'}});
  try{
    await phone.loadURL(info.link);const p=code=>phone.webContents.executeJavaScript(code);
    await wait(()=>p(`!document.querySelector('#app').hidden`),20000,'phone paired');
    await p(`document.querySelector('#tabs [data-tab=settings]').click();true`);await wait(()=>p(`document.querySelectorAll('#v-list .voice').length>=1`),10000,'phone voices');
    await p(`document.querySelector('#rec-open').click();true`);await wait(()=>p(`!document.querySelector('#rec').hidden&&document.querySelector('#rec-prompt').textContent.length>10`),10000,'phone recorder');
    assert.equal(await p(`document.querySelector('#rec-next').disabled`),true,'phone: no consent, no next');
    // the Mac refuses a recording without consent even if the page were bypassed
    const bypass=await p(`fetch('/api/voices/record',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('bula-remote-token')},body:JSON.stringify({audio:'UklGRg==',engine:'cosyvoice',consent:{person:'x',agreed:false}})}).then(r=>r.json())`);
    assert.match(bypass.error||'',/同意/,'route refuses without consent');
    await p(`document.querySelector('#rec-person').value='我自己';document.querySelector('#rec-person').dispatchEvent(new Event('input'));document.querySelector('#rec-agreed').click();document.querySelector('#rec-next').click();true`);
    await p(`document.querySelector('#rec-btn').click();true`);await wait(()=>p(`!document.querySelector('#rec-on').hidden`),10000,'phone recording');
    await new Promise(r=>setTimeout(r,11000));
    await p(`document.querySelector('#rec-btn').click();true`);await wait(()=>p(`!document.querySelector('#rec-send').disabled`),15000,'phone take ready');
    assert.equal(await p(`document.querySelector('#rec-on').hidden`),true,'phone mic indicator off');
    await p(`document.querySelector('#rec-send').click();true`);await wait(()=>p(`Boolean(document.body.dataset.recSaved)`),30000,'phone voice saved');
    const phoneId=await p(`document.body.dataset.recSaved`),phoneProfile=voices.get(phoneId);
    assert.deepEqual([phoneProfile.engine,phoneProfile.license.tier,phoneProfile.consent.person],['cosyvoice','personal','我自己']);
    assert.equal(getSettings().characterVoices?.[modId],phoneId,'the phone voice is bound');assert.deepEqual(tempDirs(),[]);
    await wait(()=>p(`document.querySelector('#v-list .voice[data-id="${phoneId}"]')!==null`),10000,'listed on the phone');
    console.log('VOICELAB_SMOKE',JSON.stringify({consentRequired:true,levelPeak:Math.round(peak),saved:id,bound:modId,phone:phoneId,rawDeleted:true,exportRefused:true}));
  }finally{phone.destroy();}
}
module.exports={run};
