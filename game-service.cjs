// Experimental: the character plays a game. Laya (an open, non-generative decision model) picks each move
// in ~20 ms from a short text description the game writes; the character reacts and comments as it plays.
const fs=require('node:fs');const path=require('node:path');const {launch,venvPython}=require('./platform.cjs');
const {BrowserWindow,shell}=require('electron');

const LINES={
  start:{zh:['看我的！','來，這局我包了。','暖身完畢，開始！'],en:["Watch this!","Alright, this run is mine.","Warmed up. Let's go!"]},
  dodge:{zh:['好險！','閃！','差一點點～'],en:['Close one!','Dodged!','Whoa, just made it!']},
  coins:{zh:['金幣收好收滿','又一枚，嘿嘿','有錢了！'],en:['Coins, coins, coins!','Another one, hehe.',"I'm rich!"]},
  crash:{zh:['痛…剛剛那個不算！','哎呀，撞到了','再來一次，這次一定行'],en:["Ouch… that one didn't count!",'Oops, hit it.','Again. This time for sure.']},
  milestone:{zh:['越來越順了','這速度你跟得上嗎？','我是不是很會玩？'],en:["I'm getting the hang of this.",'Can you keep up with this speed?','Pretty good, right?']},
  point:{zh:['得分！','看到沒，這球是我的','漂亮～'],en:['Point!','Did you see that? Mine!','Nice one~']},
  lost:{zh:['唔，被打下來了','下一球拿回來','電腦好強…'],en:['Hmm, they got that one.',"I'll get the next one.",'The computer is good…']},
  rethink:{zh:['等等，讓我想想…換個打法！','暫停一下，我調整一下策略','這樣打不行，換招！'],en:['Hold on, let me think… new plan!','Time out, adjusting my strategy.','That is not working. New tactic!']},
  win:{zh:['我贏了！','冠軍是我～'],en:['I won!','Champion~']},
  lose:{zh:['輸了…再來一場！','下次一定贏'],en:['Lost… one more game!','Next time for sure.']}
};
const EMOTION={start:'smug',dodge:'surprised',coins:'happy',crash:'nervous',milestone:'smug',point:'happy',lost:'nervous',win:'happy',lose:'sad',rethink:'nervous'};

class LayaSidecar{
  constructor(python,script){this.python=python;this.script=script;this.child=null;this.pending=new Map();this.next=1;}
  start(onStatus){
    if(this.ready)return this.ready;
    const child=launch(this.python,[this.script],{stdio:['pipe','pipe','pipe'],windowsHide:true});this.child=child;let buffer='',log='';
    this.ready=new Promise((resolve,reject)=>{
      child.stderr.on('data',data=>{log=(log+data).slice(-3000);});
      child.stdout.on('data',data=>{
        buffer+=data;let i;
        while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.startsWith('@laya '))continue;
          let message;try{message=JSON.parse(line.slice(6));}catch{continue;}
          if(message.ready){onStatus({state:'ready',device:message.device});resolve(message);continue;}
          const job=this.pending.get(message.id);if(!job)continue;this.pending.delete(message.id);message.error?job.reject(new Error(message.error)):job.resolve(message);}
      });
      child.on('error',reject);
      child.on('exit',code=>{if(this.child===child){this.child=null;this.ready=null;}for(const job of this.pending.values())job.reject(new Error('Laya stopped'));this.pending.clear();
        reject(new Error(`Laya 沒有啟動（${code}）：${log.trim().split('\n').slice(-2).join(' ')}`));});
    });
    this.ready.catch(()=>{});onStatus({state:'loading'});return this.ready;
  }
  decide(state,questions){
    if(!this.child)return Promise.reject(new Error('Laya is not running'));
    const id=this.next++;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.child.stdin.write(JSON.stringify({id,state,questions})+'\n');});
  }
  stop(){const child=this.child;this.child=null;this.ready=null;child?.kill();}
}

// Jev (TypeSafe AI's hosted System One model): the same state + typed questions over HTTPS, billed per input token.
const JEV_BASE=()=>process.env.AGENT_WARDROBE_JEV_BASE||'https://api.typesafe.ai/v1';
async function jevDecide(key,state,questions,{fetchImpl=fetch}={}){
  // Jev wants each choice's criteria as a map of option -> description; Laya also takes a plain list.
  const typed=Object.fromEntries(Object.entries(questions).map(([id,q])=>[id,Array.isArray(q.criteria)?{...q,criteria:Object.fromEntries(q.criteria.map(o=>[o,null]))}:q]));
  const started=Date.now();
  const response=await fetchImpl(`${JEV_BASE()}/systemone`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:'jev-latest',state,questions:typed})});
  if(response.status===429||response.status===529)return {skip:true,wait:1000};
  if(!response.ok){const error=new Error(response.status===401?'Jev 金鑰無效，請重新輸入。':`Jev 回應 ${response.status}：${(await response.text()).slice(0,160)}`);error.status=response.status;throw error;}
  const data=await response.json();return {answers:data.answers,ms:Date.now()-started,model:data.model};
}

