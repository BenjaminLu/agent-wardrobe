const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
require('../src/main/locales.cjs').setLanguage('zh-Hant');  // messages are checked in the zh-Hant interface text
const {keywordLine,syllableTokens,loadTokens,loadEnglish}=require('../src/main/voice-input.cjs');
const dir=path.join(__dirname,'..','models','kws');const ctx={tokens:loadTokens(path.join(dir,'tokens.txt')),english:loadEnglish(path.join(dir,'en.phone'))};
test('pinyin syllables split into the model\'s initial and toned-final tokens',()=>{
  assert.deepEqual(syllableTokens('hēi'),['h','ēi']);assert.deepEqual(syllableTokens('zhōu'),['zh','ōu']);assert.deepEqual(syllableTokens('ān'),['ān']);assert.deepEqual(syllableTokens('yǒu'),['y','ǒu']);
});
test('Chinese, English and mixed wake phrases become keyword lines',()=>{
  assert.equal(keywordLine('嘿安妮',ctx),'h ēi ān n ī @嘿安妮');
  assert.equal(keywordLine('Hey Annie',ctx),'HH EY1 AE1 N IY0 @Hey_Annie');
  assert.equal(keywordLine('嘿 Annie',ctx),'h ēi AE1 N IY0 @嘿_Annie');
});
test('wake phrases the model cannot hear are refused with a reason',()=>{
  assert.throws(()=>keywordLine('',ctx),/1–30/);assert.throws(()=>keywordLine('Hey Qwzxv',ctx),/不在辨識字典/);assert.throws(()=>keywordLine('!!!',ctx),/中文或英文/);
});
const fs=require('node:fs');const os=require('node:os');const crypto=require('node:crypto');const http=require('node:http');const {installAsr,asrInstalled}=require('../src/main/voice-input.cjs');
test('the recognition model installs only when every file verifies',async()=>{
  const body=Buffer.from('model-bytes');const server=http.createServer((req,res)=>res.end(body));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const good=[{name:'model.int8.onnx',url:base+'/m',size:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex')},{name:'tokens.txt',url:base+'/t',size:body.length},{name:'silero_vad.onnx',url:base+'/v',size:body.length}];
    const dir=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'asr-')),'m');await installAsr(dir,{files:good});assert.ok(fs.existsSync(path.join(dir,'.complete')));
    const bad=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'asr-')),'m');await assert.rejects(installAsr(bad,{files:[{...good[0],sha256:'0'.repeat(64)}]}),/驗證失敗/);assert.ok(!fs.existsSync(bad)&&!fs.existsSync(bad+'.partial'));
  }finally{server.close();}
});
const {keywordLines,toneForms}=require('../src/main/voice-input.cjs');
test('casual tones of a Chinese wake phrase are accepted too',()=>{
  assert.deepEqual(toneForms('ēi',ctx.tokens).sort(),['éi','èi','ēi','ěi','ei'].filter(f=>ctx.tokens.has(f)).sort());
  const lines=keywordLines('嘿安妮',ctx);
  assert.ok(lines.includes('h ēi ān n ī @嘿安妮'));assert.ok(lines.includes('h èi ān n í @嘿安妮'));assert.ok(lines.every(l=>l.endsWith('@嘿安妮')));
  assert.equal(keywordLines('Hey Annie',ctx).length,1,'English needs no tone variants');
  assert.ok(keywordLines('哈囉你好小幫手',ctx).length<=200*5,'variants are capped');
});
