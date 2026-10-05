// Lane Dash: a three-lane runner. In AI mode the game describes the next row in one sentence per lane,
// Laya answers "which lane is empty?" with probabilities, and the runner stays or steers one lane.
const $=id=>document.getElementById(id);
const zh=new URLSearchParams(location.search).get('lang')!=='en';
const T=zh?{}:{score:'Score',best:'Best',coins:'Coins',crashes:'Crashes',ai:'▶ Let it play',me:'⌨ I play',stop:'■ Stop'};
for(const el of document.querySelectorAll('[data-t]'))if(T[el.dataset.t])el.textContent=T[el.dataset.t];
let engineInfo={selected:'laya'};const ENGINE=()=>engineInfo.selected==='jev'?'Jev':'Laya';
const say={loading:()=>zh?`${ENGINE()} 載入中…`:`Loading ${ENGINE()}…`,ready:device=>zh?`${ENGINE()} 就緒 · ${device}`:`${ENGINE()} ready · ${device}`,keys:zh?'用 ← → 換車道':'Use ← → to change lanes',stay:(lane,p)=>zh?`留在${NAMES[lane]}：P(空)=${p}`:`stay ${LANES[lane]}: P(empty)=${p}`,move:(lane,p,to)=>zh?`${NAMES[lane]} P(空)=${p}，往${NAMES[to]}`:`${LANES[lane]} P(empty)=${p}, steer to ${LANES[to]}`};
const LANES=['left','middle','right'],NAMES=['左道','中道','右道'],QUESTIONS={lane:{type:'choice',instructions:'Which lane is empty?',criteria:LANES}};
const STAY=0.25;
const canvas=$('road'),ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,PLAYER_Y=H-70,LANE_W=W/3;
let minInterval=33,mode=null,rows=[],lane=1,x=LANE_W*1.5,speed=0,score=0,best=0,coins=0,crashes=0,pausedUntil=0,last=0,shake=0,nextGap=0,decisions=[],stats={n:0,since:performance.now()};

function reset(){rows=[];lane=1;x=LANE_W*1.5;speed=260;score=0;coins=0;nextGap=300;hud();}
function spawn(){
  const blocked=[false,false,false],count=Math.random()<.35?2:1;
  while(blocked.filter(Boolean).length<count)blocked[Math.floor(Math.random()*3)]=true;
  const free=[0,1,2].filter(i=>!blocked[i]);rows.push({d:H,blocked,coin:Math.random()<.55?free[Math.floor(Math.random()*free.length)]:-1});
}
function hud(){$('score').textContent=score;$('best').textContent=best;$('coins').textContent=coins;$('crashes').textContent=crashes;}
function crash(){crashes++;shake=12;pausedUntil=performance.now()+900;rows=rows.filter(r=>r.d>320);speed=Math.max(260,speed*.8);hud();window.game.event('crash');}

