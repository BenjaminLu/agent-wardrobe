const {ROOT}=require('./root.cjs');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const L = require('./locales.cjs');
const FILES={ '/':'wardrobe.html','/wardrobe.js':'wardrobe.js','/wardrobe.css':'wardrobe.css','/interaction.css':'interaction.css','/avatars.js':'avatars.js','/avatar.css':'avatar.css','/i18n.js':'i18n.js','/platform-text.js':'platform-text.js','/vendor/vrm-kit.js':'vendor/vrm-kit.js' };
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.vrm':'model/gltf-binary'};
async function startControl({runtime,catalog,modsRoot=path.join(ROOT,'mods'),language,onSelect,onProvider,onHook,onConnectClaude,onInspectDesktop,onControlConnect,identity={}}) {
  const token=identity.token||randomBytes(32).toString('hex'), clients=new Set(); let origin;
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  function authorized(req,value) { const supplied=Buffer.from(value||'');const expected=Buffer.from(token);return supplied.length===expected.length&&timingSafeEqual(supplied,expected); }
  function event(state) { for(const res of clients)res.write(`data: ${JSON.stringify(state)}\n\n`); }
  // a language change is announced as a named event; the page fetches /api/i18n again
  function languageEvent(lang) { for(const res of clients)res.write(`event: i18n\ndata: ${JSON.stringify({lang})}\n\n`); }
  const server=http.createServer(async(req,res)=>{
    try {
      if(req.headers.host!==new URL(origin).host){send(res,403,{error:'Invalid host'});return;}
      if(req.headers.origin&&req.headers.origin!==origin){send(res,403,{error:'Invalid origin'});return;}
      const url=new URL(req.url,origin);
      const credential=req.headers.authorization?.replace(/^Bearer /,'') || (url.pathname==='/api/events'?url.searchParams.get('token'):null);
      if(url.pathname.startsWith('/api/')&&!authorized(req,credential)){send(res,401,{error:'Open the control page from the desktop app'});return;}
      if(req.method==='GET'&&url.pathname==='/api/catalog'){send(res,200,{catalog,state:runtime.snapshot(),language});return;}
      // the interface language and its dictionary (the page has no preload; it calls i18n.set with these)
      if(req.method==='GET'&&url.pathname==='/api/i18n'){send(res,200,L.bundle());return;}
      if(req.method==='GET'&&url.pathname==='/api/desktop'&&onInspectDesktop){send(res,200,await onInspectDesktop());return;}
      if(req.method==='GET'&&url.pathname==='/api/events'){
        if(onControlConnect)onControlConnect();
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
        res.write(`data: ${JSON.stringify(runtime.snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;
      }
      if(req.method==='POST'&&['/api/select','/api/provider','/api/hook','/api/claude-connect'].includes(url.pathname)){
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(url.pathname==='/api/hook'?65536:4096)){send(res,413,{error:'Request too large'});return;}}
        const data=JSON.parse(body);
        if(url.pathname==='/api/hook'){if(!onHook){send(res,404,{error:'Hooks unavailable'});return;}send(res,200,await onHook(data));return;}
        if(url.pathname==='/api/claude-connect'){if(!onConnectClaude){send(res,404,{error:'Hooks unavailable'});return;}send(res,200,await onConnectClaude());return;}
        const state=url.pathname==='/api/select'?await onSelect({modId:data.modId,skinId:data.skinId,personaId:data.personaId}):await onProvider(data.provider);
        send(res,200,state);return;
      }
      if(req.method==='GET'&&FILES[url.pathname]){
        res.writeHead(200,{'Content-Type':MIME[path.extname(FILES[url.pathname])],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' blob:; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'"});
        res.end(fs.readFileSync(path.join(ROOT,FILES[url.pathname])));return;
      }
      // Mod assets: only files the catalog validated, from that Mod's own folder.
      const modAsset=url.pathname.match(/^\/mods\/([a-z][a-z0-9-]{0,63})\/([^/]+)$/);
      if(req.method==='GET'&&modAsset){
        const mod=catalog.find(item=>item.id===modAsset[1]),file=decodeURIComponent(modAsset[2]);
        if(!mod?.assets?.includes(file)){send(res,404,{error:'Not found'});return;}
        res.writeHead(200,{'Content-Type':MIME[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(fs.readFileSync(path.join(modsRoot,mod.id,file)));return;
      }
      send(res,404,{error:'Not found'});
    }catch(error){send(res,400,{error:error.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(identity.port||0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;runtime.on('change',event);const offLanguage=L.onChange(languageEvent);
  return {url:`${origin}/#${token}`,origin,token,port:server.address().port,close:async()=>{runtime.off('change',event);offLanguage();for(const res of clients)res.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
module.exports={startControl};
