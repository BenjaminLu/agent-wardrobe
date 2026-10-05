const test=require('node:test');const assert=require('node:assert/strict');
const {support,toDevice,fromDevice,keyCode,modifiers,windowsArgs,xdotoolPlan,needsPaste,parseShell,NativeInput}=require('../computer-input.cjs');
test('computer use reports per-platform availability with a reason the UI can show',()=>{
  assert.equal(support({platform:'darwin'}).available,true);
  assert.equal(support({platform:'win32',helper:()=>true}).backend,'windows');
  assert.match(support({platform:'win32',helper:()=>false}).reason,/build:native/);
  assert.deepEqual(support({platform:'linux',env:{DISPLAY:':0'},has:()=>true}),{available:true,backend:'x11'});
  assert.match(support({platform:'linux',env:{DISPLAY:':0'},has:()=>false}).reason,/xdotool/);
  assert.match(support({platform:'linux',env:{}}).reason,/DISPLAY/);
  for(const env of [{XDG_SESSION_TYPE:'wayland',DISPLAY:':0',WAYLAND_DISPLAY:'wayland-0'},{WAYLAND_DISPLAY:'wayland-0'}]){const s=support({platform:'linux',env,has:()=>true});assert.equal(s.available,false);assert.equal(s.backend,'wayland');assert.match(s.reason,/Wayland/);}
  assert.equal(support({platform:'freebsd'}).available,false);
});
test('logical points become device pixels at the display scale and back',()=>{
  assert.equal(toDevice(100,1),100);assert.equal(toDevice(100.4,1.25),126);assert.equal(toDevice(333,1.5),500);assert.equal(toDevice(10,2),20);assert.equal(toDevice(10,0),10);
  assert.equal(fromDevice(126,1.25),100.8);assert.equal(fromDevice(500,1.5),333.33);
  for(const scale of [1,1.25,1.5,1.75,2,3])for(const v of [0,1,640,1919])assert.ok(Math.abs(fromDevice(toDevice(v,scale),scale)-v)<=0.5/scale+0.01);
});
test('keys and modifiers map to xdotool keysyms and Windows virtual keys; command means Ctrl off macOS',()=>{
  assert.deepEqual(keyCode('Enter'),{sym:'Return',vk:0x0d,extended:false});
  assert.deepEqual(keyCode('ArrowLeft'),{sym:'Left',vk:0x25,extended:true});
  assert.deepEqual(keyCode('Backspace'),{sym:'BackSpace',vk:0x08,extended:false});
  assert.deepEqual(keyCode('a'),{sym:'a',vk:0x41,extended:false});assert.deepEqual(keyCode('V'),{sym:'v',vk:0x56,extended:false});
  assert.equal(keyCode('F5').vk,0x74);assert.equal(keyCode('7').vk,0x37);
  for(const key of ['Enter','Escape','Tab','Backspace','ArrowLeft','ArrowRight','ArrowDown','ArrowUp','a','c','v','l','w','q','Space'])assert.ok(keyCode(key),`macOS helper key ${key}`);
  for(const bad of ['', 'ab', 'Meta', 'é', null])assert.throws(()=>keyCode(bad),/Unsupported key/);
  assert.deepEqual(modifiers(['command','shift']),['ctrl','shift']);assert.deepEqual(modifiers(['command','control','option']),['ctrl','alt']);
  assert.throws(()=>modifiers(['super']),/modifier/);
});
test('Windows helper argv: scaled points, buttons, wheel units, base64 text, virtual keys',()=>{
  assert.deepEqual(windowsArgs({action:'click',x:100,y:50},{scale:1.5}),['click','150','75','left','1']);
  assert.deepEqual(windowsArgs({action:'click',x:10,y:10,button:'right',count:2,targetWindow:1234}),['--focus','1234','click','10','10','right','2']);
  assert.deepEqual(windowsArgs({action:'move',x:1.4,y:2.6}),['move','1','3']);
  assert.deepEqual(windowsArgs({action:'drag',x:0,y:0,toX:100,toY:40},{scale:2}),['drag','0','0','200','80']);
  assert.deepEqual(windowsArgs({action:'scroll',dy:120}),['scroll','0','360']);
  assert.deepEqual(windowsArgs({action:'scroll',dx:40,dy:-99999}),['scroll','-120','-6000']);
  const [,encoded]=windowsArgs({action:'type',text:'Hi 世界 😀\n'});assert.equal(Buffer.from(encoded,'base64').toString('utf8'),'Hi 世界 😀\n');
  assert.deepEqual(windowsArgs({action:'key',key:'a',modifiers:['command']}),['key','65','0','17']);
  assert.deepEqual(windowsArgs({action:'key',key:'ArrowUp',modifiers:['shift','option']}),['key','38','1','16,18']);
  assert.deepEqual(windowsArgs({action:'key',key:'Escape'}),['key','27','0','-']);
  assert.deepEqual(windowsArgs({action:'position'}),['position']);
  assert.throws(()=>windowsArgs({action:'click',x:'1',y:NaN}),/coordinates/);
  assert.throws(()=>windowsArgs({action:'click',x:1,y:1,button:'back'}),/button/);
  assert.throws(()=>windowsArgs({action:'click',x:1,y:1,count:9}),/count/);
  assert.throws(()=>windowsArgs({action:'fn'}),/Unsupported action/);
  assert.throws(()=>windowsArgs({action:'type',text:'x'.repeat(2001)}),/text/);
});
test('xdotool plans: chained pointer commands, wheel buttons, clipboard paste for CJK',()=>{
  assert.deepEqual(xdotoolPlan({action:'click',x:100,y:50},{scale:2}).args,['mousemove','200','100','click','--repeat','1','--delay','80','1']);
  assert.deepEqual(xdotoolPlan({action:'click',x:1,y:1,button:'right',count:2}).args.slice(-4),['2','--delay','80','3']);
  assert.equal(xdotoolPlan({action:'click',x:1,y:1,button:'middle'}).args.at(-1),'2');
  const drag=xdotoolPlan({action:'drag',x:0,y:0,toX:80,toY:16}).args;assert.deepEqual(drag.slice(0,5),['mousemove','0','0','mousedown','1']);assert.deepEqual(drag.slice(-5),['mousemove','80','16','mouseup','1']);
  assert.deepEqual(xdotoolPlan({action:'scroll',dy:120,dx:-40}).args,['click','--repeat','3','--delay','20','4','click','--repeat','1','--delay','20','7']);
  assert.deepEqual(xdotoolPlan({action:'scroll',dy:-5}).args,['click','--repeat','1','--delay','20','5']);
  assert.deepEqual(xdotoolPlan({action:'scroll',dy:0}).args,[]);
  assert.deepEqual(xdotoolPlan({action:'type',text:'hello -x'}),{args:['type','--clearmodifiers','--delay','12','--','hello -x']});
  assert.deepEqual(xdotoolPlan({action:'type',text:'你好 world'}),{paste:'你好 world',args:['key','--clearmodifiers','ctrl+v']});
  assert.equal(needsPaste('tab\tand\nnewline'),false);assert.equal(needsPaste('café'),true);assert.equal(needsPaste('😀'),true);
  assert.deepEqual(xdotoolPlan({action:'key',key:'Enter',modifiers:['command','shift']}).args,['key','--clearmodifiers','ctrl+shift+Return']);
  assert.deepEqual(parseShell('X=640\nY=480\nSCREEN=0\nWINDOW=123\n'),{X:640,Y:480,SCREEN:0,WINDOW:123});
});
test('X11 backend types CJK through the clipboard and restores it',async()=>{
  const calls=[];let board='old';const input=new NativeInput({platform:'linux',clipboard:{readText:()=>board,writeText:text=>{calls.push(['clip',text]);board=text;}}});
  input.exec=async(file,args)=>{calls.push([file,...args]);return '';};
  const prev={DISPLAY:process.env.DISPLAY,PATH:process.env.PATH,XDG:process.env.XDG_SESSION_TYPE,WL:process.env.WAYLAND_DISPLAY};
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xdo-'));fs.writeFileSync(path.join(dir,'xdotool'),'',{mode:0o755});
  Object.assign(process.env,{DISPLAY:':9',PATH:dir});delete process.env.XDG_SESSION_TYPE;delete process.env.WAYLAND_DISPLAY;
  try{
    assert.equal(await input.run({action:'type',text:'中文',targetWindow:'77'}),'{"ok":true}');
    assert.deepEqual(calls,[['xdotool','windowactivate','--sync','77'],['clip','中文'],['xdotool','key','--clearmodifiers','ctrl+v'],['clip','old']]);
    assert.equal(board,'old');
  }finally{for(const [k,v] of [['DISPLAY',prev.DISPLAY],['PATH',prev.PATH],['XDG_SESSION_TYPE',prev.XDG],['WAYLAND_DISPLAY',prev.WL]])v===undefined?delete process.env[k]:process.env[k]=v;fs.rmSync(dir,{recursive:true,force:true});}
});
