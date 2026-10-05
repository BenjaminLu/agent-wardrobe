const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');
const {script,writeScript,check}=require('../cli-setup.cjs');
test('setup scripts use the official installers and only install when missing',()=>{
  const missing=script('claude',{find:()=>null,home:'/Users/x'});
  assert.match(missing,/curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);assert.match(missing,/'\/Users\/x\/\.local\/bin\/claude' 'auth' 'login'/);
  assert.match(script('codex',{find:()=>null,home:'/Users/x'}),/curl -fsSL https:\/\/chatgpt\.com\/codex\/install\.sh \| sh[\s\S]*'\/Users\/x\/\.local\/bin\/codex' 'login'/);
  const present=script('codex',{find:()=>"/opt/it's/codex"});assert.match(present,/if \[ ! -x '\/opt\/it'\\''s\/codex' \]/);
  assert.throws(()=>script('rm'));
  const file=writeScript('claude',fs.mkdtempSync(path.join(os.tmpdir(),'setup-')),{find:()=>null});assert.equal(fs.statSync(file).mode&0o777,0o700);assert.match(file,/\.command$/);
  execFileSync('/bin/zsh',['-n',file]);
});
test('sign-in state comes from each CLI status command',async()=>{
  const run=(out,code)=>(_bin,_args,_opts,cb)=>cb(code?Object.assign(new Error('x'),{code}):null,out,'');
  assert.deepEqual(await check('claude',{find:()=>'/bin/claude',run:run('{"loggedIn":true}',0)}),{installed:true,loggedIn:true});
  assert.deepEqual(await check('claude',{find:()=>'/bin/claude',run:run('{"loggedIn":false}',0)}),{installed:true,loggedIn:false});
  assert.deepEqual(await check('codex',{find:()=>'/bin/codex',run:run('Logged in using ChatGPT',0)}),{installed:true,loggedIn:true});
  assert.deepEqual(await check('codex',{find:()=>'/bin/codex',run:run('Not logged in',1)}),{installed:true,loggedIn:false});
  assert.deepEqual(await check('codex',{find:()=>null}),{installed:false,loggedIn:false});
});
