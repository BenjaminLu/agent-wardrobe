// Pikachu Volleyball (gorisanson.github.io, a fan port of the 1997 game) played by the character as 1P against the built-in computer.
// The game is a third-party web page loaded at run time; no Pikachu sprites, sounds or code are in this repository.
// The page exposes no API, so before its scripts run we catch its own objects as they are constructed (each class sets a
// property no other object uses), read positions every frame, and press the same keys a person would.
const {contextBridge,ipcRenderer}=require('electron');

contextBridge.executeInMainWorld({func:()=>{
  const seen=window.__pikaAgent={players:[],ball:null,game:null};
  const catchOn=(prop,keep)=>Object.defineProperty(Object.prototype,prop,{configurable:true,set(value){
    Object.defineProperty(this,prop,{value,writable:true,configurable:true,enumerable:true});keep(this);}});
  catchOn('computerWhereToStandBy',player=>{seen.players=[...seen.players.filter(p=>p.isPlayer2!==player.isPlayer2),player];});
  catchOn('expectedLandingPointX',ball=>{seen.ball=ball;});
  catchOn('slowMotionNumOfSkippedFrames',game=>{seen.game=game;});
}});
const snapshot=()=>contextBridge.executeInMainWorld({func:()=>{
  const {players,ball,game}=window.__pikaAgent,p1=players.find(p=>p.isPlayer2===false),p2=players.find(p=>p.isPlayer2===true);
  if(!game||!ball||!p1)return null;
  return {phase:game.state?.name||'',paused:game.paused,scores:[...game.scores],gameEnded:game.gameEnded,p1:{x:p1.x,y:p1.y,state:p1.state},p2:{x:p2?.x??324},ball:{x:ball.x,y:ball.y,vx:ball.xVelocity,vy:ball.yVelocity,landing:ball.expectedLandingPointX}};
}});
const setPaused=value=>contextBridge.executeInMainWorld({func:value=>{const game=window.__pikaAgent.game;if(game)game.paused=value;},args:[value]});

