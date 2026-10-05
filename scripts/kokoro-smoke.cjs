const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {app}=require('electron');
// Local Kokoro voice with the real model: settings UI, real synthesis, sentence-by-sentence playback and lip-sync.
async function run({win,runtime}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=60000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Kokoro smoke timed out');await new Promise(r=>setTimeout(r,100));}};
  const dir=path.join(app.getPath('userData'),'models','kokoro-multi-lang-v1_0');
  win.show();await wait(()=>js('document.body.dataset.ready==="true"'));
  await js(`document.querySelector('#settings-toggle').click();document.querySelector('#voice-provider').value='kokoro';document.querySelector('#voice-provider').dispatchEvent(new Event('change'));true`);
  await wait(()=>js(`!document.querySelector('#kokoro-voice').hidden`));
  if(!fs.existsSync(path.join(dir,'.complete'))){
    assert.equal(await js(`document.querySelector('#kokoro-install').hidden`),false,'offers the download when the model is missing');
    assert.equal(await js(`document.querySelector('#kokoro-preview').disabled`),true,'preview disabled until installed');
    // the model download itself is unit-tested; copy the already-verified model for the playback test
    fs.cpSync(process.env.KOKORO_MODEL_SRC,dir,{recursive:true});fs.writeFileSync(path.join(dir,'.complete'),'smoke');
    await js(`document.querySelector('#voice-provider').dispatchEvent(new Event('change'));true`);
  }
  await wait(()=>js(`document.querySelector('#kokoro-install').hidden&&!document.querySelector('#kokoro-preview').disabled`));
  assert.ok(await js(`document.querySelectorAll('#kokoro-voice-name option').length`)>=16);
  await js(`document.querySelector('#kokoro-voice-name').value='zm_yunxi';document.querySelector('#kokoro-speed').value='1.1';document.querySelector('#save').click();true`);
  await new Promise(r=>setTimeout(r,300));
  const timeline=[];runtime.on('change',s=>timeline.push([Date.now(),s.speaking]));
  const t0=Date.now();await js(`window.bula.speak('嗨，我是 Annie。今天想做什麼呢？我們一起完成吧！')`);
  await wait(()=>timeline.some(([,on])=>on));const firstSound=timeline.find(([,on])=>on)[0]-t0;
  await wait(()=>timeline.length&&timeline.at(-1)[1]===false);const total=timeline.at(-1)[0]-t0;
  assert.ok(total>firstSound+1500,'three sentences played after the first one started');
  // stopping mid-sentence ends speech promptly
  await js(`window.bula.speak('這是一段很長的句子，用來測試停止功能。第二句。第三句。')`);await wait(()=>runtime.state.speaking);
  await js(`window.bula.stop()`);await wait(()=>!runtime.state.speaking,3000);
  // Edge Taiwanese voice against the live service (needs network)
  await js(`document.querySelector('#voice-provider').value='edge';document.querySelector('#voice-provider').dispatchEvent(new Event('change'));true`);
  await wait(()=>js(`!document.querySelector('#edge-voice').hidden&&document.querySelectorAll('#edge-voice-name option').length>=3`));
  await js(`document.querySelector('#edge-voice-name').value='zh-TW-HsiaoChenNeural';document.querySelector('#save').click();true`);await new Promise(r=>setTimeout(r,300));
  const edgeTimeline=[];runtime.on('change',s=>edgeTimeline.push([Date.now(),s.speaking]));const e0=Date.now();
  await js(`window.bula.speak('嗨，我是 Annie！這是台灣腔的聲音。')`);
  await wait(()=>edgeTimeline.some(([,on])=>on),20000);const edgeFirst=edgeTimeline.find(([,on])=>on)[0]-e0;
  await wait(()=>edgeTimeline.at(-1)[1]===false,30000);
  assert.equal(await js(`[...document.querySelectorAll('#conversation .error')].some(n=>/Edge/.test(n.textContent))`),false,'no Edge error');
  console.log('EDGE_SMOKE',JSON.stringify({voice:'zh-TW-HsiaoChenNeural',firstSoundMs:edgeFirst}));
  console.log('KOKORO_SMOKE',JSON.stringify({model:'kokoro-multi-lang-v1_0',voice:'zm_yunxi',firstSoundMs:firstSound,totalMs:total,stop:true}));
  await js(`window.bula.saveSettings({provider:'codex',base:'http://127.0.0.1:1234/v1',model:'',voiceProvider:'system'})`).catch(()=>{});
}
module.exports={run};
