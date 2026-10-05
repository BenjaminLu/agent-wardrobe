const assert=require('node:assert/strict');const http=require('node:http');
async function run({win,read}){
  const wait=async(fn)=>{const until=Date.now()+10000;while(!await fn()){if(Date.now()>until)throw new Error('Memory smoke timed out');await new Promise(resolve=>setTimeout(resolve,50));}};
  await wait(()=>win.webContents.executeJavaScript('document.body.dataset.ready==="true"'));
  if(!read)await win.webContents.executeJavaScript('window.bula.clearHistory()');
  if(read){
    assert.ok(await win.webContents.executeJavaScript(`document.querySelector('#conversation').innerText.includes('冰箱寬68.5公分、深65公分')`),'prior conversation is restored in a fresh Electron process');
    const stored=await win.webContents.executeJavaScript('window.bula.history()');assert.ok(stored.some(m=>m.role==='user'&&m.content.includes('70公分')));
  }
  let received=false;const fixture=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
    if(read){assert.ok(body.messages.some(m=>m.role==='assistant'&&m.content.includes('冰箱寬68.5公分、深65公分')),'restored context is actually sent to the model');assert.ok(body.messages.some(m=>m.role==='user'&&m.content.includes('70公分')));}
    received=true;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({text:read?'記得，你要寬度70公分以下的冰箱；候選寬68.5公分、深65公分。':'冰箱寬68.5公分、深65公分，符合70公分以下的需求。',emotion:'happy'})}}]}));
  });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  try{
    await win.webContents.executeJavaScript(`window.bula.saveSettings({provider:'local',base:'http://127.0.0.1:${fixture.address().port}/v1',model:'memory-fixture',volume:false})`);
    const text=read?'你記得上次找的冰箱尺寸嗎？':'幫我找冰箱，寬度70公分以下。';
    await win.webContents.executeJavaScript(`document.querySelector('#task-mode').value='chat';document.querySelector('#prompt').value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit()`);
    await wait(async()=>received&&await win.webContents.executeJavaScript(`document.querySelector('#conversation').innerText.includes(${JSON.stringify(read?'記得，你要':'符合70公分以下')})`));
    if(read){await require('./input-smoke.cjs').run({win});for(const provider of ['claude','codex']){await win.webContents.executeJavaScript(`window.bula.saveSettings({provider:'${provider}',base:'http://127.0.0.1:1234/v1',model:'',volume:false})`);assert.ok(await win.webContents.executeJavaScript(`document.querySelector('#conversation').innerText.includes('冰箱寬68.5公分、深65公分')`),'provider switching retains shared history');}
      await win.webContents.executeJavaScript(`document.querySelector('#reset').click()`);await wait(async()=>!(await win.webContents.executeJavaScript('window.bula.history()')).length);
    }
    console.log('MEMORY_RESTART_SMOKE',JSON.stringify({phase:read?'fresh-process-read':'write',nativeUI:true,persisted:true,modelReceivesRestoredContext:read,providerSwitch:read,clear:read,model:'HTTP fixture'}));
  }finally{await new Promise(resolve=>fixture.close(resolve));}
}
module.exports={run};
