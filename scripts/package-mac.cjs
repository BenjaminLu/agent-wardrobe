const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(process.platform!=='darwin')throw new Error('macOS packaging requires macOS');
const output=path.join(root,'dist/Agent Wardrobe.app');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.rmSync(output,{recursive:true,force:true});
fs.cpSync(path.join(root,'node_modules/electron/dist/Electron.app'),output,{recursive:true,verbatimSymlinks:true});
const appRoot=path.join(output,'Contents/Resources/app');fs.mkdirSync(appRoot,{recursive:true});
const files=fs.readdirSync(root).filter(name=>/\.(cjs|js|html|css)$/.test(name)||name==='package.json'||name==='THIRD_PARTY.md');
for(const filename of files)fs.copyFileSync(path.join(root,filename),path.join(appRoot,filename));
fs.cpSync(path.join(root,'mods'),path.join(appRoot,'mods'),{recursive:true});
fs.cpSync(path.join(root,'vendor'),path.join(appRoot,'vendor'),{recursive:true});
fs.cpSync(path.join(root,'game'),path.join(appRoot,'game'),{recursive:true});
fs.cpSync(path.join(root,'remote'),path.join(appRoot,'remote'),{recursive:true});
fs.cpSync(path.join(root,'person'),path.join(appRoot,'person'),{recursive:true});
fs.cpSync(path.join(root,'library-thumbs'),path.join(appRoot,'library-thumbs'),{recursive:true});
// App icon (Annie, made by scripts/make-icon.cjs): the bundle keeps Electron's icon file name, plus small copies for the menu bar and phone.
fs.copyFileSync(path.join(root,'build/icon.icns'),path.join(output,'Contents/Resources/electron.icns'));
fs.mkdirSync(path.join(appRoot,'build'),{recursive:true});for(const name of ['icon.png','icon-256.png'])fs.copyFileSync(path.join(root,'build',name),path.join(appRoot,'build',name));
// Wake-word model (8 MB) ships with the app; the speech-recognition model downloads on first use.
fs.cpSync(path.join(root,'models'),path.join(appRoot,'models'),{recursive:true});
// Local voice runtime (native addon + its prebuilt macOS libraries); the voice model itself downloads on first use.
for(const pkg of ['sherpa-onnx-node',`sherpa-onnx-darwin-${process.arch}`,'ws','pinyin-pro','opencc-js','qrcode-generator','ag-psd','base64-js','pako'])fs.cpSync(path.join(root,'node_modules',pkg),path.join(appRoot,'node_modules',pkg),{recursive:true,verbatimSymlinks:true});
fs.copyFileSync(path.join(root,'agent-pty.py'),path.join(appRoot,'agent-pty.py'));
fs.copyFileSync(path.join(root,'native-input.swift'),path.join(appRoot,'native-input.swift'));
if(!fs.existsSync(path.join(root,'bin/native-input')))throw new Error('Run npm run build:native before packaging');
fs.cpSync(path.join(root,'bin'),path.join(appRoot,'bin'),{recursive:true});
// Real-permission verification for external-app computer tools must run under the packaged identity.
// The smoke suites ship too (they only run with --smoke-test), so a signed release can be checked as built.
fs.mkdirSync(path.join(appRoot,'scripts'));for(const name of fs.readdirSync(path.join(root,'scripts')).filter(n=>/-smoke\.cjs$/.test(n)))fs.copyFileSync(path.join(root,'scripts',name),path.join(appRoot,'scripts',name));
for(const [key,value] of [['CFBundleName','Agent Wardrobe'],['CFBundleDisplayName','Agent Wardrobe'],['CFBundleIdentifier',process.env.AGENT_WARDROBE_BUNDLE_ID||'local.agent-wardrobe.poc'],['NSCameraUsageDescription','Agent Wardrobe uses the camera only when you take a photo to make a cartoon character. The photo is analysed on this Mac and not saved.'],['NSMicrophoneUsageDescription','Agent Wardrobe listens for your wake word and the question that follows. Audio is processed on this Mac and never stored or uploaded.']])execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,path.join(output,'Contents/Info.plist')]);
// A stable certificate keeps macOS Accessibility / Screen Recording grants across rebuilds; ad-hoc pins them to one build.
// --release signs for other Macs: Developer ID identity, hardened runtime, every nested binary signed inside-out, then notarized.
const release=process.argv.includes('--release');
const identity=process.env.AGENT_WARDROBE_SIGN_IDENTITY||'Agent Wardrobe Local Signing';
let sign='-';
try{if(execFileSync('/usr/bin/security',['find-certificate','-c',identity],{encoding:'utf8'}).includes(identity))sign=identity;}catch{}
if(release&&sign==='-')throw new Error(`--release needs the "${identity}" certificate in the keychain (set AGENT_WARDROBE_SIGN_IDENTITY to your "Developer ID Application: …" name).`);
if(sign==='-')console.warn(`No "${identity}" certificate; using ad-hoc signing. Run node scripts/create-signing-identity.cjs so privacy grants survive rebuilds.`);
if(release)signForRelease();else{execFileSync('/usr/bin/codesign',['--force','--deep','--sign',sign,output],{stdio:'inherit'});console.log(output);}

function signForRelease(){
const entitlements=process.env.AGENT_WARDROBE_ENTITLEMENTS||path.join(root,'build/entitlements.mac.plist');
const codesign=(target,extra=[])=>execFileSync('/usr/bin/codesign',['--force','--timestamp','--options','runtime','--sign',sign,...extra,target],{stdio:['ignore','ignore','inherit']});
const isMachO=file=>{try{const fd=fs.openSync(file,'r');const b=Buffer.alloc(4);fs.readSync(fd,b,0,4,0);fs.closeSync(fd);return [0xfeedfacf,0xcafebabe,0xcffaedfe,0xbebafeca].includes(b.readUInt32BE(0));}catch{return false;}};
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);return e.isSymbolicLink()?[]:e.isDirectory()?walk(p):[p];});
// Deepest first: loose binaries (.node, .dylib, helpers' executables), then frameworks and helper apps, then the app itself.
const contents=path.join(output,'Contents');
for(const file of walk(contents).filter(isMachO).sort((a,b)=>b.split('/').length-a.split('/').length))codesign(file,file.includes('/MacOS/')?['--entitlements',entitlements]:[]);
for(const bundle of [...new Set(walk(contents).flatMap(f=>{const out=[];let m;const re=/\.(?:framework|app)(?=\/)/g;while((m=re.exec(f)))out.push(f.slice(0,m.index+m[0].length));return out;}))].filter(b=>b!==output).sort((a,b)=>b.length-a.length))codesign(bundle,bundle.endsWith('.app')?['--entitlements',entitlements]:[]);
codesign(output,['--entitlements',entitlements]);
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',output],{stdio:'inherit'});
const profile=process.env.AGENT_WARDROBE_NOTARY_PROFILE;
if(!profile){console.warn('Signed for release but not notarized: set AGENT_WARDROBE_NOTARY_PROFILE (xcrun notarytool store-credentials) to notarize.');console.log(output);return;}
const zip=path.join(root,'dist/Agent Wardrobe.zip');fs.rmSync(zip,{force:true});
execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',output,zip],{stdio:'inherit'});
execFileSync('/usr/bin/xcrun',['notarytool','submit',zip,'--keychain-profile',profile,'--wait'],{stdio:'inherit'});
execFileSync('/usr/bin/xcrun',['stapler','staple',output],{stdio:'inherit'});
fs.rmSync(zip,{force:true});execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',output,zip],{stdio:'inherit'});
console.log(zip);
}
