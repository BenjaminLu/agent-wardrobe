const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
// ⤢ cycles the chat panel size; the window grows from its bottom-right corner and the conversation gets taller.
async function run({win}){
  const js=code=>win.webContents.executeJavaScript(code);
  win.show();await new Promise(r=>setTimeout(r,600));
  await js(`for(const t of ['可以幫我整理一下這週的待辦嗎？','好的！這週你有三件事：一、週三前交報告；二、週四下午和設計師開會；三、週五記得繳電費。要我幫你排進行事曆嗎？','好，順便提醒我買貓砂'])message(t,t.startsWith('好的')?'assistant':'user');showChat(true);true`);
  const dir=path.join(__dirname,'..','evidence');fs.mkdirSync(dir,{recursive:true});const seen={};
  for(let i=0;i<3;i++){
    const size=await js(`document.body.dataset.chatSize`);await new Promise(r=>setTimeout(r,400));
    const b=win.getBounds();seen[size]={width:b.width,height:b.height,right:b.x+b.width,bottom:b.y+b.height,conversation:await js(`document.querySelector('#conversation').getBoundingClientRect().height`)};
    fs.writeFileSync(path.join(dir,`chat-size-${size}.png`),(await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#chat-size').click();true`);await new Promise(r=>setTimeout(r,400));
  }
  assert.ok(seen.normal.conversation<seen.large.conversation&&seen.large.conversation<seen.xl.conversation,JSON.stringify(seen));
  assert.ok(seen.xl.width>seen.normal.width);assert.equal(seen.xl.right,seen.normal.right,'anchored at the right edge');assert.equal(seen.xl.bottom,seen.normal.bottom,'anchored at the bottom');
  assert.equal(await js(`document.body.dataset.chatSize`),'large','cycles back to large');
  console.log('CHAT_SIZE_SMOKE',JSON.stringify(seen));
}
module.exports={run};
