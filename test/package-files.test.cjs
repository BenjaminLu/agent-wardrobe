const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {copyApp,missingRequires}=require('../scripts/package-common.cjs');
// The release build refuses to package an app whose files require something left out; check the same file list on every run,
// so a missing file shows up in CI instead of at release time.
test('every file the packaged app loads is packaged, on every platform',()=>{
  for(const platform of ['darwin','win32','linux']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'package-files-'));
    try{copyApp(dir,{platform,runtime:false});assert.deepEqual(missingRequires(dir),[],platform);for(const lang of ['zh-Hant','zh-Hans','en','ja'])assert.ok(fs.existsSync(path.join(dir,'locales',`${lang}.json`)),`locales/${lang}.json`);}
    finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
