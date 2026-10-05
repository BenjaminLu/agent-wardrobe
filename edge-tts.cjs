// Edge online voices (Microsoft "Read aloud"), including Taiwanese Mandarin.
// This is the unofficial endpoint the Edge browser uses: free and keyless, but Microsoft may change or block it.
// Only the spoken text is sent; nothing identifies the user beyond a random per-connection cookie.
const crypto=require('node:crypto');
const WebSocket=require('ws');

const TOKEN='6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_VERSION='143.0.3650.75';
const HOST='wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const VOICES=[
  {name:'zh-TW-HsiaoChenNeural',label:'曉臻 · 台灣女聲'},{name:'zh-TW-HsiaoYuNeural',label:'曉雨 · 台灣女聲'},{name:'zh-TW-YunJheNeural',label:'雲哲 · 台灣男聲'},
  {name:'en-US-AvaMultilingualNeural',label:'Ava · English'},{name:'en-US-AndrewMultilingualNeural',label:'Andrew · English'},{name:'ja-JP-NanamiNeural',label:'七海 · 日本語'}
];
let clockSkew=0;
// Sec-MS-GEC: SHA-256 of Windows file time (rounded down to 5 minutes) + client token.
function secMsGec(now=Date.now()/1000+clockSkew){let ticks=Math.floor(now)+11644473600;ticks-=ticks%300;return crypto.createHash('sha256').update(`${BigInt(ticks)*10000000n}${TOKEN}`).digest('hex').toUpperCase();}
const id=()=>crypto.randomUUID().replace(/-/g,'');
const xml=text=>String(text).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[ch]);
function ssml(text,voice,rate){
  const lang=voice.split('-').slice(0,2).join('-');const pct=Math.round((Math.max(.5,Math.min(2,Number(rate)||1))-1)*100);
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='+0Hz' rate='${pct>=0?'+':''}${pct}%' volume='+0%'>${xml(text)}</prosody></voice></speak>`;
}
// Binary frames: 2-byte big-endian header length, text headers, then audio bytes.
function audioOf(frame){const n=frame.readUInt16BE(0);return frame.subarray(2,2+n).toString().includes('Path:audio')?frame.subarray(2+n):null;}

function synthesize(text,voice,rate=1,{url=HOST,signal,retry=true}={}){
  if(!VOICES.some(v=>v.name===voice))return Promise.reject(new Error(`Unknown Edge voice ${voice}`));
  const input=String(text).slice(0,2000);if(!input.trim())return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve,reject)=>{
    const major=EDGE_VERSION.split('.')[0];
    const ws=new WebSocket(`${url}?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${EDGE_VERSION}&ConnectionId=${id()}`,{headers:{
      Origin:'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',Pragma:'no-cache','Cache-Control':'no-cache','Accept-Language':'en-US,en;q=0.9',
      'User-Agent':`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
      Cookie:`muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`}});
    const chunks=[];let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);try{ws.terminate();}catch{}error?reject(error):resolve(value);};
    const onAbort=()=>{const error=new Error('aborted');error.name='AbortError';finish(error);};
    const timer=setTimeout(()=>finish(new Error('Edge 語音逾時，請檢查網路。')),20000);
    signal?.addEventListener('abort',onAbort);
    ws.on('unexpected-response',(_req,res)=>{
      // A 403 is usually clock skew against the token window: correct from the server's clock once.
      const server=Date.parse(res.headers.date||'');
      if(res.statusCode===403&&retry&&server){clockSkew+=(server-Date.now())/1000;settled=true;clearTimeout(timer);ws.terminate();synthesize(text,voice,rate,{url,signal,retry:false}).then(resolve,reject);return;}
      finish(new Error(`Edge 語音服務拒絕連線（${res.statusCode}），微軟可能更改了介面。請先改用其他語音。`));
    });
    ws.on('error',()=>finish(new Error('連不到 Edge 語音服務，請檢查網路。')));
    ws.on('open',()=>{
      const date=new Date().toString();
      ws.send(`X-Timestamp:${date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
      ws.send(`X-RequestId:${id()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${date}Z\r\nPath:ssml\r\n\r\n${ssml(input,voice,rate)}`);
    });
    ws.on('message',(data,binary)=>{
      if(binary){const audio=audioOf(data);if(audio)chunks.push(audio);return;}
      if(String(data).includes('Path:turn.end'))finish(chunks.length?null:new Error('Edge 語音沒有回傳聲音。'),Buffer.concat(chunks));
    });
  });
}
module.exports={synthesize,secMsGec,ssml,audioOf,VOICES,EDGE_VERSION};
