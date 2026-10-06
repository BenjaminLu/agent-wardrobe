// Codex / Claude for people with a subscription: the official installer and sign-in run in a terminal window,
// where the user sees every step; the app only writes the script and checks the result afterwards.
//  macOS   a .command file (zsh) that Terminal opens
//  Windows a .ps1 run by Windows Terminal or PowerShell
//  Linux   a bash script in the first terminal emulator found; with none, the command is returned for the user to paste
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {binary}=require('./cli.cjs');const platform=require('./platform.cjs');const {t}=require('./locales.cjs');

const TOOLS={
  claude:{label:'Claude Code',install:'curl -fsSL https://claude.ai/install.sh | bash',installWin:'irm https://claude.ai/install.ps1 | iex',login:['auth','login'],status:['auth','status','--json'],
    ready:out=>{try{return JSON.parse(out).loggedIn===true;}catch{return false;}}},
  codex:{label:'Codex',install:'curl -fsSL https://chatgpt.com/codex/install.sh | sh',installWin:'irm https://chatgpt.com/codex/install.ps1 | iex',login:['login'],status:['login','status'],
    ready:(out,code)=>code===0&&/logged in/i.test(out)}
};
const quote=value=>`'${String(value).replace(/'/g,`'\\''`)}'`;
const psQuote=value=>`'${String(value).replace(/'/g,"''")}'`;
const installed=(name,find=binary)=>find(name)||null;
// Where the official installer puts the tool when it is not installed yet.
const expected=(name,{home=os.homedir(),plat=process.platform,env=process.env}={})=>plat==='win32'?(name==='claude'?path.win32.join(home,'.local','bin','claude.exe'):path.win32.join(env.LOCALAPPDATA||path.win32.join(home,'AppData','Local'),'Programs','OpenAI','Codex','bin','codex.exe')):path.posix.join(home,'.local','bin',name);

// Runs a tool and collects its output (npm's .cmd shims on Windows included).
function runTool(bin,args,{timeout=10000}={},callback){
  let child;try{child=platform.launch(bin,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});}catch(error){callback(error,'','');return;}
  let out='',err='',done=false;const finish=(error,code)=>{if(done)return;done=true;clearTimeout(timer);callback(error||(code?Object.assign(new Error(`exit ${code}`),{code}):null),out,err);};
  const timer=setTimeout(()=>{try{child.kill();}catch{}finish(new Error('timeout'));},timeout);
  child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});child.on('error',error=>finish(error));child.on('close',code=>finish(null,code));
}
function check(name,{find=binary,run=runTool}={}){
  const tool=TOOLS[name];if(!tool)return Promise.reject(new Error('Unknown tool'));
  const bin=installed(name,find);if(!bin)return Promise.resolve({installed:false,loggedIn:false});
  return new Promise(resolve=>run(bin,tool.status,{timeout:10000},(error,stdout='',stderr='')=>resolve({installed:true,loggedIn:tool.ready(`${stdout}${stderr}`,error?error.code??1:0)})));
}
async function status(options){const [claude,codex]=await Promise.all([check('claude',options),check('codex',options)]);return {claude,codex};}

