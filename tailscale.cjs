// Tailscale publishes the phone remote inside the user's own tailnet with HTTPS (tailscale serve); nothing is exposed to the internet.
const fs=require('node:fs');const {execFile}=require('node:child_process');

const CANDIDATES=['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale'];
const REMOTE_PORT=8443;
const binary=(exists=fs.existsSync)=>CANDIDATES.find(p=>exists(p))||null;
const run=(bin,args,runner=execFile)=>new Promise((resolve,reject)=>runner(bin,args,{timeout:15000},(error,stdout,stderr)=>error?reject(new Error(String(stderr||error.message).trim().split('\n').slice(-2).join(' '))):resolve(String(stdout))));

// {installed, running, dnsName, url} — url is where the phone opens the remote once serving is on.
async function status({exists,runner}={}){
  const bin=binary(exists);if(!bin)return {installed:false,running:false};
  try{
    const data=JSON.parse(await run(bin,['status','--json'],runner));
    const dnsName=String(data.Self?.DNSName||'').replace(/\.$/,'');const running=data.BackendState==='Running'&&Boolean(dnsName);
    return {installed:true,running,dnsName,url:running?`https://${dnsName}:${REMOTE_PORT}/remote/`:null};
  }catch(error){return {installed:true,running:false,error:error.message};}
}
// Proxy https://<this Mac>.<tailnet>.ts.net:8443 to the local remote server. Needs MagicDNS and HTTPS certificates in the tailnet.
async function serve(localPort,{exists,runner}={}){
  const bin=binary(exists);if(!bin)throw new Error('這台 Mac 還沒安裝 Tailscale。');
  try{await run(bin,['serve','--bg',`--https=${REMOTE_PORT}`,`http://127.0.0.1:${localPort}`],runner);}
  catch(error){throw new Error(/HTTPS|cert/i.test(error.message)?`Tailscale 還沒開啟 HTTPS 憑證：到 Tailscale 管理後台的 DNS 頁面開啟 MagicDNS 與 HTTPS Certificates 後再試。（${error.message}）`:`Tailscale serve 失敗：${error.message}`);}
}
async function stop({exists,runner}={}){const bin=binary(exists);if(bin)await run(bin,['serve',`--https=${REMOTE_PORT}`,'off'],runner).catch(()=>{});}
module.exports={status,serve,stop,binary,REMOTE_PORT};
