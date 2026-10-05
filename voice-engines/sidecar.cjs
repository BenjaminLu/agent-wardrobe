// A local engine process (Python sidecar) started on demand and spoken to over stdio, one JSON object per line.
//   sidecar → app:  "@voice {...}" lines (anything else on stdout/stderr is the library's own logging and is ignored)
//                   {"ready":true, ...info} once the model is loaded, or {"fatal":"message"}
//                   {"id":n, "progress":0.5}   while working
//                   {"id":n, "ok":true, ...result} or {"id":n, "ok":false, "error":"message"}
//   app → sidecar:  {"id":n, "op":"speak", ...}, {"op":"cancel","id":n}, {"op":"quit"}
// Nothing listens on a port, so no other app or web page can reach the model. The process stops after a quiet spell.
const {spawn}=require('node:child_process');

const PREFIX='@voice ';
function createSidecar({command,args=[],cwd,env={},name='voice engine',readyTimeout=10*60*1000,idleMs=10*60*1000,spawnImpl=spawn}){
  let child=null,ready=null,nextId=1,idleTimer=null,info=null,log='';
  const pending=new Map();
  const fail=(error)=>{for(const p of pending.values())p.reject(error);pending.clear();};
  function onMessage(message,resolveReady,rejectReady){
    if(message.ready){info=message;resolveReady(message);return;}
    if(message.fatal){rejectReady(new Error(`${name} 無法啟動：${message.fatal}`));return;}
    const p=pending.get(message.id);if(!p)return;
    if(message.progress!==undefined&&message.ok===undefined){p.onProgress?.(message.progress,message);return;}
    pending.delete(message.id);armIdle();
    if(message.ok)p.resolve(message);else p.reject(new Error(message.error||`${name} 失敗`));
  }
  function start(){
    if(ready)return ready;
    ready=new Promise((resolveReady,rejectReady)=>{
      const proc=spawnImpl(command,args,{cwd,env:{...process.env,PYTHONUNBUFFERED:'1',...env},stdio:['pipe','pipe','pipe']});child=proc;
      let buffer='';
      const timer=setTimeout(()=>{rejectReady(new Error(`${name} 啟動逾時。`));stop({now:true});},readyTimeout);
      const done=fn=>value=>{clearTimeout(timer);fn(value);};
      const okReady=done(resolveReady),badReady=done(error=>{rejectReady(error);});
      proc.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);
        if(!line.startsWith(PREFIX)){log=(log+line+'\n').slice(-4000);continue;}
        let message;try{message=JSON.parse(line.slice(PREFIX.length));}catch{continue;}onMessage(message,okReady,badReady);}});
      proc.stderr.on('data',chunk=>{log=(log+chunk).slice(-4000);});
      proc.stdin.on('error',()=>{});
      proc.on('error',error=>{badReady(new Error(`${name} 無法啟動：${error.message}`));});
      proc.on('exit',code=>{
        if(child===proc){child=null;ready=null;clearTimeout(idleTimer);}
        const tail=log.trim().split('\n').slice(-2).join(' ').slice(0,300);
        const error=new Error(`${name} 結束了（${code??'signal'}）${tail?`：${tail}`:''}`);
        badReady(error);fail(error);
      });
    });
    ready.catch(()=>{});
    return ready;
  }
  function armIdle(){clearTimeout(idleTimer);if(!pending.size&&idleMs)idleTimer=setTimeout(()=>stop(),idleMs);idleTimer?.unref?.();}
  async function request(op,data={},{signal,onProgress}={}){
    if(signal?.aborted)throw Object.assign(new Error('已取消。'),{name:'AbortError'});
    await start();clearTimeout(idleTimer);
    const id=nextId++;
    return new Promise((resolve,reject)=>{
      const onAbort=()=>{if(!pending.has(id))return;pending.delete(id);send({op:'cancel',id});armIdle();reject(Object.assign(new Error('已取消。'),{name:'AbortError'}));};
      pending.set(id,{resolve:v=>{signal?.removeEventListener('abort',onAbort);resolve(v);},reject:e=>{signal?.removeEventListener('abort',onAbort);reject(e);},onProgress});
      signal?.addEventListener('abort',onAbort,{once:true});
      send({...data,id,op});
    });
  }
  function send(message){try{child?.stdin.write(JSON.stringify(message)+'\n');}catch{}}
  function stop({now=false}={}){
    clearTimeout(idleTimer);const proc=child;child=null;ready=null;
    if(!proc)return;
    // ask politely (quit / end of input), then SIGTERM, then SIGKILL
    try{proc.stdin.write(JSON.stringify({op:'quit'})+'\n');proc.stdin.end();}catch{}
    const term=setTimeout(()=>{try{proc.kill('SIGTERM');}catch{}},now?0:1000),kill=setTimeout(()=>{try{proc.kill('SIGKILL');}catch{}},4000);term.unref?.();kill.unref?.();
    proc.once('exit',()=>{clearTimeout(term);clearTimeout(kill);});
    fail(Object.assign(new Error('已停止。'),{name:'AbortError'}));
  }
  return {request,start,stop,get running(){return Boolean(child);},get info(){return info;},get pid(){return child?.pid;}};
}
module.exports={createSidecar,PREFIX};
