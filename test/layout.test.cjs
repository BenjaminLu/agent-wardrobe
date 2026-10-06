const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {copyApp,HELPERS}=require('../scripts/package-common.cjs');
const root=path.resolve(__dirname,'..');

test('project notes and native sources live in their dedicated directories',()=>{
  const groups={docs:['INTEGRATION-NOTES.md','MODS.md','PLATFORM.md','POC-PLAN.md','VERIFICATION.md'],native:['agent-pty.py','native-input.swift','native-input.cs']};
  for(const [dir,names] of Object.entries(groups))for(const name of names){
    assert.equal(fs.existsSync(path.join(root,name)),false,`${name} must leave the root`);
    assert.ok(fs.statSync(path.join(root,dir,name)).isFile(),`${dir}/${name} must exist`);
  }
});

test('relative Markdown links in the root guides and docs resolve, including fragments',()=>{
  const files=['README.md','CONTRIBUTING.md',...fs.readdirSync(path.join(root,'docs')).filter(name=>name.endsWith('.md')).map(name=>`docs/${name}`)];
  for(const file of files){
    const text=fs.readFileSync(path.join(root,file),'utf8');
    // Inline links and reference definitions; optional titles are not part of the destination.
    const links=[...text.matchAll(/\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^\n]*?["'])?\s*\)/g),...text.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)];
    for(const [,link] of links){
      if(/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(link))continue;
      const target=decodeURIComponent(link.split('#')[0]);
      if(!target.endsWith('.md'))continue;
      assert.ok(fs.existsSync(path.resolve(root,path.dirname(file),target)),`${file}: ${link}`);
    }
  }
});

test('every platform packages the PTY at the path used by agent-session',()=>{
  for(const platform of ['darwin','win32','linux']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'layout-'));
    try{
      copyApp(dir,{platform,runtime:false});
      assert.ok(fs.existsSync(path.join(dir,'native','agent-pty.py')),platform);
      assert.equal(fs.existsSync(path.join(dir,'agent-pty.py')),false,platform);
      assert.deepEqual(fs.readFileSync(path.join(dir,'native','agent-pty.py')),fs.readFileSync(path.join(root,'native','agent-pty.py')));
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});

test('packaging helper sources exist under native',()=>{
  assert.ok(HELPERS,'packaging exports HELPERS');
  assert.deepEqual(Object.keys(HELPERS).sort(),['darwin','win32']);
  for(const [platform,helper] of Object.entries(HELPERS)){
    assert.equal(helper.source,`native/native-input.${platform==='darwin'?'swift':'cs'}`);
    assert.ok(fs.statSync(path.join(root,helper.source)).isFile(),helper.source);
  }
});

test('Windows and macOS compilers receive the relocated native source',()=>{
  for(const [file,compiler,extension] of [['src/main/computer-input.cjs','csc','cs'],['scripts/build-native.cjs',"'/usr/bin/xcrun'",'swift']]){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const call=source.split('\n').find(line=>line.includes(`execFileSync(${compiler},`));
    assert.ok(call,`${file}: compiler invocation`);
    const match=call.match(/path\.join\(root,\s*['"](native)['"],\s*['"](native-input\.(?:cs|swift))['"]\)/);
    assert.ok(match,`${file}: compiler source must be under native/`);
    assert.equal(match[2],`native-input.${extension}`);
    assert.ok(fs.statSync(path.join(root,match[1],match[2])).isFile(),`${file}: compiler source exists`);
  }
});

const mainModules=[
  "agent-session.cjs",
  "ai.cjs",
  "archive.cjs",
  "asset-library.cjs",
  "assisted-window.cjs",
  "assisted.cjs",
  "claude-hooks.cjs",
  "cli-setup.cjs",
  "cli.cjs",
  "codex-server.cjs",
  "computer-input.cjs",
  "control-identity.cjs",
  "control-server.cjs",
  "conversation-store.cjs",
  "conversation-text.cjs",
  "dev-companion.cjs",
  "dev-session.cjs",
  "dev-sessions.cjs",
  "dev-speech.cjs",
  "edge-tts.cjs",
  "game-service.cjs",
  "game-watch.cjs",
  "hook-client.cjs",
  "kokoro.cjs",
  "library-accounts.cjs",
  "live2d-core.cjs",
  "local-llm.cjs",
  "locales.cjs",
  "main.cjs",
  "mod-assets.cjs",
  "model-formats.cjs",
  "mods.cjs",
  "operation-tools.cjs",
  "output-store.cjs",
  "permission-mcp.cjs",
  "person-draw.cjs",
  "person-service.cjs",
  "platform.cjs",
  "remote-server.cjs",
  "report-mcp.cjs",
  "runtime.cjs",
  "speech.cjs",
  "system-voice.cjs",
  "tailscale.cjs",
  "task-agents.cjs",
  "task-feedback.cjs",
  "tts.cjs",
  "typeless.cjs",
  "voice-audio.cjs",
  "voice-input.cjs",
  "voice-lab.cjs",
  "voice-service.cjs",
  "voices.cjs",
  "wake-service.cjs"
];

test('all 54 main-process modules live only under src/main',()=>{
  assert.equal(mainModules.length,54);
  for(const name of mainModules){
    assert.equal(fs.existsSync(path.join(root,name)),false,`${name} must leave the root`);
    assert.ok(fs.statSync(path.join(root,'src','main',name)).isFile(),`src/main/${name} must exist`);
  }
  assert.equal(require('../package.json').main,'src/main/main.cjs');
});

test('main-process paths use ROOT except for existing main-process siblings',()=>{
  const dir=path.join(root,'src','main');
  assert.equal(require('../src/main/root.cjs').ROOT,root);
  for(const name of fs.readdirSync(dir).filter(name=>name.endsWith('.cjs')&&name!=='root.cjs')){
    const source=fs.readFileSync(path.join(dir,name),'utf8');
    const rest=source.replace(/\bpath\s*\.\s*join\s*\(\s*__dirname\s*,\s*(['"])([\w-]+\.cjs)\1\s*\)/g,(call,quote,sibling)=>{
      assert.ok(fs.statSync(path.join(dir,sibling)).isFile(),`${name}: sibling ${sibling} exists`);
      return '';
    });
    assert.doesNotMatch(rest,/\b__dirname\b/,`${name}: paths outside src/main must use ROOT`);
  }
});
