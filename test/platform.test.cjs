const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const zlib=require('node:zlib');
const platform=require('../src/main/platform.cjs');const systemVoice=require('../src/main/system-voice.cjs');const archive=require('../src/main/archive.cjs');
const tmp=prefix=>fs.mkdtempSync(path.join(os.tmpdir(),prefix));

test('tools are found on PATH and in the usual install folders, with Windows extensions',()=>{
  const seen=new Set(['C:\\bin\\codex.cmd','C:\\Users\\me\\.local\\bin\\claude.exe','/usr/local/bin/codex']);const exists=file=>seen.has(file);
  assert.equal(platform.which('codex',{platform:'win32',env:{PATH:'C:\\bin',PATHEXT:'.COM;.EXE;.BAT;.CMD'},exists}),'C:\\bin\\codex.cmd');
  assert.equal(platform.which('codex',{platform:'linux',env:{PATH:'/usr/local/bin:/usr/bin'},exists}),'/usr/local/bin/codex');
  assert.equal(platform.which('nothing-here',{platform:'linux',env:{PATH:'/usr/bin'},exists}),null);
  const dirs=platform.toolDirs({platform:'win32',env:{APPDATA:'C:\\Users\\me\\AppData\\Roaming',LOCALAPPDATA:'C:\\Users\\me\\AppData\\Local'}});
  assert.ok(dirs.includes('C:\\Users\\me\\AppData\\Roaming\\npm'),'npm global folder');
});
test('an npm .cmd shim is started as node + its script, so arguments skip cmd.exe',()=>{
  const dir=tmp('shim-');fs.mkdirSync(path.join(dir,'node_modules','@openai','codex','bin'),{recursive:true});
  const script=path.join(dir,'node_modules','@openai','codex','bin','codex.js');fs.writeFileSync(script,'');
  fs.writeFileSync(path.join(dir,'codex.cmd'),'@ECHO off\r\nGOTO start\r\n:start\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  const target=platform.shimTarget(path.join(dir,'codex.cmd'));assert.ok(target);assert.equal(target.args[0],path.join(dir,'node_modules','@openai','codex','bin','codex.js'));
  assert.equal(platform.shimTarget(path.join(dir,'missing.cmd')),null);
  const quoted=platform.cmdArg('a "b" & c');assert.match(quoted,/^\^\^\^"/);assert.ok(quoted.includes('^^^&'),'metacharacters caret-escaped twice for a .cmd');
});
test('venv paths, transparency and shortcut text per platform',()=>{
  assert.equal(platform.venvPython('C:\\e\\venv','win32'),path.join('C:\\e\\venv','Scripts','python.exe'));
  assert.equal(platform.venvPython('/e/venv','linux'),path.join('/e/venv','bin','python'));
  assert.equal(platform.venvSitePackages('venv','3.10','linux'),path.join('venv','lib','python3.10','site-packages'));
  assert.equal(platform.transparencySupported({platform:'win32',env:{}}),true);
  assert.equal(platform.transparencySupported({platform:'linux',env:{XDG_SESSION_TYPE:'wayland'}}),true);
  assert.equal(platform.transparencySupported({platform:'linux',env:{XDG_CURRENT_DESKTOP:'ubuntu:GNOME'}}),true);
  assert.equal(platform.transparencySupported({platform:'linux',env:{}}),false,'Xvfb / no desktop: opaque');
  assert.equal(platform.transparencySupported({platform:'linux',env:{AGENT_WARDROBE_TRANSPARENT:'1'}}),true);
  assert.equal(platform.shortcutText('角色文件（⌘⇧O）','win32'),'角色文件（Ctrl+Shift+O）');assert.equal(platform.shortcutText('⌘⇧S','darwin'),'⌘⇧S');
});
test('system voices: SAPI and espeak-ng voices follow the text language',()=>{
  const voices=[{name:'Microsoft Zira Desktop',culture:'en-US'},{name:'Microsoft Huihui Desktop',culture:'zh-CN'},{name:'Microsoft Hanhan Desktop',culture:'zh-TW'},{name:'Microsoft Haruka Desktop',culture:'ja-JP'}];
  assert.equal(systemVoice.pickSapi(voices,systemVoice.langOf('你好，今天要做什麼？')),'Microsoft Hanhan Desktop','Taiwan first');
  assert.equal(systemVoice.pickSapi(voices.filter(v=>v.culture!=='zh-TW'),'zh'),'Microsoft Huihui Desktop');
  assert.equal(systemVoice.pickSapi(voices,systemVoice.langOf('こんにちは')),'Microsoft Haruka Desktop');
  assert.equal(systemVoice.pickSapi(voices,'en'),'Microsoft Zira Desktop');
  assert.equal(systemVoice.pickSapi([{name:'Only',culture:'de-DE'}],'zh'),'Only','any voice beats silence');
  assert.equal(systemVoice.espeak({find:()=>null}),null,'no espeak-ng: the caller shows how to install it');
  assert.match(systemVoice.LINUX_MISSING,/espeak-ng/);
});
test('the SAPI helper speaks to one PowerShell process and reads back each WAV',async()=>{
  const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');const dir=tmp('sapi-');const written=[];
  const spawnImpl=(cmd,args)=>{assert.equal(cmd,'powershell.exe');assert.ok(args.includes('-EncodedCommand'));
    const proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough();proc.kill=()=>{};
    setImmediate(()=>proc.stdout.write(`@voices ${Buffer.from(JSON.stringify([{name:'Microsoft Hanhan Desktop',culture:'zh-TW'}])).toString('base64')}\n`));
    proc.stdin.on('data',line=>{const r=JSON.parse(line);written.push({...r,text:Buffer.from(r.text,'base64').toString()});fs.writeFileSync(r.out,'RIFFwav');proc.stdout.write(`@done ${r.id}\n`);});
    return proc;};
  const sapi=systemVoice.createSapi({spawnImpl,temp:dir});
  assert.equal(String(await sapi.synthesize('你好。')),'RIFFwav');assert.equal(written[0].voice,'Microsoft Hanhan Desktop');assert.equal(written[0].text,'你好。');
  assert.deepEqual(fs.readdirSync(dir),[],'the temporary WAV is removed');sapi.stop();
});
test('RTF terms are read without textutil (code page bytes and \\u characters)',()=>{
  assert.equal(archive.rtfPlain("{\\rtf1\\ansi\\ansicpg932{\\fonttbl{\\f0 MS Gothic;}}{\\*\\generator x;}\\f0 \\'97\\'98\\'97\\'70\\'8b\\'4b\\'96\\'f1\\par \\uc1\\u12354?OK}"),'利用規約\nあOK');
  const dir=tmp('rtf-'),file=path.join(dir,'readme.rtf');fs.writeFileSync(file,'{\\rtf1\\ansi Hello\\par World}');
  assert.equal(archive.rtfText(file,{platform:'linux'}),'Hello\nWorld');
});
// a ZIP64 archive (counts and offsets in the ZIP64 records, sizes in the extra field), as large engine downloads use
function zip64(entries){
  const parts=[],central=[];let offset=0;
  for(const e of entries){
    const name=Buffer.from(e.name),raw=Buffer.from(e.data),body=e.deflate?zlib.deflateRawSync(raw):raw;
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(45,4);local.writeUInt16LE(e.deflate?8:0,8);local.writeUInt32LE(archive.crc32(raw),14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);
    const extra=Buffer.alloc(28);extra.writeUInt16LE(1,0);extra.writeUInt16LE(24,2);extra.writeBigUInt64LE(BigInt(raw.length),4);extra.writeBigUInt64LE(BigInt(body.length),12);extra.writeBigUInt64LE(BigInt(offset),20);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE((3<<8)|45,4);c.writeUInt16LE(45,6);c.writeUInt16LE(e.deflate?8:0,10);c.writeUInt32LE(archive.crc32(raw),16);
    c.writeUInt32LE(0xffffffff,20);c.writeUInt32LE(0xffffffff,24);c.writeUInt16LE(name.length,28);c.writeUInt16LE(extra.length,30);c.writeUInt32LE(((e.mode||0o100644)<<16)>>>0,38);c.writeUInt32LE(0xffffffff,42);
    parts.push(local,name,body);central.push(c,name,extra);offset+=30+name.length+body.length;
  }
  const dir=Buffer.concat(central),z=Buffer.alloc(56);z.writeUInt32LE(0x06064b50,0);z.writeBigUInt64LE(44n,4);z.writeBigUInt64LE(BigInt(entries.length),24);z.writeBigUInt64LE(BigInt(entries.length),32);z.writeBigUInt64LE(BigInt(dir.length),40);z.writeBigUInt64LE(BigInt(offset),48);
  const loc=Buffer.alloc(20);loc.writeUInt32LE(0x07064b50,0);loc.writeBigUInt64LE(BigInt(offset+dir.length),8);loc.writeUInt32LE(1,16);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0xffff,8);end.writeUInt16LE(0xffff,10);end.writeUInt32LE(0xffffffff,12);end.writeUInt32LE(0xffffffff,16);
  return Buffer.concat([...parts,dir,z,loc,end]);
}
test('large zips (ZIP64) unpack as a stream, keep executables, and refuse unsafe paths',async()=>{
  const dir=tmp('zip64-'),file=path.join(dir,'engine.vvpp');
  fs.writeFileSync(file,zip64([{name:'engine/',data:''},{name:'engine/run',data:'#!/bin/sh\necho ok\n',mode:0o100755},{name:'engine/model.bin',data:'x'.repeat(100000),deflate:true},{name:'engine/engine_manifest.json',data:'{"command":"run"}',deflate:true}]));
  const out=path.join(dir,'out');let progress=0;const result=await archive.unzipLarge(file,out,{onProgress:p=>{progress=p;}});
  assert.equal(result.entries,4);assert.equal(fs.readFileSync(path.join(out,'engine','model.bin'),'utf8').length,100000);assert.equal(progress,1);
  if(process.platform!=='win32')assert.ok(fs.statSync(path.join(out,'engine','run')).mode&0o100,'executable bit kept');
  const bad=path.join(dir,'bad.zip');fs.writeFileSync(bad,zip64([{name:'../escape.txt',data:'x'}]));
  await assert.rejects(archive.unzipLarge(bad,path.join(dir,'bad')),{code:'ZIP_SLIP'});
  const small=path.join(dir,'small.zip');fs.writeFileSync(small,require('./fixtures/zip.cjs').makeZip([{name:'a.txt',data:'hello',deflate:true}]));
  await archive.unzipLarge(small,path.join(dir,'small'));assert.equal(fs.readFileSync(path.join(dir,'small','a.txt'),'utf8'),'hello','ordinary zips too');
});
test('7z / rar need bsdtar: GNU tar alone gets a clear message',()=>{
  assert.throws(()=>archive.untar('x.7z',tmp('7z-'),{canRead:false}),/libarchive-tools/);
});
