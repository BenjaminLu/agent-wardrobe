const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
async function run({win,runtime,agentSession,getAgentWindow,getToolTask,openAgentConsole,emergencyStop}){
  const wait=async(fn,timeout=10000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Task smoke timed out');await new Promise(resolve=>setTimeout(resolve,80));}};
  let modelCalls=0,hold=false;const requests=[];
  const fixture=http.createServer(async(req,res)=>{
    if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Task test</title><h1>Task test</h1><p id="count">Count: 0</p><button onclick="document.querySelector(\'#count\').textContent=\'Count: 1\'">Increase</button>');return;}
    if(req.url==='/models'){res.setHeader('Content-Type','application/json');res.end('{"data":[{"id":"fixture-local"}]}');return;}
    if(req.url!=='/chat/completions'){res.writeHead(404);res.end();return;}
    let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);requests.push(data);modelCalls++;
    if(hold)return;
    const tool=(name,args)=>({role:'assistant',content:modelCalls===2?'「日系冰箱」這關鍵字在三家都只撈到收納小物，我改用品牌＋型號去搜，順便抓尺寸。':null,tool_calls:[{id:'call-'+modelCalls,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    let message;
    if(modelCalls===1)message=tool('browser_open',{url:origin+'/fixture'});
    else if(modelCalls===2)message=tool('browser_click',{id:0});
    else{
      const observation=data.messages.filter(m=>m.role==='tool').at(-1).content;
      assert.match(observation,/Count: 1/);message={role:'assistant',content:'我已按下測試頁面的按鈕，並確認計數從 0 變成 1。'};
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${fixture.address().port}`;
  await win.webContents.executeJavaScript('window.taskSmokeEvents=[];window.taskSmokeSpeaking=[];window.bula.onTask(event=>window.taskSmokeEvents.push(event));window.bula.onSpeaking(on=>window.taskSmokeSpeaking.push(on));true');
  const send=async(provider,text,mode='browser',volume=false)=>{
    await win.webContents.executeJavaScript(`window.bula.saveSettings({provider:${JSON.stringify(provider)},base:${JSON.stringify(origin)},model:'fixture-local',volume:${volume}})`);
    await win.webContents.executeJavaScript(`window.taskSmokeEvents=[];document.querySelector('#task-mode').value=${JSON.stringify(mode)};document.querySelector('#prompt').value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit()`);
  };
  const outcome=()=>win.webContents.executeJavaScript('window.taskSmokeEvents.find(e=>["result","error","cancelled"].includes(e.type))');
  try{
    await send('local','請按一次測試頁面的按鈕，確認計數並告訴我結果。');
    await wait(outcome);const local=await outcome();assert.equal(local.type,'result');assert.match(local.text,/從 0 變成 1/);
    assert.ok(!getAgentWindow()?.isVisible(),'local task does not expose CLI');
    assert.ok(await win.webContents.executeJavaScript(`document.querySelector('#conversation').innerText.includes('從 0 變成 1')`),'avatar explains the actual browser result');
    assert.ok(await win.webContents.executeJavaScript(`document.querySelector('#conversation').innerText.includes('我改用品牌＋型號去搜，順便抓尺寸。')`),'human intermediate commentary appears in avatar');
    assert.ok(await win.webContents.executeJavaScript(`!document.querySelector('#conversation').innerText.includes('Running:')&&!document.querySelector('#conversation').innerText.includes('browser_click')`),'raw tool names stay out of avatar');
    assert.ok(getToolTask()?.tools.browser||modelCalls===3);await wait(()=>!getToolTask());
    fs.mkdirSync(path.join(__dirname,'../evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../evidence/avatar-task-result.png'),(await win.webContents.capturePage()).toPNG());
    hold=true;await send('local','測試緊急停止。');await wait(()=>requests.length===4);emergencyStop();await wait(()=>!getToolTask());assert.equal((await outcome()).type,'cancelled');hold=false;
    console.log('LOCAL_AVATAR_TASK_SMOKE',JSON.stringify({realChromiumClick:true,avatarResult:true,noCLI:true,abortRequest:true,model:'local HTTP fixture; not a loaded LM Studio model'}));
    await send('codex',`請使用 browser_open 開啟 ${origin}/fixture，再按一次 Increase，讀取頁面確認 Count: 1，最後以繁體中文告訴我結果。只操作這個本機測試頁面，不使用其他工具。`);
    await wait(outcome,120000);const codex=await outcome();assert.equal(codex.type,'result',codex.text);assert.ok(!getAgentWindow()?.isVisible());await wait(()=>!getToolTask());
    console.log('CODEX_AVATAR_TASK_SMOKE',JSON.stringify({liveAppServer:true,avatarResult:true,noCLI:true,reply:codex.text}));
    await send('claude','這是角色結果回傳測試。不要使用任何工具，不操作電腦或瀏覽器。請只回答「我已準備好，結果會由角色告訴你。」','computer',true);
    await wait(outcome,120000);const claude=await outcome();assert.ok(['result','error'].includes(claude.type));
    assert.ok(await win.webContents.executeJavaScript('window.taskSmokeSpeaking.includes(true)'),'avatar speech started');
    assert.ok(await win.webContents.executeJavaScript(`window.taskSmokeEvents.some(e=>e.type==='progress'&&e.messageId&&e.text.includes('我已準備好'))`),'live Claude MessageDisplay forwards conversational text before final outcome');
    assert.equal(await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#conversation .message.assistant')).filter(e=>e.textContent.trim()==='我已準備好，結果會由角色告訴你。').length`),1,'final reply is not duplicated by display hook');
    console.log('CLAUDE_AVATAR_TASK_SMOKE',JSON.stringify({officialHook:true,avatarOutcome:claude.type,noAutomaticCLI:!getAgentWindow()?.isVisible(),avatarSpeech:true,reply:claude.text}));
    await wait(()=>!agentSession.child,6000);
    // Official permission prompts still surface only when needed.
    await openAgentConsole({automatic:true});assert.ok(getAgentWindow().isVisible());getAgentWindow().hide();
    assert.equal(runtime.state.activity,claude.type==='result'?'success':'error');
  }finally{emergencyStop();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
}
module.exports={run};
