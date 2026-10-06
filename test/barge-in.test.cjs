const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
// Barge-in and conversation mode, with stand-ins for the speech models: a "loud" chunk counts as speech.
const voiceInput=require('../voice-input.cjs');
const transcripts=[];
class FakeVad{constructor(){this.on=false;}acceptWaveform(w){this.on=w.some(v=>Math.abs(v)>.1);}isDetected(){return this.on;}}
class FakeDictation{constructor(){this.sherpa={Vad:FakeVad};this.vadConfig={};}load(){}begin(){this.heard=false;this.got=[];this.quiet=0;}
  accept(s){const loud=s.some(v=>Math.abs(v)>.1);if(loud){this.heard=true;this.quiet=0;this.got.push(s.length);}else if(this.heard&&++this.quiet>=8){return {done:true,text:transcripts.shift()||'下一句'};}return {done:false};}
  finish(){return this.heard?transcripts.shift()||'':''}}
voiceInput.Dictation=FakeDictation;voiceInput.asrInstalled=()=>true;
const {createWake}=require('../wake-service.cjs');

function setup(settings={}){
  const sent=[],handlers={},userData=fs.mkdtempSync(path.join(os.tmpdir(),'barge-'));let micHandler,speaking=false,stops=0;
  const win={isVisible:()=>true,show(){},isDestroyed:()=>false,webContents:{send:(channel,value)=>sent.push([channel,value])}};
  createWake({app:{getPath:()=>userData,getPreferredSystemLanguages:()=>['zh-TW'],focus(){}},handle:(name,fn)=>{handlers[name]=fn;},ipcMain:{on:(name,fn)=>{if(name==='bula:mic')micHandler=fn;}},systemPreferences:{getMediaAccessStatus:()=>'granted'},
    getWin:()=>win,getRuntime:()=>({snapshot:()=>({mod:{id:'annie',name:'Annie'}})}),getSettings:()=>({wakeEnabled:true,dictationEngine:'local',...settings}),persist(){},
    speech:{isSpeaking:()=>speaking,stop:()=>{stops++;speaking=false;}}});
  const chunk=(loud,ms=100)=>{const a=new Float32Array(16*ms);if(loud)a.fill(.3);micHandler({sender:win.webContents},a);};
  return {sent,handlers,chunk,speak:on=>{speaking=on;},stops:()=>stops,channels:()=>sent.map(([c])=>c),cleanup:()=>fs.rmSync(userData,{recursive:true,force:true})};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('talking over the companion stops it and listens, keeping the words said so far',async()=>{
  const t=setup();try{
    t.speak(true);await sleep(320);  // past the first moments of a sentence
    t.chunk(true);t.chunk(true);t.chunk(false);t.chunk(false);t.chunk(false);t.chunk(false);t.chunk(false);  // a short "嗯" is not an interruption
    assert.equal(t.stops(),0);
    for(let i=0;i<5;i++)t.chunk(true);  // 0.5 s of real speech
    assert.equal(t.stops(),1,'speech stopped');assert.ok(t.channels().includes('bula:barge-in'));
    transcripts.push('等一下，換個話題');for(let i=0;i<8;i++)t.chunk(false);
    const [,dictated]=t.sent.find(([c])=>c==='bula:dictation');assert.equal(dictated.text,'等一下，換個話題');assert.equal(dictated.follow,false);
  }finally{t.cleanup();}
});
test('the first moments of each sentence never count as an interruption (echo cancellation is still adapting)',async()=>{
  const t=setup();try{t.speak(true);for(let i=0;i<2;i++)t.chunk(true);assert.equal(t.stops(),0);}finally{t.cleanup();}
});
test('barge-in can be turned off',async()=>{
  const t=setup({bargeIn:false});try{t.speak(true);await sleep(320);for(let i=0;i<8;i++)t.chunk(true);assert.equal(t.stops(),0);}finally{t.cleanup();}
});
test('after a reply to something said aloud, it keeps listening for the next sentence without the wake word',async()=>{
  const t=setup();try{
    t.speak(true);for(let i=0;i<8;i++)t.chunk(true);transcripts.push('今天天氣如何');for(let i=0;i<8;i++)t.chunk(false);  // a question said aloud
    t.speak(true);t.chunk(false);t.speak(false);t.chunk(false);  // the reply is spoken, then ends
    assert.ok(t.channels().includes('bula:follow'),'follow-up window opens');
    transcripts.push('那明天呢');for(let i=0;i<3;i++)t.chunk(true);for(let i=0;i<8;i++)t.chunk(false);
    const last=t.sent.filter(([c])=>c==='bula:dictation').at(-1)[1];assert.deepEqual(last,{text:'那明天呢',follow:true});
  }finally{t.cleanup();}
});
test('conversation mode can be turned off',async()=>{
  const t=setup({conversationMode:false});try{
    t.speak(true);for(let i=0;i<8;i++)t.chunk(true);transcripts.push('問題');for(let i=0;i<8;i++)t.chunk(false);
    t.speak(true);t.chunk(false);t.speak(false);t.chunk(false);assert.ok(!t.channels().includes('bula:follow'));
  }finally{t.cleanup();}
});
test('stopping listening ends a follow-up window: what is said next is not sent',async()=>{
  const t=setup();try{
    t.speak(true);for(let i=0;i<8;i++)t.chunk(true);transcripts.push('問題');for(let i=0;i<8;i++)t.chunk(false);
    t.speak(true);t.chunk(false);t.speak(false);t.chunk(false);assert.ok(t.channels().includes('bula:follow'));
    await t.handlers['bula:listen-cancel']();const before=t.sent.filter(([c])=>c==='bula:dictation').length;
    transcripts.push('不該送出');for(let i=0;i<3;i++)t.chunk(true);for(let i=0;i<8;i++)t.chunk(false);
    assert.equal(t.sent.filter(([c])=>c==='bula:dictation').length,before);
  }finally{t.cleanup();}
});
