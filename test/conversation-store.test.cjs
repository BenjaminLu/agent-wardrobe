const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {ConversationStore}=require('../conversation-store.cjs');
function fixture(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wardrobe-memory-'));try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('conversation survives process restart, shares brains, stores progress and retrieves old fridge dimensions',()=>fixture(root=>{
  const file=path.join(root,'history.json');const store=new ConversationStore(file);
  store.append('user','找冰箱，寬度不能超過70公分',{provider:'claude'});store.append('assistant','日系冰箱候選型號尺寸：寬68.5公分。',{provider:'claude',taskId:'task',id:'task:message',kind:'progress'});
  store.append('assistant','日系冰箱候選型號尺寸：寬68.5公分、深65公分。',{provider:'claude',taskId:'task',id:'task:message',kind:'progress'});
  for(let i=0;i<30;i++)store.append('user','無關話題'+i,{provider:'codex'});
  const restored=new ConversationStore(file);assert.equal(restored.snapshot().length,32);assert.ok(restored.context('上次的冰箱尺寸').some(m=>m.content.includes('深65公分')));assert.ok(restored.context('冰箱').some(m=>m.content.includes('70公分')));assert.ok(restored.context('冰箱').length<=19);if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);
  restored.finishTask('task','日系冰箱候選型號尺寸：寬68.5公分、深65公分。','claude','result');assert.equal(restored.snapshot().filter(m=>m.content.includes('深65公分')).length,1);
}));
test('legacy import is scoped to owned workspace and human text, and clear cannot resurrect old sessions',()=>fixture(root=>{
  const transcript=path.join(root,'legacy');fs.mkdirSync(transcript);const cwd='/owned/workspace';
  fs.writeFileSync(path.join(transcript,'abc-123.jsonl'),[
    {type:'user',cwd,uuid:'1',timestamp:'1',message:{content:'幫我找冰箱'}},
    {type:'assistant',cwd,uuid:'2',timestamp:'2',message:{content:[{type:'thinking',thinking:'private reasoning'},{type:'tool_use',name:'browser_read'},{type:'text',text:'冰箱尺寸是68公分。'}]}},
    {type:'user',cwd:'/other',uuid:'3',message:{content:'other private data'}},
    {type:'user',cwd,uuid:'4',message:{content:[{type:'tool_result',content:'raw tool output'}]}},
    {type:'assistant',cwd,isSidechain:true,uuid:'5',message:{content:'subagent text'}}
  ].map(JSON.stringify).join('\n'));
  const file=path.join(root,'history.json');const store=new ConversationStore(file);assert.equal(store.importLegacy(transcript,cwd),2);assert.equal(store.snapshot()[1].content,'冰箱尺寸是68公分。');assert.equal(store.importLegacy(transcript,cwd),0);
  store.clear();const restored=new ConversationStore(file);assert.equal(restored.importLegacy(transcript,cwd),0);assert.deepEqual(restored.snapshot(),[]);
}));
test('corrupt memory is preserved instead of silently overwritten',()=>fixture(root=>{const file=path.join(root,'history.json');fs.writeFileSync(file,'broken');assert.throws(()=>new ConversationStore(file),/left unchanged/);assert.equal(fs.readFileSync(file,'utf8'),'broken');}));

test('saved folder references survive restart and are passed to the model as verified context',()=>fixture(root=>{
  const file=path.join(root,'history.json');const store=new ConversationStore(file);const artifacts=[{id:'task',folder:'/Desktop/Agent Wardrobe/冰箱比較',files:['比較.md']}];
  store.finishTask('task','整理完成。','claude','result',artifacts);
  const restarted=new ConversationStore(file);assert.deepEqual(restarted.snapshot()[0].artifacts,artifacts);assert.ok(restarted.context('報告在哪')[0].content.includes('/Desktop/Agent Wardrobe/冰箱比較'));
}));
