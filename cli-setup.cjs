// Codex / Claude for people with a subscription: the official installer and sign-in run in Terminal,
// where the user sees every step; the app only writes the script and checks the result afterwards.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFile}=require('node:child_process');
const {binary}=require('./cli.cjs');

const TOOLS={
  claude:{label:'Claude Code',install:'curl -fsSL https://claude.ai/install.sh | bash',login:['auth','login'],status:['auth','status','--json'],
    ready:out=>{try{return JSON.parse(out).loggedIn===true;}catch{return false;}}},
  codex:{label:'Codex',install:'curl -fsSL https://chatgpt.com/codex/install.sh | sh',login:['login'],status:['login','status'],
    ready:(out,code)=>code===0&&/logged in/i.test(out)}
};
const quote=value=>`'${String(value).replace(/'/g,`'\\''`)}'`;
const installed=(name,find=binary)=>find(name)||null;

function check(name,{find=binary,run=execFile}={}){
  const tool=TOOLS[name];if(!tool)return Promise.reject(new Error('Unknown tool'));
  const bin=installed(name,find);if(!bin)return Promise.resolve({installed:false,loggedIn:false});
  return new Promise(resolve=>run(bin,tool.status,{timeout:10000},(error,stdout='',stderr='')=>resolve({installed:true,loggedIn:tool.ready(`${stdout}${stderr}`,error?error.code??1:0)})));
}
async function status(options){const [claude,codex]=await Promise.all([check('claude',options),check('codex',options)]);return {claude,codex};}

// Install only when missing, then sign in; a failed step keeps the window open with its message.
function script(name,{find=binary,home=os.homedir()}={}){
  const tool=TOOLS[name];if(!tool)throw new Error('Unknown tool');
  const bin=installed(name,find)||path.join(home,'.local','bin',name);
  return ['#!/bin/zsh',`echo ${quote(`== ${tool.label} 設定（官方安裝程式與登入）==`)}`,
    `if [ ! -x ${quote(bin)} ]; then`,`  echo ${quote(`正在安裝 ${tool.label}…`)}`,
    `  ${tool.install} || { echo ${quote('安裝失敗，請檢查網路後再試一次。')}; read -k1; exit 1; }`,'fi',
    `echo ${quote('接著會開啟瀏覽器，請用你的訂閱帳號登入。')}`,
    `${quote(bin)} ${tool.login.map(quote).join(' ')} || { echo ${quote('登入沒有完成，可以回到 App 再按一次。')}; read -k1; exit 1; }`,
    `echo; echo ${quote('完成！可以關掉這個視窗，回到 App。')}`,''].join('\n');
}
function writeScript(name,dir=os.tmpdir(),options){const file=path.join(dir,`agent-wardrobe-${name}-setup.command`);fs.writeFileSync(file,script(name,options),{mode:0o700});fs.chmodSync(file,0o700);return file;}
module.exports={TOOLS,check,status,script,writeScript};
