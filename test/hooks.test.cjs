const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
const {configure,refreshProject,normalize,activity}=require('../src/main/claude-hooks.cjs');
test('hook install is idempotent, quotes paths, and uninstall preserves user hooks',()=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),"wardrobe 'project "));const file=path.join(project,'.claude/settings.local.json');fs.mkdirSync(path.dirname(file));const original={permissions:{allow:['Read']},hooks:{Stop:[{hooks:[{type:'command',command:'my-custom-hook'}]}]}};fs.writeFileSync(file,JSON.stringify(original));
  try{const config={project,executable:"/a path/it's node",client:'/our/hook-client.cjs',bridge:'/config with space.json'};assert.equal(configure(config).changed,true);const first=fs.readFileSync(file,'utf8');assert.equal(configure(config).changed,false);assert.equal(fs.readFileSync(file,'utf8'),first);assert.match(first,/WARDROBE_HOOK=1/);configure({...config,remove:true});assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),original);assert.equal(configure({...config,remove:true}).changed,false);}finally{fs.rmSync(project,{recursive:true,force:true});}
});
test('hooks strip private prompt, arguments and transcript fields',()=>{assert.deepEqual(normalize({hook_event_name:'PreToolUse',session_id:'s1',tool_name:'Read',prompt:'secret',tool_input:{file_path:'/private'},transcript_path:'/private/log'}),{event:'PreToolUse',sessionId:'s1',tool:'Read'});assert.equal(activity('Stop'),'idle');assert.equal(activity('PostToolUseFailure'),'working');});
test('offline observer exits successfully with no output or instructions',()=>{const result=spawnSync(process.execPath,[path.join(__dirname,'../src/main/hook-client.cjs'),'/missing-config'],{input:JSON.stringify({hook_event_name:'Stop',session_id:'s1'}),encoding:'utf8',timeout:3000});assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');});


test('startup refresh replaces old app clients while preserving unrelated settings and hooks',()=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),"refresh 'project "));
  const file=path.join(project,'.claude','settings.local.json');
  const config={project,executable:"/new path/it's node",client:"/new path/it's app/src/main/hook-client.cjs",bridge:'/bridge.json',taskResults:true};
  try{
    fs.mkdirSync(path.dirname(file));
    const unrelated={permissions:{allow:['Read']},hooks:{Stop:[{hooks:[{type:'command',command:'my-custom-hook'}]}]}};
    fs.writeFileSync(file,JSON.stringify(unrelated));
    configure({...config,client:'/old app/hook-client.cjs'});
    assert.equal(refreshProject(config).changed,true);
    const refreshed=fs.readFileSync(file,'utf8');
    assert.ok(!refreshed.includes('/old app/hook-client.cjs'));
    assert.equal(configure(config).changed,false,'refresh uses the same configuration as connect');
    assert.equal(refreshProject(config),'skipped: none');
    assert.equal(fs.readFileSync(file,'utf8'),refreshed);
    configure({...config,remove:true});
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),unrelated);
  }finally{fs.rmSync(project,{recursive:true,force:true});}
});

test('startup refresh never creates settings or hooks for an unconnected project',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'refresh-none-'));
  const config={executable:'/node',client:'/new/hook-client.cjs',bridge:'/bridge'};
  try{
    for(const project of [base,path.join(base,'missing')]){
      assert.equal(refreshProject({...config,project}),'skipped: none');
      assert.equal(fs.existsSync(path.join(project,'.claude')),false);
    }
    assert.equal(fs.existsSync(path.join(base,'missing')),false);
    const file=path.join(base,'.claude','settings.local.json');fs.mkdirSync(path.dirname(file));
    for(const text of ['{ "permissions": {"allow": ["Read"]} }\n','{ "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo user-hook"}]}]} }\n']){
      fs.writeFileSync(file,text);
      assert.equal(refreshProject({...config,project:base}),'skipped: none');
      assert.equal(fs.readFileSync(file,'utf8'),text);
    }
  }finally{fs.rmSync(base,{recursive:true,force:true});}
});

test('startup refresh leaves invalid settings and configure rejections unchanged',()=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'refresh-invalid-'));
  const file=path.join(project,'.claude','settings.local.json');
  const config={project,executable:'/node',client:'/new/hook-client.cjs',bridge:'/bridge'};
  try{
    fs.mkdirSync(path.dirname(file));
    configure({...config,client:'/old/hook-client.cjs'});
    const old=JSON.parse(fs.readFileSync(file,'utf8'));
    const rejected={...old,hooks:{...old.hooks,Stop:'invalid'}};
    for(const text of ['{broken','{"hooks":[]}', '[]', 'null', '{"hooks":false}',JSON.stringify(rejected)]){
      fs.writeFileSync(file,text);
      assert.equal(refreshProject(config),'skipped: invalid');
      assert.equal(fs.readFileSync(file,'utf8'),text);
    }
    fs.rmSync(file);fs.mkdirSync(file);
    assert.equal(refreshProject(config),'skipped: invalid','I/O errors never escape startup');
    assert.ok(fs.statSync(file).isDirectory());
  }finally{fs.rmSync(project,{recursive:true,force:true});}
});

test('startup refresh preserves the original file when configure cannot replace it',t=>{
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'refresh-write-error-'));
  const file=path.join(project,'.claude','settings.local.json');
  const config={project,executable:'/node',client:'/new/hook-client.cjs',bridge:'/bridge'};
  try{
    configure({...config,client:'/old/hook-client.cjs'});
    const before=fs.readFileSync(file,'utf8');
    t.mock.method(fs,'renameSync',()=>{throw Object.assign(new Error('write refused'),{code:'EACCES'});});
    assert.equal(refreshProject(config),'skipped: invalid');
    assert.equal(fs.readFileSync(file,'utf8'),before);
  }finally{t.mock.restoreAll();fs.rmSync(project,{recursive:true,force:true});}
});