// Install only when missing, then sign in; a failed step keeps the window open with its message.
function script(name,{find=binary,home=os.homedir(),plat=process.platform}={}){
  const tool=TOOLS[name];if(!tool)throw new Error('Unknown tool');
  if(plat==='win32')return psScript(name,{find,home});
  const bin=installed(name,find)||expected(name,{home,plat});
  const pause=plat==='darwin'?'read -k1':'read -n1 -s';
  return [plat==='darwin'?'#!/bin/zsh':'#!/bin/bash',`echo ${quote(t('cli.setup.title',{tool:tool.label}))}`,
    `if [ ! -x ${quote(bin)} ]; then`,`  echo ${quote(t('cli.setup.installing',{tool:tool.label}))}`,
    `  ${tool.install} || { echo ${quote(t('cli.setup.installFailed'))}; ${pause}; exit 1; }`,'fi',
    `echo ${quote(t('cli.setup.loginNext'))}`,
    `${quote(bin)} ${tool.login.map(quote).join(' ')} || { echo ${quote(t('cli.setup.loginIncomplete'))}; ${pause}; exit 1; }`,
    `echo; echo ${quote(t('cli.setup.done'))}`,''].join('\n');
}
function psScript(name,{find=binary,home=os.homedir()}={}){
  const tool=TOOLS[name],bin=installed(name,find)||expected(name,{home,plat:'win32'});
  const fail=text=>`Write-Host ${psQuote(text)}; Read-Host ${psQuote(t('cli.setup.pressEnter'))}; exit 1`;
  return ['$ErrorActionPreference = "Stop"',`Write-Host ${psQuote(t('cli.setup.title',{tool:tool.label}))}`,`$bin = ${psQuote(bin)}`,
    `if (-not (Test-Path $bin)) {`,`  Write-Host ${psQuote(t('cli.setup.installing',{tool:tool.label}))}`,`  try { ${tool.installWin} } catch { ${fail(t('cli.setup.installFailed'))} }`,
    `  $env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')`,
    `  $found = Get-Command ${psQuote(name)} -ErrorAction SilentlyContinue; if ($found) { $bin = $found.Source }`,'}',
    `Write-Host ${psQuote(t('cli.setup.loginNext'))}`,
    `& $bin ${tool.login.map(psQuote).join(' ')}`,`if ($LASTEXITCODE -ne 0) { ${fail(t('cli.setup.loginIncomplete'))} }`,
    `Write-Host ''; Write-Host ${psQuote(t('cli.setup.done'))}`,''].join('\r\n');
}
function writeScript(name,dir=os.tmpdir(),options={}){
  const plat=options.plat||process.platform,ext=plat==='darwin'?'command':plat==='win32'?'ps1':'sh';
  const file=path.join(dir,`agent-wardrobe-${name}-setup.${ext}`);
  // Windows PowerShell 5 reads a .ps1 without a byte-order mark as the ANSI code page, which garbles Chinese
  fs.writeFileSync(file,(ext==='ps1'?'﻿':'')+script(name,options),{mode:0o700});fs.chmodSync(file,0o700);return file;
}
// Linux terminal emulators and how each runs a command.
const TERMINALS=[['x-terminal-emulator',['-e']],['gnome-terminal',['--']],['konsole',['-e']],['xfce4-terminal',['-x']],['kitty',[]],['alacritty',['-e']],['wezterm',['start','--']],['tilix',['-e']],['mate-terminal',['-x']],['lxterminal',['-e']],['xterm',['-e']]];
// Opens the script in a terminal. Returns {opened:true}, or {command} for the user to paste when there is no terminal.
async function open(name,{dir=os.tmpdir(),openPath,find=platform.which,spawnImpl=spawn,plat=process.platform}={}){
  const file=writeScript(name,dir,{plat});
  if(plat==='darwin'){const error=await openPath(file);if(error)throw new Error(error);return {opened:true,file};}
  const detach=(cmd,args)=>{const child=spawnImpl(cmd,args,{detached:true,stdio:'ignore'});child.on?.('error',()=>{});child.unref?.();return {opened:true,file};};
  if(plat==='win32'){
    const ps=['-NoProfile','-ExecutionPolicy','Bypass','-File',file];const wt=find('wt');
    return wt?detach(wt,['powershell.exe',...ps]):detach('powershell.exe',ps);
  }
  for(const [term,args] of TERMINALS){const bin=find(term);if(bin)return detach(bin,[...args,'/bin/bash',file]);}
  const tool=TOOLS[name];return {opened:false,file,command:`${tool.install} && ${quote(expected(name,{plat}))} ${tool.login.join(' ')}`};
}
module.exports={TOOLS,check,status,script,psScript,writeScript,open,runTool,expected,TERMINALS};
