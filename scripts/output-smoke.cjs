const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
async function run({win,agentSession,getToolTask,restoreOnly=false}){
  const wait=async(fn,timeout=10000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Output smoke timed out');await new Promise(resolve=>setTimeout(resolve,80));}};
  await wait(()=>win.webContents.executeJavaScript('document.body.dataset.ready==="true"'));
  if(restoreOnly){
    const saved=await win.webContents.executeJavaScript('window.bula.history()');const message=saved.filter(m=>m.artifacts?.length).at(-1);assert.ok(message);assert.ok(fs.existsSync(path.join(message.artifacts[0].folder,message.artifacts[0].files[0])));assert.ok(await win.webContents.executeJavaScript('!!document.querySelector(".artifact button")'));assert.equal(await win.webContents.executeJavaScript(`window.bula.openOutput(${JSON.stringify(message.artifacts[0].id)})`),true);console.log('DOCUMENT_RESTART_SMOKE',JSON.stringify({restoredAvatarButton:true,oldFileExists:true,finderReopens:true}));return;
  }
  let calls=0;
  const fixture=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);assert.ok(data.tools.some(t=>t.function.name==='report_save'));calls++;
    const message=calls<=2?{role:'assistant',content:calls===1?'我會把比較資料整理成文件，存到桌面的任務資料夾。':null,tool_calls:[{id:'save'+calls,type:'function',function:{name:'report_save',arguments:JSON.stringify(calls===1?{filename:'冰箱比較.md',content:'# 冰箱比較\n\n|型號|寬度|\n|---|---|\n|測試型號|68.5 cm|\n\n本資料為功能測試，不是實際產品。'}:{filename:'冰箱比較.csv',content:'型號,寬度\n測試型號,68.5 cm\n'})}}]}:{role:'assistant',content:'已將比較報告和表格存到資料夾，可以直接開啟。'};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message}]}));
  });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${fixture.address().port}/v1`;
  await win.webContents.executeJavaScript('window.outputEvents=[];window.bula.onTask(event=>window.outputEvents.push(event));true');
  const send=async(provider,text,mode)=>{await win.webContents.executeJavaScript(`window.bula.saveSettings({provider:${JSON.stringify(provider)},base:${JSON.stringify(origin)},model:'fixture-output',volume:false})`);await win.webContents.executeJavaScript(`window.outputEvents=[];document.querySelector('#task-mode').value=${JSON.stringify(mode)};document.querySelector('#prompt').value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit()`);};
  const result=()=>win.webContents.executeJavaScript('window.outputEvents.find(e=>["result","error","cancelled"].includes(e.type))');
  try{
    await send('local','請整理冰箱比較資料，存成報告和表格。','chat');await wait(result);const local=await result();assert.equal(local.type,'result',local.text);assert.equal(local.artifacts[0].files.length,2);assert.ok(fs.readFileSync(path.join(local.artifacts[0].folder,'冰箱比較.md'),'utf8').includes('68.5'));await wait(()=>!getToolTask());
    await wait(()=>win.webContents.executeJavaScript('!!document.querySelector(".artifact button")'));assert.equal(await win.webContents.executeJavaScript(`window.bula.openOutput(${JSON.stringify(local.artifacts[0].id)})`),true);assert.ok((await win.webContents.executeJavaScript('window.bula.history()')).some(m=>m.artifacts?.[0]?.id===local.artifacts[0].id));
    console.log('LOCAL_DOCUMENT_SMOKE',JSON.stringify({autoRouteFromChat:true,markdown:true,csv:true,avatarFolderButton:true,finderOpen:true,persistedArtifact:true,model:'HTTP fixture'}));
    const prompt='這是無害的存檔測試，不要瀏覽網站或使用其他工具。請呼叫 report_save，filename 為 test-report.md，content 為「# 文件存檔測試\n此文件是測試產物，不含產品資料。」。工具回傳成功後，用繁體中文告訴我已存到桌面資料夾。';
    await send('codex',prompt,'files');await wait(result,120000);const codex=await result();assert.equal(codex.type,'result',codex.text);assert.ok(fs.readFileSync(path.join(codex.artifacts[0].folder,'test-report.md'),'utf8').includes('文件存檔測試'));await wait(()=>!getToolTask());console.log('CODEX_DOCUMENT_SMOKE',JSON.stringify({liveAppServer:true,realSavedFile:true,avatarArtifact:true}));
    await send('claude',prompt,'files');await wait(result,120000);const claude=await result();assert.equal(claude.type,'result',claude.text);assert.ok(fs.readFileSync(path.join(claude.artifacts[0].folder,'test-report.md'),'utf8').includes('文件存檔測試'));await wait(()=>!agentSession.child,6000);console.log('CLAUDE_DOCUMENT_SMOKE',JSON.stringify({liveOfficialCLI:true,stdioMCP:true,realSavedFile:true,avatarArtifact:true}));
  }finally{fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
}
module.exports={run};
