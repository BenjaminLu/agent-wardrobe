// Real pointer and keyboard through the computer-use backend (Windows SendInput helper, X11 xdotool) into a window of our own,
// checked by the DOM events it receives and by Electron's own cursor position (so DPI scaling has to be right).
// macOS only checks the helper answers: moving the pointer there needs the Accessibility grant (scripts/computer-smoke.cjs covers it).
// Runs inside the app (npm run smoke) or alone: npx electron scripts/native-input-smoke.cjs   (Linux CI: xvfb-run, --no-sandbox)
const assert=require('node:assert/strict');const {app,BrowserWindow,screen,desktopCapturer}=require('electron');
const {OperationTools,computerSupport}=require('../src/main/operation-tools.cjs');
const PAGE=`<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px sans-serif"><textarea id="t" style="position:absolute;left:20px;top:20px;width:300px;height:120px"></textarea>
<div id="pad" style="position:absolute;left:340px;top:20px;width:260px;height:300px;overflow:auto;background:#eee"><div style="height:3000px"></div></div>
<div id="drag" style="position:absolute;left:20px;top:170px;width:300px;height:150px;background:#cde"></div>
<script>window.events=[];const log=(type,e)=>events.push({type,button:e.button,x:e.clientX,y:e.clientY,detail:e.detail,deltaY:e.deltaY});
for(const type of ['mousedown','mouseup','dblclick','contextmenu','dragstart'])addEventListener(type,e=>{log(type,e);if(type==='contextmenu'||type==='dragstart')e.preventDefault();});
addEventListener('wheel',e=>log('wheel',e),{capture:true,passive:true});pad.scrollTop=1500;</script>`;
async function run(){
  const status=computerSupport();console.log('NATIVE_INPUT_SUPPORT',JSON.stringify({platform:process.platform,...status}));
  const tools=new OperationTools();
  if(process.platform==='darwin'){
    const preflight=JSON.parse(await tools.native({action:'preflight'}));assert.equal(typeof preflight.accessibility,'boolean');
    console.log('NATIVE_INPUT_SMOKE',JSON.stringify({platform:'darwin',helper:true,preflight}));return;
  }
  assert.ok(status.available,status.reason);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const win=new BrowserWindow({width:640,height:360,useContentSize:true,alwaysOnTop:true,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true}});
  try{
    win.setAlwaysOnTop(true,'screen-saver');await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(PAGE));win.center();win.show();win.focus();await wait(800);
    const js=code=>win.webContents.executeJavaScript(code),content=win.getContentBounds(),at=(x,y)=>({x:content.x+x,y:content.y+y});
    const until=async(test,label)=>{for(let i=0;i<40;i++){if(await test())return;await wait(100);}throw new Error(`${label}: ${JSON.stringify(await js('events'))}`);};
    const scale=screen.getPrimaryDisplay().scaleFactor;
    // move + read back, twice, against the helper's own reading and Electron's
    for(const p of [at(100,60),at(400,200)]){
      await tools.native({action:'move',...p});const read=JSON.parse(await tools.native({action:'position'})),cursor=screen.getCursorScreenPoint();
      assert.ok(Math.abs(read.x-p.x)<=1&&Math.abs(read.y-p.y)<=1,`helper position ${JSON.stringify(read)} for ${JSON.stringify(p)}`);
      assert.ok(Math.abs(cursor.x-p.x)<=1&&Math.abs(cursor.y-p.y)<=1,`Electron cursor ${JSON.stringify(cursor)} for ${JSON.stringify(p)} at scale ${scale}`);
    }
    // the model's own tools: observe (screenshot + front window), click, type with CJK, Ctrl+A shortcut, scroll
    const observed=await tools.execute('computer_observe',{},'computer');const shot=JSON.parse(observed.text);
    assert.ok(shot.imageWidth>0&&observed.image.length>1000,'desktop screenshot');
    const call=async(name,args)=>{await tools.execute(name,{...args,reason:'native input smoke'},'computer');await tools.execute('computer_observe',{},'computer');};
    await call('computer_click',at(100,60));await until(()=>js(`document.activeElement.id==='t'`),'click focuses the textarea');
    await call('computer_type',{text:'hello 世界'});await until(()=>js(`t.value==='hello 世界'`),'typed text with CJK');
    await call('computer_key',{key:'a',modifiers:['command']});await call('computer_type',{text:'replaced'});await until(()=>js(`t.value==='replaced'`),'Ctrl+A then type');
    await call('computer_key',{key:'Enter'});await until(()=>js(`t.value==='replaced\\n'`),'Enter key');
    await tools.native({action:'move',...at(470,100)});await js('events.length=0');await call('computer_scroll',{dy:-120});
    await until(()=>js(`events.some(e=>e.type==='wheel'&&e.deltaY>0)`),'scroll down reaches the pad');
    // the extra pointer actions in the backend: right-click, double-click, drag
    await js('events.length=0');await tools.native({action:'click',...at(470,100),button:'right'});await until(()=>js(`events.some(e=>e.type==='contextmenu'&&e.button===2)`),'right click');
    await js('events.length=0');await tools.native({action:'click',...at(470,100),count:2});await until(()=>js(`events.some(e=>e.type==='dblclick')`),'double click');
    await js('events.length=0');// a selection left from Ctrl+A would turn the press into an HTML drag-and-drop of that text
    await js('document.activeElement.blur();getSelection().removeAllRanges()');await tools.native({action:'drag',...at(40,200),toX:content.x+280,toY:content.y+300});
    await until(()=>js(`events.some(e=>e.type==='mousedown'&&Math.abs(e.x-40)<=2&&Math.abs(e.y-200)<=2)&&events.some(e=>e.type==='mouseup'&&Math.abs(e.x-280)<=2&&Math.abs(e.y-300)<=2)`),'drag from and to');
    console.log('NATIVE_INPUT_SMOKE',JSON.stringify({platform:process.platform,backend:status.backend,scale,screenshot:[shot.imageWidth,shot.imageHeight],move:true,click:true,type:true,cjk:true,keys:true,scroll:true,rightClick:true,doubleClick:true,drag:true}));
  }finally{tools.stop();if(!win.isDestroyed())win.destroy();}
}
module.exports={run};
// Electron's default app loads a script path without making it require.main, so look for it on the command line.
if(process.argv.some(arg=>/native-input-smoke\.cjs$/.test(arg))){app.whenReady().then(run).then(()=>app.exit(0),error=>{console.error('POC_SMOKE_FAILED',error.stack||error.message);app.exit(1);});}
