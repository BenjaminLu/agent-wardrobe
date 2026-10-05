const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
// AI voice end to end against a local stand-in for OpenAI: key guide, verify + encrypted save, playback with lip-sync, clear.
async function run({win,runtime}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=15000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Voice smoke timed out');await new Promise(r=>setTimeout(r,80));}};
  // half a second of tone as the stand-in's "mp3" (the in-app player sniffs the format, like Chromium does)
  const audio=require('../kokoro.cjs').wav(Float32Array.from({length:12000},(_,i)=>Math.sin(i/24000*2*Math.PI*440)*.2),24000);
  const key='sk-test-voice-smoke-0123456789abcdef',seen=[];
  const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;seen.push({url:req.url,auth:req.headers.authorization,body:body&&JSON.parse(body)});
    if(req.headers.authorization!==`Bearer ${key}`){res.writeHead(401);res.end('{"error":{"message":"bad"}}');return;}
    res.setHeader('Content-Type','audio/mpeg');res.end(audio);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.AGENT_WARDROBE_OPENAI_BASE=`http://127.0.0.1:${server.address().port}/v1`;
  try{
    win.show();await wait(()=>js('document.body.dataset.ready==="true"'));
    await js(`window.bula.clearOpenAIKey()`);
    await js(`document.querySelector('#settings-toggle').click();document.querySelector('#voice-provider').value='openai';document.querySelector('#voice-provider').dispatchEvent(new Event('change'));true`);
    await wait(()=>js(`!document.querySelector('#openai-voice').hidden&&!document.querySelector('#openai-key-guide').hidden`));
    assert.equal(await js(`document.querySelectorAll('#openai-voice-name option').length`),13,'all OpenAI voices offered');
    // wrong format is rejected locally; a key OpenAI refuses is not saved
    for(const bad of ['hello','sk-test-wrong-0123456789abcdefgh']){
      await js(`document.querySelector('#openai-key').value=${JSON.stringify(bad)};document.querySelector('#openai-key-save').click();true`);
      await wait(()=>js(`!document.querySelector('#openai-key-save').disabled`));await new Promise(r=>setTimeout(r,300));
      assert.equal((await js(`window.bula.voiceStatus()`)).hasOpenAIKey,false,`rejected ${bad}`);assert.equal(await js(`document.querySelector('#openai-key').value`),'','key field is cleared');
    }
    await js(`document.querySelector('#openai-key').value=${JSON.stringify(key)};document.querySelector('#openai-key-save').click();true`);
    await wait(()=>js(`window.bula.voiceStatus().then(s=>s.hasOpenAIKey)`));
    assert.match(await js(`document.querySelector('#openai-key-status').textContent`),/已儲存|saved/);
    const stored=fs.readFileSync(path.join(require('electron').app.getPath('userData'),'secrets.json'),'utf8');assert.ok(!stored.includes('sk-test'),'key stored encrypted');
    // choose a voice and save; a reply is spoken with it and the character talks
    await js(`document.querySelector('#openai-voice-name').value='cedar';document.querySelector('#openai-model').value='gpt-4o-mini-tts';document.querySelector('#openai-style').value='Cheerful.';document.querySelector('#save').click();true`);
    await new Promise(r=>setTimeout(r,300));const talking=[];runtime.on('change',s=>talking.push(s.speaking));
    await js(`window.bula.speak('嗨，這是語音測試。');true`);
    await wait(()=>talking.includes(true));await wait(()=>talking.at(-1)===false);
    const speech=seen.filter(r=>r.url==='/v1/audio/speech').at(-1);
    assert.ok(seen.some(r=>r.url==='/v1/audio/speech'&&r.body.model==='tts-1'&&r.body.input==='ok'),'key verified with a tiny speech request');
    assert.deepEqual({voice:speech.body.voice,model:speech.body.model,instructions:speech.body.instructions},{voice:'cedar',model:'gpt-4o-mini-tts',instructions:'Cheerful.'});
    assert.ok(seen.every(r=>!JSON.stringify(r.body||'').includes('sk-')),'key never sent in a request body');
    // removing the key stops AI speech with a clear message instead of falling back to macOS
    await js(`document.querySelector('#openai-key-clear').click();true`);await wait(()=>js(`window.bula.voiceStatus().then(s=>!s.hasOpenAIKey)`));
    const before=seen.length;await js(`window.bula.speak('嗨，這是語音測試。');true`);
    await wait(()=>js(`document.querySelector('#conversation').innerText.includes('尚未設定 OpenAI API key')`));assert.equal(seen.length,before,'no request without a key');
    console.log('VOICE_SMOKE',JSON.stringify({voices:13,badKeysRejected:true,keyVerifiedAndEncrypted:true,voiceUsed:'cedar',lipSync:true,clearStopsAIVoice:true}));
  }finally{server.closeAllConnections();server.close();await js(`window.bula.saveSettings({provider:'codex',base:'http://127.0.0.1:1234/v1',model:'',voiceProvider:'system'})`).catch(()=>{});}
}
module.exports={run};
