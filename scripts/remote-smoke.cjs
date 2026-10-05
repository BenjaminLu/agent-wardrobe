const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const {BrowserWindow}=require('electron');
// Phone remote end to end on loopback (Tailscale only adds HTTPS in front): pair from the QR link in a phone-sized window,
// chat (stand-in local model), see the reply on both screens, and follow a skin change live.
async function run({win,startRemote}){
  const model=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url.endsWith('/models'))return res.end('{"data":[{"id":"fixture"}]}');
    let body='';for await(const c of req)body+=c;const data=JSON.parse(body);
    if(data.tools){const done=data.messages.some(m=>m.role==='tool');
      res.end(JSON.stringify({choices:[{message:done?{role:'assistant',content:'已整理成「本週待辦.md」與表格，存到桌面。'}:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'report_save',arguments:JSON.stringify({filename:'本週待辦.md',content:'# 本週待辦\n- 週三交報告，參考 https://example.com/report?id=1。\n- 週五繳電費：[台電繳費](https://www.taipower.com.tw/pay)\n- 不要連 javascript:alert(1)\n'})}}]}}]}));return;}
    const said=data.messages.at(-1).content;res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({text:`收到：${said}`,emotion:'happy',action:'none'})}}]}));});
  await new Promise(r=>model.listen(0,'127.0.0.1',r));
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=20000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Remote smoke timed out');await new Promise(r=>setTimeout(r,150));}};
  let phone;
  try{
    win.show();await js(`window.bula.saveSettings({provider:'local',localEngine:'lmstudio',base:'http://127.0.0.1:${model.address().port}/v1',model:'fixture',volume:false})`);
    await js(`window.__remote=[];window.bula.onRemoteChat(e=>window.__remote.push(e));true`);
    await startRemote();  // loopback only; tests run without Tailscale
    const info=await js(`(async()=>{return await window.bula.remotePair().catch(e=>({error:e.message}))})()`);
    assert.ok(info.link,`pairing link: ${JSON.stringify(info)}`);assert.match(info.code,/^\d{6}$/);assert.match(info.qr,/^<svg/);
    phone=new BrowserWindow({width:390,height:760,show:true,title:'Phone',webPreferences:{contextIsolation:true,sandbox:true,partition:'remote-smoke-phone'}});
    await phone.loadURL(info.link);
    const p=code=>phone.webContents.executeJavaScript(code);
    await wait(()=>p(`!document.querySelector('#app').hidden&&document.querySelector('#link').classList.contains('on')`));
    assert.equal(await p(`location.search`),'','the code is removed from the address after pairing');
    await p(`document.querySelector('#text').value='明天幾點出門？';document.querySelector('#chat').requestSubmit();true`);
    await wait(()=>p(`[...document.querySelectorAll('.msg')].some(m=>m.textContent==='收到：明天幾點出門？')`));
    await new Promise(r=>setTimeout(r,800));assert.equal(await p(`[...document.querySelectorAll('.msg')].filter(m=>m.textContent==='收到：明天幾點出門？').length`),1,'each line shows once on the phone');
    await wait(()=>js(`window.__remote.length>0`));const shown=await js(`window.__remote[0]`);assert.equal(shown.reply,'收到：明天幾點出門？');
    const skins=await js(`window.bula.state().then(s=>s.mod.skins.map(k=>k.id))`);
    await js(`window.bula.select({skinId:${JSON.stringify(skins.at(-1))}})`).catch(()=>{});
    fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','remote-phone.png'),(await phone.webContents.capturePage()).toPNG());
    // settings from the phone: reply language changes on the Mac too
    await p(`document.querySelector('#tabs [data-tab=settings]').click();const r=document.querySelector('#s-reply');r.value='ja';r.dispatchEvent(new Event('change'));true`);
    await wait(()=>js(`window.bula.settings().then(s=>s.replyLanguage==='ja')`));
    // a task is refused until the Mac allows it
    assert.equal(await p(`document.querySelector('#mode [value=files]').disabled`),true,'task modes are off until allowed on the Mac');
    await js(`window.bula.remoteTasks(true)`);await wait(()=>p(`!document.querySelector('#mode [value=files]').disabled`));
    await p(`document.querySelector('#tabs [data-tab=chat]').click();document.querySelector('#mode').value='files';document.querySelector('#text').value='把本週待辦整理成報告';document.querySelector('#chat').requestSubmit();true`);
    await wait(()=>p(`[...document.querySelectorAll('.msg.task')].some(m=>m.textContent.includes('完成')&&m.textContent.includes('本週待辦'))`),30000);
    // the saved report is readable in the files tab
    await p(`document.querySelector('#tabs [data-tab=files]').click();true`);
    await wait(()=>p(`[...document.querySelectorAll('.file-group button')].some(b=>b.textContent.includes('本週待辦.md'))`));
    await p(`[...document.querySelectorAll('.file-group button')].find(b=>b.textContent.includes('本週待辦.md')).click();true`);
    await wait(()=>p(`document.querySelector('#viewer-body').textContent.includes('週五繳電費')`));
    assert.equal(await p(`document.querySelector('#tab-chat').getBoundingClientRect().height`),0,'only the open tab is shown');
    const links=await p(`[...document.querySelectorAll('#viewer-body a')].map(a=>({href:a.href,text:a.textContent,target:a.target,rel:a.rel}))`);
    assert.deepEqual(links.map(l=>[l.href,l.text]),[['https://example.com/report?id=1','https://example.com/report?id=1'],['https://www.taipower.com.tw/pay','台電繳費']],JSON.stringify(links));
    assert.ok(links.every(l=>l.target==='_blank'&&l.rel.includes('noopener')),'links open in a new tab');
    assert.equal(await p(`document.querySelector('#task-bar').hidden`),true,'the task bar clears after the result');
    fs.writeFileSync(path.join(__dirname,'..','evidence','remote-phone-file.png'),(await phone.webContents.capturePage()).toPNG());
    const devices=await js(`window.bula.remoteStatus().then(s=>s.devices)`);assert.equal(devices.length,1);
    await js(`window.bula.remoteRevoke(${JSON.stringify(devices[0].id)})`);
    await phone.reload();await wait(()=>p(`!document.querySelector('#pair').hidden`));
    console.log('REMOTE_SMOKE',JSON.stringify({paired:true,chat:true,desktopSawPhoneChat:true,settingsFromPhone:true,taskNeedsMacPermission:true,taskResult:true,readSavedFile:true,revokeSendsBackToPairing:true}));
  }finally{phone?.destroy();model.closeAllConnections();model.close();}
}
module.exports={run};
