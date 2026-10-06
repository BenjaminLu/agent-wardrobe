const test=require('node:test');require('../src/main/locales.cjs').setLanguage('zh-Hant');  // messages are matched in the source language
const assert=require('node:assert/strict');const {WebSocketServer}=require('ws');
const edge=require('../src/main/edge-tts.cjs');
test('the token is stable within a 5-minute window and changes after it',()=>{
  const t=1790000000;assert.equal(edge.secMsGec(t),edge.secMsGec(t+299-(t%300)));assert.notEqual(edge.secMsGec(t),edge.secMsGec(t+300));assert.match(edge.secMsGec(t),/^[0-9A-F]{64}$/);
});
test('text is escaped into SSML with the voice language and speed',()=>{
  const out=edge.ssml(`<script>&"'`,'zh-TW-HsiaoChenNeural',1.2);
  assert.match(out,/xml:lang='zh-TW'/);assert.match(out,/rate='\+20%'/);assert.ok(out.includes('&lt;script&gt;&amp;&quot;&apos;'));assert.ok(!out.includes('<script>'));
});
async function fakeEdge(onSsml,fn){
  const server=new WebSocketServer({port:0});const seen={};
  server.on('connection',(ws,req)=>{seen.url=req.url;seen.headers=req.headers;ws.on('message',data=>{const text=String(data);if(text.includes('Path:ssml')){seen.ssml=text;onSsml(ws);}});});
  await new Promise(r=>server.on('listening',r));
  try{return {result:await fn(`ws://127.0.0.1:${server.address().port}/edge`),seen};}finally{server.close();}
}
const frame=(path,payload)=>{const head=Buffer.from(`X-RequestId:1\r\nPath:${path}\r\n`);const len=Buffer.alloc(2);len.writeUInt16BE(head.length);return Buffer.concat([len,head,payload]);};
test('audio frames are joined until turn.end',async()=>{
  const {result,seen}=await fakeEdge(ws=>{ws.send(frame('audio',Buffer.from('AB')));ws.send(frame('audio',Buffer.from('CD')));ws.send(frame('response',Buffer.from('xx')));ws.send('Path:turn.end\r\n\r\n{}');},
    url=>edge.synthesize('你好','zh-TW-YunJheNeural',1,{url}));
  assert.equal(result.toString(),'ABCD');assert.match(seen.url,/Sec-MS-GEC=[0-9A-F]{64}/);assert.equal(seen.headers.origin,'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold');assert.match(seen.ssml,/zh-TW-YunJheNeural/);
});
test('unknown voices and silent replies are errors',async()=>{
  await assert.rejects(edge.synthesize('hi','xx-Unknown'),/Unknown Edge voice/);
  await assert.rejects(fakeEdge(ws=>ws.send('Path:turn.end\r\n\r\n{}'),url=>edge.synthesize('hi','zh-TW-HsiaoYuNeural',1,{url})),/沒有回傳聲音/);
});
