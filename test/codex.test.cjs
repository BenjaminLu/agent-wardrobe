const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {PassThrough,Writable}=require('node:stream');const {CodexServer}=require('../src/main/codex-server.cjs');
function fixture(fail=false){
  const calls=[];let child;
  const launch=()=>{child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.killed=true;};
    const emit=value=>{const line=JSON.stringify(value)+'\n';child.stdout.write(line.slice(0,7));child.stdout.write(line.slice(7));};
    child.stdin=new Writable({write(chunk,_encoding,done){const req=JSON.parse(chunk.toString());calls.push(req);done();queueMicrotask(()=>{
      if(req.method==='initialize')emit({id:req.id,result:{}});
      if(req.method==='thread/start')emit({id:req.id,result:{thread:{id:'own-thread'}}});
      if(req.method==='turn/start'){
        emit({method:'turn/completed',params:{threadId:'other-thread',turn:{id:'other',status:'failed'}}});
        emit({method:'turn/started',params:{threadId:'own-thread',turn:{id:'own-turn'}}});
        emit({id:req.id,result:{turn:{id:'own-turn'}}});
        emit({method:'item/completed',params:{threadId:'other-thread',turnId:'other',item:{type:'agentMessage',text:'wrong reply'}}});
        emit({method:'item/completed',params:{threadId:'own-thread',turnId:'own-turn',item:{type:'agentMessage',text:'{"text":"right reply","emotion":"happy"}'}}});
        emit({method:'turn/completed',params:{threadId:'own-thread',turn:{id:'own-turn',status:fail?'failed':'completed',error:fail?{message:'test failure'}:null}}});
      }
      if(req.method==='thread/unsubscribe')emit({id:req.id,result:{}});
    });}});return child;};
  return {server:new CodexServer({launch,findBinary:()=>'/fake/codex'}),calls};
}
test('App Server handles chunked JSON, isolates threads, and emits actual turn status',async()=>{const {server,calls}=fixture();const events=[];try{const reply=await server.chat([{role:'user',content:'hello'}],'You are Miso',e=>events.push(e.kind));assert.equal(reply.text,'right reply');assert.deepEqual(events,['working','success']);assert.equal(calls.find(c=>c.method==='thread/start').params.sandbox,'read-only');assert.equal(calls[0].method,'initialize');}finally{server.stop();}});
test('failed Codex turns reject rather than displaying a completed answer',async()=>{const {server}=fixture(true);try{await assert.rejects(server.chat([{role:'user',content:'hello'}],'persona'),/test failure/);}finally{server.stop();}});
