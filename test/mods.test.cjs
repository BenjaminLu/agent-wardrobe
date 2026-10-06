const test=require('node:test');const assert=require('node:assert/strict');
const mods=require('../src/main/mods.cjs');const {Runtime}=require('../src/main/runtime.cjs');
const catalog=mods.loadCatalog();
test('distinct characters and complete skin states',()=>{assert.ok(catalog.length>=4);assert.equal(new Set(catalog.map(m=>m.model||m.id)).size,catalog.length);for(const mod of catalog)for(const skin of mod.skins)for(const state of mods.STATES)assert.ok(skin.states[state]);});
test('palette injection, executable skin fields and missing states are rejected',()=>{
  for(const mutate of [m=>m.skins[0].palette.body='url(https://example.com)',m=>m.skins[0].script='run()',m=>delete m.skins[0].states.working,m=>m.model='../evil',m=>m.skins.push(m.skins[0])]){const mod=structuredClone(catalog[0]);mutate(mod);assert.throws(()=>mods.validate(mod));}
});
test('Live2D and MMD renderers: model paths stay inside the Mod folder; motions only on model renderers',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{live2dFolder,mmdFolder}=require('./fixtures/models/make.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mods-models-'));live2dFolder(dir);mmdFolder(dir);
  const states={idle:'neutral',working:'smug',waiting_for_approval:'surprised',speaking:'neutral',success:'happy',error:'nervous'};
  const mod=(renderer,skin)=>({schemaVersion:2,id:'x',name:'X',identity:'A character.',renderer,defaultSkin:'a',defaultPersona:'p',personas:[{id:'p',name:'P',prompt:'Hi.'}],skins:[{id:'a',name:'A',states,...skin}]});
  assert.equal(mods.validate(mod('live2d',{model:'hiyori/runtime/hiyori.model3.json'}),dir).renderer,'live2d');
  assert.ok(mods.validate(mod('mmd',{model:'Model/テストモデル.pmx'}),dir).assets.includes('Model/Tex/body.png'));
  for(const model of ['../hiyori.model3.json','/etc/x.pmx','Model\\テストモデル.pmx'])assert.throws(()=>mods.validate(mod('mmd',{model}),dir),/Invalid asset path/,model);
  assert.throws(()=>mods.validate(mod('mmd',{model:'hiyori/runtime/hiyori.model3.json'}),dir),/\.pmx/);
  const annie=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','annie','mod.json'),'utf8'));annie.skins[0].motions=[];
  assert.throws(()=>mods.validate(annie,path.join(__dirname,'..','mods','annie')),/Motions need a 3D model/);
});
test('skin and character changes retain provider and in-flight activity',()=>{const r=new Runtime(catalog,{modId:'miso',skinId:'ginger',personaId:'buddy'});r.activity('working');r.select({skinId:'midnight'});assert.equal(r.state.activity,'working');assert.equal(r.state.provider,'codex');r.select({modId:'byte'});assert.equal(r.state.activity,'working');assert.equal(r.state.skinId,'mint');assert.equal(r.state.personaId,'buddy');assert.throws(()=>r.provider('local'));});
test('invalid selection is atomic and accepts partial web payload',()=>{const r=new Runtime(catalog,{modId:'miso',skinId:'ginger',personaId:'buddy'});const before=r.snapshot();assert.throws(()=>r.select({modId:'byte',skinId:'missing'}));assert.deepEqual(r.snapshot(),before);r.select({modId:undefined,skinId:'midnight',personaId:undefined});assert.equal(r.state.skinId,'midnight');});
test('personality affects next prompt while skin does not',()=>{const r=new Runtime(catalog,{modId:'miso',skinId:'ginger',personaId:'buddy'});const first=mods.prompt(catalog,r.state,'ja');r.select({skinId:'midnight'});assert.equal(mods.prompt(catalog,r.state,'ja'),first);r.select({personaId:'coach'});assert.notEqual(mods.prompt(catalog,r.state,'ja'),first);r.select({modId:'byte'});assert.match(mods.prompt(catalog,r.state,'ja'),/You are Byte/);assert.doesNotMatch(mods.prompt(catalog,r.state,'ja'),/whale|mascot/i);});
test('speech overlays activity without losing underlying state',()=>{const r=new Runtime(catalog);r.activity('working');r.speaking(true);assert.equal(r.snapshot().displayState,'speaking');r.select({modId:'byte'});r.speaking(false);assert.equal(r.snapshot().displayState,'working');});
test('companion prompt lets the model choose an operation mode',()=>{
  const text=mods.prompt(catalog,new Runtime(catalog).state,'zh-TW');
  for(const mode of ['browser','computer','files'])assert.match(text,new RegExp(`"${mode}"|${mode}\\|`));
  assert.match(text,/"action"/);
});
test('Annie ships as an SVG-parts Mod in her own lace outfit; built-in rigs only take their own accessories',()=>{
  const annie=catalog.find(m=>m.id==='annie');assert.equal(annie.renderer,'svg');
  assert.deepEqual(annie.skins.map(s=>s.accessory),['lace-collar']);
  assert.deepEqual(Object.keys(annie.parts.accessories),['lace-collar']);
  const cat=structuredClone(catalog.find(m=>m.model==='cat'));cat.skins[0].accessory='lace-collar';assert.throws(()=>mods.validate(cat),/accessory/i);
  const whale=structuredClone(cat);whale.model='whale';assert.throws(()=>mods.validate(whale),/Unsupported character model/);
});
test('Annie is the default character, and saved choices that are no longer bundled fall back without crashing',()=>{
  const {restoreSelection}=require('../src/main/runtime.cjs');
  assert.deepEqual(new Runtime(catalog).state.modId,'annie');
  const annieDefault={modId:'annie',skinId:'everyday',personaId:'buddy'};
  assert.deepEqual(restoreSelection(catalog,{modId:'bula',skinId:'ocean',personaId:'skeptic'}),annieDefault,'a removed character becomes Annie with her defaults');
  assert.deepEqual(restoreSelection(catalog,{modId:'annie',skinId:'moon-sailor',personaId:'coach'}),{...annieDefault,personaId:'coach'},'a removed skin becomes the default skin; the persona stays');
  assert.deepEqual(restoreSelection(catalog,{modId:'miso',skinId:'midnight',personaId:'gone'}),{modId:'miso',skinId:'midnight',personaId:'buddy'});
  for(const saved of [undefined,null,{},{modId:42},{modId:'__proto__'}])assert.deepEqual(restoreSelection(catalog,saved),annieDefault);
  const r=new Runtime(catalog,{modId:'bula',skinId:'cosmic',personaId:'buddy',provider:'claude'});assert.equal(r.snapshot().mod.id,'annie');assert.equal(r.state.provider,'claude');
  const noAnnie=catalog.filter(m=>m.id!=='annie');assert.equal(new Runtime(noAnnie,{modId:'bula'}).state.modId,noAnnie[0].id);
});
test('reply language: auto follows the user, a chosen language is always used',()=>{
  const state=new Runtime(catalog).state;
  assert.match(mods.prompt(catalog,state,'en-TW'),/Follow the user's current language/);
  const zh=mods.prompt(catalog,state,'en-TW','zh-Hant');assert.match(zh,/Always reply in Traditional Chinese \(Taiwan\)/);assert.ok(!/Follow the user's current language/.test(zh));
  assert.match(mods.prompt(catalog,state,'en','ja'),/Always reply in Japanese/);
  assert.equal(mods.replyLanguage('zh-Hans'),'Always reply in Simplified Chinese, whatever language the user writes in.');
  assert.equal(mods.replyLanguage('xx'),null);
});
