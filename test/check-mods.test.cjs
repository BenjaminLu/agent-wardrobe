const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawnSync}=require('node:child_process');
const script=path.join(__dirname,'..','scripts','check-mods.cjs');
const run=(root,...args)=>spawnSync(process.execPath,[script,...args],{env:{...process.env,MODS_ROOT:root},encoding:'utf8'});
test('the Mod PR check passes good Mods and names what is wrong with bad ones',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mods-'));const byte=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','byte','mod.json'),'utf8'));const good=id=>JSON.stringify({...byte,id});
  for(const id of ['good','sneaky','broken'])fs.mkdirSync(path.join(root,id));
  fs.writeFileSync(path.join(root,'good','mod.json'),good('good'));
  fs.writeFileSync(path.join(root,'sneaky','mod.json'),good('sneaky'));fs.writeFileSync(path.join(root,'sneaky','run.sh'),'echo hi');
  fs.writeFileSync(path.join(root,'broken','mod.json'),'{');
  let out=run(root,'good');assert.equal(out.status,0,out.stdout);assert.match(out.stdout,/ok {4}good/);
  out=run(root);assert.equal(out.status,1);assert.match(out.stdout,/FAIL {2}sneaky: run\.sh has a file type/);assert.match(out.stdout,/FAIL {2}broken:/);
  out=run(root,'good','sneaky');assert.equal(out.status,1);assert.doesNotMatch(out.stdout,/broken/,'only the Mods in the change are judged');
});
test('bundled Mods need an open licence and an author or source; private, prototype and fan terms are refused',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'mods-licence-'));const byte=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','byte','mod.json'),'utf8'));
  const add=(id,fields)=>{fs.mkdirSync(path.join(root,id));const mod={...byte,id,...fields};for(const [k,v] of Object.entries(fields))if(v===undefined)delete mod[k];fs.writeFileSync(path.join(root,id,'mod.json'),JSON.stringify(mod));};
  const open={'cc0':'CC0 1.0','cc-by':'CC BY 4.0, by Someone','cc-by-sa':'CC BY-SA 4.0','mit':'MIT','apache':'Apache-2.0','sourced':'MIT'};
  for(const [id,license] of Object.entries(open))add(id,{license,...(id==='sourced'?{author:undefined,source:'https://example.com/my-art'}:{})});
  const closed={'private':'Private prototype; costume skins are fan-inspired and not for public distribution','prototype':'Brand reference; prototype only','fan':'Fan art of a famous character','nodist':'CC0 but not for public distribution','nc':'CC BY-NC 4.0','gpl':'GPL-3.0','none':undefined};
  for(const [id,license] of Object.entries(closed))add(id,{license});
  add('anonymous',{license:'MIT',author:''});
  const out=run(root);assert.equal(out.status,1);
  for(const id of Object.keys(open))assert.match(out.stdout,new RegExp(`ok {4}${id} `),id);
  for(const id of [...Object.keys(closed),'anonymous'])assert.match(out.stdout,new RegExp(`FAIL {2}${id}: `),id);
  assert.match(out.stdout,/FAIL {2}private: licence .* is not an open licence/);assert.match(out.stdout,/FAIL {2}gpl: licence .* is not one of CC0/);
  assert.match(out.stdout,/FAIL {2}none: declares no licence/);assert.match(out.stdout,/FAIL {2}anonymous: names no author or source/);
  assert.equal(run(root,'mit','cc0').status,0,'only the Mods in the change are judged');
});
test('every Mod bundled in this repository passes the PR check, including the licence rules',()=>{
  const out=spawnSync(process.execPath,[script],{encoding:'utf8'});assert.equal(out.status,0,out.stdout);
  for(const id of fs.readdirSync(path.join(__dirname,'..','mods')))assert.match(out.stdout,new RegExp(`ok {4}${id} `),id);
});
