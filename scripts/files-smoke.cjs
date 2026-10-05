const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {globalShortcut}=require('electron');
async function run({win,outputs,openFiles,getFilesWindow}){
  const wait=async(fn)=>{const until=Date.now()+10000;while(!await fn()){if(Date.now()>until)throw new Error('Files smoke timed out');await new Promise(resolve=>setTimeout(resolve,60));}};
  await wait(()=>win.webContents.executeJavaScript('document.body.dataset.ready==="true"'));
  const id=randomUUID();outputs.create(id,'角色文件入口測試');outputs.save(id,'入口測試.txt','這是角色文件入口測試產物，並非你的資料。');outputs.close(id);
  // late-loading parts of the window can still move the button: click only once its position holds still
  const where=()=>win.webContents.executeJavaScript(`JSON.stringify(document.querySelector('#files').getBoundingClientRect())`);let last='';await wait(async()=>{await new Promise(r=>setTimeout(r,250));const now=await where();const same=now===last;last=now;return same;});
  const point=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#files').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),right:r.right,width:innerWidth};})()`);assert.ok(point.right<=point.width,'folder button fits avatar window');
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:point.x,y:point.y});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:point.x,y:point.y});
  await wait(()=>getFilesWindow()?.isVisible());const files=getFilesWindow();await wait(()=>files.webContents.executeJavaScript('document.querySelectorAll(".task").length>0'));
  assert.ok(files.webContents.getURL().startsWith('file:'));assert.equal(files.webContents.getLastWebPreferences().nodeIntegration,false);assert.equal(files.webContents.getLastWebPreferences().sandbox,true);
  await files.webContents.executeJavaScript(`document.querySelector('#search').value='入口測試.txt';document.querySelector('#search').dispatchEvent(new Event('input'));`);await wait(()=>files.webContents.executeJavaScript('document.querySelectorAll(".task").length===1'));
  assert.ok(await files.webContents.executeJavaScript('document.querySelector(".file-name").textContent.includes("入口測試.txt")'));
  assert.equal(await files.webContents.executeJavaScript(`window.wardrobeFiles.openFolder(${JSON.stringify(id)})`),true);
  assert.equal(await files.webContents.executeJavaScript(`window.wardrobeFiles.openFile({id:${JSON.stringify(id)},name:'入口測試.txt'})`),true);
  assert.equal(await files.webContents.executeJavaScript(`window.wardrobeFiles.reveal({id:${JSON.stringify(id)},name:'入口測試.txt'})`),true);
  const denied=await files.webContents.executeJavaScript(`window.wardrobeFiles.openFile({id:${JSON.stringify(id)},name:'../escape.md'}).then(()=>false,()=>true)`);assert.equal(denied,true);
  await files.webContents.executeJavaScript(`document.querySelector('#search').value='不存在的文件zzzz';document.querySelector('#search').dispatchEvent(new Event('input'));`);await wait(()=>files.webContents.executeJavaScript('!!document.querySelector(".empty")'));
  await openFiles();assert.equal(getFilesWindow(),files,'reuse the existing native files window');assert.equal(globalShortcut.isRegistered('CommandOrControl+Shift+O'),true);
  files.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});files.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(()=>!getFilesWindow());
  assert.ok(global.smokeOpened.some(p=>p.endsWith('入口測試.txt')),'opening is recorded, not performed');
  console.log('NATIVE_FILES_SMOKE',JSON.stringify({nativeToolbarClick:true,buttonFits:true,search:true,openFolder:true,openDocument:true,finderReveal:true,pathTraversalRejected:true,reusesWindow:true,globalShortcut:true,escapeCloses:true}));
}
module.exports={run};
