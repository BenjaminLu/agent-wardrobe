// What every desktop build puts in resources/app (scripts/package-mac.cjs, package-win.cjs, package-linux.cjs).
// Engines and models that download on first use (llama.cpp, VOICEVOX, CosyVoice / GPT-SoVITS environments, Kokoro and
// speech-recognition models, Live2D Cubism Core) live in userData and are never bundled; the 8 MB wake-word model is.
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const DIRS=['mods','vendor','game','remote','person','library-thumbs','models','voice-engines'];
const RUNTIME_PACKAGES=['sherpa-onnx-node','ws','pinyin-pro','opencc-js','qrcode-generator','ag-psd','base64-js','pako'];
// sherpa-onnx's prebuilt native libraries come as one optional package per platform.
const sherpaPackage=(platform,arch)=>`sherpa-onnx-${platform==='win32'?'win':platform}-${arch}`;
const HELPERS={darwin:{source:'native-input.swift',binary:'native-input'},win32:{source:'native-input.cs',binary:'native-input.exe'}};
function copyApp(appRoot,{platform=process.platform,arch=process.arch}={}){
  fs.mkdirSync(appRoot,{recursive:true});
  const files=fs.readdirSync(root).filter(name=>/\.(cjs|js|html|css)$/.test(name)||name==='package.json'||name==='THIRD_PARTY.md');
  for(const filename of files)fs.copyFileSync(path.join(root,filename),path.join(appRoot,filename));
  for(const dir of DIRS)fs.cpSync(path.join(root,dir),path.join(appRoot,dir),{recursive:true});
  // App icon copies for the tray / menu bar and the phone (the executable's own icon is set per platform).
  fs.mkdirSync(path.join(appRoot,'build'),{recursive:true});for(const name of ['icon.png','icon-256.png'])fs.copyFileSync(path.join(root,'build',name),path.join(appRoot,'build',name));
  // Local voice runtime (native addon + its prebuilt libraries); the voice model itself downloads on first use.
  for(const pkg of [...RUNTIME_PACKAGES,sherpaPackage(platform,arch)]){
    if(!fs.existsSync(path.join(root,'node_modules',pkg)))throw new Error(`node_modules/${pkg} is missing; run npm ci on ${platform}-${arch}`);
    fs.cpSync(path.join(root,'node_modules',pkg),path.join(appRoot,'node_modules',pkg),{recursive:true,verbatimSymlinks:true});
  }
  fs.copyFileSync(path.join(root,'agent-pty.py'),path.join(appRoot,'agent-pty.py'));
  // Computer-use input helper: Swift on macOS, C# on Windows (both built by npm run build:native); Linux runs the system's xdotool.
  const helper=HELPERS[platform];
  if(helper){
    fs.copyFileSync(path.join(root,helper.source),path.join(appRoot,helper.source));
    if(!fs.existsSync(path.join(root,'bin',helper.binary)))throw new Error('Run npm run build:native before packaging');
    fs.cpSync(path.join(root,'bin'),path.join(appRoot,'bin'),{recursive:true});
  }
  // The smoke suites ship too (they only run with --smoke-test), so a release can be checked as built.
  fs.mkdirSync(path.join(appRoot,'scripts'),{recursive:true});for(const name of fs.readdirSync(path.join(root,'scripts')).filter(n=>/-smoke\.cjs$/.test(n)))fs.copyFileSync(path.join(root,'scripts',name),path.join(appRoot,'scripts',name));
  const missing=missingRequires(appRoot);if(missing.length)throw new Error(`Packaged app would fail to load: ${missing.join(', ')}`);
}
// Every relative require() in the packaged app must resolve inside it (test fixtures are only loaded by --smoke-test runs).
function missingRequires(appRoot){
  const missing=[];
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='node_modules'||e.name==='vendor'?[]:e.isDirectory()?walk(path.join(dir,e.name)):/\.(cjs|js)$/.test(e.name)?[path.join(dir,e.name)]:[]);
  for(const file of walk(appRoot))for(const [,request] of fs.readFileSync(file,'utf8').matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)){
    const target=path.resolve(path.dirname(file),request);if(path.relative(appRoot,target).split(/[\\/]/).includes('test'))continue;
    if(!['','.cjs','.js','.json'].some(ext=>fs.existsSync(target+ext)))missing.push(`${path.relative(appRoot,file)} → ${request}`);
  }
  return [...new Set(missing)];
}
const size=target=>{const stat=fs.lstatSync(target);return stat.isDirectory()?fs.readdirSync(target).reduce((sum,name)=>sum+size(path.join(target,name)),0):stat.size;};
const megabytes=target=>`${(size(target)/1048576).toFixed(1)} MB`;
module.exports={root,DIRS,RUNTIME_PACKAGES,sherpaPackage,copyApp,missingRequires,megabytes};
