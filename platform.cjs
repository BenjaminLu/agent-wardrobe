// What differs between macOS, Windows and Linux in one place: finding command-line tools, starting them (npm's .cmd
// shims on Windows), ending a process tree, the system tar, a venv's python, and names shown to the user.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn,spawnSync}=require('node:child_process');

const PLATFORM=process.platform,MAC=PLATFORM==='darwin',WIN=PLATFORM==='win32',LINUX=PLATFORM==='linux';
const home=()=>os.homedir();
// Where installers put tools, beyond PATH (an app started from the Dock or Start menu often has a short PATH).
function toolDirs({platform=PLATFORM,env=process.env}={}){
  const h=home(),dirs=[],p=platform==='win32'?path.win32:path.posix;
  if(platform==='darwin')dirs.push('/opt/homebrew/bin','/usr/local/bin',p.join(h,'.local','bin'));
  else if(platform==='win32'){const local=env.LOCALAPPDATA||p.join(h,'AppData','Local'),roaming=env.APPDATA||p.join(h,'AppData','Roaming');
    dirs.push(p.join(h,'.local','bin'),p.join(roaming,'npm'),p.join(local,'Programs','OpenAI','Codex','bin'),p.join(local,'Microsoft','WinGet','Links'),p.join(h,'.cargo','bin'),p.join(h,'scoop','shims'),
      p.join(env.ProgramFiles||'C:\\Program Files','nodejs'));}
  else dirs.push(p.join(h,'.local','bin'),'/usr/local/bin','/usr/bin','/snap/bin',p.join(h,'.npm-global','bin'),p.join(h,'.cargo','bin'));
  const nvm=p.join(h,'.nvm','versions','node');try{dirs.push(...fs.readdirSync(nvm).reverse().map(v=>p.join(nvm,v,'bin')));}catch{}
  if(platform==='win32'&&env.NVM_SYMLINK)dirs.push(env.NVM_SYMLINK);
  return dirs;
}
// An executable named `name` on PATH or in the usual install folders; on Windows also name.exe / .cmd / .bat.
function which(name,{platform=PLATFORM,env=process.env,extra=[],exists=null}={}){
  const dirs=[...extra,...String(env.PATH||env.Path||'').split(platform==='win32'?';':':').filter(Boolean),...toolDirs({platform,env})];
  const exts=platform==='win32'?(path.extname(name)?['']:String(env.PATHEXT||'.EXE;.CMD;.BAT;.COM').toLowerCase().split(';').filter(e=>['.exe','.cmd','.bat','.com'].includes(e))):[''];
  const ok=exists||(file=>{try{if(platform==='win32')return fs.statSync(file).isFile();fs.accessSync(file,fs.constants.X_OK);return fs.statSync(file).isFile();}catch{return false;}});
  const join=platform==='win32'?path.win32.join:path.posix.join;
  for(const dir of dirs)for(const ext of exts){const file=join(dir,name+ext);if(ok(file))return file;}
  return null;
}
// npm's Windows shim (`codex.cmd`) runs `node <package>/bin/x.js %*`. Starting the script with node directly avoids
// cmd.exe and its quoting rules, so prompts and JSON arguments arrive unchanged.
function shimTarget(file){
  if(!/\.(cmd|bat)$/i.test(file))return null;
  let text;try{text=fs.readFileSync(file,'utf8');}catch{return null;}
  const m=text.match(/"%(?:~dp0|dp0)%?\\([^"]+\.(?:c|m)?js)"/i);if(!m)return null;
  const script=path.join(path.dirname(file),...m[1].split(/[\\/]/));if(!fs.existsSync(script))return null;
  const local=path.join(path.dirname(file),'node.exe');
  const node=fs.existsSync(local)?local:which('node');
  return node?{command:node,args:[script],env:{}}:{command:process.execPath,args:[script],env:{ELECTRON_RUN_AS_NODE:'1'}};
}
// cmd.exe quoting for a .cmd/.bat that is not an npm shim (cross-spawn's rules: quote, then caret-escape twice).
function cmdArg(arg){
  let s=String(arg).replace(/(\\*)"/g,'$1$1\\"').replace(/(\\*)$/,'$1$1');s=`"${s}"`;
  for(let i=0;i<2;i++)s=s.replace(/([()\][%!^"`<>&|;, *?])/g,'^$1');return s;
}
// spawn() that also starts Windows .cmd / .bat tools.
function launch(command,args=[],options={},spawnImpl=spawn){
  if(WIN&&/\.(cmd|bat)$/i.test(command)){
    const shim=shimTarget(command);
    if(shim)return spawnImpl(shim.command,[...shim.args,...args],{...options,env:{...(options.env||process.env),...shim.env},shell:false});
    const line=[cmdArg(command),...args.map(cmdArg)].join(' ');
    return spawnImpl(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`"${line}"`],{...options,shell:false,windowsVerbatimArguments:true});
  }
  return spawnImpl(command,args,options);
}
// Ends a process and its children: a process group on macOS / Linux (spawned with detached:true), taskkill /T on Windows.
function killTree(child,signal='SIGTERM'){
  if(!child?.pid)return;
  if(WIN){try{spawnSync('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}return;}
  try{process.kill(-child.pid,signal);}catch{try{child.kill(signal);}catch{}}
}
// libarchive's bsdtar: /usr/bin/tar on macOS, System32\tar.exe on Windows 10+; GNU tar on Linux (gz/xz only, no zip/7z/rar).
function tarCommand(){if(MAC)return '/usr/bin/tar';if(WIN){const sys=path.join(process.env.SystemRoot||'C:\\Windows','System32','tar.exe');return fs.existsSync(sys)?sys:'tar';}return which('bsdtar')||'tar';}
const bsdtar=()=>MAC||WIN||Boolean(which('bsdtar'));
// A virtual environment's interpreter.
const venvPython=(venv,platform=PLATFORM)=>platform==='win32'?path.join(venv,'Scripts','python.exe'):path.join(venv,'bin','python');
const venvSitePackages=(venv,version='3.10',platform=PLATFORM)=>platform==='win32'?path.join(venv,'Lib','site-packages'):path.join(venv,'lib',`python${version}`,'site-packages');
// Transparent windows on Linux need a compositing window manager. Wayland always composites; on X11 the usual desktops
// (GNOME, KDE, Cinnamon…) do, bare window managers and Xvfb do not. AGENT_WARDROBE_TRANSPARENT=1/0 overrides the guess.
function transparencySupported({platform=PLATFORM,env=process.env}={}){
  if(env.AGENT_WARDROBE_TRANSPARENT==='1')return true;if(env.AGENT_WARDROBE_TRANSPARENT==='0')return false;
  if(platform!=='linux')return true;
  if(env.WAYLAND_DISPLAY||env.XDG_SESSION_TYPE==='wayland')return true;
  return /gnome|kde|plasma|cinnamon|budgie|pantheon|deepin|unity|ubuntu|cosmic|xfce/i.test(`${env.XDG_CURRENT_DESKTOP||''}:${env.DESKTOP_SESSION||''}`)&&!/i3|openbox|fluxbox|awesome|dwm/i.test(env.DESKTOP_SESSION||'');
}
// Names shown in the interface: 這台 Mac / 這台電腦.
const HERE=MAC?'這台 Mac':'這台電腦',HERE_ON=MAC?'這台 Mac 上':'這台電腦上',ON_HERE=MAC?' Mac 上':'電腦上',MACHINE=MAC?' Mac ':'電腦';
const SYSTEM_VOICE_LABEL={darwin:{zh:'macOS 內建語音',en:'macOS voice'},win32:{zh:'Windows 內建語音',en:'Windows voice'},linux:{zh:'Linux 系統語音（espeak-ng）',en:'Linux voice (espeak-ng)'}};
const systemName=(platform=PLATFORM)=>({darwin:'Mac',win32:'Windows',linux:'Linux'})[platform]||'電腦';
// Shortcut text: ⌘⇧S on a Mac, Ctrl+Shift+S elsewhere.
function shortcutText(text,platform=PLATFORM){if(platform==='darwin')return text;return String(text).replace(/⌘⇧([A-Z0-9]|Return|Enter|↩)/g,'Ctrl+Shift+$1').replace(/⌘\s?＋?/g,'Ctrl+').replace(/⇧/g,'Shift+').replace(/Ctrl\+\+/g,'Ctrl+');}
// Windows briefly locks a freshly written file or folder (antivirus scans, handles still closing): a rename then fails with
// EPERM / EBUSY / EACCES for a moment. Retry for a few seconds instead of failing a finished download.
function renameRetry(from,to,{tries=20,delay=150}={}){
  for(let attempt=1;;attempt++){try{return fs.renameSync(from,to);}catch(error){if(attempt>=tries||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delay);}}
}
module.exports={renameRetry,transparencySupported,HERE,HERE_ON,ON_HERE,MACHINE,PLATFORM,MAC,WIN,LINUX,toolDirs,which,shimTarget,cmdArg,launch,killTree,tarCommand,bsdtar,venvPython,venvSitePackages,SYSTEM_VOICE_LABEL,systemName,shortcutText};
