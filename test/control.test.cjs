const test=require('node:test');const assert=require('node:assert/strict');
const {Runtime}=require('../src/main/runtime.cjs');const {loadCatalog}=require('../src/main/mods.cjs');const {startControl}=require('../src/main/control-server.cjs');
test('local control authenticates writes, isolates origins, and validates selection',async()=>{
  const catalog=loadCatalog(),runtime=new Runtime(catalog);
  const control=await startControl({runtime,catalog,language:'en',onSelect:v=>runtime.select(v),onProvider:v=>runtime.provider(v)});
  const headers={Authorization:`Bearer ${control.token}`,'Content-Type':'application/json'};
  try{
    assert.equal((await fetch(control.origin+'/api/catalog')).status,401);
    assert.equal((await fetch(control.origin+'/api/catalog',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
    const result=await fetch(control.origin+'/api/select',{method:'POST',headers,body:JSON.stringify({modId:'miso'})});assert.equal(result.status,200);assert.equal((await result.json()).modId,'miso');
    const bad=await fetch(control.origin+'/api/select',{method:'POST',headers,body:JSON.stringify({skinId:'../evil'})});assert.equal(bad.status,400);assert.equal(runtime.state.modId,'miso');
    const res=await fetch(control.origin+'/api/events?token='+control.token);const reader=res.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/"modId":"miso"/);runtime.select({skinId:'midnight'});assert.match(new TextDecoder().decode((await reader.read()).value),/"skinId":"midnight"/);await reader.cancel();
    assert.equal((await fetch(control.origin+'/main.cjs')).status,404);
  }finally{await control.close();}
});
test('web wardrobe gets the interface language from the desktop app and hears when it changes',async()=>{
  const L=require('../src/main/locales.cjs');const before=L.language;L.setLanguage('zh-Hant');
  const catalog=loadCatalog(),runtime=new Runtime(catalog);
  const control=await startControl({runtime,catalog,language:'en',onSelect:v=>runtime.select(v),onProvider:v=>runtime.provider(v)});
  const headers={Authorization:`Bearer ${control.token}`};
  try{
    assert.equal((await fetch(control.origin+'/api/i18n')).status,401);
    const first=await (await fetch(control.origin+'/api/i18n',{headers})).json();
    assert.equal(first.lang,'zh-Hant');assert.equal(first.dict['wardrobe.apply'],'套用 Mod');
    assert.equal((await fetch(control.origin+'/i18n.js')).status,200);assert.equal((await fetch(control.origin+'/locale.js')).status,404);
    const res=await fetch(control.origin+'/api/events?token='+control.token);const reader=res.body.getReader();await reader.read();
    L.setLanguage('ja');assert.match(new TextDecoder().decode((await reader.read()).value),/event: i18n\ndata: \{"lang":"ja"\}/);await reader.cancel();
    const next=await (await fetch(control.origin+'/api/i18n',{headers})).json();assert.equal(next.lang,'ja');assert.equal(next.dict['wardrobe.apply'],'Mod を適用');
  }finally{await control.close();L.setLanguage(before);}
});
test('web wardrobe can load validated Mod assets and nothing else from Mod folders',async()=>{
  const catalog=loadCatalog();const runtime=new Runtime(catalog);
  const control=await startControl({runtime,catalog,language:'en',onSelect:v=>runtime.select(v),onProvider:v=>runtime.provider(v)});
  try{
    const get=p=>fetch(new URL(p,control.url));
    const png=await get('/mods/pixel-byte/eyes-open.png');assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/png');
    assert.equal((await get('/mods/vrm-sample/sample.vrm')).status,200);
    assert.equal((await get('/vendor/vrm-kit.js')).status,200);
    for(const p of ['/mods/pixel-byte/mod.json','/mods/pixel-byte/parts.json','/mods/pixel-byte/..%2F..%2Fmain.cjs','/mods/nope/x.png','/mods/annie/parts.json'])assert.equal((await get(p)).status,404,p);
  }finally{await control.close();}
});
