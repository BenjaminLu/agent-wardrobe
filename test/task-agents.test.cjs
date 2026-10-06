const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const {EventEmitter}=require('node:events');
const {runLocal,runCodex}=require('../src/main/task-agents.cjs');const {specs,validate}=require('../src/main/operation-tools.cjs');
test('tool input blocks unknown modes, protocol injection, invalid values and cross-mode access',()=>{
  assert.throws(()=>validate('browser_open',{url:'file:///private'},'browser'));
  assert.throws(()=>validate('browser_open',{url:'https://u:p@example.com'},'browser'));
  assert.throws(()=>validate('computer_click',{x:NaN,y:1,reason:'test'},'computer'));
  assert.throws(()=>validate('computer_click',{x:1,y:1,reason:'test'},'browser'));
  assert.throws(()=>validate('browser_read',{code:'evil'},'browser'));
  assert.equal(validate('browser_open',{url:'https://example.com'},'browser').url,'https://example.com');
});
test('LM Studio calls real host tools, includes observations, then returns its own explanation',async()=>{
  const requests=[];const server=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);requests.push(data);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:requests.length===1?{role:'assistant',content:null,tool_calls:[{id:'tool1',type:'function',function:{name:'browser_read',arguments:'{}'}}]}:{role:'assistant',content:'I read the task page and found the expected heading.'}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const calls=[];
  try{
    const result=await runLocal({settings:{base:`http://127.0.0.1:${server.address().port}/v1`,model:'local-fixture'},text:'Read the page',prompt:'You are Miso',tools:specs('browser'),signal:new AbortController().signal,execute:async(name,args)=>{calls.push({name,args});return {text:'Expected heading'};}});
    assert.equal(result.provider,'local');assert.match(result.text,/expected heading/);assert.equal(calls.length,1);
    assert.equal(requests[1].messages.find(m=>m.role==='tool').content,'Expected heading');assert.ok(requests[0].tools.length>0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('local emergency stop aborts an in-flight model request',async()=>{
  let received;const hit=new Promise(resolve=>received=resolve);const server=http.createServer((_req,_res)=>received());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const controller=new AbortController();
  try{const running=runLocal({settings:{base:`http://127.0.0.1:${server.address().port}/v1`,model:'local'},text:'test',prompt:'pet',tools:specs('browser'),signal:controller.signal,execute:()=>assert.fail('No action after abort')});await hit;controller.abort();await assert.rejects(running,/abort/i);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Codex dynamic tool loop scopes calls to the owned thread and returns the agent result',async()=>{
  const server=new EventEmitter();server.cwd='/tmp';server.child={};server.stop=()=>{};server.start=async()=>{};let options,steer;
  server.request=async(method,params)=>{
    if(method==='thread/start'){options=params;return {thread:{id:'owned'}};}
    if(method==='turn/steer'){assert.equal(params.expectedTurnId,'turn');assert.equal(params.input[0].text,'Only read');return {}; }
    if(method==='turn/start'){
      queueMicrotask(async()=>{
        server.emit('notification',{method:'turn/started',params:{threadId:'owned',turn:{id:'turn'}}});
        await steer('Only read');
        await assert.rejects(server.toolHandler({threadId:'foreign',turnId:'turn',tool:'browser_read',arguments:{}}),/Stale/);
        const reply=await server.toolHandler({threadId:'owned',turnId:'turn',tool:'browser_read',arguments:{}});assert.equal(reply.success,true);
        server.emit('notification',{method:'item/completed',params:{threadId:'owned',turnId:'turn',item:{type:'agentMessage',text:'The page says hello.'}}});
        server.emit('notification',{method:'turn/completed',params:{threadId:'owned',turn:{id:'turn',status:'completed'}}});
      });return {turn:{id:'turn'}};
    }
    return {};
  };
  const result=await runCodex({server,setSteer:value=>{steer=value;},text:'Read',prompt:'You are Byte',tools:specs('browser'),execute:async()=>({text:'hello'}),signal:new AbortController().signal});
  assert.equal(result.text,'The page says hello.');assert.ok(options.dynamicTools.length>0);assert.equal(server.toolHandler,null);assert.equal(options.approvalPolicy,'on-request');assert.equal(options.approvalsReviewer,'auto_review');assert.equal(options.sandbox,'workspace-write');
});

test('local interruption skips stale planned actions and reaches the next model request',async()=>{
  let steer,count=0;const requests=[];
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.setHeader('Content-Type','application/json');
    if(++count===1){await steer('Do not click; only read');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'I will inspect the page.',tool_calls:[{id:'stale',type:'function',function:{name:'browser_click',arguments:'{"id":1}'}}]}}]}));}
    else res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'I followed the updated instruction.'}}]}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const progress=[];
  try{const result=await runLocal({settings:{base:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture'},text:'click',prompt:'pet',tools:specs('browser'),signal:new AbortController().signal,setSteer:value=>{steer=value;},onMessage:text=>progress.push(text),execute:()=>assert.fail('Stale click must not execute')});
    assert.match(result.text,/updated/);assert.ok(requests[1].messages.some(m=>m.role==='user'&&m.content==='Do not click; only read'));assert.deepEqual(progress,['I will inspect the page.']);assert.equal(steer,null);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
