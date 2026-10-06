const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {typelessStatus,SpeechEnd}=require('../src/main/typeless.cjs');
const chunk=(level,ms=100)=>{const n=ms*16,a=new Float32Array(n);for(let i=0;i<n;i++)a[i]=level*Math.sin(i/3);return a;};
test('a pause after speech ends the question; silence alone gives up',()=>{
  let end=new SpeechEnd();for(let i=0;i<5;i++)assert.equal(end.accept(chunk(.003)),null);
  for(let i=0;i<15;i++)assert.equal(end.accept(chunk(.08)),null,'still talking');
  let result=null,quiet=0;while(!result){result=end.accept(chunk(.003));quiet+=100;}assert.equal(result,'done');assert.ok(quiet>=1200&&quiet<=1400,`ended after ${quiet} ms of quiet`);
  end=new SpeechEnd();let t=0;while(!(result=end.accept(chunk(.004))))t+=100;assert.equal(result,'nothing');assert.ok(t>=6800);
  end=new SpeechEnd({maxMs:3000});t=0;while(!(result=end.accept(chunk(.1))))t+=100;assert.equal(result,'done','a very long question is cut off');
});
test('Typeless is used only when installed with its Fn shortcut',()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'typeless-')),dir=path.join(home,'Library','Application Support','Typeless');fs.mkdirSync(dir,{recursive:true});
  const app=fs.mkdtempSync(path.join(os.tmpdir(),'Typeless.app-'));const write=binding=>fs.writeFileSync(path.join(dir,'app-settings.json'),JSON.stringify({featureShortcutBindings:{dictationMode:[binding]}}));
  write('Fn');assert.deepEqual(typelessStatus({home,app,platform:'darwin'}),{installed:true,shortcut:'Fn',supported:true});
  write('Ctrl+Alt');assert.equal(typelessStatus({home,app,platform:'darwin'}).supported,false);
  assert.equal(typelessStatus({home,app:path.join(app,'missing'),platform:'darwin'}).supported,false);
  for(const platform of ['win32','linux'])assert.deepEqual(typelessStatus({home,app,platform}),{installed:false,shortcut:null,supported:false},`no Typeless on ${platform}`);
});
