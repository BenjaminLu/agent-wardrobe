const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');if(process.platform!=='darwin')throw new Error('Native input requires macOS');
fs.mkdirSync(path.join(root,'bin'),{recursive:true});
execFileSync('/usr/bin/xcrun',['swiftc','-O',path.join(root,'native-input.swift'),'-o',path.join(root,'bin/native-input')],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--force','--sign','-',path.join(root,'bin/native-input')],{stdio:'inherit'});
