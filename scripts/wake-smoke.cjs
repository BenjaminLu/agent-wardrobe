const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const {app}=require('electron');
// Hands-free input end to end: Chromium plays a WAV as the microphone ("嘿安妮… 今天台北的天氣怎麼樣？").
async function run({win}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=40000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Wake smoke timed out');await new Promise(r=>setTimeout(r,100));}};
  const asr=path.join(app.getPath('userData'),'models','sensevoice-int8-2025-09-09');
  if(!fs.existsSync(path.join(asr,'.complete'))){fs.cpSync(process.env.ASR_MODEL_SRC,asr,{recursive:true});fs.writeFileSync(path.join(asr,'.complete'),'smoke');}
  const requests=[];const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/models')){res.end('{"data":[{"id":"fixture"}]}');return;}requests.push(JSON.parse(body));res.end(JSON.stringify({choices:[{message:{content:'{"text":"台北今天多雲。","emotion":"happy","action":"none"}'}}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    win.webContents.on('console-message',e=>{if(/error|Error/.test(e.message))console.log('PAGE',e.message.slice(0,200));});
    win.show();await wait(()=>js('document.body.dataset.ready==="true"'));
    await js(`document.querySelector('#settings-toggle').click();document.querySelector('#wake-enabled').checked=true;document.querySelector('#wake-phrases').value='嘿安妮';saveWake().then(()=>true)`);
    await js(`window.bula.saveSettings({provider:'local',base:'http://127.0.0.1:${server.address().port}/v1',model:'fixture',voiceProvider:'off'}).then(s=>{settings=s;document.querySelector('#settings-toggle').click();return true;})`);
    await wait(()=>js(`!document.querySelector('#mic-indicator').hidden`),10000);
    await js(`document.querySelector('#panel').hidden=true;document.body.classList.add('quiet');true`);
    await wait(()=>js(`!document.querySelector('#panel').hidden`),20000);
    const heard=requests.length;await wait(()=>requests.length>heard||requests.length>0);
    const said=requests.at(-1).messages.at(-1).content;
    assert.match(said,/台北/,`dictation reached the chat (${said})`);if(require('electron').app.getPreferredSystemLanguages().some(l=>/Hant|-(TW|HK|MO)$/i.test(l)))assert.ok(!/天气|怎么/.test(said),'converted to Traditional Chinese');
    await wait(()=>js(`document.querySelector('#conversation').innerText.includes('台北今天多雲')`));
    console.log('WAKE_SMOKE',JSON.stringify({wake:'嘿安妮',dictated:said,openedChat:true,sent:true}));
  }finally{server.closeAllConnections();server.close();await js(`window.bula.wakeSettings({wakeEnabled:false})`).catch(()=>{});}
}
module.exports={run};
