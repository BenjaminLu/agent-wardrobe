const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
// Windows: bin/native-input.exe from native-input.cs. Linux drives xdotool directly and has nothing to build.
if(process.platform==='win32'){require('../computer-input.cjs').buildWindows(root);process.exit(0);}
if(process.platform==='linux'){console.log('Linux computer use runs xdotool at runtime; nothing to build.');process.exit(0);}
if(process.platform!=='darwin')throw new Error('Native input requires macOS or Windows');
fs.mkdirSync(path.join(root,'bin'),{recursive:true});
execFileSync('/usr/bin/xcrun',['swiftc','-O',path.join(root,'native-input.swift'),'-o',path.join(root,'bin/native-input')],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--force','--sign','-',path.join(root,'bin/native-input')],{stdio:'inherit'});
