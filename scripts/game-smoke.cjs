const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
// The character plays Lane Dash for a while. Offline it uses a stand-in decision sidecar; with GAME_SMOKE_REAL=1 it uses Laya from .laya/venv;
// with GAME_SMOKE_ENGINE=jev it plays through a local stand-in for TypeSafe's Jev API, entering the key in the game window.
const answer=state=>{const lanes=['left','middle','right'],empty=lanes.map(l=>state.includes('The '+l+' lane is empty'));
  return {lane:{type:'choice',choice:lanes[empty.indexOf(true)],probabilities:Object.fromEntries(lanes.map((l,i)=>[l,empty[i]?0.9/empty.filter(Boolean).length:0.05])),confidence:.8}};};
async function run({gameService,runtime,win:companion}){
  const jev=process.env.GAME_SMOKE_ENGINE==='jev',key='ts-test-key-0123456789abcdef',seen=[];let server;
  if(jev){
    server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const data=JSON.parse(body);seen.push({url:req.url,auth:req.headers.authorization,data});
      if(req.headers.authorization!==`Bearer ${key}`){res.writeHead(401);res.end('{"error":"bad key"}');return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'jev-1.13.0',answers:answer(data.state),usage:{input_tokens:40,output_tokens:0}}));});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.AGENT_WARDROBE_JEV_BASE=`http://127.0.0.1:${server.address().port}/v1`;
  }else if(!process.env.GAME_SMOKE_REAL){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'game-smoke-')),fake=path.join(dir,'fake-laya.cjs');
    fs.writeFileSync(fake,`const rl=require('readline').createInterface({input:process.stdin});console.log('@laya '+JSON.stringify({ready:true,device:'stand-in'}));
rl.on('line',line=>{const r=JSON.parse(line),lanes=['left','middle','right'],empty=lanes.map(l=>r.state.includes('The '+l+' lane is empty'));
const p=Object.fromEntries(lanes.map((l,i)=>[l,empty[i]?0.9/empty.filter(Boolean).length:0.05]));const choice=lanes[empty.indexOf(true)];
console.log('@laya '+JSON.stringify({id:r.id,answers:{lane:{type:'choice',choice,probabilities:p}},ms:1}));});`);
    process.env.LAYA_PYTHON=require('./fake-bin.cjs').fakeBin(dir,'python',fake);
  }
  const wait=async(fn,timeout=60000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Game smoke timed out');await new Promise(r=>setTimeout(r,200));}};
  let win;
  if(jev){
    // the engine and the key live in the companion's AI settings
    const main=code=>companion.webContents.executeJavaScript(code);companion.show();
    await main(`document.querySelector('#settings-toggle').click();const e=document.querySelector('#game-engine');e.value='jev';e.dispatchEvent(new Event('change'));true`);
    await wait(()=>main(`!document.querySelector('#game-jev').hidden&&!document.querySelector('#game-jev-save').hidden`));
    await main(`document.querySelector('#game-jev-key').value='wrong-key-0123456789';document.querySelector('#game-jev-save').click();true`);
    await wait(()=>main(`[...document.querySelectorAll('#conversation .message.error')].some(m=>/金鑰無效/.test(m.textContent))`));
    await main(`document.querySelector('#game-jev-key').value=${JSON.stringify(key)};document.querySelector('#game-jev-save').click();true`);
    await wait(()=>main(`!document.querySelector('#game-jev-clear').hidden`));
    await main(`document.querySelector('#settings').scrollTop=0;true`);fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','game-settings.png'),(await companion.webContents.capturePage()).toPNG());
    await main(`document.querySelector('#open-game').click();true`);await wait(()=>Boolean(gameService.getWindow()));win=gameService.getWindow();
  }else win=gameService.open();
  await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  const js=code=>win.webContents.executeJavaScript(code);
  await wait(()=>js(`!document.querySelector('#ai').disabled`));
  await js(`document.querySelector('#ai').click();true`);
  await wait(()=>js(`window.laneDash.stats().mode==='ai'`));
  assert.equal(runtime.state.emotion,'smug','the character reacts when the run starts');
  await new Promise(r=>setTimeout(r,15000));
  const stats=await js(`window.laneDash.stats()`);
  fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','game.png'),(await win.webContents.capturePage()).toPNG());
  assert.ok(stats.decisions>(jev?100:150),`made ${stats.decisions} decisions: ${JSON.stringify(stats)}`);
  if(jev){const plays=seen.filter(s=>s.auth===`Bearer ${key}`);assert.equal(plays.at(-1).data.model,'jev-latest');assert.deepEqual(plays.at(-1).data.questions.lane.criteria,{left:null,middle:null,right:null},'choice criteria sent as a map');
    assert.ok(plays.length/15<=13,`stays under the rate limit (${(plays.length/15).toFixed(1)}/s)`);assert.equal(stats.engine,'jev');server.close();}assert.ok(stats.score>=10,`passed ${stats.score} rows: ${JSON.stringify(stats)}`);
  assert.equal(stats.crashes,0,'no crashes');
  await js(`document.querySelector('#stop').click();true`);win.close();
  console.log('GAME_SMOKE',JSON.stringify({...stats,engine:jev?'jev (stand-in API)':process.env.GAME_SMOKE_REAL?'laya':'stand-in'}));
}
module.exports={run};
