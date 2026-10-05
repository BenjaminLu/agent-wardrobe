const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {app,dialog,BrowserWindow}=require('electron');
const kokoro=require('../kokoro.cjs');const {PER}=require('../voice-engines/kokoro-mix.cjs');
// 聲音: make a 萌系少女 mix in the settings panel, bind it to Annie, and check her replies are spoken through it; packs; the phone.
// Kokoro runs as a stand-in for sherpa-onnx (main.cjs passes standinSherpa when VOICES_SMOKE_STANDIN is set) over a fake model folder.
const calls=[];
const standinSherpa={OfflineTts:class{
  constructor(config){this.voices=config.model.kokoro.voices;}
  generateAsync(request){calls.push({voices:this.voices,...request});const rate=24000,samples=new Float32Array(rate/5);for(let i=0;i<samples.length;i++)samples[i]=.05*Math.sin(2*Math.PI*330*i/rate);return Promise.resolve({samples,sampleRate:rate});}
},calls};
async function run({win,runtime,voiceService,startRemote}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=20000,label='')=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error(`Voices smoke timed out ${label}`);await new Promise(r=>setTimeout(r,100));}};
  // a stand-in Kokoro model: the required files, and a voices.bin of the real shape where speaker s is filled with s+1
  const model=path.join(app.getPath('userData'),'models','kokoro-multi-lang-v1_0');fs.mkdirSync(model,{recursive:true});
  for(const name of kokoro.REQUIRED)fs.writeFileSync(path.join(model,name),'stand-in');
  const voices=new Float32Array(54*PER);for(let s=0;s<54;s++)voices.fill(s+1,s*PER,(s+1)*PER);fs.writeFileSync(path.join(model,'voices.bin'),Buffer.from(voices.buffer));fs.writeFileSync(path.join(model,'.complete'),'smoke');
  win.show();await wait(()=>js('document.body.dataset.ready==="true"'),30000,'ready');
  await js(`window.bula.select({modId:'annie'})`);await wait(()=>runtime.state.modId==='annie');
  await js(`window.bula.saveSettings({provider:'codex',base:'http://127.0.0.1:1234/v1',model:'',voiceProvider:'system'})`);
  // 新增聲音 → 萌系混音: five presets, sliders, preview
  await js(`document.querySelector('#settings-toggle').click();true`);await wait(()=>js(`document.querySelector('#voice-current-text').textContent.length>0`),10000,'voices section');
  assert.match(await js(`document.querySelector('#voice-current-text').textContent`),/現在用預設語音/);
  // settings are split into sections with a sidebar; the voice section shows only voice settings
  await js(`document.querySelector('#settings-nav [data-pane=voice]').click();true`);
  assert.deepEqual(await js(`[...document.querySelectorAll('#settings-panes .pane')].filter(p=>!p.hidden).map(p=>p.dataset.pane)`),['voice']);
  {const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','settings.png'),(await win.webContents.capturePage()).toPNG());}
  assert.equal(await js(`document.querySelector('#voice-lab').hidden`),false,'錄音複製 is offered now that the 聲音工作室 window is in the app');
  await js(`document.querySelector('#voice-new-mix').click();true`);await wait(()=>js(`!document.querySelector('#voice-mix').hidden&&document.querySelectorAll('#mix-preset option').length===5`),10000,'mix panel');
  assert.deepEqual(await js(`[...document.querySelectorAll('#mix-preset option')].map(o=>o.textContent)`),['萌系少女','元氣妹妹','溫柔姊姊','傲嬌','少年']);
  assert.deepEqual(await js(`[document.querySelector('#mix-name').value,document.querySelector('#mix-a').value,document.querySelector('#mix-b').value,document.querySelector('#mix-blend').value,document.querySelector('#mix-pitch').value]`),['萌系少女','zf_xiaoyi','zf_xiaobei','60','3']);
  const talking=[];runtime.on('change',s=>talking.push(s.speaking));
  await js(`document.querySelector('#mix-preview').click();true`);await wait(()=>calls.length>=1,10000,'preview');await wait(()=>talking.includes(true)&&talking.at(-1)===false,10000,'preview played');
  assert.equal(calls[0].sid,0);assert.equal(calls[0].speed,1.05);assert.ok(calls[0].voices.startsWith(path.join(app.getPath('userData'),'voices','.kokoro-mix')),'a derived voices file');
  const derived=new Float32Array(fs.readFileSync(calls[0].voices).buffer);const sid=n=>kokoro.VOICES.find(v=>v.name===n).sid;
  assert.ok(Math.abs(derived[123]-(.6*(sid('zf_xiaoyi')+1)+.4*(sid('zf_xiaobei')+1)))<1e-4,'speaker 0 holds 60% 小藝 + 40% 小北');assert.equal(derived[PER*7+1],8,'other speakers unchanged');
  // save → bound to Annie; her replies go through the mix
  await js(`document.querySelector('#mix-save').click();true`);await wait(()=>js(`document.querySelectorAll('#voices-list li.bound').length===1`),10000,'saved and bound');
  // the top of the page says which voice is heard, and the default voice is marked as not applying to Annie
  await wait(()=>js(`/專屬聲音/.test(document.querySelector('#voice-current-text').textContent)`),5000,'current voice');
  assert.equal(await js(`document.querySelector('#voice-default').classList.contains('inactive')&&document.querySelector('#voice-for').value===document.querySelector('#voices-list li.bound').dataset.id`),true);
  // the picker at the top switches back to the default voice and back again
  await js(`(()=>{const s=document.querySelector('#voice-for');s.value='';s.dispatchEvent(new Event('change'));return true;})()`);await wait(()=>js(`/現在用預設語音/.test(document.querySelector('#voice-current-text').textContent)`),5000,'picker to default');
  await js(`(()=>{const s=document.querySelector('#voice-for');s.selectedIndex=1;s.dispatchEvent(new Event('change'));return true;})()`);await wait(()=>js(`/專屬聲音/.test(document.querySelector('#voice-current-text').textContent)`),5000,'picker to own voice');
  const state=await js(`window.bula.voices()`);const id=state.bound;assert.match(id,/^v-[a-z0-9-]+$/);assert.equal(state.bindings.annie,id);assert.equal(state.profiles[0].license.tier,'open');
  assert.ok(fs.existsSync(path.join(app.getPath('userData'),'voices',id,'voice.json')));
  const before=calls.length;talking.length=0;
  await js(`window.bula.speak('嗨，我是 Annie。今天想做什麼呢？')`);
  await wait(()=>calls.length>=before+2&&talking.includes(true)&&talking.at(-1)===false,15000,'reply spoken');
  assert.deepEqual(calls.slice(before).map(c=>c.text),['嗨，我是 Annie。','今天想做什麼呢？'],'sentence by sentence through the profile');
  // another character without a voice falls back to the voice provider (macOS say here)
  await js(`window.bula.select({modId:'miso'})`);await wait(()=>runtime.state.modId==='miso');const n=calls.length;talking.length=0;
  await js(`window.bula.speak('嗯')`);await wait(()=>talking.includes(true)&&talking.at(-1)===false,15000,'fallback');assert.equal(calls.length,n,'Miso does not use Annie\'s voice');
  await js(`window.bula.select({modId:'annie'})`);await wait(()=>runtime.state.modId==='annie');
  // voice pack: export, then import as a second profile with the same licence
  const pack=path.join(app.getPath('userData'),'moe.voice.zip');dialog.showSaveDialog=async()=>({canceled:false,filePath:pack});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[pack]});
  await js(`document.querySelector('#voices-settings').scrollIntoView();[...document.querySelectorAll('#voices-list li[data-id="${id}"] button')].find(b=>b.textContent==='匯出').click();true`);await wait(()=>fs.existsSync(pack),10000,'export');
  await js(`document.querySelector('#voice-import').click();true`);await wait(()=>js(`document.querySelectorAll('#voices-list li').length===2`),10000,'import');
  const imported=(await js(`window.bula.voices()`)).profiles.find(p=>p.id!==id);assert.equal(imported.name,'萌系少女');assert.deepEqual(imported.license,state.profiles[0].license);
  // a cloned voice is refused on export
  const cloned=await voiceService.voices.save({name:'朋友',engine:'kokoro-mix',params:{mix:[{voice:'zf_xiaoni',weight:1}]},license:{label:'personal',commercial:false,credit:null,tier:'personal'},consent:{person:'小美',at:new Date().toISOString(),note:''}});
  await assert.rejects(js(`window.bula.voiceExport(${JSON.stringify(cloned.id)})`),/小美 本人/);
  // the phone: list, preview on the phone (audio comes back), unbind and bind again
  await startRemote();const info=await js(`window.bula.remotePair()`);
  const phone=new BrowserWindow({width:390,height:820,show:true,webPreferences:{contextIsolation:true,sandbox:true,partition:'voices-phone'}});
  try{
    await phone.loadURL(info.link);const p=code=>phone.webContents.executeJavaScript(code);
    await wait(()=>p(`!document.querySelector('#app').hidden&&document.querySelector('#link').classList.contains('on')`),20000,'pair');
    await p(`window.played=[];HTMLMediaElement.prototype.play=function(){window.played.push(this.src);return Promise.resolve();};document.querySelector('#tabs [data-tab=settings]').click();true`);
    await wait(()=>p(`document.querySelectorAll('#v-list .voice').length===3&&document.querySelectorAll('#v-list .voice.on').length===1`),10000,'phone list');
    const n2=calls.length;await p(`[...document.querySelectorAll('#v-list .voice.on button')].find(b=>b.textContent.includes('手機')).click();true`);
    await wait(()=>p(`window.played.length===1&&window.played[0].startsWith('blob:')`),10000,'phone preview');assert.equal(calls.length,n2+1);
    await p(`document.querySelector('#v-list .voice.on button.bind').click();true`);await wait(()=>p(`document.querySelectorAll('#v-list .voice.on').length===0`),10000,'phone unbind');
    assert.equal((await js(`window.bula.voices()`)).bound,null);
    await p(`document.querySelector('#v-list .voice[data-id="${id}"] button.bind').click();true`);await wait(()=>p(`document.querySelector('#v-list .voice[data-id="${id}"]').classList.contains('on')`),10000,'phone bind');
    assert.equal((await js(`window.bula.voices()`)).bound,id);
  }finally{phone.destroy();}
  console.log('VOICES_SMOKE',JSON.stringify({presets:5,preview:true,boundTo:'annie',replySentences:2,fallback:'system',packRoundTrip:true,clonedExportRefused:true,phone:true}));
  await js(`window.bula.saveSettings({provider:'codex',base:'http://127.0.0.1:1234/v1',model:'',voiceProvider:'system'})`).catch(()=>{});
}
module.exports={run,standinSherpa};
