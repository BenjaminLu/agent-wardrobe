const test=require('node:test');require('../src/main/locales.cjs').setLanguage('zh-Hant');  // messages are matched in the source language
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const formats=require('../src/main/model-formats.cjs');const mods=require('../src/main/mods.cjs');
const {mmdFolder,live2dFolder,pmx,vmd,png}=require('./fixtures/models/make.cjs');
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'model-formats-'));
const states={idle:'neutral',working:'smug',waiting_for_approval:'surprised',speaking:'neutral',success:'happy',error:'nervous'};
const manifest=(id,renderer,skin)=>({schemaVersion:2,id,name:'Imported',identity:'A character.',license:'Personal use',renderer,defaultSkin:'a',defaultPersona:'p',personas:[{id:'p',name:'P',prompt:'Be nice.'}],skins:[{id:'a',name:'A',states,...skin}]});

test('pmx header: model name and the texture table',()=>{
  const info=formats.pmxInfo(pmx());
  assert.equal(info.name,'テストモデル');assert.deepEqual(info.textures,['tex\\Body.PNG','tex/face.png','toon01.bmp']);
  assert.throws(()=>formats.pmxInfo(Buffer.from('nope')),/PMX/);
});
test('detect finds every Live2D and MMD model in an unpacked archive, with their motions',()=>{
  const dir=tmp();mmdFolder(dir);live2dFolder(dir);live2dFolder(dir,{name:'chara'});fs.renameSync(path.join(dir,'chara','runtime','chara.model3.json'),path.join(dir,'chara','runtime','model.model3.json'));
  fs.mkdirSync(path.join(dir,'__MACOSX'));fs.writeFileSync(path.join(dir,'__MACOSX','x.pmx'),'junk');
  const found=formats.detect(dir);
  assert.deepEqual(found.map(f=>[f.renderer,f.entry,f.title]).sort((a,b)=>a[1].localeCompare(b[1])),[['live2d','chara/runtime/model.model3.json','chara'],['live2d','hiyori/runtime/hiyori.model3.json','hiyori'],['mmd','Model/テストモデル.pmx','テストモデル']]);
  assert.deepEqual(found.find(f=>f.renderer==='mmd').motions,[{file:'Model/motion/wave.vmd',name:'wave',use:'react'},{file:'Model/motion/待機.vmd',name:'待機',use:'idle',loop:true}]);
  assert.deepEqual(found.find(f=>f.title==='hiyori').motions.map(m=>[m.file,m.name,m.use]),[['hiyori/runtime/motions/idle.motion3.json','Idle: idle','idle'],['hiyori/runtime/motions/tap.motion3.json','TapBody: tap','react']]);
});
test('detectMotions lists motion files of one kind (with a guessed use), so a VRM import can pick up .vrma/.vmd next to it',()=>{
  const dir=tmp();mmdFolder(dir);fs.writeFileSync(path.join(dir,'dance.vrma'),'x');
  assert.deepEqual(formats.detectMotions(dir,'vrm').map(m=>[m.file,m.use]),[['Model/motion/wave.vmd','react'],['Model/motion/待機.vmd','idle'],['dance.vrma','react']]);
  assert.deepEqual(formats.detectMotions(dir,'live2d'),[]);assert.deepEqual(formats.detectMotions(dir,'gltf'),[]);
});
test('install copies an MMD model, its textures (any case) and motions, and the result loads as a Mod',()=>{
  const src=tmp(),root=tmp(),dest=path.join(root,'me-test');const {entry}=mmdFolder(src);
  const result=formats.install({srcDir:src,entry,renderer:'mmd',destDir:dest});
  assert.equal(result.model,'テストモデル.pmx');
  assert.deepEqual(result.files,['Tex/Face.png','Tex/body.png','motion/wave.vmd','motion/待機.vmd','テストモデル.pmx']);
  assert.ok(!fs.existsSync(path.join(dest,'unused.png'))&&!fs.existsSync(path.join(dest,'readme.txt')),'only what the model needs');
  assert.deepEqual(result.motions,[{file:'motion/wave.vmd',name:'wave',use:'react'},{file:'motion/待機.vmd',name:'待機',use:'idle',loop:true}]);
  fs.writeFileSync(path.join(dest,'mod.json'),JSON.stringify(manifest('me-test','mmd',{model:result.model,motions:result.motions})));
  const mod=mods.loadCatalog(root,{personal:true})[0];
  assert.deepEqual(mod.assets.sort(),[...result.files].sort());assert.equal(mod.skins[0].motions.length,2);
});
test('install copies a Live2D model and everything its model3.json references',()=>{
  const src=tmp(),root=tmp(),dest=path.join(root,'me-live');const {entry}=live2dFolder(src);fs.writeFileSync(path.join(src,'hiyori','runtime','extra.png'),png(2,2,()=>[0,0,0,255]));
  const result=formats.install({srcDir:src,entry,renderer:'live2d',destDir:dest});
  assert.equal(result.model,'hiyori.model3.json');
  assert.deepEqual(result.files,['expressions/smile.exp3.json','hiyori.moc3','hiyori.model3.json','hiyori.physics3.json','motions/idle.motion3.json','motions/tap.motion3.json','textures/texture_00.png']);
  assert.deepEqual(result.motions.map(m=>[m.file,m.use]),[['motions/idle.motion3.json','idle'],['motions/tap.motion3.json','react']]);
  fs.writeFileSync(path.join(dest,'mod.json'),JSON.stringify(manifest('me-live','live2d',{model:result.model,motions:result.motions})));
  assert.equal(mods.loadCatalog(root,{personal:true})[0].assets.length,7);
});
test('a model that misses files fails with a clear Chinese error and copies nothing',()=>{
  const src=tmp(),dest=path.join(tmp(),'x');const {entry}=mmdFolder(src);fs.rmSync(path.join(src,'Model','Tex','Face.png'));
  assert.throws(()=>formats.install({srcDir:src,entry,renderer:'mmd',destDir:dest}),/模型缺少檔案：tex\/face\.png/);assert.ok(!fs.existsSync(dest));
  const l2=tmp();const live=live2dFolder(l2);fs.rmSync(path.join(l2,'hiyori','runtime','hiyori.moc3'));
  assert.throws(()=>formats.install({srcDir:l2,entry:live.entry,renderer:'live2d',destDir:dest}),/模型缺少檔案：hiyori\/runtime\/hiyori\.moc3/);
  assert.throws(()=>formats.install({srcDir:l2,entry:'../etc/passwd',renderer:'mmd',destDir:dest}),/路徑/);
  assert.throws(()=>formats.install({srcDir:l2,entry:live.entry,renderer:'vrm',destDir:dest}),/只支援/);
});
test('install never follows links out of the archive',()=>{
  const src=tmp();const {entry}=mmdFolder(src,{motions:false});fs.rmSync(path.join(src,'Model','Tex','body.png'));fs.symlinkSync('/etc/hosts',path.join(src,'Model','Tex','body.png'));
  assert.throws(()=>formats.install({srcDir:src,entry,renderer:'mmd',destDir:path.join(tmp(),'x')}),/缺少檔案/);
});
test('a Live2D reference that climbs out of the archive is refused',()=>{
  const src=tmp();const {entry}=live2dFolder(src);const file=path.join(src,entry),json=JSON.parse(fs.readFileSync(file,'utf8'));
  json.FileReferences.Textures=['../../../../etc/x.png'];fs.writeFileSync(file,JSON.stringify(json));
  assert.throws(()=>formats.install({srcDir:src,entry,renderer:'live2d',destDir:path.join(tmp(),'x')}),/缺少檔案/);
});
test('the assisted download (archive.cjs) lists these models and motions through this module',()=>{
  const archive=require('../src/main/archive.cjs');const dir=tmp();mmdFolder(dir);live2dFolder(dir);fs.writeFileSync(path.join(dir,'Model','idle_loop.vrma'),'x');
  const found=archive.findModels(dir,{formats}).filter(c=>c.available&&['mmd','live2d'].includes(c.kind));
  assert.deepEqual(found.map(c=>[c.kind,c.entry,c.motions.length]).sort(),[['live2d','hiyori/runtime/hiyori.model3.json',2],['mmd','Model/テストモデル.pmx',2]]);
  assert.deepEqual(archive.findMotions(dir,{formats}).map(m=>[m.file,m.name,m.use,m.loop]),[['Model/idle_loop.vrma','idle loop','idle',true],['Model/motion/wave.vmd','wave','react',false],['Model/motion/待機.vmd','待機','idle',true]]);
});
test('vmd fixture has the VMD signature',()=>{assert.ok(vmd().subarray(0,20).toString('latin1').startsWith('Vocaloid Motion Data'));});
