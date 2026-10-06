const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');const {randomUUID}=require('node:crypto');const {OutputStore}=require('../src/main/output-store.cjs');
function fixture(fn){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wardrobe-outputs-'));try{fn(temp);}finally{fs.rmSync(temp,{recursive:true,force:true});}}
test('requested report creates an accessible task folder, never overwrites, survives restart and stops accepting writes',()=>fixture(temp=>{
  const root=path.join(temp,'Desktop','Agent Wardrobe'),plans=path.join(temp,'plans');const store=new OutputStore(root,plans),id=randomUUID();store.create(id,'冰箱比較');assert.ok(!fs.existsSync(root),'no empty Desktop folders for tasks that do not save files');
  const first=store.save(id,'冰箱比較.md','# 冰箱比較\n寬68.5公分。');const second=store.save(id,'冰箱比較.md','Second version');assert.notEqual(first.path,second.path);assert.match(first.folder,/冰箱比較/);assert.equal(fs.readFileSync(first.path,'utf8'),'# 冰箱比較\n寬68.5公分。');
  const restarted=new OutputStore(root,plans);assert.equal(restarted.folder(id),first.folder);assert.equal(restarted.artifact(id).files.length,2);restarted.close(id);assert.throws(()=>store.save(id,'late.md','late'),/ended/);
}));
test('report writing rejects path traversal, executable files, symbolic links and invalid JSON',()=>fixture(temp=>{
  const store=new OutputStore(path.join(temp,'Desktop'),path.join(temp,'plans')),id=randomUUID();const plan=store.create(id,'test');
  for(const name of ['../outside.md','/tmp/file.md','sub/file.md','.hidden.md','script.sh','index.html','a\\b.md'])assert.throws(()=>store.save(id,name,'text'));
  assert.throws(()=>store.save(id,'data.json','not JSON'));assert.throws(()=>store.save(id,'data.md','x'.repeat(150001)));
  fs.mkdirSync(plan.root);fs.symlinkSync(temp,plan.folder);assert.throws(()=>store.save(id,'data.md','text'),/symbolic/);assert.equal(store.artifact(id),null);
}));
test('Claude stdio document tool writes verified reports and exposes no arbitrary filesystem methods',()=>fixture(temp=>{
  const store=new OutputStore(path.join(temp,'Desktop'),path.join(temp,'plans')),id=randomUUID();store.create(id,'MCP report');
  const requests=[{id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},{id:2,method:'tools/list'},{id:3,method:'tools/call',params:{name:'report_save',arguments:{filename:'report.md',content:'# Test\nVerified data'}}},{id:4,method:'tools/call',params:{name:'report_save',arguments:{filename:'../escape.md',content:'bad'}}}];
  const result=spawnSync(process.execPath,[path.join(__dirname,'../src/main/report-mcp.cjs'),store.planFile(id)],{input:requests.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',timeout:5000});assert.equal(result.status,0,result.stderr);const replies=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(replies[1].result.tools[0].name,'report_save');assert.equal(replies[1].result.tools.length,1);const saved=JSON.parse(replies[2].result.content[0].text);assert.equal(fs.readFileSync(saved.path,'utf8'),'# Test\nVerified data');assert.equal(replies[3].result.isError,true);
}));

test('document requests route to file tasks while remembering old reports remains ordinary chat',()=>{
  const {wantsDocument}=require('../src/main/output-store.cjs');
  for(const text of ['請整理冰箱比較資料，存成報告和表格。','幫我製作一份冰箱比較表','冰箱資料放到桌面的資料夾','Save this data as CSV','Please organize the information'])assert.equal(wantsDocument(text),true,text);
  for(const text of ['你記得上次的冰箱報告嗎？','上次報告放在哪裡？','What does the previous report say?','你還記得我的冰箱尺寸嗎'])assert.equal(wantsDocument(text),false,text);
});

test('file catalog searches saved tasks, resolves only recorded files, and omits deleted files',()=>fixture(temp=>{
  const store=new OutputStore(path.join(temp,'Desktop'),path.join(temp,'plans')),first=randomUUID(),second=randomUUID();store.create(first,'冰箱比較');store.create(second,'旅遊清單');const saved=store.save(first,'冰箱比較.csv','型號,寬度\nfixture,68.5');store.save(second,'行程.md','# 行程');store.close(first);store.close(second);
  assert.equal(store.list('冰箱').length,1);assert.equal(store.list('CSV')[0].id,first);assert.equal(store.list('unknown').length,0);assert.equal(store.file(first,'冰箱比較.csv'),saved.path);assert.throws(()=>store.file(first,'not-recorded.md'));assert.throws(()=>store.file(first,'../outside.md'));fs.unlinkSync(saved.path);assert.equal(store.list('冰箱').length,0);assert.throws(()=>store.file(first,'冰箱比較.csv'));
}));
