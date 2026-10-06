const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {BrowserWindow}=require('electron');
// Interface languages end to end: the settings (every pane), the Mod marketplace and the paired phone page switch live,
// without a reload, to en, ja, zh-Hans and back to zh-Hant. In English no Chinese or Japanese text may be visible; in
// Japanese and Simplified Chinese no Traditional-only characters; Mod / user content (translate="no") is not counted.
// Screenshots: evidence/i18n-<lang>.png (settings | marketplace | phone side by side).
const L=require('../locales.cjs');
// characters that only Traditional Chinese uses (Japanese and Simplified Chinese write them differently)
const TRADITIONAL_ONLY='這們說會來對還沒裡點關聲體從應發實處擇據錄頁圖檔單變與將當讓區轉獨聽號';
// for Simplified Chinese also the ones Japanese happens to share
const TRADITIONAL_ZH=TRADITIONAL_ONLY+'為門問題見話鐘費書筆環時後開語設動選確認網視請載務現個機術電腦長際邊頭';
const CHECKS={
  en:{bad:/[　-〿぀-ヿ㐀-鿿＀-￯]/,what:'Chinese or Japanese'},
  ja:{bad:new RegExp(`[${TRADITIONAL_ONLY}]`),what:'Traditional-only'},
  'zh-Hans':{bad:new RegExp(`[${TRADITIONAL_ZH}]`),what:'Traditional'}
};
// the visible text of a page (text nodes, the shown option of each select, placeholders), skipping translate="no" and the conversation
const VISIBLE=`(()=>{
  const out=[];const skip=el=>el.closest('[translate=no],#conversation,script,style,noscript,template');
  const shown=el=>el.checkVisibility({visibilityProperty:true})&&el.getClientRects().length>0;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let n=walker.nextNode();n;n=walker.nextNode()){const el=n.parentElement;if(!el||!n.nodeValue.trim()||skip(el)||el.closest('select,option'))continue;if(shown(el))out.push(n.nodeValue.trim());}
  for(const el of document.querySelectorAll('select'))if(shown(el)&&!skip(el)){const o=el.selectedOptions[0];if(o&&!o.closest('[translate=no]')&&o.getAttribute('translate')!=='no')out.push(o.textContent.trim());}
  for(const el of document.querySelectorAll('input[placeholder],textarea[placeholder]'))if(shown(el)&&!skip(el)&&el.placeholder)out.push(el.placeholder);
  return out;})()`;
// [data-i18n] leaf elements and their current text, to compare with the dictionary
const LABELS=`[...document.querySelectorAll('[data-i18n]:not([data-i18n-vars])')].filter(e=>!e.firstElementChild).map(e=>[e.getAttribute('data-i18n'),e.textContent])`;

