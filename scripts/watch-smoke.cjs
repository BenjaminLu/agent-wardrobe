const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {app}=require('electron');
const {RUNTIME}=require('../src/main/local-llm.cjs');
// Watch mode end to end: the character plays Pikachu Volleyball in one window (stand-in decisions) while watch mode looks at that
// window with the built-in vision model (LLM_MODEL_SRC, linked like the built-in smoke) and comments. Needs the network.
async function run({win}){
  const src=process.env.LLM_MODEL_SRC,root=path.join(app.getPath('userData'),'models','llm');fs.mkdirSync(path.join(root,'qwen3.5-2b'),{recursive:true});
  fs.symlinkSync(path.join(src,`llama-${RUNTIME.tag}`),path.join(root,`llama-${RUNTIME.tag}`));
  for(const name of ['model.gguf','mmproj.gguf'])fs.symlinkSync(path.join(src,'qwen3.5-2b',name),path.join(root,'qwen3.5-2b',name));fs.writeFileSync(path.join(root,'qwen3.5-2b','.complete'),'ok');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'watch-smoke-')),fake=path.join(dir,'fake-laya.cjs');
  fs.writeFileSync(fake,`const rl=require('readline').createInterface({input:process.stdin});console.log('@laya '+JSON.stringify({ready:true,device:'stand-in'}));
rl.on('line',line=>{const r=JSON.parse(line),a={};for(const [id,q] of Object.entries(r.questions)){const keys=Array.isArray(q.criteria)?q.criteria:Object.keys(q.criteria);
const pick=id==='go'?(r.state.includes('to the left')?'left':r.state.includes('to the right')||r.state.includes('go back to the right')?'right':'here'):id==='jump'?(r.state.includes('time to jump')?'jump':'wait'):keys[0];
a[id]={type:'choice',choice:pick,probabilities:Object.fromEntries(keys.map(k=>[k,k===pick?.8:.1]))};}console.log('@laya '+JSON.stringify({id:r.id,answers:a,ms:1}));});`);
  process.env.LAYA_PYTHON=require('./fake-bin.cjs').fakeBin(dir,'python',fake);
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=120000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Watch smoke timed out');await new Promise(r=>setTimeout(r,500));}};
  win.show();await js(`window.bula.saveSettings({provider:'local',localEngine:'builtin',builtinModel:'qwen3.5-2b',volume:false,replyLanguage:'zh-Hant'})`);
  await js(`window.__watch=[];window.bula.onWatch(e=>window.__watch.push(e));window.bula.openGame('laya','pikachu')`);
  let source;await wait(async()=>{source=(await js(`window.bula.watchSources()`)).find(s=>process.env.WATCH_SOURCE==='screen'?s.screen:/pikachu|皮卡丘/i.test(s.name));return Boolean(source);},60000);
  await new Promise(r=>setTimeout(r,8000));
  const info=await js(`window.bula.watchStart({sourceId:${JSON.stringify(source.id)},game:'皮卡丘打排球',interval:5})`);
  try{await wait(async()=>(await js(`window.__watch.filter(e=>e.state==='comment').length`))>=3,240000);}catch(error){console.log('WATCH_DEBUG',JSON.stringify((await js(`window.__watch`)).slice(-8)));throw error;}
  const events=await js(`window.__watch`);await js(`window.bula.watchStop()`);
  const comments=events.filter(e=>e.state==='comment');assert.ok(comments.length>=3);
  console.log('WATCH_SMOKE',JSON.stringify({window:source.name,brief:info,comments:comments.map(c=>({text:c.text,emotion:c.emotion,progress:c.progress})),errors:events.filter(e=>e.state==='error').map(e=>e.error).slice(0,3)}));
}
module.exports={run};
