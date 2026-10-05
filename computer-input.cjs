// Native mouse and keyboard for computer-use tasks, one backend per OS behind the JSON actions native-input.swift takes:
// move, click (button, count), drag, scroll, type, key, position, frontmost, preflight. Coordinates arrive in logical (DIP)
// primary-display points; macOS posts them as-is, Windows (bin/native-input.exe, SendInput) and X11 (xdotool) get device pixels.
const fs=require('node:fs');const path=require('node:path');const {execFile,execFileSync}=require('node:child_process');
const ROOT=__dirname;
const helperPath=(platform=process.platform)=>path.join(ROOT,'bin',platform==='win32'?'native-input.exe':'native-input');
function onPath(name,env=process.env){for(const dir of String(env.PATH||'').split(path.delimiter).filter(Boolean)){try{fs.accessSync(path.join(dir,name),fs.constants.X_OK);return true;}catch{}}return false;}
// What the UI and the task runner check before offering or starting a computer task.
function support({platform=process.platform,env=process.env,has=name=>onPath(name,env),helper=file=>fs.existsSync(file)}={}){
  if(platform==='darwin')return {available:true,backend:'macos',permissions:true};
  if(platform==='win32')return helper(helperPath('win32'))?{available:true,backend:'windows'}:{available:false,backend:'windows',reason:'Native input helper missing; run npm run build:native.'};
  if(platform!=='linux')return {available:false,backend:null,reason:`Computer use is not supported on ${platform}.`};
  if(env.XDG_SESSION_TYPE==='wayland'||(env.WAYLAND_DISPLAY&&!env.DISPLAY))return {available:false,backend:'wayland',reason:'Computer use needs an X11 session: Wayland does not let apps move the pointer or send keys to other windows. Log in with "Ubuntu on Xorg" (or your desktop\'s X11 session) to use it.'};
  if(!env.DISPLAY)return {available:false,backend:'x11',reason:'Computer use needs a graphical X11 session (DISPLAY is not set).'};
  if(!has('xdotool'))return {available:false,backend:'x11',reason:'Computer use on Linux needs xdotool: install it (sudo apt install xdotool, or your distribution\'s package) and restart Agent Wardrobe.'};
  return {available:true,backend:'x11'};
}
// Logical → device pixels. Electron reports the primary display in DIPs from (0,0); SendInput (per-monitor DPI aware) and X11 work in pixels.
const toDevice=(value,scale=1)=>Math.round(value*(scale>0?scale:1));
const fromDevice=(value,scale=1)=>Math.round(value/(scale>0?scale:1)*100)/100;
// Same sign as the macOS helper (CGEvent pixel wheel): positive dy scrolls up, positive dx scrolls left. One notch per 40 px.
const NOTCH=40,clampScroll=v=>Math.max(-2000,Math.min(2000,Math.trunc(Number(v)||0)));
const notches=px=>px?Math.max(1,Math.min(50,Math.round(Math.abs(px)/NOTCH))):0;
// On Windows and Linux the shortcut modifier the model calls "command" is Ctrl; "option" is Alt.
const MODIFIERS={command:'ctrl',control:'ctrl',shift:'shift',option:'alt'};
function modifiers(list=[]){const out=[];for(const m of list){const name=MODIFIERS[m];if(!name)throw new Error('Unsupported modifier');if(!out.includes(name))out.push(name);}return out;}
const NAMED={Enter:['Return',0x0d],Escape:['Escape',0x1b],Tab:['Tab',0x09],Backspace:['BackSpace',0x08],Space:['space',0x20],Delete:['Delete',0x2e,1],Home:['Home',0x24,1],End:['End',0x23,1],PageUp:['Prior',0x21,1],PageDown:['Next',0x22,1],ArrowLeft:['Left',0x25,1],ArrowUp:['Up',0x26,1],ArrowRight:['Right',0x27,1],ArrowDown:['Down',0x28,1]};
for(let i=1;i<=12;i++)NAMED['F'+i]=['F'+i,0x6f+i];
// [xdotool keysym, Windows virtual key, extended-key flag] for the keys the macOS helper takes plus the rest of a keyboard's letters, digits and navigation.
function keyCode(key){
  if(typeof key!=='string')throw new Error('Unsupported key');
  if(NAMED[key])return {sym:NAMED[key][0],vk:NAMED[key][1],extended:Boolean(NAMED[key][2])};
  if(/^[a-z0-9]$/i.test(key))return {sym:key.toLowerCase(),vk:key.toUpperCase().charCodeAt(0),extended:false};
  throw new Error('Unsupported key');
}
const VK_MOD={ctrl:0x11,shift:0x10,alt:0x12};
const BUTTONS=['left','right','middle'];
function point(input,scale,a='x',b='y'){const x=Number(input[a]),y=Number(input[b]);if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Missing coordinates');return [toDevice(x,scale),toDevice(y,scale)];}
function clickOptions(input){const button=input.button||'left';if(!BUTTONS.includes(button))throw new Error('Unsupported button');const count=input.count===undefined?1:input.count;if(!Number.isInteger(count)||count<1||count>3)throw new Error('Unsupported click count');return {button,count};}
function checkText(text){if(typeof text!=='string'||text.length>2000)throw new Error('Invalid text');return text;}
// bin/native-input.exe argv (native-input.cs). A target window from the last observation goes first so the helper can bring it back to the front.
function windowsArgs(input,{scale=1}={}){
  const focus=input.targetWindow?['--focus',String(input.targetWindow)]:[];
  switch(input.action){
    case 'preflight':case 'position':case 'frontmost':return [input.action];
    case 'move':return [...focus,'move',...point(input,scale).map(String)];
    case 'click':{const {button,count}=clickOptions(input);return [...focus,'click',...point(input,scale).map(String),button,String(count)];}
    case 'drag':return [...focus,'drag',...point(input,scale).map(String),...point(input,scale,'toX','toY').map(String)];
    case 'scroll':return [...focus,'scroll',String(-clampScroll(input.dx)*120/NOTCH),String(clampScroll(input.dy)*120/NOTCH)];
    case 'type':return [...focus,'type',Buffer.from(checkText(input.text),'utf8').toString('base64')];
    case 'key':{const key=keyCode(input.key);return [...focus,'key',String(key.vk),key.extended?'1':'0',modifiers(input.modifiers).map(m=>VK_MOD[m]).join(',')||'-'];}
    default:throw new Error('Unsupported action');
  }
}
// xdotool cannot type CJK or emoji reliably (it remaps spare keycodes), so anything outside printable ASCII goes through the clipboard and Ctrl+V.
const needsPaste=text=>/[^\x20-\x7e\t\n]/.test(text);
function xdotoolPlan(input,{scale=1}={}){
  switch(input.action){
    case 'position':return {args:['getmouselocation','--shell']};
    case 'frontmost':return {args:['getactivewindow']};
    case 'preflight':return {args:['version']};
    // No --sync: it waits for the pointer to change position, so it hangs when it is already there. XTEST keeps the order anyway.
    case 'move':return {args:['mousemove',...point(input,scale).map(String)]};
    case 'click':{const {button,count}=clickOptions(input);return {args:['mousemove',...point(input,scale).map(String),'click','--repeat',String(count),'--delay','80',String(BUTTONS.indexOf(button)===1?3:BUTTONS.indexOf(button)===2?2:1)]};}
    case 'drag':{const [x,y]=point(input,scale),[tx,ty]=point(input,scale,'toX','toY');const steps=[];for(let i=1;i<=8;i++)steps.push('mousemove',String(Math.round(x+(tx-x)*i/8)),String(Math.round(y+(ty-y)*i/8)));return {args:['mousemove',String(x),String(y),'mousedown','1',...steps,'mouseup','1']};}
    case 'scroll':{const dx=clampScroll(input.dx),dy=clampScroll(input.dy),args=[];
      if(dy)args.push('click','--repeat',String(notches(dy)),'--delay','20',dy>0?'4':'5');
      if(dx)args.push('click','--repeat',String(notches(dx)),'--delay','20',dx>0?'6':'7');
      return {args};}
    case 'type':{const text=checkText(input.text);return needsPaste(text)?{paste:text,args:['key','--clearmodifiers','ctrl+v']}:{args:['type','--clearmodifiers','--delay','12','--',text]};}
    case 'key':{const key=keyCode(input.key);return {args:['key','--clearmodifiers',[...modifiers(input.modifiers),key.sym].join('+')]};}
    default:throw new Error('Unsupported action');
  }
}
const parseShell=text=>Object.fromEntries(String(text).split('\n').map(line=>line.split('=')).filter(p=>p.length===2).map(([k,v])=>[k.trim(),Number(v)]));
class NativeInput {
  constructor({platform=process.platform,clipboard=null,timeout=5000}={}){this.platform=platform;this.clipboard=clipboard;this.timeout=timeout;this.children=new Set();}
  exec(file,args,options={}){return new Promise((resolve,reject)=>{
    const child=execFile(file,args,{timeout:this.timeout,maxBuffer:65536,windowsHide:true,...options},(error,stdout,stderr)=>{this.children.delete(child);error?reject(new Error(String(stderr||'').trim()||error.message)):resolve(String(stdout));});this.children.add(child);
  });}
  stop(){for(const child of this.children)child.kill('SIGKILL');this.children.clear();}
  // Returns the helper's JSON line as text, like bin/native-input on macOS.
  async run(input,{scale=1}={}){
    if(this.platform==='darwin'){
      const helper=helperPath('darwin');if(!fs.existsSync(helper))throw new Error('Native input helper missing; run npm run build:native.');
      return this.exec(helper,[JSON.stringify(input)],{maxBuffer:4096});
    }
    const status=support({platform:this.platform});if(!status.available)throw new Error(status.reason);
    if(this.platform==='win32'){
      const out=await this.exec(helperPath('win32'),windowsArgs(input,{scale}));
      if(input.action!=='position')return out;
      const p=JSON.parse(out);return JSON.stringify({x:fromDevice(p.x,scale),y:fromDevice(p.y,scale),deviceX:p.x,deviceY:p.y});
    }
    return this.x11(input,scale);
  }
  async x11(input,scale){
    if(input.targetWindow&&!['position','frontmost','preflight'].includes(input.action)){
      // Without an EWMH window manager (e.g. bare Xvfb) windowactivate is refused; keyboard focus then follows the pointer.
      await this.exec('xdotool',['windowactivate','--sync',String(input.targetWindow)]).catch(()=>this.exec('xdotool',['windowfocus','--sync',String(input.targetWindow)])).catch(()=>{});
    }
    const plan=xdotoolPlan(input,{scale});
    if(input.action==='frontmost'){
      const window=await this.exec('xdotool',plan.args).then(out=>out.trim()).catch(()=>null);
      const pid=window?await this.exec('xdotool',['getwindowpid',window]).then(out=>Number(out.trim())||null).catch(()=>null):null;
      return JSON.stringify({pid,window});
    }
    if(input.action==='position'){const p=parseShell(await this.exec('xdotool',plan.args));return JSON.stringify({x:fromDevice(p.X,scale),y:fromDevice(p.Y,scale),deviceX:p.X,deviceY:p.Y});}
    if(input.action==='preflight')return JSON.stringify({xdotool:(await this.exec('xdotool',plan.args)).trim()});
    if(plan.paste!==undefined){
      if(!this.clipboard)throw new Error('Typing this text needs the clipboard');
      const old=this.clipboard.readText();this.clipboard.writeText(plan.paste);
      try{await this.exec('xdotool',plan.args);await new Promise(resolve=>setTimeout(resolve,200));}finally{this.clipboard.writeText(old);}
    }else if(plan.args.length)await this.exec('xdotool',plan.args);
    return JSON.stringify({ok:true});
  }
}
// Builds bin/native-input.exe with the C# compiler that ships with .NET Framework 4 on every Windows 10/11 install.
function windowsCompiler(env=process.env){
  const base=path.join(env.WINDIR||env.SystemRoot||'C:\\Windows','Microsoft.NET');
  return ['Framework64','Framework'].map(dir=>path.join(base,dir,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
}
function buildWindows(root=ROOT){
  const csc=windowsCompiler();if(!csc)throw new Error('csc.exe (.NET Framework 4) not found; it ships with Windows 10 and 11.');
  fs.mkdirSync(path.join(root,'bin'),{recursive:true});
  execFileSync(csc,['/nologo','/optimize+','/target:exe','/platform:anycpu','/out:'+path.join(root,'bin','native-input.exe'),path.join(root,'native-input.cs')],{stdio:'inherit'});
}
module.exports={support,helperPath,toDevice,fromDevice,keyCode,modifiers,windowsArgs,xdotoolPlan,needsPaste,parseShell,NativeInput,buildWindows,windowsCompiler};
