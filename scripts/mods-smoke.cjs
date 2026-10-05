const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
// Mounts one Mod per renderer in the real companion window and proves each one draws.
async function run({win,runtime,evidence}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(fn,timeout=20000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error('Mods smoke timed out');await new Promise(r=>setTimeout(r,100));}};
  win.webContents.on('console-message',e=>{if(/error|warn|refused|blocked/i.test(e.message))console.log('PAGE',e.message.slice(0,300));});
  win.show();await wait(()=>js('document.body.dataset.ready==="true"'));
  const result={};
  for(const [id,renderer] of [['annie','svg'],['pixel-byte','png'],['vrm-sample','vrm']]){
    runtime.select({modId:id});
    await wait(()=>js(`document.querySelector('#bula')?.dataset.renderer===${JSON.stringify(renderer)}`));
    if(renderer==='svg'){
      assert.ok(await js(`document.querySelector('#bula .eyes .pupils')&&document.querySelector('#bula .character').getBBox().width>100`),'SVG parts drew a character');
    }
    if(renderer==='png'){
      // every layer image must actually decode from the Mod folder
      const loaded=await js(`Promise.all([...document.querySelectorAll('#bula image')].map(n=>new Promise(r=>{const i=new Image();i.onload=()=>r(i.naturalWidth>0);i.onerror=()=>r(false);i.src=n.getAttribute('href');})))`);
      assert.ok(loaded.length>=8&&loaded.every(Boolean),'all PNG layers load');
    }
    if(renderer==='vrm'){
      await js(`Avatars.ready(document.querySelector('#bula'))`);
      await wait(()=>js(`Boolean(document.querySelector('#bula canvas'))`));
      await new Promise(r=>setTimeout(r,600));
      const opaque=await js(`(()=>{const c=document.querySelector('#bula canvas');const g=document.createElement('canvas');g.width=c.width;g.height=c.height;const x=g.getContext('2d');x.drawImage(c,0,0);const d=x.getImageData(0,0,g.width,g.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n/(g.width*g.height);})()`);
      console.log('VRM_PIXELS',JSON.stringify(await js(`(()=>{const c=document.querySelector('#bula canvas');const g=document.createElement('canvas');g.width=c.width;g.height=c.height;const x=g.getContext('2d');x.drawImage(c,0,0);const d=x.getImageData(0,0,g.width,g.height).data;const h={};for(let i=0;i<d.length;i+=4){if(!d[i+3])continue;const k=[d[i]>>5,d[i+1]>>5,d[i+2]>>5,d[i+3]>>6].join(',');h[k]=(h[k]||0)+1;}return Object.entries(h).sort((a,b)=>b[1]-a[1]).slice(0,6);})()`)));
      assert.ok(opaque>.05,`VRM model rendered (${opaque.toFixed(3)} of canvas covered)`);
      assert.equal(await js(`document.querySelector('#bula').dataset.error||''`),'','no 3D load error');
      // orbit: a plain drag rotates the view without moving the window; ⌥-drag moves it; wheel spins; double-click resets
      await js(`document.querySelector('#panel').hidden=true;true`);await new Promise(r=>setTimeout(r,300));
      const p=await js(`(()=>{const r=document.querySelector('#bula').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height*.6)}})()`);
      const before=win.getPosition(),send=e=>win.webContents.sendInputEvent(e);
      send({type:'mouseMove',...p});send({type:'mouseDown',button:'left',clickCount:1,...p});
      for(let i=1;i<=6;i++){send({type:'mouseMove',x:p.x+i*12,y:p.y,modifiers:['leftButtonDown']});await new Promise(r=>setTimeout(r,30));}
      send({type:'mouseUp',button:'left',clickCount:1,x:p.x+72,y:p.y});await new Promise(r=>setTimeout(r,200));
      const dragged=await js(`Avatars.view(document.querySelector('#bula'))`);
      assert.ok(Math.abs(dragged.yaw)>.5,`drag rotated the view (yaw ${dragged.yaw})`);assert.deepEqual(win.getPosition(),before,'drag did not move the window');
      await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(evidence,'mod-vrm-rotated.png'),(await win.webContents.capturePage()).toPNG());
      send({type:'mouseWheel',...p,deltaX:0,deltaY:-120});await new Promise(r=>setTimeout(r,200));
      const wheeled=await js(`Avatars.view(document.querySelector('#bula'))`);assert.notEqual(wheeled.yaw,dragged.yaw,'wheel rotates the view');
      send({type:'mouseDown',button:'left',clickCount:2,...p});send({type:'mouseUp',button:'left',clickCount:2,...p});await new Promise(r=>setTimeout(r,200));
      assert.deepEqual(await js(`Avatars.view(document.querySelector('#bula'))`),{yaw:0,pitch:0},'double-click resets the view');
      await js(`window.__dragStarts=0;document.querySelector('#pet-wrap').addEventListener('pointerdown',()=>window.__dragStarts++);true`);
      send({type:'mouseDown',button:'left',clickCount:1,modifiers:['alt'],...p});send({type:'mouseUp',button:'left',clickCount:1,modifiers:['alt'],...p});await new Promise(r=>setTimeout(r,200));
      assert.equal(await js('window.__dragStarts'),1,'⌥-press goes to the window drag handler');assert.deepEqual(await js(`Avatars.view(document.querySelector('#bula'))`),{yaw:0,pitch:0},'⌥-press does not rotate');
      assert.match(await js(`document.querySelector('#pet-wrap').title`),/rotate|旋轉/,'hint explains the gesture');
      await js(`document.querySelector('#panel').hidden=false;true`);
    }
    // the shared interaction API must work for every renderer
    await js(`(()=>{const el=document.querySelector('#bula');Avatars.blink(el);Avatars.look(el,.5,-.3);Avatars.react(el,'surprised',300);return true;})()`);
    runtime.speaking(true);await new Promise(r=>setTimeout(r,300));runtime.speaking(false);
    await js(`document.querySelector('#panel').hidden=true;true`);await new Promise(r=>setTimeout(r,300));
    fs.writeFileSync(path.join(evidence,`mod-${renderer}.png`),(await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#panel').hidden=false;true`);
    result[renderer]=true;
  }
  runtime.select({modId:'annie'});
  console.log('MODS_SMOKE',JSON.stringify(result));
}
module.exports={run};
