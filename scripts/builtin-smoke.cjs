const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {app}=require('electron');
const {RUNTIME}=require('../local-llm.cjs');
// Built-in brain with a real model: LLM_MODEL_SRC holds llama-<tag>/ and qwen3.5-2b/ (model.gguf, mmproj.gguf), linked in, not copied.
async function run({win}){
  const src=process.env.LLM_MODEL_SRC,root=path.join(app.getPath('userData'),'models','llm');fs.mkdirSync(path.join(root,'qwen3.5-2b'),{recursive:true});
  fs.symlinkSync(path.join(src,`llama-${RUNTIME.tag}`),path.join(root,`llama-${RUNTIME.tag}`));
  for(const name of ['model.gguf','mmproj.gguf'])fs.symlinkSync(path.join(src,'qwen3.5-2b',name),path.join(root,'qwen3.5-2b',name));fs.writeFileSync(path.join(root,'qwen3.5-2b','.complete'),'ok');
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=120000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Builtin smoke timed out');await new Promise(r=>setTimeout(r,200));}};
  win.show();await js(`window.bula.saveSettings({provider:'local',localEngine:'builtin',builtinModel:'qwen3.5-2b',volume:false})`);
  const status=await js(`window.bula.llmStatus()`);assert.equal(status.models.find(m=>m.id==='qwen3.5-2b').installed,true);
  // saving the choice warms the server, so the first message does not pay the load time
  await wait(async()=>(await js(`window.bula.llmStatus()`)).running==='qwen3.5-2b');await new Promise(r=>setTimeout(r,500));
  const started=Date.now();
  await js(`document.querySelector('#task-mode').value='chat';document.querySelector('#prompt').value='用一句話介紹你自己';document.querySelector('#chat-form').requestSubmit();true`);
  await wait(()=>js(`document.querySelectorAll('#conversation .message.assistant').length>1||document.querySelector('#conversation .message.error')!==null`));
  const error=await js(`document.querySelector('#conversation .message.error')?.textContent||''`);assert.equal(error,'',error);
  const reply=await js(`[...document.querySelectorAll('#conversation .message.assistant')].at(-1).textContent`);assert.ok(reply.trim().length>1);
  assert.equal((await js(`window.bula.llmStatus()`)).running,'qwen3.5-2b');
  const direct=await js(`window.bula.chat('今天好開心！',{auto:false})`);assert.equal(direct.ok,true,direct.error);assert.match(direct.emotion,/^(neutral|smug|happy|surprised|nervous|sad)$/);assert.doesNotMatch(direct.text,/^\s*\{/,'the JSON wrapper never reaches the chat');
  console.log('BUILTIN_SMOKE',JSON.stringify({model:'qwen3.5-2b',firstReplySeconds:Math.round((Date.now()-started)/1000),emotion:direct.emotion,reply:reply.slice(0,60)}));
}
module.exports={run};
