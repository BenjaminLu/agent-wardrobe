const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {UI_LANGUAGES,THEMES,resolveLanguage,defaultVoice,sanitizeUiLanguage,sanitizeTheme,startupPrefs,applyUiPrefs,uiApplyReady}=require('../ui-prefs.cjs');
test('interface language resolves explicit choices and system fallback',()=>{
  assert.deepEqual(UI_LANGUAGES,['auto','en','zh-TW','zh-CN','ja']);assert.deepEqual(THEMES,['ocean','mint','sakura','dark']);
  for(const code of UI_LANGUAGES.slice(1))assert.equal(resolveLanguage(code,['fr']),code);
  for(const code of ['auto','unknown',undefined]){assert.equal(resolveLanguage(code,['zh-TW','en']),'zh-TW');assert.equal(resolveLanguage(code,[]),'en');}
});
test('saved interface preferences survive restart and legacy settings follow macOS',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ui-prefs-'));
  try{const file=path.join(root,'settings.json');fs.writeFileSync(file,JSON.stringify({uiLanguage:'ja',theme:'mint',language:'en'}));
    assert.deepEqual(startupPrefs(JSON.parse(fs.readFileSync(file)),['zh-TW']),{uiLanguage:'ja',theme:'mint',language:'ja',voice:'Kyoko'});
    assert.deepEqual(startupPrefs({language:'ja'},['zh-TW']),{uiLanguage:'auto',theme:'ocean',language:'zh-TW',voice:'Eddy (Chinese (Taiwan))'});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('preferences sanitize invalid values and retain valid choices',()=>{
  for(const value of [undefined,null,'invalid','',{},1]){assert.equal(sanitizeTheme(value),'ocean');assert.equal(sanitizeUiLanguage(value),'auto');}
  for(const value of THEMES)assert.equal(sanitizeTheme(value),value);
  for(const value of UI_LANGUAGES)assert.equal(sanitizeUiLanguage(value),value);
});
test('default macOS voice follows the effective language',()=>{
  for(const code of ['zh-CN','zh-SG','zh-Hans'])assert.equal(defaultVoice(code),'Tingting');
  for(const code of ['zh-TW','zh-Hant','zh'])assert.equal(defaultVoice(code),'Eddy (Chinese (Taiwan))');
  assert.equal(defaultVoice('ja-JP'),'Kyoko');assert.equal(defaultVoice('en-US'),'Samantha');assert.equal(defaultVoice('fr'),'Samantha');
});
test('preference changes preserve unrelated settings and custom voices on no-op or theme changes',()=>{
  const original={uiLanguage:'auto',theme:'ocean',language:'en-US',provider:'claude',model:'x',replyLanguage:'ja',voice:'Samantha',secret:'keep',nested:{same:true}};
  const result=applyUiPrefs(original,{uiLanguage:'zh-TW',provider:'codex',model:'overwrite'},['en-US']);
  assert.equal(result.languageChanged,true);assert.equal(result.themeChanged,false);
  assert.deepEqual(result.settings,{...original,uiLanguage:'zh-TW',language:'zh-TW',voice:'Eddy (Chinese (Taiwan))'});
  assert.equal(original.uiLanguage,'auto');assert.equal(result.settings.nested,original.nested);
  const custom={...result.settings,voice:'Custom'};
  assert.deepEqual(applyUiPrefs(custom,{uiLanguage:'zh-TW'},['en-US']),{settings:custom,languageChanged:false,themeChanged:false});
  assert.deepEqual(applyUiPrefs(custom,{theme:'dark'},['en-US']),{settings:{...custom,theme:'dark'},languageChanged:false,themeChanged:true});
  for(const data of [{},{uiLanguage:'invalid',theme:'invalid'},{uiLanguage:undefined,theme:null}])assert.deepEqual(applyUiPrefs(custom,data,['en-US']),{settings:custom,languageChanged:false,themeChanged:false});
  assert.equal(applyUiPrefs(custom,{uiLanguage:'auto'},['en-US']).settings.language,'en-US');
});
test('UI apply waits for every independent source of running work',()=>{
  for(const activity of ['success','error','idle']){
    const clear={chatBusy:false,toolTask:null,taskRunning:false,activity};assert.equal(uiApplyReady(clear),true);
    for(const busy of [{chatBusy:true},{toolTask:{}},{taskRunning:true},{activity:'working'},{activity:'waiting_for_approval'}])assert.equal(uiApplyReady({...clear,...busy}),false,JSON.stringify(busy));
  }
});
