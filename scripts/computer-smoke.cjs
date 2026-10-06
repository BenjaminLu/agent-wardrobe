const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {execFile}=require('node:child_process');
const {app,clipboard,systemPreferences}=require('electron');const {OperationTools}=require('../src/main/operation-tools.cjs');
// Drives a real external app (TextEdit) only through the same computer_* tools a model receives.
async function run(){
  // LaunchServices launches (needed so TCC attributes to Electron, not the terminal) drop stdout, so mirror progress to a file.
  const trace=path.join(app.getPath('userData'),'computer-smoke.log');fs.writeFileSync(trace,'');const log=(...parts)=>{console.log(...parts);fs.appendFileSync(trace,parts.join(' ')+'\n');};
  const permissions={screen:systemPreferences.getMediaAccessStatus('screen'),accessibility:systemPreferences.isTrustedAccessibilityClient(false),executable:process.execPath};
  log('COMPUTER_SMOKE_PERMISSIONS',JSON.stringify(permissions));
  if(permissions.screen!=='granted'||!permissions.accessibility)throw new Error('Grant Screen Recording and Accessibility to the executable above, then rerun.');
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const file=path.join(app.getPath('userData'),'computer-smoke.txt');fs.writeFileSync(file,'');
  const marker=`Agent Wardrobe 外部操作 ${Date.now()}`;const old=clipboard.readText();const tools=new OperationTools();
  let shot=0;const call=async(name,args={})=>{log('STEP',name,JSON.stringify(args));const result=await tools.execute(name,{...args,...(name==='computer_observe'?{}:{reason:'computer smoke'})},'computer');if(result.image)fs.writeFileSync(path.join(app.getPath('userData'),`computer-smoke-${++shot}.jpg`),Buffer.from(result.image.split(',')[1],'base64'));else log('RESULT',result.text);return result;};
  try{
    log('HELPER_PREFLIGHT',(await tools.native({action:'preflight'})).trim());
    await new Promise((resolve,reject)=>execFile('/usr/bin/open',['-a','TextEdit',file],error=>error?reject(error):resolve()));await wait(1500);
    const first=await call('computer_observe');const observed=JSON.parse(first.text);fs.writeFileSync(path.join(app.getPath('userData'),'computer-smoke-observe.jpg'),Buffer.from(first.image.split(',')[1],'base64'));const targetName=(await new Promise(resolve=>execFile('/bin/ps',['-o','comm=','-p',String(tools.targetPid)],(_e,out)=>resolve(String(out).trim()))));
    // Never send keys (⌘A/⌘C/⌘W) into whatever the user is working in.
    if(!targetName.endsWith('/TextEdit'))throw new Error(`Frontmost app is ${targetName}, not TextEdit; keep the Mac idle during this smoke`);
    log('TARGET',tools.targetPid,(await new Promise(resolve=>execFile('/bin/ps',['-o','comm=','-p',String(tools.targetPid)],(_e,out)=>resolve(String(out).trim())))));assert.ok(observed.width>0&&observed.imageWidth>0,'screen capture returns an image');
    // Click inside TextEdit's own window (as a model would after reading the screenshot), not a blind screen point.
    const script='ObjC.import("CoreGraphics");JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly,0))).filter(w=>w.kCGWindowOwnerPID==='+tools.targetPid+'&&w.kCGWindowLayer===0&&w.kCGWindowName==="computer-smoke.txt").map(w=>w.kCGWindowBounds))';
    const frame=JSON.parse(await new Promise((resolve,reject)=>execFile('/usr/bin/osascript',['-l','JavaScript','-e',script],(error,out)=>error?reject(error):resolve(out))))[0];assert.ok(frame,'TextEdit window is on screen');
    await call('computer_click',{x:Math.round(frame.X+frame.Width/2),y:Math.round(frame.Y+frame.Height/2)});await wait(300);
    await call('computer_observe');await call('computer_key',{key:'a',modifiers:['command']});
    await call('computer_observe');await call('computer_type',{text:marker});await wait(300);
    clipboard.writeText('');await call('computer_observe');await call('computer_key',{key:'a',modifiers:['command']});
    await call('computer_observe');await call('computer_key',{key:'c',modifiers:['command']});
    for(let i=0;i<20&&!clipboard.readText();i++)await wait(100);log('CLIPBOARD',JSON.stringify(clipboard.readText()));
    assert.equal(clipboard.readText().trim(),marker,'typed text reached TextEdit and was copied back by native keys');
    // Leave the smoke document empty rather than closing it: ⌘W can raise a save sheet in the user's TextEdit.
    await call('computer_observe');await call('computer_key',{key:'Backspace'});
    log('COMPUTER_SMOKE',JSON.stringify({externalApp:'TextEdit',observe:true,click:true,type:true,shortcuts:true,verifiedByClipboard:true}));
  }catch(error){log('COMPUTER_SMOKE_FAILED',error.message);throw error;}finally{tools.stop();clipboard.writeText(old);}
}
module.exports={run};
