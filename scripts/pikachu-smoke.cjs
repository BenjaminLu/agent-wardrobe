const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
// The character plays the real Pikachu Volleyball web page (needs the network) as 1P against its computer for 40 s.
// Decisions come from a stand-in sidecar unless GAME_SMOKE_REAL=1 uses Laya from .laya/venv.
async function run({gameService,win:companion}){
  if(!process.env.GAME_SMOKE_REAL){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pika-smoke-')),fake=path.join(dir,'fake-laya.cjs'),python=path.join(dir,'python');
    fs.writeFileSync(fake,`const rl=require('readline').createInterface({input:process.stdin});console.log('@laya '+JSON.stringify({ready:true,device:'stand-in'}));
rl.on('line',line=>{const r=JSON.parse(line),go=r.state.includes('to the left')?'left':r.state.includes('to the right')?'right':'here',near=r.state.includes('close above');
console.log('@laya '+JSON.stringify({id:r.id,answers:{go:{type:'choice',choice:go,probabilities:{left:go==='left'?.8:.1,here:go==='here'?.8:.1,right:go==='right'?.8:.1}},jump:{type:'noul',noul:near?.8:.1}},ms:1}));});`);
    fs.writeFileSync(python,`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${fake}"\n`,{mode:0o755});process.env.LAYA_PYTHON=python;
  }
  const wait=async(fn,timeout=60000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Pikachu smoke timed out');await new Promise(r=>setTimeout(r,250));}};
  await companion.webContents.executeJavaScript(`window.bula.openGame('laya','pikachu')`);
  await wait(()=>Boolean(gameService.getWindow()));const win=gameService.getWindow();
  const read=()=>win.webContents.executeJavaScript(`window.pikaAgentStats?window.pikaAgentStats.read():null`).catch(()=>null);
  try{await wait(async()=>(await read())?.phase==='round',90000);}catch(error){fs.writeFileSync(path.join(__dirname,'..','evidence','pikachu-stuck.png'),(await win.webContents.capturePage()).toPNG());console.log('PIKA_DEBUG',JSON.stringify(await read()),await win.webContents.executeJavaScript(`JSON.stringify({hooks:!!window.__pikaAgent,players:window.__pikaAgent?.players.length,ball:!!window.__pikaAgent?.ball,game:!!window.__pikaAgent?.game,state:window.__pikaAgent?.game?.state?.name,hud:document.getElementById('agent-hud')?.textContent,about:document.getElementById('about-box')?.className})`));throw error;}
  // PIKA_CAPTURE=<dir>: save the game canvas every 250 ms with the action the scripted player took, to evaluate vision models.
  const capture=process.env.PIKA_CAPTURE;let shots=0;
  if(capture){fs.mkdirSync(capture,{recursive:true});const rect=await win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#game-canvas').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`);
    (async()=>{while(!win.isDestroyed()){const s=await read();if(s?.phase==='round'){const img=(await win.webContents.capturePage(rect)).resize({width:432});fs.writeFileSync(path.join(capture,`${String(shots).padStart(4,'0')}.png`),img.toPNG());fs.appendFileSync(path.join(capture,'labels.jsonl'),JSON.stringify({i:shots,action:s.lastAction,ball:s.ball,p1:s.p1,p2:s.p2})+'\n');shots++;}await new Promise(r=>setTimeout(r,250));}})().catch(()=>{});}
  const xs=new Set();let maxScore=0,airborne=false;const until=Date.now()+(+process.env.PIKA_SECONDS||40)*1000;
  // PIKA_UNTIL_SCORE=n stops as soon as either side reaches n points (up to 10 minutes).
  const target=+process.env.PIKA_UNTIL_SCORE||0;const deadline=target?Date.now()+600000:until;
  while(Date.now()<deadline){const s=await read();if(target&&s?.scores&&Math.max(...s.scores)>=target)break;if(s?.p1){xs.add(Math.round(s.p1.x/20));if(s.p1.y<230)airborne=true;maxScore=Math.max(maxScore,s.scores[0]+s.scores[1]);}await new Promise(r=>setTimeout(r,200));}
  const s=await read();
  fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','pikachu.png'),(await win.webContents.capturePage()).toPNG());
  console.log('PIKA_RESULT',JSON.stringify({plays:s.plays,score:s.scores,strategy:s.strategy,strategies:s.strategies,decisions:s.decisions}));
  assert.ok(s.decisions>100,`made ${s.decisions} decisions`);assert.ok(xs.size>=4,'Pikachu moved around its court');assert.ok(airborne,'Pikachu jumped');assert.ok(maxScore>=1,'rallies were played to a point');
  win.close();
  console.log('PIKACHU_SMOKE',JSON.stringify({engine:process.env.GAME_SMOKE_REAL?'laya':'stand-in',decisions:s.decisions,score:s.scores,strategies:s.strategies,positionsVisited:xs.size,jumped:airborne}));
}
module.exports={run};