const KEYS={left:'KeyD',right:'KeyG',up:'KeyR',down:'KeyV',hit:'KeyZ'},held=new Set();
const key=(code,down)=>{if(down===held.has(code))return;down?held.add(code):held.delete(code);window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}));};
const tap=(code,ms=80)=>{key(code,true);setTimeout(()=>key(code,false),ms);};
const release=()=>{for(const code of [...held])key(code,false);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const NET_X=216,HALF=32;
// Four ways to play; after three points lost in a row the character pauses and switches to the most promising one.
const STRATEGIES=[
  // A uses the built-in computer player's own numbers; the others lean toward the net or toward defence.
  {id:'A',zh:'標準打法',en:'standard',offset:0,jumpBelow:104,maxVx:5,wait:108,spike:[KEYS.right]},
  {id:'B',zh:'貼網壓迫',en:'press the net',offset:-4,jumpBelow:124,maxVx:6,wait:150,spike:[KEYS.right,KEYS.down]},
  {id:'C',zh:'後場防守',en:'deep defence',offset:-8,jumpBelow:94,maxVx:4,wait:84,spike:[KEYS.right,KEYS.up]},
  {id:'D',zh:'提早起跳',en:'jump early',offset:0,jumpBelow:134,maxVx:7,wait:120,spike:[KEYS.right]}
].map(s=>({...s,won:0,lost:0}));
let strategy=STRATEGIES[0];
const QUESTIONS={
  go:{type:'choice',instructions:'Which way should Pikachu move to meet the ball?',criteria:{left:'move to the left',here:'stay where it is',right:'move to the right'}},
  jump:{type:'choice',instructions:'Should Pikachu jump now or wait on the ground?',criteria:{jump:'jump now',wait:'wait on the ground'}}
};
// Attack: on each jump, Laya picks where to send the ball from where the other side is open.
const SPIKE_QUESTION={spike:{type:'choice',instructions:'Where should Pikachu send the ball so the other Pikachu cannot reach it?',criteria:{smash:'smash the ball down close to the net',drive:'hit the ball fast and flat to the middle',lob:'lob the ball high over to the far back'}}};
const PLAN={smash:'front',lob:'back',drive:'open'};
const SPIKE_KEYS={smash:[KEYS.right,KEYS.down],drive:[KEYS.right],lob:[KEYS.right,KEYS.up]};
// Where a spike lands for each key combination, using the game's own rule (physics.js expectedLandingPointXWhenPowerHit):
// left/right held = fast (20) or not = slow (10); up = lob, none = flat, down = smash.
function landingWhenSpiking(ball,xDir,yDir){
  const b={x:ball.x,y:ball.y,vx:(Math.abs(xDir)+1)*10,vy:Math.abs(ball.vy)*yDir*2};
  for(let i=0;i<1000;i++){
    if(b.x+b.vx<20||b.x+b.vx>432)b.vx=-b.vx;
    if(b.y+b.vy<0)b.vy=1;
    if(Math.abs(b.x-216)<25&&b.y>176&&b.vy>0)b.vy=-b.vy;
    b.y+=b.vy;if(b.y>252)return b.x;
    b.x+=b.vx;b.vy+=1;
  }
  return b.x;
}
// Drop it short when the other Pikachu is back, send it deep when it is at the net, and never at the other Pikachu.
function pickSpike(ball,p2,plan){
  const options=[];
  for(const xDir of [0,1])for(const yDir of [-1,0,1]){const x=landingWhenSpiking(ball,xDir,yDir);options.push({xDir,yDir,x});}
  const theirs=options.filter(o=>o.x>232&&o.x<425&&Math.abs(o.x-p2.x)>64);
  const pool=theirs.length?theirs:options.filter(o=>o.x>216);
  const goal=plan==='front'?250:plan==='back'?420:Math.abs(p2.x-260)>Math.abs(p2.x-400)?260:400;
  return (pool.length?pool:options).sort((a,b)=>Math.abs(a.x-goal)-Math.abs(b.x-goal))[0];
}
const openSpace=s=>s.p2.x<290?'at the far back':s.p2.x>370?'close to the net':'in the middle';
let spikePlan=null,lastShot=null,aim=null,aimUntil=0,prevDist=null,lastAction='none';
// The game is described in short sentences Laya reads reliably (checked one by one); positions and timing stay in code.
function describe(s){
  // Waiting spot: the computer spikes at least 64 px away from us. When it is at the net, stand close to our side of the net
  // so the quick short smash has no room and it must go deep, which takes longer to arrive.
  const wait=s.p2.x<290?150:Math.max(strategy.wait,128);
  const ours=s.ball.landing<NET_X,target=ours?s.ball.landing+strategy.offset:wait,d=target-s.p1.x;
  const move=ours?(Math.abs(d)<=10?'The ball will come down exactly on Pikachu, so stay.':d<0?'The ball will come down to the left of Pikachu.':'The ball will come down to the right of Pikachu.')
    :(Math.abs(d)<=10?'The ball is over the net and Pikachu is already at its waiting spot, so stay.':`The ball is over the net; Pikachu should go back to the ${d<0?'left':'right'}.`);
  const above=Math.abs(s.ball.vx)<strategy.maxVx&&Math.abs(s.ball.x-s.p1.x)<HALF&&s.ball.y>-36&&s.ball.y<strategy.jumpBelow&&s.ball.vy>0;
  return `${move} ${above?'The ball is high right above Pikachu and falling, time to jump.':'The ball is not above Pikachu yet, wait.'}`;
}

let running=false,lastScores=null,lostInRow=0,plays={jumps:0,spikes:0,ballOurSide:0,ticks:0,air:[],points:[]},airTrack=null,jumpUntil=0,stats={n:0,since:0,ms:[]},hud,note='';
function showHud(text){
  if(!hud){hud=document.createElement('div');hud.id='agent-hud';Object.assign(hud.style,{position:'fixed',left:'8px',bottom:'8px',zIndex:9999,background:'#0d1b2add',color:'#e8f1f8',font:'12px -apple-system,sans-serif',padding:'6px 10px',borderRadius:'8px',pointerEvents:'none',whiteSpace:'pre',maxWidth:'70vw'});document.body.append(hud);}
  hud.textContent=text;
}
const zh=()=>/\/zh\//.test(location.pathname);
const label=st=>`${st.id}「${zh()?st.zh:st.en}」 ${st.won}:${st.lost}`;
// Untried first, then the best record so far (with a small prior so one lucky point does not decide).
function nextStrategy(){
  const others=STRATEGIES.filter(st=>st!==strategy),untried=others.filter(st=>st.won+st.lost===0);
  return untried[0]||others.sort((a,b)=>(b.won+1)/(b.won+b.lost+2)-(a.won+1)/(a.won+a.lost+2))[0];
}
async function rethink(){
  const from=strategy;strategy=nextStrategy();release();setPaused(true);lostInRow=0;
  ipcRenderer.invoke('game:event','rethink');
  note=zh()?`連丟三分，暫停換打法：${label(from)} → ${label(strategy)}`:`Lost three in a row; switching: ${label(from)} → ${label(strategy)}`;
  showHud(note);await sleep(2500);setPaused(false);
}
function onScore(s){
  if(!lastScores){lastScores=s.scores;return;}
  if(s.scores[0]===lastScores[0]&&s.scores[1]===lastScores[1])return;
  const weScored=s.scores[0]>lastScores[0];lastScores=s.scores;plays.points.push({we:weScored,ballX:Math.round(s.ball.x),p1:Math.round(s.p1.x),p2:Math.round(s.p2.x),plan:strategy.id,lastSpike:spikePlan?.choice||null,lastShot:lastShot&&Math.round(lastShot.x)});
  if(weScored){strategy.won++;lostInRow=0;}else{strategy.lost++;lostInRow++;}
  ipcRenderer.invoke('game:event',s.gameEnded?(s.scores[0]>s.scores[1]?'win':'lose'):weScored?'point':'lost');
  if(s.gameEnded)lastScores=null;
  return !weScored&&lostInRow>=3&&!s.gameEnded;
}
async function play(){
  const {minInterval,engine}=await ipcRenderer.invoke('game:start');running=true;stats={n:0,since:performance.now(),ms:[]};
  ipcRenderer.invoke('game:event','start');
  while(running){
    const started=performance.now(),s=snapshot();
    if(!s||s.paused){await sleep(200);continue;}
    if(s.phase==='menu'||s.phase==='intro'){release();tap(KEYS.hit);await sleep(300);continue;}  // Z picks 1P against the computer
    if(onScore(s)){await rethink();continue;}
    if(s.phase!=='round'){release();await sleep(100);continue;}
    // In the air: follow the ball and spike toward the other side (a reflex, like the built-in player's).
    if(s.p1.state!==0){
      if(jumpUntil){key(KEYS.up,false);jumpUntil=0;}
      const dx=s.ball.x-s.p1.x,dy=s.ball.y-s.p1.y,dist=Math.hypot(dx,dy);
      if(!airTrack)airTrack={best:[Math.round(dx),Math.round(dy)],spiked:false,hit:false};else if(dist<Math.hypot(...airTrack.best))airTrack.best=[Math.round(dx),Math.round(dy)];
      if(s.ball.vx>=10&&Math.abs(dx)<70)airTrack.hit=true;   // the ball left fast toward the other side: a real spike
      // The power-hit pose lasts about ten frames, so start it as the ball closes in, not when it is already touching.
      if(s.p1.state===1&&!airTrack.spiked&&dist<80&&prevDist!==null&&dist<prevDist){
        airTrack.spiked=true;aim=pickSpike(s.ball,s.p2,PLAN[spikePlan?.choice]);lastShot=aim;aimUntil=performance.now()+450;
        key(KEYS.up,aim.yDir===-1);key(KEYS.down,aim.yDir===1);tap(KEYS.hit,60);plays.spikes++;lastAction='spike';
      }
      // Keep following the ball; holding left or right both count as a fast shot, so only a slow shot stops steering.
      const aiming=performance.now()<aimUntil;
      if(aiming&&aim.xDir===0){key(KEYS.left,false);key(KEYS.right,false);}
      else{const toLeft=s.ball.x+s.ball.vx*2<s.p1.x-6,toRight=s.ball.x+s.ball.vx*2>s.p1.x+6;key(KEYS.left,toLeft);key(KEYS.right,toRight||(aiming&&!toLeft));}
      if(!aiming){key(KEYS.up,false);key(KEYS.down,false);}
      prevDist=dist;await sleep(15);continue;
    }
    prevDist=null;
    if(airTrack){plays.airborne=(plays.airborne||0)+1;if(airTrack.hit)plays.spikesLanded=(plays.spikesLanded||0)+1;plays.air.push(airTrack);if(plays.air.length>40)plays.air.shift();airTrack=null;}
    // keep the jump key down until the game has seen it (Pikachu leaves the ground), at most 250 ms
    if(performance.now()>jumpUntil)key(KEYS.up,false);key(KEYS.down,false);
    // Dive (reflex, like the built-in player): a low ball landing on our side out of reach.
    if(s.ball.landing<NET_X&&s.ball.y>174&&s.ball.vy>0&&Math.abs(s.ball.x-s.p1.x)>40&&Math.abs(s.ball.x-s.p1.x)<170&&s.ball.x<NET_X){
      const toward=s.ball.x<s.p1.x?KEYS.left:KEYS.right;key(KEYS.left,toward===KEYS.left);key(KEYS.right,toward===KEYS.right);tap(KEYS.hit);lastAction='dive';plays.dives=(plays.dives||0)+1;await sleep(60);continue;
    }
    const state=describe(s);
    try{
      const result=await ipcRenderer.invoke('game:decide',state,QUESTIONS);
      if(result.skip){await sleep(result.wait||1000);continue;}
      const go=result.answers.go,jump=result.answers.jump;
      key(KEYS.left,go.choice==='left');key(KEYS.right,go.choice==='right');lastAction=go.choice==='here'?'none':go.choice;
      plays.ticks++;if(s.ball.x<NET_X)plays.ballOurSide++;
      if(jump.choice==='jump'&&performance.now()>jumpUntil){plays.jumps++;key(KEYS.up,true);jumpUntil=performance.now()+250;lastAction='jump';spikePlan=null;const open=openSpace(s);
        ipcRenderer.invoke('game:decide',`The open space on the other side is ${open}.`,SPIKE_QUESTION).then(r=>{if(!r.skip)spikePlan={choice:r.answers.spike.choice,open};}).catch(()=>{});}
      stats.n++;stats.ms.push(result.ms);if(stats.ms.length>60)stats.ms.shift();
      const rate=stats.n/((performance.now()-stats.since)/1000),median=[...stats.ms].sort((a,b)=>a-b)[stats.ms.length>>1];
      showHud(`${engine==='jev'?'Jev':'Laya'} · ${rate.toFixed(0)}/s · ${median.toFixed(0)} ms · ${zh()?'打法':'plan'} ${label(strategy)}\n${state}\n→ ${go.choice} · ${jump.choice}${spikePlan?` · ${zh()?'吊':'aim'} ${PLAN[spikePlan.choice]}（${zh()?'空檔':'open'} ${spikePlan.open}）${lastShot?` → x≈${Math.round(lastShot.x)}`:''}`:''}  ·  ${s.scores[0]} : ${s.scores[1]}${note?`\n${note}`:''}`);
    }catch(error){showHud(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));running=false;release();break;}
    await sleep(Math.max(0,minInterval-(performance.now()-started)));
  }
}
// The page shows an About box first; its 開始 button loads the game. Then the character plays on its own.
window.addEventListener('DOMContentLoaded',()=>{
  const start=document.getElementById('close-about-btn');if(start)setTimeout(()=>start.click(),800);
  play().catch(error=>showHud(String(error.message).replace(/^Error invoking remote method '[^']+': (Error: )?/,'')));
});
contextBridge.exposeInMainWorld('pikaAgentStats',{read:()=>({...snapshot(),decisions:stats.n,running,plays,lastAction,strategy:strategy.id,strategies:STRATEGIES.map(({id,won,lost})=>({id,won,lost}))})});