function createGame({ipcMain,handle,getRuntime,getSettings,getSecrets,persist,speak,root=__dirname}){
  let window=null,sidecar=null,lastLine=0,engine='laya',jevKey=null;
  const python=()=>[process.env.LAYA_PYTHON,venvPython(path.join(root,'.laya','venv'))].find(p=>p&&fs.existsSync(p));
  const send=(channel,value)=>{if(window&&!window.isDestroyed())window.webContents.send(channel,value);};
  const from=handler=>(event,...args)=>{if(!window||event.sender!==window.webContents)throw new Error('Unknown game window');return handler(...args);};
  const engines=()=>({selected:getSettings().gameEngine||'laya',laya:{installed:Boolean(python())},jev:{hasKey:getSecrets().has('typesafe')}});
  // The engine and the Jev key are chosen in the companion's AI settings; the game window only reads them.
  ipcMain.handle('game:engines',from(engines));
  handle('bula:game-engines',engines);
  handle('bula:set-jev-key',async key=>{
    key=String(key||'').trim();if(!/^\S{16,300}$/.test(key))throw new Error('這看起來不是 Jev API key。');
    const probe=await jevDecide(key,'The left lane is empty.',{lane:{type:'choice',instructions:'Which lane is empty?',criteria:['left','right']}});
    if(!probe.skip&&!probe.answers?.lane)throw new Error('Jev 沒有回傳答案，key 沒有保存。');
    getSecrets().set('typesafe',key);return engines();
  });
  handle('bula:clear-jev-key',()=>{getSecrets().clear('typesafe');return engines();});
  handle('bula:open-jev-keys',()=>shell.openExternal('https://console.typesafe.ai/keys'));
  ipcMain.handle('game:start',from(async()=>{
    engine=getSettings().gameEngine==='jev'?'jev':'laya';
    // Jev allows about 20 requests a second; the game asks at most 12.
    if(engine==='jev'){jevKey=getSecrets().get('typesafe');if(!jevKey)throw new Error('還沒有 Jev API key：請到人物的 ⚙ 設定 → 遊戲決策模型輸入。');send('game:status',{state:'ready',device:'TypeSafe API'});return {engine,minInterval:83};}
    const bin=python();if(!bin)throw new Error('還沒安裝 Laya。請在專案資料夾執行 npm run laya:setup（約 800 MB）。');
    sidecar||=new LayaSidecar(bin,path.join(root,'game','laya-sidecar.py'));await sidecar.start(status=>send('game:status',status));return {engine,minInterval:33};
  }));
  ipcMain.handle('game:decide',from((state,questions)=>{
    if(typeof state!=='string'||state.length>2000||!questions||typeof questions!=='object')throw new Error('Invalid observation');
    return engine==='jev'?jevDecide(jevKey,state,questions):sidecar.decide(state,questions);
  }));
  // Game events drive the character: an emotion every time, a spoken line at most every few seconds.
  ipcMain.handle('game:event',from(kind=>{
    if(!LINES[kind])return false;const runtime=getRuntime(),settings=getSettings();
    // a reaction, not work: 'working' would block switching brains while a game is open
    try{runtime.activity(['crash','lose'].includes(kind)?'error':'success',EMOTION[kind]);}catch{}
    if(kind==='rethink'||Date.now()-lastLine>(kind==='crash'?2500:6000)){lastLine=Date.now();const pool=LINES[kind][settings.language.startsWith('zh')?'zh':'en'];speak(pool[Math.floor(Math.random()*pool.length)]);}
    return true;
  }));
  ipcMain.handle('game:close',from(()=>window.close()));
  // Pikachu Volleyball is gorisanson's fan remake, a third-party web page loaded at run time; nothing of it is bundled.
  // Pikachu is (c) Nintendo / Creatures / GAME FREAK / The Pokémon Company. The window may only navigate within that site.
  const PIKACHU_URL='https://gorisanson.github.io/pikachu-volleyball/';
  function openPikachu(zh){
    window=new BrowserWindow({width:880,height:700,title:zh?'角色玩皮卡丘打排球（第三方網頁遊戲 · gorisanson 同人重製版，不隨附）':'Character plays Pikachu Volleyball (third-party web game by gorisanson, not bundled)',backgroundColor:'#000000',show:false,
      webPreferences:{preload:path.join(root,'game','pikachu-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,partition:'persist:pikachu-volleyball'}});
    const opened=window;opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    opened.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(PIKACHU_URL))event.preventDefault();});
    opened.once('ready-to-show',()=>opened.show());
    opened.on('closed',()=>{if(window===opened)window=null;jevKey=null;sidecar?.stop();sidecar=null;try{getRuntime().activity('idle');}catch{}});
    opened.loadURL(`${PIKACHU_URL}${zh?'zh/':'en/'}`);
    return opened;
  }
  function open(){
    if(window&&!window.isDestroyed()){window.show();window.focus();return window;}
    const zh=getSettings().language.startsWith('zh');
    if(getSettings().game==='pikachu')return openPikachu(zh);
    window=new BrowserWindow({width:520,height:880,minWidth:420,minHeight:700,title:zh?'角色玩遊戲（實驗）':'Character plays (experimental)',backgroundColor:'#0d1b2a',show:false,
      webPreferences:{preload:path.join(root,'game','game-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    const opened=window;opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));opened.webContents.on('will-navigate',event=>event.preventDefault());
    opened.once('ready-to-show',()=>opened.show());
    opened.on('closed',()=>{if(window===opened)window=null;jevKey=null;sidecar?.stop();sidecar=null;try{getRuntime().activity('idle');}catch{}});
    opened.loadFile(path.join(root,'game','game.html'),{query:{lang:zh?'zh':'en'}});
    return opened;
  }
  return {open,stop:()=>{sidecar?.stop();sidecar=null;},close:()=>{if(window&&!window.isDestroyed())window.close();},getWindow:()=>window};
}
module.exports={createGame,LayaSidecar,jevDecide,LINES};
