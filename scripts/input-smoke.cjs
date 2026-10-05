const assert=require('node:assert/strict');const http=require('node:http');const {clipboard,Menu}=require('electron');
async function run({win}){
  const wait=async(fn)=>{const until=Date.now()+10000;while(!await fn()){if(Date.now()>until)throw new Error('Input smoke timed out');await new Promise(resolve=>setTimeout(resolve,50));}};
  const old={text:clipboard.readText(),html:clipboard.readHTML(),rtf:clipboard.readRTF(),image:clipboard.readImage()};const requests=[];
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'{"text":"已收到語音貼入的冰箱需求。","emotion":"happy"}'}}]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    win.show();win.focus();win.webContents.focus();
    const selected=await win.webContents.executeJavaScript(`(()=>{document.activeElement.blur();const area=document.querySelector('#conversation');area.tabIndex=-1;area.focus();const text=document.querySelector('#conversation .message.assistant').firstChild;const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(8,text.length));window.getSelection().removeAllRanges();window.getSelection().addRange(range);return window.getSelection().toString();})()`);assert.ok(selected);win.webContents.copy();await wait(()=>clipboard.readText()===selected);
    // macOS needs the Edit menu for ⌘C / ⌘V; Windows and Linux have no app menu (Chromium handles Ctrl+C / Ctrl+V itself)
    if(process.platform==='darwin')assert.ok(Menu.getApplicationMenu().items.some(item=>item.submenu?.items.some(sub=>sub.role==='paste')),'native Edit menu supplies copy/paste shortcuts');
    await win.webContents.executeJavaScript(`window.getSelection().removeAllRanges();window.bula.saveSettings({provider:'local',base:'http://127.0.0.1:${server.address().port}/v1',model:'voice-fixture',volume:false})`);
    await win.webContents.executeJavaScript(`document.querySelector('#voice-input').click();document.querySelector('#task-mode').value='chat';document.querySelector('#prompt').value='';document.querySelector('#prompt').dispatchEvent(new CompositionEvent('compositionstart'));document.querySelector('#prompt').value='尚未完成的注音';document.querySelector('#chat-form').requestSubmit();`);
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(requests.length,0,'composition must not submit partial speech/IME text');
    await win.webContents.executeJavaScript(`document.querySelector('#prompt').dispatchEvent(new CompositionEvent('compositionend'));document.querySelector('#prompt').value='';document.querySelector('#prompt').focus();`);
    const dictated='冰箱請找白色款式，\n寬度不要超過70公分。';clipboard.writeText(dictated);win.webContents.paste();
    await wait(()=>requests.length===1);assert.equal(requests[0].messages.at(-1).content,dictated,'native pasted dictation sends multiline speech into normal chat');
    await wait(()=>win.webContents.executeJavaScript(`!document.querySelector('#send').disabled&&document.querySelector('#conversation').innerText.includes('已收到語音貼入的冰箱需求')`));
    await win.webContents.executeJavaScript(`document.querySelector('#voice-input').click();document.querySelector('#prompt').value='';document.querySelector('#prompt').focus();`);
    clipboard.writeText('這段先不要送出');win.webContents.paste();await new Promise(resolve=>setTimeout(resolve,900));assert.equal(requests.length,1,'voice mode off leaves pasted text as draft');
    await win.webContents.executeJavaScript(`document.querySelector('#prompt').value='';`);
    console.log('NATIVE_INPUT_SMOKE',JSON.stringify({selectionCopy:true,editMenu:true,trustedNativePaste:true,voiceAutoSend:true,multiline:true,compositionGuard:true,voiceOffRetainsDraft:true,actualTypelessMicrophone:false}));
  }finally{clipboard.write(old);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
module.exports={run};
