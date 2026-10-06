const test=require('node:test');const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const path=require('node:path');
const {argumentsFor}=require('../src/main/agent-session.cjs');const {binary}=require('../src/main/cli.cjs');
test('official tasks stay interactive, keep auto permissions, and preserve literal prompts',()=>{
  const text='搜尋 example；$(touch /tmp/not-real)';
  const args=argumentsFor({mode:'browser',text,id:'test-session',persona:'Annie'});
  assert.ok(args.includes('--chrome'));assert.ok(!args.includes('-p'));assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.equal(args[args.indexOf('--permission-mode')+1],'auto');assert.equal(args.at(-1),text);
  assert.equal(args.at(-2),'--','user text cannot become CLI options');
  const setup=argumentsFor({mode:'browser',id:'s',persona:'setup',setup:true});assert.ok(!setup.includes('--'));assert.ok(!setup.includes('-p'),'official setup stays interactive without an initial task');
  assert.ok(!argumentsFor({mode:'computer',text:'hello',id:'s',persona:''}).includes('--chrome'));
  for(const text of ['', 'x\x1by', 'x'.repeat(2001)])assert.throws(()=>argumentsFor({mode:'computer',text,id:'s',persona:''}));
  assert.throws(()=>argumentsFor({mode:'fake',text:'hello'}));
});
test('emergency stop kills a stubborn owned CLI without stopping unrelated processes',{timeout:8000,skip:process.platform==='win32'&&'agent-pty.py needs a POSIX pty (Claude terminal tasks are not offered on Windows)'},async()=>{
  const python=binary('python3');
  const unrelated=spawn(python,['-c','import time; time.sleep(30)']);
  const code="import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); signal.signal(signal.SIGINT,signal.SIG_IGN); print('STUBBORN_READY',flush=True); time.sleep(30)";
  const child=spawn(python,[path.join(__dirname,'../native/agent-pty.py'),python,'-u','-c',code]);
  let output='',started=0;
  try{
    const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('U1RVQkJPUk5fUkVBRFk')&&!started){started=Date.now();child.stdin.write(JSON.stringify({type:'emergency'})+'\n');}});});
    assert.equal(await closed,0);assert.ok(started,'owned CLI became ready');assert.ok(Date.now()-started<2000,'emergency uses bounded hard kill');
    assert.doesNotThrow(()=>process.kill(unrelated.pid,0),'unrelated CLI remains alive');
  }finally{child.stdin.destroy();child.kill();unrelated.kill();}
});
test('PTY provides real TTY input, UTF-8 output, resize and owned shutdown', {timeout:8000,skip:process.platform==='win32'&&'agent-pty.py needs a POSIX pty (Claude terminal tasks are not offered on Windows)'},async()=>{
  const python=binary('python3');assert.ok(python);
  const code="import sys,os,time; print('TTY:'+str(sys.stdin.isatty()),flush=True); text=input(); print('ECHO:'+text,flush=True); time.sleep(30)";
  const child=spawn(python,[path.join(__dirname,'../native/agent-pty.py'),python,'-u','-c',code],{stdio:['pipe','pipe','pipe']});
  let buffer='',output='';let sent=false;
  const finished=new Promise((resolve,reject)=>{
    child.on('error',reject);child.on('close',resolve);
    child.stdout.on('data',chunk=>{
      buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();
      for(const line of lines){const item=JSON.parse(line);if(item.type==='output')output+=Buffer.from(item.data,'base64').toString();}
      if(output.includes('TTY:True')&&!sent){sent=true;child.stdin.write(JSON.stringify({type:'resize',cols:88,rows:24})+'\n');child.stdin.write(JSON.stringify({type:'input',data:Buffer.from('你好 Annie\n').toString('base64')})+'\n');}
      if(output.includes('ECHO:你好 Annie'))child.stdin.write(JSON.stringify({type:'stop'})+'\n');
    });
  });
  try{assert.equal(await finished,0);assert.match(output,/TTY:True/);assert.match(output,/ECHO:你好 Annie/);}
  finally{child.stdin.destroy();child.kill();}
});
