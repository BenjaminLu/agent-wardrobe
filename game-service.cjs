// Experimental: the character plays a game. Laya (an open, non-generative decision model) picks each move
// in ~20 ms from a short text description the game writes; the character reacts and comments as it plays.
const fs=require('node:fs');const path=require('node:path');const {launch,venvPython}=require('./platform.cjs');
const {BrowserWindow,shell}=require('electron');
const L=require('./locales.cjs');const {t}=L;

// What the character says on each game event: game.line.<kind>.1…n in the interface language (one picked at random).
const LINES={start:3,dodge:3,coins:3,crash:3,milestone:3,point:3,lost:3,rethink:3,win:2,lose:2};
const line=(kind,pick=Math.random())=>t(`game.line.${kind}.${1+Math.floor(pick*LINES[kind])}`);
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
        reject(L.error('game.error.layaStart',{code,log:log.trim().split('\n').slice(-2).join(' ')}));});
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
  if(!response.ok){const error=response.status===401?L.error('game.error.jevKeyInvalid'):L.error('game.error.jevStatus',{status:response.status,body:(await response.text()).slice(0,160)});error.status=response.status;throw error;}
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
    key=String(key||'').trim();if(!/^\S{16,300}$/.test(key))throw L.error('game.error.notJevKey');
    const probe=await jevDecide(key,'The left lane is empty.',{lane:{type:'choice',instructions:'Which lane is empty?',criteria:['left','right']}});
    if(!probe.skip&&!probe.answers?.lane)throw L.error('game.error.jevNoAnswer');
    getSecrets().set('typesafe',key);return engines();
  });
  handle('bula:clear-jev-key',()=>{getSecrets().clear('typesafe');return engines();});
  handle('bula:open-jev-keys',()=>shell.openExternal('https://console.typesafe.ai/keys'));
  ipcMain.handle('game:start',from(async()=>{
    engine=getSettings().gameEngine==='jev'?'jev':'laya';
    // Jev allows about 20 requests a second; the game asks at most 12.
    if(engine==='jev'){jevKey=getSecrets().get('typesafe');if(!jevKey)throw L.error('game.note.noJevKey');send('game:status',{state:'ready',device:'TypeSafe API'});return {engine,minInterval:83};}
    const bin=python();if(!bin)throw L.error('game.error.noLaya');
    sidecar||=new LayaSidecar(bin,path.join(root,'game','laya-sidecar.py'));await sidecar.start(status=>send('game:status',status));return {engine,minInterval:33};
  }));
  ipcMain.handle('game:decide',from((state,questions)=>{
    if(typeof state!=='string'||state.length>2000||!questions||typeof questions!=='object')throw new Error('Invalid observation');
    return engine==='jev'?jevDecide(jevKey,state,questions):sidecar.decide(state,questions);
  }));
  // Game events drive the character: an emotion every time, a spoken line at most every few seconds.
  ipcMain.handle('game:event',from(kind=>{
    if(!LINES[kind])return false;const runtime=getRuntime();
    // a reaction, not work: 'working' would block switching brains while a game is open
    try{runtime.activity(['crash','lose'].includes(kind)?'error':'success',EMOTION[kind]);}catch{}
    if(kind==='rethink'||Date.now()-lastLine>(kind==='crash'?2500:6000)){lastLine=Date.now();speak(line(kind));}
    return true;
  }));
  ipcMain.handle('game:close',from(()=>window.close()));
  // Pikachu Volleyball is gorisanson's fan remake, a third-party web page loaded at run time; nothing of it is bundled.
  // Pikachu is (c) Nintendo / Creatures / GAME FREAK / The Pokémon Company. The window may only navigate within that site.
  const PIKACHU_URL='https://gorisanson.github.io/pikachu-volleyball/';
  function openPikachu(){
    window=new BrowserWindow({width:880,height:700,title:t('game.windowTitlePikachu'),backgroundColor:'#000000',show:false,
      webPreferences:{preload:path.join(root,'game','pikachu-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,partition:'persist:pikachu-volleyball'}});
    const opened=window;opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    opened.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(PIKACHU_URL))event.preventDefault();});
    opened.once('ready-to-show',()=>opened.show());
    opened.on('closed',()=>{if(window===opened)window=null;jevKey=null;sidecar?.stop();sidecar=null;try{getRuntime().activity('idle');}catch{}});
    // the game page in the interface language where the site has it (it offers en, ko and zh)
    opened.loadURL(`${PIKACHU_URL}${L.language.startsWith('zh')?'zh/':'en/'}`);
    return opened;
  }
  function open(){
    if(window&&!window.isDestroyed()){window.show();window.focus();return window;}
    if(getSettings().game==='pikachu')return openPikachu();
    window=new BrowserWindow({width:520,height:880,minWidth:420,minHeight:700,title:t('game.windowTitle'),backgroundColor:'#0d1b2a',show:false,
      webPreferences:{preload:path.join(root,'game','game-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    const opened=window;opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));opened.webContents.on('will-navigate',event=>event.preventDefault());
    opened.once('ready-to-show',()=>opened.show());
    opened.on('closed',()=>{if(window===opened)window=null;jevKey=null;sidecar?.stop();sidecar=null;try{getRuntime().activity('idle');}catch{}});
    opened.loadFile(path.join(root,'game','game.html'));
    return opened;
  }
  return {open,stop:()=>{sidecar?.stop();sidecar=null;},close:()=>{if(window&&!window.isDestroyed())window.close();},getWindow:()=>window};
}
module.exports={createGame,LayaSidecar,jevDecide,LINES,line};
