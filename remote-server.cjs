// Phone remote: a small HTTPS-fronted web app for chatting with the character from a phone.
// The server listens on 127.0.0.1 only; Tailscale Serve publishes it inside the user's tailnet (never the internet).
// A phone pairs once with a 6-digit code shown on the Mac and then uses its own device token; devices can be revoked.
const {ON_HERE}=require('./platform.cjs');
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');

const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
class DeviceStore{
  constructor(file,{now=()=>Date.now()}={}){this.file=file;this.now=now;this.code=null;this.attempts=0;}
  read(){try{return JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{return {devices:[]};}}
  write(data){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=`${this.file}.tmp`;fs.writeFileSync(temp,JSON.stringify(data),{mode:0o600});fs.renameSync(temp,this.file);}
  // A pairing code lives five minutes and allows five tries.
  newCode(){this.code={value:String(crypto.randomInt(0,1e6)).padStart(6,'0'),expires:this.now()+5*60*1000};this.attempts=0;return this.code;}
  pair(code,name='Phone'){
    if(!this.code||this.now()>this.code.expires)throw Object.assign(new Error(`配對碼已過期，請在${ON_HERE}重新產生。`),{status:410});
    if(++this.attempts>5){this.code=null;throw Object.assign(new Error(`嘗試太多次，請在${ON_HERE}重新產生配對碼。`),{status:429});}
    const a=Buffer.from(String(code)),b=Buffer.from(this.code.value);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Object.assign(new Error('配對碼不對。'),{status:401});
    this.code=null;const token=crypto.randomBytes(32).toString('hex'),data=this.read();
    const device={id:crypto.randomUUID(),name:String(name).slice(0,60)||'Phone',hash:hash(token),created:new Date(this.now()).toISOString(),lastSeen:null};
    data.devices.push(device);this.write(data);return {token,device:{id:device.id,name:device.name}};
  }
  verify(token){
    if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))return null;const data=this.read(),h=hash(token);
    const device=data.devices.find(d=>crypto.timingSafeEqual(Buffer.from(d.hash),Buffer.from(h)));if(!device)return null;
    if(!device.lastSeen||this.now()-Date.parse(device.lastSeen)>60000){device.lastSeen=new Date(this.now()).toISOString();this.write(data);}
    return device;
  }
  list(){return this.read().devices.map(({id,name,created,lastSeen})=>({id,name,created,lastSeen}));}
  revoke(id){const data=this.read();data.devices=data.devices.filter(d=>d.id!==id);this.write(data);}
}

