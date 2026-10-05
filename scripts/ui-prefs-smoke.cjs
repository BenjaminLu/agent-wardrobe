const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {app,Menu}=require('electron');
// The hook holds the real main-process busy flag without contacting an AI provider.
async function run({win,holdReply}){
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=async(predicate,label)=>{
    const until=Date.now()+20000;
    while(true){
      try{if(await predicate())return;}catch(error){if(!/destroyed|disposed|context|frame/i.test(error.message))throw error;}
      if(Date.now()>until)throw new Error(`UI preferences smoke timed out: ${label}`);
      await new Promise(resolve=>setTimeout(resolve,50));
    }
  };
  const disk=()=>JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'bula-settings.json'),'utf8'));
  const change=(id,value)=>js(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change'));return true;})()`);
  const ready=language=>wait(()=>js(`document.body.dataset.ready==='true'&&document.documentElement.lang===${JSON.stringify(language)}`),`ready in ${language}`);
  let reloads=0,finished=0,release;const loaded=()=>reloads++,done=()=>finished++;
  win.webContents.on('did-start-loading',loaded);win.webContents.on('did-finish-load',done);
  const reloaded=async(language,previous)=>{await wait(()=>finished>previous,`reload into ${language}`);await ready(language);};
  const checked={};
  try{
    win.show();await wait(()=>js(`document.body.dataset.ready==='true'`),'initial ready');
    const draft='A draft kept across interface changes.';
    const reply=await js(`settings.replyLanguage==='ja'?'en':'ja'`);
    await js(`document.getElementById('prompt').value=${JSON.stringify(draft)};showChat(true);document.getElementById('settings-toggle').click();document.getElementById('reply-language').value=${JSON.stringify(reply)};showPane('general');true`);
    const initial=finished;await change('ui-language','en');await reloaded('en',initial);
    assert.equal(reloads,1);
    const restored=await js(`({draft:document.getElementById('prompt').value,open:!document.getElementById('settings').hidden,pane:document.querySelector('#settings-nav [aria-selected=true]').dataset.pane,label:document.querySelector('#settings-nav [data-pane=general] span').textContent,stored:sessionStorage.getItem('bula-ui-reload')})`);
    assert.deepEqual(restored,{draft,open:true,pane:'general',label:'General',stored:null});
    assert.equal(disk().uiLanguage,'en');assert.equal(disk().replyLanguage,reply);
    assert.equal(Menu.getApplicationMenu().items[0].submenu.items[0].label,'Show / restore companion');
    checked.english=restored;

    const english=finished;await change('ui-language','zh-TW');await reloaded('zh-TW',english);
    assert.equal(await js(`document.querySelector('#settings-nav [data-pane=general] span').textContent`),'一般');
    assert.equal(disk().uiLanguage,'zh-TW');
    assert.equal(Menu.getApplicationMenu().items[0].submenu.items[0].label,'顯示／恢復人物');
    checked.traditional=disk().uiLanguage;

    release=holdReply();const heldReloads=reloads;
    const provider=await js(`document.getElementById('provider').value`);
    await change('provider',provider==='claude'?'codex':'claude');
    await change('ui-language','ja');
    await wait(()=>js(`!document.getElementById('ui-language').disabled&&Boolean(document.getElementById('ui-prefs-status').textContent)`),'brain switch refused');
    assert.equal(await js(`document.getElementById('ui-language').value`),'zh-TW');
    assert.equal(await js(`document.getElementById('settings').hidden`),false);
    assert.equal(await js(`document.documentElement.lang`),'zh-TW');
    assert.equal(disk().uiLanguage,'zh-TW');assert.equal(reloads,heldReloads);
    checked.refusal=await js(`document.getElementById('ui-prefs-status').textContent`);

    await change('provider',provider);await change('ui-language','en');
    await wait(()=>js(`!document.getElementById('ui-language').disabled&&settings.uiLanguage==='en'`),'queued preference saved');
    assert.equal(disk().uiLanguage,'en');assert.equal(await js(`document.documentElement.lang`),'zh-TW');assert.equal(reloads,heldReloads);
    checked.queued={saved:disk().uiLanguage,visible:'zh-TW',reloads};
    const heldFinished=finished;release();release=null;await reloaded('en',heldFinished);assert.equal(reloads,heldReloads+1);

    await change('theme','dark');
    await wait(()=>js(`document.body.dataset.theme==='dark'&&!document.getElementById('theme').disabled`),'theme applied');
    const colours=await js(`(()=>{const preview=document.getElementById('theme-preview'),panel=document.getElementById('panel');return {theme:preview.dataset.theme,assistant:getComputedStyle(preview.querySelector('.assistant')).backgroundColor,user:getComputedStyle(preview.querySelector('.user')).backgroundColor,panel:getComputedStyle(panel).getPropertyValue('--panel-bg-1').trim(),background:getComputedStyle(panel).backgroundImage};})()`);
    assert.equal(colours.theme,'dark');assert.equal(colours.assistant,'rgb(41, 60, 80)');assert.equal(colours.user,'rgb(55, 86, 110)');assert.equal(colours.panel,'#fffffff5');assert.match(colours.background,/rgba\(255, 255, 255,/);
    await js(`document.getElementById('settings-toggle').click();true`);
    const chat=await js(`({panel:getComputedStyle(document.getElementById('panel')).getPropertyValue('--panel-bg-1').trim(),background:getComputedStyle(document.getElementById('panel')).backgroundImage,assistant:getComputedStyle(document.querySelector('#conversation .assistant')).backgroundColor})`);
    assert.equal(chat.panel,'#162230');assert.match(chat.background,/rgb\(22, 34, 48\)/);assert.equal(chat.assistant,'rgb(41, 60, 80)');assert.equal(disk().theme,'dark');assert.equal(reloads,heldReloads+1);
    checked.dark={preview:colours,chat,saved:disk().theme};
    // A deferred apply captures the pane at notification time, not when the choice was saved.
    await js(`document.getElementById('settings-toggle').click();true`);
    release=holdReply();const before=reloads;
    await change('ui-language','ja');await wait(()=>js(`!document.getElementById('ui-language').disabled&&settings.uiLanguage==='ja'`),'first pending choice');
    await change('ui-language','zh-CN');await wait(()=>js(`!document.getElementById('ui-language').disabled&&settings.uiLanguage==='zh-CN'`),'replacement pending choice');
    await js(`document.getElementById('settings-toggle').click();true`);
    assert.equal(reloads,before);const pendingFinished=finished;release();release=null;await reloaded('zh-CN',pendingFinished);
    assert.equal(reloads,before+1);assert.equal(await js(`document.getElementById('settings').hidden`),true);assert.equal(await js(`document.getElementById('prompt').value`),draft);
    assert.equal(disk().uiLanguage,'zh-CN');checked.coalesced='zh-CN, chat remains open';
    console.log('UI_PREFS_SMOKE',JSON.stringify(checked));
  }finally{release?.();win.webContents.removeListener('did-start-loading',loaded);win.webContents.removeListener('did-finish-load',done);}
}
module.exports={run};