function step(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(mode&&now>pausedUntil){
    speed=Math.min(640,speed+5*dt);nextGap-=speed*dt;if(nextGap<=0){spawn();nextGap=240+Math.random()*130;}
    for(const row of rows){const before=row.d;row.d-=speed*dt;
      if(before>0&&row.d<=0){const at=Math.round(x/LANE_W-.5);if(row.blocked[at]){crash();break;}
        score++;if(score>best)best=score;if(row.coin===at){coins++;if(coins%5===0)window.game.event('coins');}if(score%25===0)window.game.event('milestone');hud();}}
    rows=rows.filter(r=>r.d>-60);
  }
  x+=(LANE_W*(lane+.5)-x)*Math.min(1,dt*14);
  draw(now);requestAnimationFrame(step);
}
function draw(now){
  ctx.save();if(shake>0){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=.85;if(shake<.5)shake=0;}
  ctx.fillStyle='#10243a';ctx.fillRect(-20,-20,W+40,H+40);
  ctx.strokeStyle='#2c4d6b';ctx.lineWidth=3;ctx.setLineDash([22,18]);ctx.lineDashOffset=-(now/1000*speed)%40;
  for(const i of [1,2]){ctx.beginPath();ctx.moveTo(LANE_W*i,0);ctx.lineTo(LANE_W*i,H);ctx.stroke();}ctx.setLineDash([]);
  for(const row of rows){const y=PLAYER_Y-row.d;if(y<-40||y>H+40)continue;
    row.blocked.forEach((b,i)=>{if(!b)return;const bx=LANE_W*i+12,bw=LANE_W-24;ctx.fillStyle='#e8573f';ctx.fillRect(bx,y-16,bw,32);ctx.fillStyle='#ffd166';for(let s=0;s<bw;s+=24)ctx.fillRect(bx+s,y-16,12,32);});
    if(row.coin>=0){ctx.fillStyle='#ffd166';ctx.beginPath();ctx.arc(LANE_W*(row.coin+.5),y,11,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e0a800';ctx.fillRect(LANE_W*(row.coin+.5)-2,y-6,4,12);}}
  // the runner: a little blue blob
  ctx.fillStyle='#3d8be8';ctx.beginPath();ctx.ellipse(x,PLAYER_Y,24,28,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#eaf6ff';ctx.beginPath();ctx.ellipse(x,PLAYER_Y+10,15,13,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#10243a';ctx.beginPath();ctx.arc(x-8,PLAYER_Y-8,3.5,0,Math.PI*2);ctx.arc(x+8,PLAYER_Y-8,3.5,0,Math.PI*2);ctx.fill();
  if(!mode){ctx.fillStyle='#0d1b2acc';ctx.fillRect(0,H/2-30,W,60);ctx.fillStyle='#e8f1f8';ctx.font='bold 18px -apple-system';ctx.textAlign='center';ctx.fillText(zh?'按「讓角色玩」開始':'Press “Let it play”',W/2,H/2+6);}
  ctx.restore();
}

function showBrain(probabilities,choice){
  $('bars').replaceChildren(...LANES.map((name,i)=>{const p=probabilities[name]||0,bar=document.createElement('div');bar.className='bar'+(name===choice?' pick':'');
    const fill=document.createElement('i');fill.style.width=`${Math.round(p*100)}%`;const label=document.createElement('span');const a=document.createElement('b');a.textContent=zh?NAMES[i]:name;const b=document.createElement('em');b.textContent=p.toFixed(2);label.append(a,b);bar.append(fill,label);return bar;}));
}
// The next row ahead, one sentence per lane, exactly as Laya's own lane-runner demo phrases it.
function observe(){const row=rows.filter(r=>r.d>0).sort((a,b)=>a.d-b.d)[0];if(!row)return null;return {row,state:LANES.map((name,i)=>`The ${name} lane is ${row.blocked[i]?'blocked by a barrier':'empty'}.`).join(' ')};}
async function think(){
  while(mode==='ai'){
    const started=performance.now(),obs=observe();
    if(obs){
      try{
        const result=await window.game.decide(obs.state,QUESTIONS);if(mode!=='ai')break;
        if(result.skip){await new Promise(r=>setTimeout(r,result.wait||1000));continue;}
        const answer=result.answers.lane,p=answer.probabilities[LANES[lane]]||0;showBrain(answer.probabilities,answer.choice);
        if(p>=STAY)$('why').textContent=say.stay(lane,p.toFixed(2));
        else{const to=LANES.indexOf(answer.choice),d=Math.sign(to-lane);if(d){lane+=d;if(obs.row.d<140)window.game.event('dodge');}$('why').textContent=say.move(lane-d,p.toFixed(2),to);}
        decisions.push(result.ms);if(decisions.length>60)decisions.shift();stats.n++;
        const now=performance.now(),rate=stats.n/((now-stats.since)/1000),median=[...decisions].sort((a,b)=>a-b)[decisions.length>>1];
        $('rate').textContent=`${rate.toFixed(0)}/s · ${median.toFixed(0)} ms`;
      }catch(error){$('note').textContent=error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');stop();break;}
    }
    await new Promise(r=>setTimeout(r,Math.max(0,minInterval-(performance.now()-started))));
  }
}
async function start(next){
  $('note').textContent='';
  if(next==='ai'){$('laya-status').textContent=say.loading();$('ai').disabled=true;try{({minInterval}=await window.game.start());}catch(error){$('note').textContent=error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');$('ai').disabled=false;$('laya-status').textContent='';return;}}
  reset();mode=next;stats={n:0,since:performance.now()};decisions=[];$('ai').disabled=$('me').disabled=true;$('stop').disabled=false;
  if(next==='me')$('why').textContent=say.keys;else{window.game.event('start');think();}
}
function stop(){mode=null;$('ai').disabled=$('me').disabled=false;$('stop').disabled=true;showEngine();}
window.game.onStatus(status=>{$('laya-status').textContent=status.state==='ready'?say.ready(status.device):say.loading();});
// The engine is picked in the companion's AI settings; this window shows it and whether it is ready.
const cleanError=error=>error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
async function showEngine(){
  engineInfo=await window.game.engines();const jev=engineInfo.selected==='jev';
  $('engine-name').textContent=jev?(zh?'決策模型：Jev（TypeSafe API・按用量付費）':'Decision model: Jev (TypeSafe API, pay per use)'):(zh?'決策模型：Laya（本機・免費）':'Decision model: Laya (local, free)');
  $('engine-hint').textContent=zh?'在人物 ⚙ 設定切換':'Change it in the companion ⚙ settings';$('brain-label').textContent=zh?`${ENGINE()} 的判斷`:`${ENGINE()}'s call`;
  const missing=jev?!engineInfo.jev.hasKey:!engineInfo.laya.installed;if(!mode)$('ai').disabled=missing;
  $('note').textContent=missing?(jev?(zh?'還沒有 Jev API key：請到人物的 ⚙ 設定 → 遊戲決策模型輸入。':'No Jev API key yet: add it in the companion ⚙ settings → Game decision model.'):(zh?'Laya 還沒安裝：在專案資料夾執行 npm run laya:setup':'Laya is not installed: run npm run laya:setup in the project folder')):'';
}
addEventListener('focus',()=>{if(!mode)showEngine();});
$('ai').onclick=()=>start('ai');$('me').onclick=()=>start('me');$('stop').onclick=stop;
addEventListener('keydown',event=>{if(mode!=='me')return;if(event.key==='ArrowLeft')lane=Math.max(0,lane-1);if(event.key==='ArrowRight')lane=Math.min(2,lane+1);});
// test hook: the smoke test reads the scoreboard
window.laneDash={stats:()=>({engine:engineInfo.selected,mode,score,best,coins,crashes,decisions:stats.n,medianMs:decisions.length?[...decisions].sort((a,b)=>a-b)[decisions.length>>1]:null})};
showBrain({},null);showEngine();requestAnimationFrame(t=>{last=t;step(t);});
