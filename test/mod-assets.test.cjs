const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {sanitizeSvg,checkPng,checkVrm,checkGltf,assetName}=require('../mod-assets.cjs');
const mods=require('../mods.cjs');

test('svg parts keep shapes, classes and palette variables',()=>{
  const ok='<g class="eyes"><ellipse cx="1" cy="2" rx="3" ry="4" fill="var(--ink)" stroke-width="2"/><g class="pupils"><circle cx="1" cy="1" r="2" fill="#3b2420"/></g></g><path d="M1 2 L3 4Z" fill="url(#body-gradient)" transform="rotate(12 1 2)"/>';
  assert.equal(sanitizeSvg(ok),ok);
});
test('svg parts reject scripts, links, handlers, foreign urls, styles and unknown classes',()=>{
  for(const bad of ['<script>alert(1)</script>','<a href="https://x"><path d="M1 1"/></a>','<path d="M1 1" onclick="x()"/>','<path d="M1 1" fill="url(https://evil/x.svg)"/>','<image href="x.png"/>','<path d="M1 1" style="fill:red"/>','<g class="totally-new"></g>','<path d="M1 1" fill="javascript:x"/>','<foreignObject></foreignObject>','<path d="M1 1"><set attributeName="d"/></path>','<!-- x --><path d="M1 1"/>','<path d="M1 1" fill="var(--secret)"/>','<path d="M1 &#x3c; 1"/>'])
    assert.throws(()=>sanitizeSvg(bad),undefined,bad);
});
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'mod-assets-'));
const png=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(32)]);
const glb=(json)=>{const j=Buffer.from(JSON.stringify(json));const pad=Buffer.alloc((4-j.length%4)%4,0x20);const chunk=Buffer.concat([j,pad]);const head=Buffer.alloc(20);head.write('glTF',0);head.writeUInt32LE(2,4);head.writeUInt32LE(20+chunk.length,8);head.writeUInt32LE(chunk.length,12);head.write('JSON',16);return Buffer.concat([head,chunk]);};
const vrmMeta={name:'x',authors:['a'],licenseUrl:'https://vrm.dev/licenses/1.0/',allowRedistribution:true,avatarPermission:'everyone'};
test('asset names stay inside the mod folder and use known types',()=>{
  for(const ok of ['body.png','eyes-open.webp','model.vrm'])assert.equal(assetName(ok),ok);
  for(const bad of ['../x.png','a/b.png','.hidden.png','x.svg','x.png.exe','X'.repeat(90)+'.png'])assert.throws(()=>assetName(bad),undefined,bad);
});
test('png assets must be real PNG files without symlinks',()=>{
  const dir=tmp();fs.writeFileSync(path.join(dir,'ok.png'),png);fs.writeFileSync(path.join(dir,'fake.png'),'<svg/>');fs.symlinkSync('/etc/hosts',path.join(dir,'link.png'));
  assert.equal(checkPng(dir,'ok.png'),'ok.png');assert.throws(()=>checkPng(dir,'fake.png'));assert.throws(()=>checkPng(dir,'link.png'));assert.throws(()=>checkPng(dir,'missing.png'));
});
test('vrm models must be self-contained and allow redistribution',()=>{
  const dir=tmp();const write=(name,json)=>fs.writeFileSync(path.join(dir,name),glb(json));
  write('ok.vrm',{asset:{version:'2.0'},extensions:{VRMC_vrm:{meta:vrmMeta}}});
  write('external.vrm',{asset:{version:'2.0'},buffers:[{uri:'https://evil/x.bin'}],extensions:{VRMC_vrm:{meta:vrmMeta}}});
  write('private.vrm',{asset:{version:'2.0'},extensions:{VRMC_vrm:{meta:{...vrmMeta,allowRedistribution:false}}}});
  write('plain.glb.vrm',{asset:{version:'2.0'}});
  write('vrm0.vrm',{asset:{version:'2.0'},extensions:{VRM:{meta:{title:'x',author:'a',licenseName:'CC0'}}}});
  assert.deepEqual(checkVrm(dir,'ok.vrm').license,{name:'x',authors:['a'],url:'https://vrm.dev/licenses/1.0/',redistribution:true});
  assert.equal(checkVrm(dir,'vrm0.vrm').license.url,'CC0');
  for(const bad of ['external.vrm','private.vrm','plain.glb.vrm'])assert.throws(()=>checkVrm(dir,bad),undefined,bad);
});
test('your own private copies may keep models that forbid redistribution; plain glTF models must still be self-contained',()=>{
  const dir=tmp();const write=(name,json)=>fs.writeFileSync(path.join(dir,name),glb(json));
  write('private.vrm',{asset:{version:'2.0'},extensions:{VRMC_vrm:{meta:{...vrmMeta,allowRedistribution:false}}}});
  write('external.vrm',{asset:{version:'2.0'},buffers:[{uri:'https://evil/x.bin'}],extensions:{VRMC_vrm:{meta:vrmMeta}}});
  write('statue.glb',{asset:{version:'2.0'}});write('external.glb',{asset:{version:'2.0'},images:[{uri:'file:///etc/passwd'}]});
  assert.equal(checkVrm(dir,'private.vrm',{personal:true}).license.redistribution,false);
  assert.throws(()=>checkVrm(dir,'external.vrm',{personal:true}),/external/);
  assert.equal(checkGltf(dir,'statue.glb').name,'statue.glb');assert.throws(()=>checkGltf(dir,'external.glb'),/external/);assert.throws(()=>checkGltf(dir,'private.vrm'),/\.glb/);
  const mod={schemaVersion:2,id:'statue',name:'Statue',identity:'A statue.',license:'CC BY',renderer:'gltf',defaultSkin:'a',defaultPersona:'p',personas:[{id:'p',name:'P',prompt:'Be nice.'}],
    skins:[{id:'a',name:'A',model:'statue.glb',states:{idle:'neutral',working:'smug',waiting_for_approval:'surprised',speaking:'neutral',success:'happy',error:'nervous'}}]};
  assert.deepEqual(mods.validate(mod,dir).assets,['statue.glb']);
  assert.throws(()=>mods.validate({...mod,renderer:'vrm',skins:[{...mod.skins[0],model:'private.vrm'}]},dir),/redistribution/);
  assert.equal(mods.validate({...mod,renderer:'vrm',skins:[{...mod.skins[0],model:'private.vrm'}]},dir,{personal:true}).renderer,'vrm');
});
const base={schemaVersion:2,id:'demo',name:'Demo',identity:'A demo.',license:'CC0',defaultSkin:'a',defaultPersona:'p',personas:[{id:'p',name:'P',prompt:'Be nice.'}]};
const states={idle:'neutral',working:'smug',waiting_for_approval:'surprised',speaking:'neutral',success:'happy',error:'nervous'};
const palette={body:'#ffffff',bodyLight:'#ffffff',belly:'#ffffff',accent:'#000000',ink:'#000000',cheek:'#ff0000'};
test('v2 mods load svg, png and vrm renderers from their own folder',()=>{
  const root=tmp();const put=(id,manifest,files)=>{fs.mkdirSync(path.join(root,id));fs.writeFileSync(path.join(root,id,'mod.json'),JSON.stringify({...base,id,...manifest}));for(const [n,c] of Object.entries(files))fs.writeFileSync(path.join(root,id,n),c);};
  put('vec',{renderer:'svg',skins:[{id:'a',name:'A',palette,accessory:'coat',states}]},{'parts.json':JSON.stringify({rig:'<path d="M1 1"/>',face:'<g class="eyes"></g>',accessories:{coat:{svg:'<path d="M2 2"/>',hide:['legs'],fills:{hands:'#ffffff'}}},mouth:[170,180]})});
  const parts={frame:[340,300],eyes:{open:{src:'eyes.png',x:1,y:2,w:3,h:4},closed:{src:'eyes.png',x:1,y:2,w:3,h:4}},mouth:{smile:{src:'eyes.png',x:1,y:2,w:3,h:4}}};
  put('pix',{renderer:'png',parts:'parts.json',skins:[{id:'a',name:'A',image:'body.png',states}]},{'parts.json':JSON.stringify(parts),'body.png':png,'eyes.png':png});
  put('poly',{renderer:'vrm',skins:[{id:'a',name:'A',model:'m.vrm',states}]},{'m.vrm':glb({asset:{version:'2.0'},extensions:{VRMC_vrm:{meta:vrmMeta}}})});
  const catalog=mods.loadCatalog(root);
  const by=Object.fromEntries(catalog.map(m=>[m.id,m]));
  assert.equal(by.vec.renderer,'svg');assert.match(by.vec.parts.accessories.coat.svg,/M2 2/);
  assert.deepEqual(by.pix.assets.sort(),['body.png','eyes.png']);assert.equal(by.pix.skins[0].image,'body.png');
  assert.equal(by.poly.skins[0].model,'m.vrm');assert.equal(by.poly.license.models['m.vrm'].redistribution,true);
});
test('v2 mods reject missing assets, unsafe svg and accessories the parts do not define',()=>{
  const root=tmp();fs.mkdirSync(path.join(root,'bad'));const write=(manifest,files={})=>{fs.writeFileSync(path.join(root,'bad','mod.json'),JSON.stringify({...base,id:'bad',...manifest}));for(const [n,c] of Object.entries(files))fs.writeFileSync(path.join(root,'bad',n),c);};
  write({renderer:'png',parts:'parts.json',skins:[{id:'a',name:'A',image:'missing.png',states}]},{'parts.json':JSON.stringify({eyes:{open:{src:'missing.png',x:0,y:0,w:1,h:1}}})});assert.throws(()=>mods.loadCatalog(root));
  write({renderer:'svg',skins:[{id:'a',name:'A',palette,accessory:'coat',states}]},{'parts.json':JSON.stringify({rig:'<script>x</script>',face:'',accessories:{coat:{svg:''}}})});assert.throws(()=>mods.loadCatalog(root));
  write({renderer:'svg',skins:[{id:'a',name:'A',palette,accessory:'cape',states}]},{'parts.json':JSON.stringify({rig:'<path d="M1 1"/>',face:'',accessories:{coat:{svg:''}}})});assert.throws(()=>mods.loadCatalog(root),/accessory/i);
  write({renderer:'vrm',skins:[{id:'a',name:'A',model:'../x.vrm',states}]});assert.throws(()=>mods.loadCatalog(root));
  write({renderer:'flash',skins:[{id:'a',name:'A',states}]});assert.throws(()=>mods.loadCatalog(root),/renderer/i);
});
test('bundled catalog: built-in rigs plus svg, png and vrm mods',()=>{
  const catalog=mods.loadCatalog();
  assert.deepEqual([...new Set(catalog.map(m=>m.renderer||'builtin'))].sort(),['builtin','png','svg','vrm']);
});
test('a broken Mod is skipped and reported instead of stopping the app',()=>{
  const root=tmp();const good=JSON.parse(fs.readFileSync(path.join(__dirname,'..','mods','byte','mod.json'),'utf8'));
  for(const id of ['alpha','beta']){fs.mkdirSync(path.join(root,id));fs.writeFileSync(path.join(root,id,'mod.json'),JSON.stringify({...good,id}));}
  fs.mkdirSync(path.join(root,'broken'));fs.writeFileSync(path.join(root,'broken','mod.json'),'{ not json');
  fs.mkdirSync(path.join(root,'evil'));fs.writeFileSync(path.join(root,'evil','mod.json'),JSON.stringify({...good,id:'evil',renderer:'svg',schemaVersion:2}));
  const errors=[];const catalog=mods.loadCatalog(root,{onError:(id,error)=>errors.push([id,error.message])});
  assert.deepEqual(catalog.map(m=>m.id).sort(),['alpha','beta']);
  assert.deepEqual(errors.map(e=>e[0]).sort(),['broken','evil']);assert.ok(errors.every(e=>e[1]));
  const empty=tmp();fs.mkdirSync(path.join(empty,'broken'));fs.writeFileSync(path.join(empty,'broken','mod.json'),'{');
  assert.throws(()=>mods.loadCatalog(empty,{onError:()=>{}}),/No Mods available/);
});
// --- Live2D and MMD folders and motion files
const {assetPath,checkModel,checkMotions}=require('../mod-assets.cjs');
const {mmdFolder,live2dFolder,vmd,motion3}=require('./fixtures/models/make.cjs');
test('model asset paths are relative, inside the folder and of known types',()=>{
  for(const ok of ['tex/Body.PNG','テクスチャ/髪.png','motions/idle.motion3.json','model.pmx','a/b/c.moc3','dance.vrma','readme.txt'])assert.equal(assetPath(ok),ok);
  for(const bad of ['../x.png','/abs.png','a/../b.png','a\\b.png','C:/x.png','.hidden/x.png','x.exe','a//b.png','x.png/','tex/.png',`${'a'.repeat(130)}/x.png`,''])assert.throws(()=>assetPath(bad),undefined,bad);
});
test('a model folder may not contain links, unknown file types or too much data',()=>{
  const ok=tmp();mmdFolder(ok);assert.ok(checkModel(ok,'Model/テストモデル.pmx','mmd').files.includes('Model/Tex/Face.png'));
  const link=tmp();mmdFolder(link);fs.symlinkSync('/etc',path.join(link,'Model','etc'));assert.throws(()=>checkModel(link,'Model/テストモデル.pmx','mmd'),/link/);
  const exe=tmp();mmdFolder(exe);fs.writeFileSync(path.join(exe,'Model','run.exe'),'MZ');assert.throws(()=>checkModel(exe,'Model/テストモデル.pmx','mmd'),/Invalid asset path/);
  const big=tmp();mmdFolder(big);fs.writeFileSync(path.join(big,'Model','huge.png'),'');fs.truncateSync(path.join(big,'Model','huge.png'),61*1024*1024);
  assert.throws(()=>checkModel(big,'Model/テストモデル.pmx','mmd'),/larger than 60 MB/);assert.equal(checkModel(big,'Model/テストモデル.pmx','mmd',{personal:true}).name,'Model/テストモデル.pmx');
  fs.truncateSync(path.join(big,'Model','huge.png'),151*1024*1024);assert.throws(()=>checkModel(big,'Model/テストモデル.pmx','mmd',{personal:true}),/larger than 150 MB/);
  const fake=tmp();mmdFolder(fake);fs.writeFileSync(path.join(fake,'Model','テストモデル.pmx'),'PMD!');assert.throws(()=>checkModel(fake,'Model/テストモデル.pmx','mmd'),/not a PMX/);
  assert.throws(()=>checkModel(ok,'Model/テストモデル.pmx','live2d'),/model3\.json/);assert.throws(()=>checkModel(ok,'Model/missing.pmx','mmd'),/Missing model/);
});
test('a Live2D model must reference only files inside its folder, and a real moc3',()=>{
  const dir=tmp();const {entry}=live2dFolder(dir);assert.equal(checkModel(dir,entry,'live2d').files.length,8);
  const file=path.join(dir,entry),json=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const textures of [['../../../secret.png'],['/etc/x.png'],['https://evil.example/x.png'],['textures/missing.png']]){fs.writeFileSync(file,JSON.stringify({...json,FileReferences:{...json.FileReferences,Textures:textures}}));assert.throws(()=>checkModel(dir,entry,'live2d'),/missing or outside/,textures[0]);}
  fs.writeFileSync(file,JSON.stringify(json));fs.writeFileSync(path.join(dir,'hiyori','runtime','hiyori.moc3'),'nope');assert.throws(()=>checkModel(dir,entry,'live2d'),/moc3/);
});
test('motions must be files of the renderer\'s own kind',()=>{
  const dir=tmp();fs.mkdirSync(path.join(dir,'motions'));fs.writeFileSync(path.join(dir,'motions','idle.vmd'),vmd());fs.writeFileSync(path.join(dir,'motions','idle.motion3.json'),motion3('ParamAngleX',[0,1]));fs.writeFileSync(path.join(dir,'fake.vmd'),'nope');
  const vrma=json=>glb({asset:{version:'2.0'},...json});fs.writeFileSync(path.join(dir,'wave.vrma'),vrma({extensionsUsed:['VRMC_vrm_animation']}));fs.writeFileSync(path.join(dir,'plain.vrma'),vrma({}));
  fs.writeFileSync(path.join(dir,'far.vrma'),vrma({extensionsUsed:['VRMC_vrm_animation'],buffers:[{uri:'https://evil/x.bin'}]}));
  assert.deepEqual(checkMotions(dir,[{file:'motions/idle.vmd',name:'待機',loop:true,use:'idle'},{file:'wave.vrma',name:'wave',use:'react'}],'vrm'),['motions/idle.vmd','wave.vrma']);
  assert.deepEqual(checkMotions(dir,[{file:'motions/idle.motion3.json',name:'Idle',use:'idle'}],'live2d'),['motions/idle.motion3.json']);assert.deepEqual(checkMotions(dir,undefined,'gltf'),[]);
  const m=(file,more={})=>[{file,name:'x',use:'react',...more}];
  for(const [motions,renderer,error] of [[m('wave.vrma'),'mmd',/not a motion/],[m('motions/idle.vmd'),'gltf',/own animations/],[m('motions/idle.vmd',{speed:2}),'mmd',/Unsupported motion field/],
    [m('motions/idle.vmd',{use:'dance'}),'mmd',/use/],[m('motions/idle.vmd',{use:undefined}),'mmd',/use/],[m('motions/idle.vmd',{name:undefined}),'mmd',/name/],[m('missing.vmd'),'mmd',/Missing motion/],[m('fake.vmd'),'mmd',/not a VMD/],[m('plain.vrma'),'vrm',/not a VRM animation/],
    [m('far.vrma'),'vrm',/external/],[m('../idle.vmd'),'mmd',/Invalid asset path/],[m('motions/idle.vmd',{loop:'yes'}),'mmd',/loop/],['idle.vmd','mmd',/Invalid motions/]])
    assert.throws(()=>checkMotions(dir,motions,renderer),error,JSON.stringify(motions));
});
test('Live2D, MMD and VRM-with-motion Mods list every file they may load as assets',()=>{
  const root=tmp();const put=(id,renderer,skin,make)=>{const dir=path.join(root,id);fs.mkdirSync(dir);make?.(dir);fs.writeFileSync(path.join(dir,'mod.json'),JSON.stringify({...base,id,renderer,skins:[{id:'a',name:'A',states,...skin}]}));};
  put('live','live2d',{model:'hiyori/runtime/hiyori.model3.json',motions:[{file:'hiyori/runtime/motions/idle.motion3.json',name:'Idle',use:'idle'}]},dir=>live2dFolder(dir));
  put('dance','mmd',{model:'Model/テストモデル.pmx',motions:[{file:'Model/motion/待機.vmd',name:'待機',use:'idle',loop:true}]},dir=>mmdFolder(dir));
  put('moving','vrm',{model:'m.vrm',motions:[{file:'motions/wave.vrma',name:'Wave',use:'react'}]},dir=>{fs.writeFileSync(path.join(dir,'m.vrm'),glb({asset:{version:'2.0'},extensions:{VRMC_vrm:{meta:vrmMeta}}}));fs.mkdirSync(path.join(dir,'motions'));fs.writeFileSync(path.join(dir,'motions','wave.vrma'),glb({asset:{version:'2.0'},extensionsUsed:['VRMC_vrm_animation']}));});
  put('statue','gltf',{model:'s.glb',motions:[{file:'x.vmd',name:'x',use:'idle'}]},dir=>fs.writeFileSync(path.join(dir,'s.glb'),glb({asset:{version:'2.0'}})));
  const errors=[];const by=Object.fromEntries(mods.loadCatalog(root,{onError:(id,e)=>errors.push([id,e.message])}).map(m=>[m.id,m]));
  assert.equal(by.live.assets.length,8);assert.ok(by.live.assets.includes('hiyori/runtime/textures/texture_00.png'));
  assert.ok(by.dance.assets.includes('Model/Tex/Face.png')&&by.dance.assets.includes('Model/motion/待機.vmd'));
  assert.deepEqual(by.moving.assets.sort(),['m.vrm','motions/wave.vrma']);assert.equal(by.moving.skins[0].motions[0].name,'Wave');
  assert.deepEqual(errors.map(e=>e[0]),['statue']);
});
