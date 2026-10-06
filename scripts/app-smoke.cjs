// Built-in end-to-end smoke tests for the companion, marketplace, web wardrobe and Claude agent console.
// Run with `npm start -- --smoke-test` (or --agent-smoke). ctx exposes main-process state through live getters.
const { app, BrowserWindow, screen, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Runtime } = require('../src/main/runtime.cjs');
const { startControl } = require('../src/main/control-server.cjs');
const { loadIdentity } = require('../src/main/control-identity.cjs');
const appRoot = path.join(__dirname, '..');
async function agentSmokeTest(ctx){
  const assert=require('node:assert/strict');
  ctx.settings.provider='claude';ctx.runtime.provider('claude');
  await ctx.win.webContents.executeJavaScript(`document.querySelector('#task-mode').value='computer';document.querySelector('#prompt').value='This is an integration startup check. Do not use tools, control the screen, or access any files. Reply with READY only.';document.querySelector('#chat-form').requestSubmit()`);
  const deadline=Date.now()+15000;
  while(!ctx.agentSession.output&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(ctx.agentSession.child,'official interactive Claude process started');
  assert.ok(ctx.agentSession.output.length>0,'official CLI produced terminal output');
  await ctx.openAgentConsole();
  assert.ok(ctx.agentWindow.webContents.getURL().startsWith('file:'));
  await new Promise(resolve=>setTimeout(resolve,1500));
  assert.ok(await ctx.agentWindow.webContents.executeJavaScript('document.querySelector(".xterm-screen").getBoundingClientRect().height>200'),'native terminal rendered');
  fs.mkdirSync(path.join(appRoot,'evidence'),{recursive:true});
  fs.writeFileSync(path.join(appRoot,'evidence/agent-console.png'),(await ctx.agentWindow.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(appRoot,'evidence/avatar-task.png'),(await ctx.win.webContents.capturePage()).toPNG());
  const setupPrompt=/trust|safety|login|log in|sign in/i.test(ctx.agentSession.output);
  const cliError=/unknown option|invalid argument|Traceback/i.test(ctx.agentSession.output);assert.equal(cliError,false,'CLI launch arguments accepted');
  const point=await ctx.win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#emergency-stop').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  ctx.win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});ctx.win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  const stopDeadline=Date.now()+5000;while(ctx.agentSession.child&&Date.now()<stopDeadline)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(ctx.agentSession.child,null,'owned session stopped');
  await ctx.win.webContents.executeJavaScript(`document.querySelector('#task-mode').value='browser';document.querySelector('#prompt').value='Integration startup check. Do not use any tools. Reply with READY only.';document.querySelector('#chat-form').requestSubmit()`);
  const browserDeadline=Date.now()+15000;
  while(!ctx.agentSession.child&&Date.now()<browserDeadline)await new Promise(resolve=>setTimeout(resolve,100));
  while(!ctx.agentSession.output&&Date.now()<browserDeadline)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(ctx.agentSession.child&&ctx.agentSession.output,'browser mode starts official Chrome-enabled CLI');
  await new Promise(resolve=>setTimeout(resolve,1000));
  const consolePoint=await ctx.agentWindow.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#emergency').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  ctx.agentWindow.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...consolePoint});ctx.agentWindow.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...consolePoint});
  const browserStopDeadline=Date.now()+5000;while(ctx.agentSession.child&&Date.now()<browserStopDeadline)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(ctx.agentSession.child,null,'console emergency stops browser session');
  assert.ok(globalShortcut.isRegistered('CommandOrControl+Shift+X'),'global emergency shortcut registered');
  console.log('AGENT_STARTUP_SMOKE',JSON.stringify({avatarTask:true,nativeTerminal:true,officialClaudeInteractive:true,manualSetupPrompt:setupPrompt,avatarEmergencyStop:true,browserConsoleEmergencyStop:true,globalEmergencyShortcut:true,screenActionsTested:false}));
}
async function smokeTest(ctx) {
  console.log('SMOKE desktop');
  ctx.settings.provider='codex';ctx.runtime.provider('codex');
  const assert=require('node:assert/strict');
  const evidence=path.join(appRoot,'evidence');fs.mkdirSync(evidence,{recursive:true});
  const wait=async condition=>{const started=Date.now(),deadline=started+(process.platform==='linux'&&process.env.CI?20000:6000);while(!(await condition())){if(Date.now()>deadline)throw new Error(`UI sync timed out after ${Date.now()-started} ms: ${condition.toString().slice(0,120)}`);await new Promise(resolve=>setTimeout(resolve,60));}};
  await wait(()=>ctx.win.webContents.executeJavaScript('!!document.querySelector("#bula")'));
  assert.equal(globalShortcut.isRegistered('CommandOrControl+Shift+S'),true,'marketplace global shortcut registered');
  ctx.win.show();ctx.win.focus();
  await ctx.win.webContents.executeJavaScript('window.bula.wardrobe()');
  await wait(()=>ctx.marketWindow?.webContents.executeJavaScript(`document.querySelectorAll(".mod-card").length===${ctx.catalog.length}`));
  const firstMarket=ctx.marketWindow;
  await ctx.openWardrobe();assert.equal(ctx.marketWindow,firstMarket,'shortcut reuses marketplace');
  assert.ok(ctx.marketWindow.webContents.getURL().startsWith('file:'),'marketplace uses packaged local files');
  const nativeClick=async(selector,target=ctx.marketWindow)=>{
    const point=await target.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    target.webContents.sendInputEvent({type:'mouseMove',...point});
    target.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    target.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  };
  for(const [query,expected] of [['miDniGHT','miso'],['安妮','annie'],['機器人','byte'],['lACE','annie'],['Pixel','pixel-byte'],['VRM','vrm-sample'],['blocky','vrm-sample'],['美少女戰士',null],['ice queen',null],['not-a-real-mod',null]]){
    // a click can land while the page is still laying out (slow virtual displays): click again if it didn't take
    const cleared=()=>ctx.marketWindow.webContents.executeJavaScript('document.activeElement.id==="search" && document.querySelector("#search").value===""');
    for(let attempt=1;;attempt++){await nativeClick('#clear');try{await wait(cleared);break;}catch(error){if(attempt>=3)throw error;}}
    await ctx.marketWindow.webContents.insertText(query);
    await wait(()=>ctx.marketWindow.webContents.executeJavaScript(`document.querySelector('#search').value===${JSON.stringify(query)}`));
    const visible=await ctx.marketWindow.webContents.executeJavaScript('[...document.querySelectorAll(".mod-card:not([hidden])")].map(card=>card.dataset.modId)');
    assert.deepEqual(visible,expected?[expected]:[],'search matches Mod/skin and localized aliases');
  }
  assert.equal(await ctx.marketWindow.webContents.executeJavaScript('document.querySelector("#empty").hidden'),false,'no-result state');
  await nativeClick('#clear');
  await wait(()=>ctx.marketWindow.webContents.executeJavaScript(`document.querySelectorAll(".mod-card:not([hidden])").length===${ctx.catalog.length}`));
  for(const mod of ctx.catalog)for(const skin of mod.skins){
    await nativeClick(`[data-mod-id="${mod.id}"] .skin[data-skin-id="${skin.id}"]`);
    await wait(()=>ctx.runtime.state.modId===mod.id&&ctx.runtime.state.skinId===skin.id);
    // palette skins are checked by rendered colour; image and 3D skins by the renderer that mounted
    await wait(()=>ctx.win.webContents.executeJavaScript(skin.palette?`document.querySelector('#bula').style.getPropertyValue('--body')===${JSON.stringify(skin.palette.body)}`:`document.querySelector('#bula')?.dataset.renderer===${JSON.stringify(mod.renderer)}&&document.querySelector('#bula').getAttribute('aria-label')===${JSON.stringify(mod.name)}`));
  }
  ctx.selectMod({modId:'annie'});
  await wait(()=>ctx.marketWindow.webContents.executeJavaScript('document.querySelector("#active-name").textContent.startsWith("Annie")'));
  await new Promise(resolve=>setTimeout(resolve,200));
  fs.writeFileSync(path.join(evidence,'app-marketplace.png'),(await ctx.marketWindow.webContents.capturePage()).toPNG());
  ctx.marketWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'f',modifiers:['meta']});
  await wait(()=>ctx.marketWindow.webContents.executeJavaScript('document.activeElement.id==="search"'));
  ctx.marketWindow.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  await wait(()=>ctx.marketWindow===null);
  assert.equal(ctx.win.isFocusable(),true,'closing marketplace restores desktop controls');
  await wait(()=>ctx.win.webContents.executeJavaScript('document.querySelector("#bula").getAttribute("aria-label")==="Annie"'));
  await new Promise(resolve=>setTimeout(resolve,15400));
  await wait(()=>ctx.win.webContents.executeJavaScript('document.body.classList.contains("quiet") && document.querySelector("#panel").hidden'));
  assert.equal(ctx.win.getBounds().height,340,'idle companion shrinks its native hit area');
  assert.ok(await ctx.win.webContents.executeJavaScript('document.querySelector("#bula").getBoundingClientRect().height>200'),'idle character remains visible');
  await new Promise(resolve=>setTimeout(resolve,200));
  fs.writeFileSync(path.join(evidence,'desktop-idle.png'),(await ctx.win.webContents.capturePage()).toPNG());
  // clicking the character (no drag) opens the chat; there is no separate Chat button any more
  await nativeClick('#bula',ctx.win);
  await wait(()=>ctx.win.webContents.executeJavaScript('!document.querySelector("#panel").hidden && document.activeElement.id==="prompt"'));
  // ⌘-scroll over the character resizes it and the window, anchored at the bottom-right corner
  {const before=ctx.win.getBounds();const point=await ctx.win.webContents.executeJavaScript(`(()=>{const r=document.querySelector('#bula').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
   for(let i=0;i<6;i++){ctx.win.webContents.sendInputEvent({type:'mouseWheel',...point,deltaX:0,deltaY:120,modifiers:['meta']});await new Promise(r=>setTimeout(r,40));}
   await wait(()=>ctx.win.getBounds().width!==before.width);const after=ctx.win.getBounds();
   assert.equal(after.x+after.width,before.x+before.width,'right edge stays put');assert.equal(after.y+after.height,before.y+before.height,'bottom edge stays put');
   assert.ok(Math.abs(ctx.settings.scale-1)>.2,`scale changed (${ctx.settings.scale})`);
   await ctx.win.webContents.executeJavaScript(`window.bula.scale(1).then(()=>{document.documentElement.style.setProperty('--scale',1);return true;})`);await wait(()=>ctx.win.getBounds().width===before.width);}
  // full height depends on the chat panel size (CHAT_SIZES in main.cjs); large is the default
  assert.equal(ctx.win.getBounds().height,{normal:620,large:774,xl:934}[ctx.settings.chatSize||'large'],'chat button restores full window');
  await ctx.win.webContents.insertText('unfinished draft');
  await ctx.win.webContents.executeJavaScript('collapseIfIdle()');
  assert.equal(await ctx.win.webContents.executeJavaScript('document.querySelector("#panel").hidden'),false,'draft must stay visible');
  await ctx.win.webContents.executeJavaScript('document.querySelector("#prompt").value=""');
  await nativeClick('#settings-toggle',ctx.win);
  await wait(()=>ctx.win.webContents.executeJavaScript('!document.querySelector("#settings").hidden'));
  await ctx.win.webContents.executeJavaScript('collapseIfIdle()');
  assert.equal(await ctx.win.webContents.executeJavaScript('document.querySelector("#panel").hidden'),false,'settings must stay visible');
  await nativeClick('#settings-toggle',ctx.win);
  ctx.restore();
  console.log('IDLE_CHAT_SMOKE',JSON.stringify({realIdleTimer:true,nativeWindowShrinks:true,chatButtonRestores:true,draftRetained:true,settingsRetained:true}));
  console.log('APP_MARKETPLACE_SMOKE',JSON.stringify({nativeWindow:true,search:true,skinSearch:true,chineseAliases:true,noResults:true,skins:ctx.catalog.reduce((n,m)=>n+m.skins.length,0),nativeMouse:true,desktopColors:true,reusesWindow:true,searchShortcut:true,escapeCloses:true,globalShortcut:true}));
  console.log('NATIVE_WARDROBE_SMOKE',JSON.stringify({skins:ctx.catalog.reduce((n,m)=>n+m.skins.length,0),nativeMouse:true,desktopColors:true,noBrowserRequired:true}));
  await new Promise(resolve=>setTimeout(resolve,200));
  fs.writeFileSync(path.join(evidence,'companion.png'),(await ctx.win.webContents.capturePage()).toPNG());
  const page=new BrowserWindow({width:1200,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  page.on('closed',()=>console.log('SMOKE browser window closed'));
  page.webContents.on('render-process-gone',(_event,details)=>console.log('SMOKE browser process gone',details));
  page.webContents.on('console-message',event=>console.log('WEB_CONSOLE',event.message));
  await page.loadURL(ctx.control.url);
  await wait(()=>page.webContents.executeJavaScript(`document.querySelectorAll(".card").length===${ctx.catalog.length}`));
  ctx.setStreaming(true);
  page.show();page.focus();
  const click=async(selector,duringPress)=>{
    const point=await page.webContents.executeJavaScript(`(()=>{const target=document.querySelector(${JSON.stringify(selector)});target.scrollIntoView({block:'center'});const rect=target.getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()`);
    page.webContents.sendInputEvent({type:'mouseMove',...point});page.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    if(duringPress)await duringPress();
    page.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  };
  console.log('SMOKE web loaded');
  await click('[data-mod-id=miso] .apply');
  await wait(()=>ctx.runtime.state.modId==='miso');
  console.log('SMOKE miso');
  await wait(()=>page.webContents.executeJavaScript('!!document.querySelector("[data-mod-id=miso].selected")'));
  await wait(()=>ctx.win.webContents.executeJavaScript('document.querySelector("#bula")?.getAttribute("aria-label")==="Miso"'));
  console.log('SMOKE desktop miso');
  await click('[aria-label="Miso Midnight"]');
  await wait(()=>ctx.runtime.state.skinId==='midnight');
  console.log('SMOKE midnight');
  await wait(()=>page.webContents.executeJavaScript('document.querySelector("#active-skin").textContent.startsWith("Midnight")'));
  await page.webContents.executeJavaScript('document.querySelector("#persona").value="coach";document.querySelector("#persona").dispatchEvent(new Event("change"))');
  await wait(()=>ctx.runtime.state.personaId==='coach');
  console.log('SMOKE coach');
  fs.writeFileSync(path.join(evidence,'wardrobe.png'),(await page.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(evidence,'desktop-miso.png'),(await ctx.win.webContents.capturePage()).toPNG());
  ctx.runtime.activity('working');
  await wait(()=>page.webContents.executeJavaScript('document.querySelector("#activity").textContent==="working"'));
  await page.webContents.executeJavaScript('window.savedButton=document.querySelector("[data-mod-id=byte] .apply");window.savedPersona=document.querySelector("#persona").firstChild');
  ctx.runtime.speaking(true);
  await wait(()=>page.webContents.executeJavaScript('document.querySelector("#activity").textContent==="speaking"'));
  assert.equal(await page.webContents.executeJavaScript('window.savedButton===document.querySelector("[data-mod-id=byte] .apply")&&window.savedPersona===document.querySelector("#persona").firstChild'),true,'activity updates must preserve interaction targets');
  ctx.runtime.speaking(false);
  await click('[data-mod-id=byte] .apply',async()=>{ctx.runtime.speaking(true);await wait(()=>page.webContents.executeJavaScript('document.querySelector("#activity").textContent==="speaking"'));ctx.runtime.speaking(false);});
  await wait(()=>ctx.runtime.state.modId==='byte');assert.equal(ctx.runtime.state.activity,'working');assert.equal(ctx.runtime.state.provider,'codex');
  await wait(()=>ctx.win.webContents.executeJavaScript('document.querySelector("#bula").getAttribute("aria-label")==="Byte"'));
  fs.writeFileSync(path.join(evidence,'desktop-byte.png'),(await ctx.win.webContents.capturePage()).toPNG());
  await page.webContents.executeJavaScript(`(async()=>{for(const id of ['annie','miso','byte','annie','byte','miso'])document.querySelector('[data-mod-id='+id+'] .mini-avatar').click();await mutationQueue;})()`);
  assert.equal(ctx.runtime.state.modId,'miso','rapid card clicks must finish on the last requested Mod');
  assert.equal(ctx.runtime.state.activity,'working');
  await page.webContents.executeJavaScript(`accept({...current,revision:current.revision-1,modId:'annie',mod:catalog.find(mod=>mod.id==='annie')})`);
  assert.equal(await page.webContents.executeJavaScript('document.querySelector("#active-name").textContent'), 'Miso','stale responses must not revert selected Mod');
  const previousInstance=ctx.runtime.state.instanceId;
  await ctx.control.close();
  await wait(()=>page.webContents.executeJavaScript('document.body.classList.contains("disconnected")'));
  ctx.runtime=new Runtime(ctx.catalog,{modId:'miso',skinId:'midnight',personaId:'coach',provider:'codex'});
  ctx.runtime.on('change',state=>ctx.win.webContents.send('bula:state',state));
  ctx.control=await startControl({runtime:ctx.runtime,catalog:ctx.catalog,language:ctx.settings.language,onSelect:ctx.selectMod,onProvider:provider=>ctx.runtime.provider(provider),identity:loadIdentity(app.getPath('userData'))});
  assert.notEqual(ctx.runtime.state.instanceId,previousInstance);
  await wait(()=>page.webContents.executeJavaScript('!document.body.classList.contains("disconnected")'));
  await click('[data-mod-id=byte] .mini-avatar');
  await wait(()=>ctx.runtime.state.modId==='byte');
  await wait(()=>page.webContents.executeJavaScript('document.querySelector("#active-name").textContent==="Byte"'));
  await click('[aria-label="Byte Arcade"]');
  await wait(()=>ctx.runtime.state.skinId==='arcade');
  await wait(()=>ctx.win.webContents.executeJavaScript('document.querySelector("#bula").style.getPropertyValue("--body")==="#cc6fbe"'));
  const freshPage=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await freshPage.loadURL(ctx.control.origin);
  await wait(()=>freshPage.webContents.executeJavaScript(`document.querySelectorAll(".card").length===${ctx.catalog.length}`));
  freshPage.destroy();
  ctx.runtime.activity('idle');ctx.selectMod({modId:'annie'});
  ctx.setStreaming(true);await wait(()=>ctx.win.webContents.executeJavaScript('document.body.classList.contains("streaming")'));assert.equal(ctx.win.isFocusable(),false);
  assert.equal(ctx.streaming,true,'wardrobe click-through must be active before browser interaction');
  ctx.restore();await wait(()=>ctx.win.webContents.executeJavaScript('!document.body.classList.contains("streaming")'));assert.equal(ctx.win.isFocusable(),true);
  page.destroy();
  console.log('POC_SMOKE',JSON.stringify({characters:ctx.catalog.length,skins:ctx.catalog.reduce((n,m)=>n+m.skins.length,0),webControl:true,desktopSync:true,personaSwitch:true,skinKeepsActivity:true,nativeMouse:true,stableClickTargets:true,rapidCardClicks:true,staleResponsesIgnored:true,oldPageAfterRestart:true,skinAfterRestart:true,streamRestore:true,language:ctx.settings.language}));
}
module.exports = { agentSmokeTest, smokeTest };
