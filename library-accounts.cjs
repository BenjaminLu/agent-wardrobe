// Sign-ins for the avatar store's libraries. Everything is kept encrypted in the app's Secrets store (macOS Keychain),
// never handed to a page.
//  VRoid Hub — OAuth 2.0 with PKCE, using the developer app the user registers at hub.vroid.com/oauth/applications.
//              The sign-in runs in its own window; the redirect back is caught before it loads, so no local server is needed.
//  Sketchfab — the user's own API token (sketchfab.com/settings/password), needed only for downloads.
const crypto=require('node:crypto');
const VROID='https://hub.vroid.com';
const REDIRECT='agentwardrobe://vroid-callback';
const b64url=buffer=>buffer.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

function createAccounts({secrets,BrowserWindow,fetchImpl=fetch,now=()=>Date.now()}){
  const read=name=>{try{return secrets.get(name);}catch{return null;}};
  const json=name=>{try{return JSON.parse(read(name)||'null');}catch{return null;}};
  async function tokenRequest(params){
    const app=json('vroidApp');if(!app)throw new Error('還沒設定 VRoid 開發者 App。');
    const response=await fetchImpl(`${VROID}/oauth/token`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'X-Api-Version':'11','Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:app.clientId,client_secret:app.clientSecret,redirect_uri:REDIRECT,...params})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.access_token)throw new Error(`VRoid Hub 沒有給登入許可（${data.error_description||data.error||response.status}）`);
    secrets.set('vroidToken',JSON.stringify({access:data.access_token,refresh:data.refresh_token||null,expires:now()+((data.expires_in||3600)-60)*1000}));
    return data.access_token;
  }
  const vroid={
    redirect:REDIRECT,
    status:()=>({configured:Boolean(json('vroidApp')),connected:Boolean(json('vroidToken'))}),
    configure({clientId,clientSecret}){
      clientId=String(clientId||'').trim();clientSecret=String(clientSecret||'').trim();
      if(!/^[\w-]{8,200}$/.test(clientId)||!/^[\w-]{8,200}$/.test(clientSecret))throw new Error('Application ID 或 Secret 的格式不對，請從 VRoid Hub 的 App 頁面完整複製。');
      secrets.set('vroidApp',JSON.stringify({clientId,clientSecret}));secrets.clear('vroidToken');return vroid.status();
    },
    // opens VRoid Hub's sign-in page; resolves once the user allows the app
    connect(){
      const app=json('vroidApp');if(!app)return Promise.reject(new Error('還沒設定 VRoid 開發者 App。'));
      const verifier=b64url(crypto.randomBytes(48)),state=b64url(crypto.randomBytes(16));
      const challenge=b64url(crypto.createHash('sha256').update(verifier).digest());
      const url=`${VROID}/oauth/authorize?${new URLSearchParams({response_type:'code',client_id:app.clientId,redirect_uri:REDIRECT,scope:'default',state,code_challenge:challenge,code_challenge_method:'S256'})}`;
      return new Promise((resolve,reject)=>{
        const win=new BrowserWindow({width:520,height:720,title:'連結 VRoid Hub',autoHideMenuBar:true,webPreferences:{partition:'persist:vroid',sandbox:true,contextIsolation:true}});
        let done=false;
        const finish=(error,value)=>{if(done)return;done=true;if(!win.isDestroyed())win.close();error?reject(error):resolve(value);};
        const catchRedirect=(event,target)=>{if(!String(target).startsWith(REDIRECT))return;event.preventDefault();
          const back=new URL(target);
          if(back.searchParams.get('state')!==state)return finish(new Error('VRoid Hub 的回應對不上，請再試一次。'));
          if(!back.searchParams.get('code'))return finish(new Error(back.searchParams.get('error')==='access_denied'?'你在 VRoid Hub 選了不允許。':'VRoid Hub 沒有給登入許可。'));
          tokenRequest({grant_type:'authorization_code',code:back.searchParams.get('code'),code_verifier:verifier}).then(()=>finish(null,vroid.status()),finish);};
        win.webContents.on('will-redirect',catchRedirect);win.webContents.on('will-navigate',catchRedirect);
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
        win.on('closed',()=>finish(new Error('VRoid Hub 登入視窗關掉了。')));
        win.loadURL(url).catch(()=>{});
      });
    },
    async token(){
      const saved=json('vroidToken');if(!saved)return null;if(saved.expires>now())return saved.access;
      if(!saved.refresh){secrets.clear('vroidToken');return null;}
      try{return await tokenRequest({grant_type:'refresh_token',refresh_token:saved.refresh});}catch{secrets.clear('vroidToken');return null;}
    },
    expired(){secrets.clear('vroidToken');},
    disconnect(){secrets.clear('vroidToken');return vroid.status();}
  };
  const sketchfab={
    status:()=>({configured:Boolean(read('sketchfabToken'))}),
    token:()=>read('sketchfabToken'),
    configure({token}){token=String(token||'').trim();if(!/^[a-f0-9]{24,64}$/i.test(token))throw new Error('Sketchfab API token 的格式不對，請到 sketchfab.com/settings/password 複製。');secrets.set('sketchfabToken',token);return sketchfab.status();},
    clear(){secrets.clear('sketchfabToken');return sketchfab.status();}
  };
  return {vroid,sketchfab,status:()=>({vroid:vroid.status(),sketchfab:sketchfab.status()})};
}
module.exports={createAccounts,REDIRECT};
