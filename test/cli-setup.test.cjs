const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');
const {script,writeScript,check,open}=require('../src/main/cli-setup.cjs');
test('setup scripts use the official installers and only install when missing',()=>{
  const missing=script('claude',{find:()=>null,home:'/Users/x',plat:'darwin'});
  assert.match(missing,/curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);assert.match(missing,/'\/Users\/x\/\.local\/bin\/claude' 'auth' 'login'/);
  assert.match(script('codex',{find:()=>null,home:'/Users/x',plat:'darwin'}),/curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh[\s\S]*'\/Users\/x\/\.local\/bin\/codex' 'login'/);
  const present=script('codex',{find:()=>"/opt/it's/codex",plat:'darwin'});assert.match(present,/if \[ ! -x '\/opt\/it'\\''s\/codex' \]/);
  assert.throws(()=>script('rm'));
  const file=writeScript('claude',fs.mkdtempSync(path.join(os.tmpdir(),'setup-')),{find:()=>null,plat:'darwin'});if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o700);assert.match(file,/\.command$/);
  if(process.platform==='darwin')execFileSync('/bin/zsh',['-n',file]);
});
test('Windows runs the official PowerShell installers; Linux uses bash, a terminal it finds, or hands back the command',async()=>{
  const ps=script('claude',{find:()=>null,home:'C:\\Users\\x',plat:'win32'});
  assert.match(ps,/irm https:\/\/claude\.ai\/install\.ps1 \| iex/);assert.match(ps,/\$bin = 'C:\\Users\\x\\\.local\\bin\\claude\.exe'/);assert.match(ps,/& \$bin 'auth' 'login'/);
  assert.match(script('codex',{find:()=>"C:\\it's\\codex.cmd",plat:'win32'}),/\$bin = 'C:\\it''s\\codex\.cmd'[\s\S]*irm https:\/\/chatgpt\.com\/codex\/install\.ps1 \| iex/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'setup-'));
  const ps1=writeScript('codex',dir,{find:()=>null,plat:'win32'});assert.match(ps1,/\.ps1$/);assert.equal(fs.readFileSync(ps1,'utf8').charCodeAt(0),0xfeff,'BOM so Windows PowerShell reads UTF-8');
  const bash=script('claude',{find:()=>null,home:'/home/x',plat:'linux'});assert.match(bash,/^#!\/bin\/bash/);assert.match(bash,/read -n1 -s/);
  const spawned=[];const spawnImpl=(cmd,args)=>{spawned.push([cmd,...args]);return {unref(){},on(){}};};
  assert.equal((await open('claude',{dir,plat:'win32',find:n=>n==='wt'?'C:\\wt.exe':null,spawnImpl})).opened,true);assert.deepEqual(spawned.at(-1).slice(0,3),['C:\\wt.exe','powershell.exe','-NoProfile']);
  await open('claude',{dir,plat:'win32',find:()=>null,spawnImpl});assert.equal(spawned.at(-1)[0],'powershell.exe');
  await open('codex',{dir,plat:'linux',find:n=>n==='konsole'?'/usr/bin/konsole':null,spawnImpl});assert.deepEqual(spawned.at(-1).slice(0,3),['/usr/bin/konsole','-e','/bin/bash']);
  const none=await open('codex',{dir,plat:'linux',find:()=>null,spawnImpl});assert.equal(none.opened,false);assert.match(none.command,/install\.sh \| sh && '.*codex' login/);
});
test('sign-in state comes from each CLI status command',async()=>{
  const run=(out,code)=>(_bin,_args,_opts,cb)=>cb(code?Object.assign(new Error('x'),{code}):null,out,'');
  assert.deepEqual(await check('claude',{find:()=>'/bin/claude',run:run('{"loggedIn":true}',0)}),{installed:true,loggedIn:true});
  assert.deepEqual(await check('claude',{find:()=>'/bin/claude',run:run('{"loggedIn":false}',0)}),{installed:true,loggedIn:false});
  assert.deepEqual(await check('codex',{find:()=>'/bin/codex',run:run('Logged in using ChatGPT',0)}),{installed:true,loggedIn:true});
  assert.deepEqual(await check('codex',{find:()=>'/bin/codex',run:run('Not logged in',1)}),{installed:true,loggedIn:false});
  assert.deepEqual(await check('codex',{find:()=>null}),{installed:false,loggedIn:false});
});
