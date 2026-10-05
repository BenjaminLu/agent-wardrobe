// Experimental: installs the open Laya decision model (Apache-2.0) into .laya/venv and caches its weights (~800 MB).
// Usage: npm run laya:setup
const {execFileSync,spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..'),venv=path.join(root,'.laya','venv'),python=path.join(venv,'bin','python');
const has=cmd=>{try{execFileSync('/usr/bin/which',[cmd],{stdio:'ignore'});return true;}catch{return false;}};
if(!fs.existsSync(python)){
  fs.mkdirSync(path.dirname(venv),{recursive:true});
  if(has('uv'))execFileSync('uv',['venv','-q','--python','3.12',venv],{stdio:'inherit'});else execFileSync('python3',['-m','venv',venv],{stdio:'inherit'});
}
if(has('uv'))execFileSync('uv',['pip','install','-q','--python',python,'laya==0.3.26'],{stdio:'inherit'});else execFileSync(python,['-m','pip','install','-q','laya==0.3.26'],{stdio:'inherit'});
console.log('Downloading and loading the Laya weights…');
const child=spawn(python,[path.join(root,'game','laya-sidecar.py')],{stdio:['pipe','pipe','inherit']});
child.stdout.on('data',data=>{const line=String(data).split('\n').find(l=>l.startsWith('@laya '));if(line&&JSON.parse(line.slice(6)).ready){console.log(`Laya ready: ${line.slice(6)}`);child.stdin.end();}});
child.on('exit',code=>process.exit(code||0));
