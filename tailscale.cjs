// Tailscale publishes the phone remote inside the user's own tailnet with HTTPS (tailscale serve); nothing is exposed to the internet.
const L=require('./locales.cjs');
const fs=require('node:fs');const {execFile}=require('node:child_process');

const path=require('node:path');
// Where Tailscale's CLI lives per platform (Linux: the package, the snap or a manual install; any other place on PATH also works).
const CANDIDATES={
  darwin:['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale'],
  win32:[path.win32.join(process.env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe'),path.win32.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Tailscale','tailscale.exe')],
  linux:['/usr/bin/tailscale','/usr/sbin/tailscale','/usr/local/bin/tailscale','/snap/bin/tailscale']
};
const REMOTE_PORT=8443;
const binary=(exists=fs.existsSync,platform=process.platform)=>(CANDIDATES[platform]||[]).find(p=>exists(p))||(exists===fs.existsSync?require('./platform.cjs').which('tailscale'):null)||null;
const run=(bin,args,runner=execFile)=>new Promise((resolve,reject)=>runner(bin,args,{timeout:15000},(error,stdout,stderr)=>error?reject(new Error(String(stderr||error.message).trim().split('\n').slice(-2).join(' '))):resolve(String(stdout))));

// {installed, running, dnsName, url} — url is where the phone opens the remote once serving is on.
async function status({exists,runner,platform}={}){
  const bin=binary(exists,platform);if(!bin)return {installed:false,running:false};
  try{
    const data=JSON.parse(await run(bin,['status','--json'],runner));
    const dnsName=String(data.Self?.DNSName||'').replace(/\.$/,'');const running=data.BackendState==='Running'&&Boolean(dnsName);
    return {installed:true,running,dnsName,url:running?`https://${dnsName}:${REMOTE_PORT}/remote/`:null};
  }catch(error){return {installed:true,running:false,error:error.message};}
}
// Proxy https://<this Mac>.<tailnet>.ts.net:8443 to the local remote server. Needs MagicDNS and HTTPS certificates in the tailnet.
async function serve(localPort,{exists,runner,platform}={}){
  const bin=binary(exists,platform);if(!bin)throw L.error('tailscale.notInstalled');
  try{await run(bin,['serve','--bg',`--https=${REMOTE_PORT}`,`http://127.0.0.1:${localPort}`],runner);}
  catch(error){throw L.error(/access denied|permission|operator/i.test(error.message)?'tailscale.operator':/HTTPS|cert/i.test(error.message)?'tailscale.https':'tailscale.serveFailed',{reason:error.message});}
}
async function stop({exists,runner,platform}={}){const bin=binary(exists,platform);if(bin)await run(bin,['serve',`--https=${REMOTE_PORT}`,'off'],runner).catch(()=>{});}
module.exports={status,serve,stop,binary,REMOTE_PORT,CANDIDATES};
