const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../locale.js'),'utf8');
const keys=['uiLanguageLabel','themeLabel','auto','generalTab','themeOcean','themeMint','themeSakura','themeDark'];
test('each interface locale defines its own preference labels without fallback',()=>{
  const context={window:{}};
  vm.runInNewContext(source.replace('window.bulaLocale =','window.tables={en,zh,cn,ja}; window.bulaLocale ='),context);
  for(const [code,table] of [['en','en'],['zh-TW','zh'],['zh-CN','cn'],['ja','ja']]){
    const resolved=context.window.bulaLocale(code),raw=context.window.tables[table];
    for(const key of keys){assert.equal(typeof resolved[key],'string',`${code}.${key}`);assert.ok(resolved[key].trim());assert.ok(Object.hasOwn(raw,key),`${table} must define ${key}`);assert.ok(raw[key].trim());}
    if(table!=='en')for(const key of ['generalTab','themeOcean','themeMint','themeSakura','themeDark'])assert.notEqual(raw[key],context.window.tables.en[key]);
  }
});
