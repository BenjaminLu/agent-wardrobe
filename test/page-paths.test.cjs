const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL,fileURLToPath}=require('node:url');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const exists=file=>assert.ok(fs.statSync(path.join(root,file)).isFile(),`${file} must exist`);
const pages=[
  'src/renderer/companion/index.html',
  'src/renderer/agent-console/agent-console.html',
  'src/renderer/assisted/assisted.html',
  'src/renderer/files/files.html',
  'src/renderer/marketplace/marketplace.html',
  'src/renderer/voice-lab/voice-lab.html'
];
const preloads=[
  'src/preload/preload.cjs',
  'src/preload/agent-console-preload.cjs',
  'src/preload/assisted-preload.cjs',
  'src/preload/files-preload.cjs',
  'src/preload/marketplace-preload.cjs',
  'src/preload/voice-lab-preload.cjs'
];
function refs(html){
  return [...html.matchAll(/<(script|link)\b[^>]*>/gi)].flatMap(([tag,kind])=>{
    const attr=tag.match(kind.toLowerCase()==='script'?/\bsrc\s*=\s*(["'])(.*?)\1/i:/\bhref\s*=\s*(["'])(.*?)\1/i);
    return attr&&!/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(attr[2])?[attr[2]]:[];
  });
}
function fileMap(server){
  const body=read(`src/main/${server}-server.cjs`).match(/\bconst FILES\s*=\s*\{([^}]+)\}/);
  assert.ok(body,`${server} FILES map exists`);
  const entries=[...body[1].matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g)].map(([,url,file])=>[url,file]);
  assert.ok(entries.length,`${server} FILES map is nonempty`);
  return Object.fromEntries(entries);
}

test('disk pages use the repository root as their first head element and resolve scripts and styles',()=>{
  for(const page of pages){
    exists(page);
    const html=read(page);
    assert.match(html,/<head\b[^>]*>\s*<base href="\.\.\/\.\.\/\.\.\/">/i,page);
    assert.equal((html.match(/<base\b/gi)||[]).length,1,page);
    const base=new URL('../../../',pathToFileURL(path.join(root,page)));
    assert.equal(fileURLToPath(base),root+path.sep,page);
    const links=refs(html);assert.ok(links.length,page);
    for(const ref of links)assert.ok(fs.statSync(fileURLToPath(new URL(ref,base))).isFile(),`${page}: ${ref}`);
  }
});

test('wardrobe keeps flat HTTP references backed by the control file map',()=>{
  const page='src/renderer/wardrobe/wardrobe.html';exists(page);
  const html=read(page),files=fileMap('control');
  assert.doesNotMatch(html,/<base\b/i);
  const links=refs(html);assert.ok(links.length);
  for(const ref of links){assert.ok(Object.hasOwn(files,'/'+ref),ref);exists(files['/'+ref]);}
});

test('Electron loads exactly the six relocated pages and six self-contained preloads',()=>{
  const targets=[];
  for(const name of fs.readdirSync(path.join(root,'src/main')).filter(name=>name.endsWith('.cjs'))){
    const source=read(`src/main/${name}`);
    const calls=[...source.matchAll(/(?:\.loadFile\s*\(\s*|\bpreload\s*:\s*)path\.join\(\s*(?:ROOT|root)\s*,([^)]*)\)/g)];
    for(const [,args] of calls){
      assert.match(args,/^\s*(['"])[^'"]+\1(?:\s*,\s*(['"])[^'"]+\2)*\s*$/);
      const parts=[...args.matchAll(/['"]([^'"]+)['"]/g)].map(([,part])=>part);
      if(['game-service.cjs','person-service.cjs'].includes(name)&&['game','person'].includes(parts[0]))continue;
      targets.push(parts.join('/'));
    }
  }
  assert.deepEqual(targets.sort(),[...pages,...preloads].sort());
  for(const file of targets)exists(file);
  for(const preload of preloads){
    const requires=[...read(preload).matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map(([,id])=>id);
    assert.deepEqual(requires,['electron'],preload);
  }
});

test('stationary pages reference the relocated shared assets',()=>{
  const expected={
    'person/person.html':['avatar.css','i18n.js','avatars.js'],
    'person/render.html':['avatar.css','avatars.js'],
    'game/game.html':['i18n.js'],
    'build/icon.html':['avatar.css','avatars.js']
  };
  for(const [page,names] of Object.entries(expected)){
    const shared=refs(read(page)).filter(ref=>/\/(?:i18n\.js|avatars\.js|avatar\.css)$/.test('/'+ref));
    assert.deepEqual(shared,names.map(name=>'../src/renderer/shared/'+name),page);
    for(const ref of shared)exists(path.join(path.dirname(page),ref));
  }
});

test('both microphone worklets resolve from the document root',()=>{
  for(const file of ['src/renderer/companion/renderer.js','src/renderer/voice-lab/voice-lab.js']){
    const modules=[...read(file).matchAll(/audioWorklet\.addModule\(\s*['"]([^'"]+)['"]\s*\)/g)].map(([,ref])=>ref);
    assert.deepEqual(modules,['src/renderer/companion/mic-worklet.js'],file);
    exists(modules[0]);
  }
});

test('control and remote routes retain their URL keys and serve existing files',()=>{
  const keys={
    control:['/','/wardrobe.js','/wardrobe.css','/interaction.css','/avatars.js','/avatar.css','/i18n.js','/platform-text.js','/vendor/vrm-kit.js'],
    remote:['/remote/','/remote/index.html','/remote/app.js','/remote/style.css','/remote/manifest.webmanifest','/remote/sw.js','/remote/icon.png','/remote/avatars.js','/remote/i18n.js','/remote/avatar.css','/remote/vendor/vrm-kit.js','/remote/vendor/live2d-kit.js']
  };
  for(const server of Object.keys(keys)){
    const files=fileMap(server);
    assert.deepEqual(Object.keys(files).sort(),keys[server].sort());
    for(const file of Object.values(files))exists(file);
  }
});
