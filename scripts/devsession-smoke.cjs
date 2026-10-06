const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {BrowserWindow}=require('electron');
// 開發夥伴 end to end with stand-in `claude` and `codex` CLIs and a fixture home: list sessions, attach, send a message
// and hear the speakable reply, answer approvals by button and by voice (only while one is pending), interrupt, leave;
// the same with Codex; the phone answering an approval; and the re-attach offer after a restart of the window.
async function run({win,runtime,devCompanion,startRemote,getSettings}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'devsession-smoke-')),log=path.join(dir,'cli-log.jsonl');
  const f=require('../test/fixtures/dev/make-home.cjs').makeHome(dir),{IDS}=require('../test/fixtures/dev/make-home.cjs');
  const {fakeBin}=require('./fake-bin.cjs');
  Object.assign(process.env,{DEV_SMOKE_HOME:f.home,DEV_FAKE_LOG:log,DEV_FAKE_THREADS:JSON.stringify(f.threads),
    DEV_SMOKE_CLAUDE:fakeBin(dir,'claude',path.join(__dirname,'..','test','fixtures','dev','fake-claude.cjs')),DEV_SMOKE_CODEX:fakeBin(dir,'codex',path.join(__dirname,'..','test','fixtures','dev','fake-codex.cjs'))});
  // a running `claude --resume <alpha>` elsewhere: alpha is flagged as possibly open in a terminal
  global.smokeDevProcesses=[{pid:999999,ppid:1,engine:'claude',command:`claude --resume ${IDS.alpha}`,cwd:null}];
  Object.assign(getSettings(),{language:'zh-TW',volume:false});global.smokeSpoken=[];
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,what,timeout=20000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error(`Dev session smoke timed out: ${what}`);await new Promise(r=>setTimeout(r,120));}};
  const entries=()=>fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').map(l=>JSON.parse(l)):[];
  const spoken=()=>global.smokeSpoken.join('\n');
  const say=text=>js(`document.querySelector('#prompt').value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit();true`);
  // what the wake word's dictation hands to the chat: the same path as speech
  const dictate=text=>{win.webContents.send('bula:dictation',{text,follow:false});};
  const replies=()=>js(`[...document.querySelectorAll('#conversation .message.dev-reply')].map(m=>m.textContent)`);
  const lastCard=()=>js(`(()=>{const c=[...document.querySelectorAll('.message.approval')].at(-1);return c?{id:c.dataset.request,question:c.querySelector('.question').textContent,detail:c.querySelector('pre')?.textContent||'',result:c.dataset.result||null,buttons:c.querySelectorAll('.actions button').length}:null})()`);
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  let phone;
  try{
    win.show();  // the page's labels are pinned to zh-Hant by --ui-language (scripts/run-smokes.cjs)
    // --- the picker: both tools, newest first, the terminal warning, subagent / exec files left out
    await js(`document.querySelector('#dev-open').click();true`);
    await wait(()=>js(`document.querySelectorAll('#dev-list button[data-id]').length===4`),'session list');
    const rows=await js(`[...document.querySelectorAll('#dev-list button[data-id]')].map(b=>({id:b.dataset.id,engine:b.dataset.engine,text:b.textContent,warn:Boolean(b.querySelector('.warn'))}))`);
    assert.deepEqual(rows.map(r=>r.id),[IDS.beta,IDS.alpha,IDS.codex,IDS.meta],JSON.stringify(rows.map(r=>r.text)));
    assert.deepEqual(rows.map(r=>r.warn),[true,true,false,false],'recently written and named by a running claude');
    assert.match(rows[1].text,/alpha · Claude/);assert.match(rows[1].text,/登入頁錯誤訊息/);assert.match(rows[2].text,/gamma · Codex/);assert.match(rows[2].text,/gamma 單元測試/);
    fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','devsession-picker.png'),(await win.webContents.capturePage()).toPNG());
    // --- attach Claude (alpha)
    await js(`document.querySelector('#dev-list button[data-id="${IDS.alpha}"]').click();true`);
    await wait(()=>js(`!document.querySelector('#dev-bar').hidden`),'attached bar');
    assert.match(await js(`document.querySelector('#dev-label').textContent`),/alpha · Claude/);
    assert.match(await js(`document.querySelector('#prompt').placeholder`),/alpha 的工作階段/,'the input says where messages go');
    assert.ok(await js(`[...document.querySelectorAll('#conversation .message.error')].some(m=>m.textContent.includes('終端機'))`),'the terminal warning is repeated after attaching');
    assert.equal(getSettings().devSession.id,IDS.alpha,'remembered for the next start');
    // a typed message reaches the session; the reply is shown in full and spoken without the code and the long path
    await say('hello there');
    await wait(async()=>(await replies()).some(r=>r.includes('收到：hello there')),'first reply');
    assert.match((await replies()).at(-1),/console\.log\('patched'\)/,'the chat keeps the code');
    await wait(()=>spoken().includes('（附了一段程式碼）'),'spoken reply');
    assert.ok(!spoken().includes('/Users/someone')&&spoken().includes('main.cjs'),spoken());
    // --- approval answered with the button
    await say('幫我建立一個檔案');
    await wait(async()=>(await lastCard())?.buttons===2,'approval card');
    let card=await lastCard();assert.equal(card.question,'要讓我寫入 hello.txt 嗎？');assert.match(card.detail,/寫入 2 行/);
    assert.equal(runtime.state.activity,'waiting_for_approval');await wait(()=>spoken().includes('要讓我寫入 hello.txt 嗎？'),'spoken question');
    await new Promise(r=>setTimeout(r,300));assert.ok(!fs.existsSync(path.join(f.alpha,'hello.txt')),'nothing happens before the user answers');
    fs.writeFileSync(path.join(__dirname,'..','evidence','devsession-approval.png'),(await win.webContents.capturePage()).toPNG());
    await js(`[...document.querySelectorAll('.message.approval')].at(-1).querySelector('.allow').click();true`);
    await wait(async()=>(await replies()).some(r=>r.includes('建立好了')),'reply after allow');
    assert.equal((await lastCard()).result,'allowed');assert.equal(fs.readFileSync(path.join(f.alpha,'hello.txt'),'utf8'),'hi from the companion\n');
    // --- with nothing pending, a spoken 好 is just a message
    dictate('好');
    await wait(async()=>(await replies()).some(r=>r.includes('收到：好')),'好 as a message');
    // --- approval answered by voice
    await say('跑一下測試');
    await wait(async()=>(await lastCard())?.buttons===2&&(await lastCard()).question==='要讓我執行 npm test 嗎？','second approval');
    dictate('今天天氣如何');await new Promise(r=>setTimeout(r,400));
    assert.equal((await lastCard()).result,null,'other words do not answer it');
    dictate('不要');
    await wait(async()=>(await lastCard()).result==='denied','denied by voice');
    await wait(async()=>(await replies()).some(r=>r.includes('先不跑測試')),'reply after deny');
    const decisions=entries().filter(e=>e.bin==='claude'&&e.decision).map(e=>e.decision.behavior);assert.deepEqual(decisions,['allow','deny']);
    // --- interrupt a running turn with the button
    await say('慢慢來，整理整個專案');
    await wait(()=>js(`!document.querySelector('#dev-stop').disabled`),'stop enabled');
    await js(`document.querySelector('#dev-stop').click();true`);
    await wait(()=>Promise.resolve(entries().some(e=>e.stdin?.type==='control_request'&&e.stdin.request.subtype==='interrupt')),'interrupt sent');
    await wait(()=>js(`document.querySelector('#dev-stop').disabled`),'turn ended');
    assert.equal(runtime.state.activity,'idle');
    // --- 停下來 by voice while nothing runs is just a message; leave
    const claudePid=entries().find(e=>e.bin==='claude'&&e.pid).pid;assert.ok(alive(claudePid));
    const claudeStarts=entries().filter(e=>e.bin==='claude'&&e.args);assert.equal(claudeStarts.length,1,'one claude process for every turn');
    assert.equal(claudeStarts[0].args[claudeStarts[0].args.indexOf('--permission-mode')+1],'acceptEdits','the session\'s own permission mode');
    await js(`document.querySelector('#dev-leave').click();true`);
    await wait(()=>js(`document.querySelector('#dev-bar').hidden`),'left');
    assert.ok(await js(`[...document.querySelectorAll('.message.dev-note')].some(m=>m.textContent.includes('claude --resume ${IDS.alpha}'))`),'how to continue in a terminal');
    await wait(()=>Promise.resolve(!alive(claudePid)),'claude process ended');
    assert.equal(getSettings().devSession,undefined);
    // --- Codex: approval by button, then leave
    await js(`document.querySelector('#dev-open').click();true`);
    await wait(()=>js(`Boolean(document.querySelector('#dev-list button[data-id="${IDS.codex}"]'))`),'codex row');
    await js(`document.querySelector('#dev-list button[data-id="${IDS.codex}"]').click();true`);
    await wait(()=>js(`document.querySelector('#dev-label').textContent.includes('gamma · Codex')`),'codex attached');
    await say('請跑測試');
    await wait(async()=>(await lastCard())?.buttons===2&&(await lastCard()).question==='要讓我執行 npm test 嗎？','codex approval');
    assert.match((await lastCard()).detail,/\$ npm test/);
    await js(`[...document.querySelectorAll('.message.approval')].at(-1).querySelector('.allow').click();true`);
    await wait(async()=>(await replies()).some(r=>r.includes('測試通過')),'codex reply');
    assert.deepEqual(entries().filter(e=>e.bin==='codex'&&e.decision!==undefined).map(e=>e.decision),['accept']);
    assert.equal(entries().find(e=>e.unsupported)?.unsupported.error.code,-32601,'questions Codex asks outside approvals are declined');
    const resume=entries().find(e=>e.stdin?.method==='thread/resume').stdin.params;assert.deepEqual(Object.keys(resume).sort(),['excludeTurns','threadId'],'the thread keeps its own settings');
    const codexPid=entries().find(e=>e.bin==='codex'&&e.pid&&e.args?.[0]==='app-server'&&e.cwd===fs.realpathSync(f.gamma))?.pid;
    await js(`document.querySelector('#dev-leave').click();true`);await wait(()=>js(`document.querySelector('#dev-bar').hidden`),'left codex');
    if(codexPid)await wait(()=>Promise.resolve(!alive(codexPid)),'codex app-server ended');
    // --- the phone: sees the approval and answers it
    await startRemote();await js(`window.bula.remoteTasks(true)`);
    const info=await js(`window.bula.remotePair()`);
    phone=new BrowserWindow({width:390,height:760,show:true,title:'Phone',webPreferences:{contextIsolation:true,sandbox:true,partition:'devsession-smoke-phone'}});
    await phone.loadURL(info.link);const p=code=>phone.webContents.executeJavaScript(code);
    await wait(()=>p(`!document.querySelector('#app').hidden&&document.querySelector('#link').classList.contains('on')`),'phone paired');
    await wait(()=>p(`!document.querySelector('#dev-pick-row').hidden`),'phone picker button');
    await p(`document.querySelector('#dev-pick').click();true`);
    await wait(()=>p(`Boolean(document.querySelector('#dev-list button[data-id="${IDS.alpha}"]'))`),'phone list');
    await p(`document.querySelector('#dev-list button[data-id="${IDS.alpha}"]').click();true`);
    await wait(()=>p(`!document.querySelector('#dev-bar').hidden&&document.querySelector('#dev-label').textContent.includes('alpha')`),'phone attached');
    await wait(()=>js(`!document.querySelector('#dev-bar').hidden`),'desktop shows the phone attach');
    await p(`document.querySelector('#text').value='再建立一個檔案';document.querySelector('#chat').requestSubmit();true`);
    await wait(()=>p(`Boolean(document.querySelector('.msg.approval .actions button'))`),'phone approval card');
    assert.match(await p(`document.querySelector('.msg.approval b').textContent`),/要讓我寫入 hello\.txt 嗎？/);
    await wait(async()=>(await lastCard())?.buttons===2,'desktop card for the phone turn');
    fs.writeFileSync(path.join(__dirname,'..','evidence','devsession-phone.png'),(await phone.webContents.capturePage()).toPNG());
    await p(`document.querySelector('.msg.approval .actions .allow').click();true`);
    await wait(()=>p(`[...document.querySelectorAll('.msg')].some(m=>m.textContent.includes('建立好了'))`),'phone reply');
    await wait(async()=>(await lastCard()).result==='allowed','desktop card resolved');
    assert.equal(await p(`[...document.querySelectorAll('.msg.user')].filter(m=>m.textContent==='再建立一個檔案').length`),1,'the phone shows its own line once');
    assert.ok(await js(`[...document.querySelectorAll('#conversation .message.user')].some(m=>m.textContent==='📱 再建立一個檔案')`),'the Mac shows the phone\'s line');
    await p(`document.querySelector('#dev-leave').click();true`);
    await wait(()=>js(`document.querySelector('#dev-bar').hidden`),'left from the phone');
    // --- after a restart: offered again, not attached by itself
    await devCompanion.attach({engine:'claude',id:IDS.alpha});const pid2=devCompanion.adapter.pid||null;
    devCompanion.close();  // what quitting does
    await win.webContents.reloadIgnoringCache();
    await wait(()=>js(`document.body.dataset.ready==='true'&&Boolean(document.querySelector('.message.offer .reattach'))`),'re-attach offer');
    assert.equal(await js(`document.querySelector('#dev-bar').hidden`),true,'not attached silently');
    await js(`document.querySelector('.message.offer .reattach').click();true`);
    await wait(()=>js(`!document.querySelector('#dev-bar').hidden`),'re-attached');
    await js(`document.querySelector('#dev-leave').click();true`);await wait(()=>js(`document.querySelector('#dev-bar').hidden`),'left again');
    assert.ok(!devCompanion.attached);
    // nothing reached a session that the user did not type or say: every message written to claude's stdin is one of ours
    const sent=entries().filter(e=>e.bin==='claude'&&e.stdin?.type==='user').map(e=>e.stdin.message.content[0].text);
    assert.deepEqual(sent,['hello there','幫我建立一個檔案','好','跑一下測試','慢慢來，整理整個專案','再建立一個檔案']);
    console.log('DEVSESSION_SMOKE',JSON.stringify({listed:rows.length,terminalWarning:true,claudeReplySpoken:true,approvalByButton:true,approvalByVoice:true,yesOnlyWhilePending:true,interrupt:true,leaveEndsProcess:true,codexApproval:true,phoneApproval:true,reattachOffer:true,restartedPid:Boolean(pid2)}));
  }finally{phone?.destroy();try{devCompanion.leave({quiet:true});}catch{}delete global.smokeDevProcesses;setTimeout(()=>fs.rmSync(dir,{recursive:true,force:true}),300);}
}
module.exports={run};
