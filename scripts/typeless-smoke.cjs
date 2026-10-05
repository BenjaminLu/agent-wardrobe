const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {execFile}=require('node:child_process');const {app}=require('electron');
// Wake word with Typeless as the recogniser, on this Mac's real Typeless: the fake microphone says "嘿安妮… 今天台北的天氣怎麼樣？",
// the app taps Fn (Typeless starts), hears the pause, taps Fn again. Typeless itself records the real microphone, so this checks the
// hand-off, not the transcript; a screenshot shows Typeless's recording overlay.
async function run({win}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=40000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Typeless smoke timed out');await new Promise(r=>setTimeout(r,100));}};
  win.show();await wait(()=>js('document.body.dataset.ready==="true"'));
  await js(`window.__typeless=[];window.bula.onTypeless(s=>window.__typeless.push(s.state));window.__wake=[];window.bula.onWake(w=>window.__wake.push(w));true`);
  await js(`document.querySelector('#settings-toggle').click();document.querySelector('#wake-enabled').checked=true;document.querySelector('#wake-phrases').value='嘿安妮';document.querySelector('#dictation-engine').value='typeless';saveWake().then(()=>{document.querySelector('#wake-phrases').focus();return true;})`);  // settings left open with the wake-word field focused, as a user might
  try{
    await wait(()=>js(`window.__wake.length>0`));
    assert.equal(await js(`window.__wake[0].typeless`),true,'wake hands off to Typeless');
    await new Promise(r=>setTimeout(r,900));
    const shot=path.join(__dirname,'..','evidence','typeless-overlay.png');fs.mkdirSync(path.dirname(shot),{recursive:true});await new Promise(r=>execFile('/usr/sbin/screencapture',['-x',shot],()=>r()));
    assert.equal(await js(`document.activeElement===document.querySelector('#prompt')`),true,'the chat box has focus for the paste');
    assert.equal(await js(`document.querySelector('#settings').hidden`),true,'settings close so Typeless cannot paste into them');
    assert.equal(await js(`window.bula.wakeStatus().then(s=>s.custom)`),'嘿安妮','the wake word is unchanged');
    await assert.rejects(js(`window.bula.wakeSettings({wakePhrases:'嘿安妮明天台北下雨機率多少？'})`),/不像喚醒詞/);
    await wait(()=>js(`window.__typeless.length>0`));
    const states=await js(`window.__typeless`);assert.deepEqual(states,['processing'],`hand-off finished: ${states}`);
    const diag=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'wake-diagnostics.json'),'utf8'));
    console.log('TYPELESS_SMOKE',JSON.stringify({wake:true,typelessStarted:true,endOfSpeech:diag.lastDictation||'pending',states}));
  }finally{await js(`window.bula.wakeSettings({wakeEnabled:false})`).catch(()=>{});}
}
module.exports={run};
