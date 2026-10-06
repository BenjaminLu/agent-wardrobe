const fs=require('node:fs');const path=require('node:path');const {randomBytes}=require('node:crypto');
function loadIdentity(directory){
  try{const data=JSON.parse(fs.readFileSync(path.join(directory,'control-identity.json'),'utf8'));if(/^[a-f0-9]{64}$/.test(data.token)&&Number.isInteger(data.port)&&data.port>0&&data.port<65536)return data;}catch{}
  // Migrate the last control URL so the most recently opened page survives this update.
  try{const data=JSON.parse(fs.readFileSync(path.join(directory,'claude-bridge.json'),'utf8'));const url=new URL(data.url);const port=Number(url.port);if(url.hostname==='127.0.0.1'&&/^[a-f0-9]{64}$/.test(data.token)&&port>0&&port<65536)return {token:data.token,port};}catch{}
  return {token:randomBytes(32).toString('hex'),port:0};
}
function saveIdentity(directory,identity){fs.mkdirSync(directory,{recursive:true});const filename=path.join(directory,'control-identity.json');fs.writeFileSync(filename+'.tmp',JSON.stringify(identity),{mode:0o600});fs.renameSync(filename+'.tmp',filename);}
module.exports={loadIdentity,saveIdentity};
