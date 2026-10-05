const assert=require('node:assert/strict');const http=require('node:http');
// Auto mode: the companion model decides between plain chat and a browser task; the stop control follows task state.
async function run({win,getToolTask}){
  const wait=async(fn,timeout=10000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Auto smoke timed out');await new Promise(resolve=>setTimeout(resolve,80));}};
  const js=code=>win.webContents.executeJavaScript(code);const requests=[];let release;
  const fixture=http.createServer(async(req,res)=>{
    if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Auto test</title><p>Price: 42</p>');return;}
    if(req.url==='/models'){res.setHeader('Content-Type','application/json');res.end('{"data":[{"id":"fixture-local"}]}');return;}
    let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);requests.push(data);
    const user=data.messages.filter(m=>m.role==='user').at(-1).content;let message;
    if(!data.tools)message={role:'assistant',content:JSON.stringify(user.includes('網頁')?{text:'好，我去網頁看看。',emotion:'happy',action:'browser'}:{text:'鯨魚是哺乳類喔。',emotion:'smug',action:'none'})};
    else if(!data.messages.some(m=>m.role==='tool')){await new Promise(resolve=>{release=resolve;});message={role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'browser_open',arguments:JSON.stringify({url:origin+'/fixture'})}}]};}
    else message={role:'assistant',content:'網頁上的價格是 42。'};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${fixture.address().port}`;
  const stopVisible=()=>js(`getComputedStyle(document.querySelector('#emergency-stop')).display!=='none'`);
  const send=text=>js(`document.querySelector('#task-mode').value='auto';document.querySelector('#prompt').value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit();true`);
  try{
    win.show();await js(`window.bula.saveSettings({provider:'local',base:${JSON.stringify(origin)},model:'fixture-local',volume:false,replyLanguage:'ja'})`);
    assert.equal(await js(`document.querySelector('#task-mode').value`),'auto','auto is the default mode');
    assert.equal(await stopVisible(),false,'stop control is hidden while idle');
    await send('鯨魚是魚嗎？');await wait(()=>js(`document.querySelector('#conversation').innerText.includes('鯨魚是哺乳類喔')`));
    assert.equal(getToolTask(),null,'plain question stays in chat');assert.equal(await stopVisible(),false);
    await send('幫我打開網頁看價格');await wait(()=>Boolean(release));
    assert.ok(getToolTask(),'model action started a browser task');assert.ok(await js(`document.querySelector('#conversation').innerText.includes('好，我去網頁看看')`),'acknowledgement shown');
    assert.equal(await stopVisible(),true,'stop control appears during the task');
    release();await wait(()=>js(`document.querySelector('#conversation').innerText.includes('網頁上的價格是 42')`));await wait(async()=>!await stopVisible());
    assert.equal(requests.filter(r=>!r.tools).length,2,'one routing chat call per message');
    assert.match(requests[0].messages[0].content,/Always reply in Japanese/,'chosen reply language reaches the model');
    assert.match(requests.find(r=>r.tools).messages[0].content,/Always reply in Japanese/,'and the operation task');
    console.log('AUTO_SMOKE',JSON.stringify({replyLanguage:'ja',defaultAuto:true,chatStaysChat:true,browserHandoff:true,stopOnlyDuringTask:true}));
  }finally{fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
}
module.exports={run};