const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
function createRemote({root,store,getState,chat,modAsset,subscribe,routes={},allowedHosts=()=>[],refreshHosts=null,live2dCore=()=>null}){
  // The phone page and the shared avatar renderer; nothing else on disk is reachable.
  const FILES={'/remote/':'remote/index.html','/remote/index.html':'remote/index.html','/remote/app.js':'remote/app.js','/remote/style.css':'remote/style.css',
    '/remote/manifest.webmanifest':'remote/manifest.webmanifest','/remote/sw.js':'remote/sw.js','/remote/icon.png':'build/icon-256.png',
    '/remote/avatars.js':'avatars.js','/remote/avatar.css':'avatar.css','/remote/vendor/vrm-kit.js':'vendor/vrm-kit.js','/remote/vendor/live2d-kit.js':'vendor/live2d-kit.js'};
  // Live2D's Cubism Core is only served once the user has downloaded it on the Mac (see live2d-core.cjs); WebAssembly needs 'wasm-unsafe-eval'.
  const CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob:; media-src 'self' blob: data:; frame-ancestors 'none'";
  const streams=new Set();let port=0;
  const send=(res,status,body,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(body));};
  const server=http.createServer(async(req,res)=>{
    try{
      // Only the loopback address and the tailnet name are accepted, so other sites cannot reach this server by DNS rebinding.
      const host=String(req.headers.host||'').replace(/:\d+$/,'');
      const known=()=>['127.0.0.1','localhost',...allowedHosts()].includes(host);
      // a *.ts.net name not seen yet: ask Tailscale once more (its name may have been learned after start)
      if(!known()&&refreshHosts&&host.endsWith('.ts.net'))await refreshHosts().catch(()=>{});
      if(!known()){send(res,403,{error:'Unknown host'});return;}
      const url=new URL(req.url,'http://remote');
      const core=url.pathname==='/remote/vendor/live2dcubismcore.min.js'&&['GET','HEAD'].includes(req.method)?live2dCore():undefined;
      if(core===null){send(res,404,{error:'Not found'});return;}
      if(core||req.method==='GET'&&FILES[url.pathname]){
        const file=core||path.join(root,FILES[url.pathname]);
        res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
          'Content-Security-Policy':CSP});
        if(req.method==='HEAD'){res.end();return;}fs.createReadStream(file).pipe(res);return;
      }
      if(req.method==='GET'&&url.pathname==='/'){res.writeHead(302,{Location:'/remote/'});res.end();return;}
      const readBody=async(limit=8192)=>{let body='';for await(const chunk of req){body+=chunk;if(body.length>limit)throw Object.assign(new Error('Too large'),{status:413});}return body?JSON.parse(body):{};};
      if(req.method==='POST'&&url.pathname==='/api/pair'){const data=await readBody(1024);send(res,200,store.pair(data.code,data.name));return;}
      const device=store.verify(String(req.headers.authorization||'').replace(/^Bearer /,''));
      if(!device){send(res,401,{error:'請重新配對這支手機。'});return;}
      if(req.method==='GET'&&url.pathname==='/api/state'){send(res,200,getState());return;}
      if(req.method==='GET'&&url.pathname==='/api/mod-asset'){const data=await modAsset(url.searchParams.get('mod'),url.searchParams.get('file'));res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'private, max-age=3600'});res.end(Buffer.from(data));return;}
      if(req.method==='POST'&&url.pathname==='/api/chat'){const data=await readBody(8192);send(res,200,await chat(String(data.text||''),device,{auto:data.auto===true}));return;}
      // Further endpoints (settings, characters, tasks, files) are supplied by the app; each gets the query, the JSON body and the device.
      const route=routes[`${req.method} ${url.pathname}`];
      // a route is a function, or {fn, limit} when it takes a bigger body (a photo)
      if(route){const fn=route.fn||route;send(res,200,await fn({query:url.searchParams,body:req.method==='POST'?await readBody(route.limit||8192):{},device}));return;}
      if(req.method==='GET'&&url.pathname==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no'});res.write(': connected\n\n');
        const stream={res,device};streams.add(stream);const ping=setInterval(()=>res.write(': ping\n\n'),25000);
        req.on('close',()=>{clearInterval(ping);streams.delete(stream);});return;
      }
      send(res,404,{error:'Not found'});
    }catch(error){if(!res.headersSent)send(res,error.status||500,{error:error.message});else res.end();}
  });
  // A phone already shows its own conversation, so its turns are sent only to the other screens.
  const unsubscribe=subscribe?.((type,data)=>{const {from,...body}=data||{};for(const {res,device} of streams)if(!from||from!==device.id)res.write(`event: ${type}\ndata: ${JSON.stringify(body)}\n\n`);});
  return {
    listen:p=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(p||0,'127.0.0.1',()=>{port=server.address().port;resolve(port);});}),
    get port(){return port;},
    disconnect(deviceId){for(const stream of streams)if(stream.device.id===deviceId){stream.res.end();streams.delete(stream);}},
    close:()=>new Promise(resolve=>{unsubscribe?.();for(const {res} of streams)res.end();streams.clear();server.closeAllConnections();server.close(()=>resolve());})
  };
}
module.exports={createRemote,DeviceStore};