async function run({win,startRemote,getMarketWindow}){
  const js=(w,code)=>w.webContents.executeJavaScript(code);
  const wait=async(fn,what,timeout=20000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error(`i18n smoke timed out: ${what}`);await new Promise(r=>setTimeout(r,120));}};
  const evidence=path.join(__dirname,'..','evidence');fs.mkdirSync(evidence,{recursive:true});
  let phone,sheet;
  try{
    win.show();await new Promise(r=>setTimeout(r,500));
    // settings open on the companion
    await js(win,`showChat(true);document.querySelector('#settings').hidden&&document.querySelector('#settings-toggle').click();true`);
    await wait(()=>js(win,`!document.querySelector('#settings').hidden`),'settings open');
    const panes=await js(win,`[...document.querySelectorAll('#settings-nav [data-pane]')].map(b=>b.dataset.pane)`);
    assert.ok(panes.includes('general'),'settings has a general pane');
    // the marketplace
    await js(win,'window.bula.wardrobe()');await wait(()=>getMarketWindow()?.webContents.executeJavaScript('document.querySelectorAll(".mod-card").length>0'),'marketplace');
    const market=getMarketWindow();
    // a paired phone, following the computer's language
    await startRemote();
    const info=await js(win,`window.bula.remotePair()`);
    phone=new BrowserWindow({width:390,height:760,show:true,title:'Phone',webPreferences:{contextIsolation:true,sandbox:true,partition:'i18n-smoke-phone'}});
    await phone.loadURL(info.link);
    await wait(()=>js(phone,`!document.querySelector('#app').hidden`),'phone paired');
    const phoneTabs=await js(phone,`[...document.querySelectorAll('#tabs [data-tab]')].map(b=>b.dataset.tab)`);
    // marks that disappear if a window reloads: the switch must be live
    for(const w of [win,market,phone])await js(w,'window.__i18nSmoke=1');
    const result={};
    for(const lang of ['en','ja','zh-Hans','zh-Hant']){
      const tr=L.t.in(lang);
      await js(win,`window.bula.uiLanguage(${JSON.stringify(lang)})`);
      for(const [name,w] of [['companion',win],['marketplace',market],['phone',phone]])
        await wait(()=>js(w,`document.documentElement.lang===${JSON.stringify(lang)}&&window.i18n?.lang===${JSON.stringify(lang)}`),`${name} switched to ${lang}`);
      await new Promise(r=>setTimeout(r,400));
      for(const w of [win,market,phone])assert.equal(await js(w,'window.__i18nSmoke'),1,'switched without reloading');
      // key labels
      assert.equal((await js(win,`document.querySelector('#ui-language').closest('label').querySelector('[data-i18n]').textContent`)).trim(),tr('settings.general.uiLanguage').trim(),`${lang}: interface language label`);
      assert.equal(market.getTitle(),tr('marketplace.windowTitle'),`${lang}: marketplace title`);
      const seen={};
      for(const [name,w] of [['settings',win],['marketplace',market],['phone',phone]]){
        const labels=await js(w,LABELS);const matching=labels.filter(([k,text])=>text.trim()===tr(k).trim());
        assert.ok(matching.length>=3,`${lang} ${name}: labels follow the dictionary (${matching.length}/${labels.length})`);
        seen[name]=matching.length;
      }
      // no text left in another language, on every settings pane, the marketplace and every phone tab
      const check=CHECKS[lang];const leftovers=[];
      // every look must see real text, or a hidden window would pass for an empty one
      const look=async(where,w)=>{const texts=await js(w,VISIBLE);assert.ok(texts.length>3,`${lang} ${where}: visible text (${texts.length})`);if(!check)return;for(const text of texts)if(check.bad.test(text))leftovers.push(`${where}: ${text.slice(0,80)}`);};
      // keeps the chat panel and the settings open (the open marketplace puts the companion in click-through mode, and the idle timer folds the panel away)
      const openSettings=()=>js(win,`window.bula.stream(false).then(()=>new Promise(r=>setTimeout(r,200))).then(()=>{clearTimeout(idleTimer);showChat(false);if(document.querySelector('#settings').hidden)document.querySelector('#settings-toggle').click();return !document.querySelector("#settings").hidden&&!document.querySelector("#panel").hidden;})`);
      for(const pane of panes){assert.ok(await openSettings(),'settings shown');await js(win,`document.querySelector('#settings-nav [data-pane=${pane}]').click();true`);await new Promise(r=>setTimeout(r,150));await look(`settings/${pane}`,win);}
      await look('marketplace',market);
      for(const tab of phoneTabs){await js(phone,`document.querySelector('#tabs [data-tab=${tab}]').click();true`);await new Promise(r=>setTimeout(r,250));await look(`phone/${tab}`,phone);}
      assert.deepEqual(leftovers,[],`${lang}: ${check?.what} text still visible`);
      // Japanese: a few labels in Japanese
      if(lang==='ja')for(const key of ['settings.general.uiLanguage','menu.quit'])assert.match(tr(key),/[぀-ヿ]|表示言語/,key);
      // the screenshot: settings (general pane) | marketplace | phone (first tab)
      await openSettings();await js(win,`document.querySelector('#settings-nav [data-pane=general]').click();true`);await js(phone,`document.querySelector('#tabs [data-tab=${phoneTabs[0]}]').click();true`);
      await new Promise(r=>setTimeout(r,400));
      const shots=[await win.webContents.capturePage(),await market.webContents.capturePage(),await phone.webContents.capturePage()].map(img=>img.toDataURL());
      sheet||=new BrowserWindow({show:false,width:400,height:300,webPreferences:{offscreen:false,sandbox:true}});
      await sheet.loadURL('about:blank');
      const png=await sheet.webContents.executeJavaScript(`(async shots=>{const imgs=await Promise.all(shots.map(src=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src=src;})));
        const h=Math.max(...imgs.map(i=>i.height)),scale=imgs.map(i=>h/i.height),w=imgs.reduce((s,i,k)=>s+i.width*scale[k],0)+16*(imgs.length-1);
        const c=document.createElement('canvas');c.width=Math.round(w);c.height=h;const g=c.getContext('2d');g.fillStyle='#ffffff';g.fillRect(0,0,c.width,c.height);
        let x=0;imgs.forEach((i,k)=>{g.drawImage(i,x,0,i.width*scale[k],h);x+=i.width*scale[k]+16;});return c.toDataURL('image/png');})(${JSON.stringify(shots)})`);
      fs.writeFileSync(path.join(evidence,`i18n-${lang}.png`),Buffer.from(png.split(',')[1],'base64'));
      result[lang]={labels:seen,panes:panes.length,phoneTabs:phoneTabs.length};
    }
    console.log('I18N_SMOKE',JSON.stringify(result));
  }finally{phone?.destroy();sheet?.destroy();const m=getMarketWindow();if(m&&!m.isDestroyed())m.close();}
}
module.exports={run};
