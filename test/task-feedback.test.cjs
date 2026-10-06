const test=require('node:test');const assert=require('node:assert/strict');
const {TaskFeedback}=require('../src/main/task-feedback.cjs');const {normalize}=require('../src/main/claude-hooks.cjs');
test('only opted-in owned task hooks carry final replies; external observers stay private',()=>{
  const payload={hook_event_name:'Stop',session_id:'owned',last_assistant_message:'結果：已完成。',prompt:'secret',transcript_path:'/private',background_tasks:[]};
  assert.equal(normalize(payload).result,undefined);
  const data=normalize(payload,{taskResults:true});assert.equal(data.result,'結果：已完成。');assert.equal(data.pending,false);assert.equal(data.prompt,undefined);assert.equal(data.transcript_path,undefined);
});
test('results isolate sessions, wait for background work, and ignore duplicates or late cancelled replies',()=>{
  const relay=new TaskFeedback();relay.begin('own','browser');
  assert.equal(relay.observe({event:'Stop',sessionId:'other',result:'wrong'}),null);
  assert.equal(relay.observe({event:'Stop',sessionId:'own',pending:true,result:'still running'}).type,'working');
  assert.equal(relay.observe({event:'PermissionRequest',sessionId:'own'}).type,'approval');
  const result=relay.observe({event:'Stop',sessionId:'own',result:'已找到資料。'});assert.equal(result.type,'result');assert.equal(result.text,'已找到資料。');
  assert.equal(relay.observe({event:'Stop',sessionId:'own',result:'duplicate'}),null);assert.equal(relay.closed(),null);
  relay.begin('next','computer');assert.equal(relay.cancel().type,'cancelled');assert.equal(relay.observe({event:'Stop',sessionId:'next',result:'late fake success'}),null);
});
test('API failures and missing results are distinct from successful completion',()=>{
  const relay=new TaskFeedback();relay.begin('own','computer');
  const failure=relay.observe(normalize({hook_event_name:'StopFailure',session_id:'own',error:'rate_limit',last_assistant_message:'API Error: Rate limit reached'},{taskResults:true}));assert.equal(failure.type,'error');assert.equal(failure.error,'rate_limit');
  relay.begin('next','browser');assert.equal(relay.closed().error,'session_ended_without_result');
});

test('owned assistant display batches preserve prose, join out-of-order lines and reject repeats',()=>{
  const relay=new TaskFeedback();relay.begin('own','browser');
  const display=(index,text,final=false,session='own')=>normalize({hook_event_name:'MessageDisplay',session_id:session,message_id:'message',index,delta:text,final},{taskResults:true});
  assert.equal(relay.observe(display(0,'secret',false,'foreign')),null);
  assert.equal(relay.observe(display(1,'我改用品牌＋型號去搜，順便抓尺寸。',true)),null);
  const result=relay.observe(display(0,'「日系冰箱」這關鍵字在三家都只撈到收納小物，'));
  assert.equal(result.type,'progress');assert.equal(result.messageId,'message');assert.equal(result.text,'「日系冰箱」這關鍵字在三家都只撈到收納小物，我改用品牌＋型號去搜，順便抓尺寸。');
  assert.equal(relay.observe(display(0,'duplicate')),null);
  relay.cancel();assert.equal(relay.observe(display(2,'late')),null);
  assert.equal(normalize({hook_event_name:'MessageDisplay',session_id:'own',message_id:'message',index:0,delta:'private assistant prose'}).text,undefined);
});
test('tool lifecycle events do not masquerade as avatar conversation',()=>{
  const relay=new TaskFeedback();relay.begin('own','browser');
  const event=relay.observe({event:'PreToolUse',sessionId:'own',tool:'mcp__claude-in-chrome__javascript_tool'});
  assert.equal(event.type,'working');assert.equal(event.text,undefined);
});
