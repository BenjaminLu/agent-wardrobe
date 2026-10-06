// Interface translations, shared by every page (window.i18n) and by the main process (require('./i18n.js')).
// The dictionaries live in locales/<lang>.json as flat namespaced keys ("settings.voice.title"); zh-Hant is the source.
// A value is a string with {name} placeholders, or a plural object {one, other, …} picked by the {count} variable.
// Pages get the active language and dictionary from their preload (window.i18nBridge) or call i18n.set(); elements carry
// data-i18n, data-i18n-placeholder, data-i18n-title and data-i18n-aria-label, and i18n.apply(root) fills them in.
// Platform wording (⌘ → Ctrl, "this Mac" → "this computer") is applied per language when a string is produced.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.i18n=api.page(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const LANGS=['zh-Hant','zh-Hans','en','ja'];
  // system language tag → interface language: zh-TW/HK/MO/Hant → zh-Hant, other zh → zh-Hans, ja → ja, everything else → en
  function systemLanguage(tag){
    const code=String(tag||'').toLowerCase().replace(/_/g,'-');
    if(code.startsWith('zh'))return /hant|-tw|-hk|-mo/.test(code)?'zh-Hant':'zh-Hans';
    if(code.startsWith('ja'))return 'ja';
    return 'en';
  }
  // the uiLanguage setting ('auto' or one of LANGS) and the system language → the language the interface uses
  function resolve(uiLanguage,system){return LANGS.includes(uiLanguage)?uiLanguage:systemLanguage(system);}
  function osOf(platform){return /^(darwin|mac)/i.test(platform||'')?'mac':/^win/i.test(platform||'')?'win':'linux';}

  // Off the Mac: shortcuts, "this Mac", the menu bar and Finder become what Windows / Linux call them, in each language.
  const KEYS=[[/⌘⇧/g,'Ctrl+Shift+'],[/⌘(?=[A-Z0-9↩])/g,'Ctrl+'],[/⌘\s?[＋+]?\s?(?=捲動|滚动|scroll|-scroll|スクロール)/g,'Ctrl＋'],[/⌘/g,'Ctrl'],[/⌥/g,'Alt+']];
  const WORDS={
    'zh-Hant':{win:[[/macOS 內建語音/g,'Windows 內建語音'],[/macOS 內建/g,'Windows 內建'],[/由 macOS 鑰匙圈保護/g,'由 Windows 的資料保護（DPAPI）保護'],[/macOS 鑰匙圈/g,'Windows 資料保護（DPAPI）'],[/這台 Mac ?/g,'這台電腦'],[/在 Mac ?上/g,'在電腦上'],[/ ?Mac ?上/g,'電腦上'],[/選單列/g,'工作列通知區域'],[/Finder/g,'檔案總管']],
      linux:[[/macOS 內建語音/g,'Linux 系統語音（espeak-ng）'],[/macOS 內建/g,'Linux 系統語音'],[/由 macOS 鑰匙圈保護/g,'由系統的金鑰圈（Secret Service）保護'],[/macOS 鑰匙圈/g,'系統金鑰圈'],[/這台 Mac ?/g,'這台電腦'],[/在 Mac ?上/g,'在電腦上'],[/ ?Mac ?上/g,'電腦上'],[/選單列/g,'系統匣'],[/Finder/g,'檔案管理員']]},
    'zh-Hans':{win:[[/macOS 内置语音/g,'Windows 内置语音'],[/macOS 内置/g,'Windows 内置'],[/由 macOS 钥匙串保护/g,'由 Windows 的数据保护（DPAPI）保护'],[/macOS 钥匙串/g,'Windows 数据保护（DPAPI）'],[/这台 Mac ?/g,'这台电脑'],[/在 Mac ?上/g,'在电脑上'],[/ ?Mac ?上/g,'电脑上'],[/菜单栏/g,'任务栏通知区域'],[/访达|Finder/g,'文件资源管理器']],
      linux:[[/macOS 内置语音/g,'Linux 系统语音（espeak-ng）'],[/macOS 内置/g,'Linux 系统语音'],[/由 macOS 钥匙串保护/g,'由系统密钥环（Secret Service）保护'],[/macOS 钥匙串/g,'系统密钥环'],[/这台 Mac ?/g,'这台电脑'],[/在 Mac ?上/g,'在电脑上'],[/ ?Mac ?上/g,'电脑上'],[/菜单栏/g,'系统托盘'],[/访达|Finder/g,'文件管理器']]},
    en:{win:[[/macOS voices?/g,'Windows voice'],[/the macOS Keychain|macOS Keychain/g,'Windows data protection (DPAPI)'],[/this Mac/g,'this computer'],[/This Mac/g,'This computer'],[/on the Mac\b/g,'on the computer'],[/the menu bar/g,'the notification area'],[/menu bar/g,'notification area'],[/Finder/g,'File Explorer']],
      linux:[[/macOS voices?/g,'Linux voice (espeak-ng)'],[/the macOS Keychain|macOS Keychain/g,'the system keyring'],[/this Mac/g,'this computer'],[/This Mac/g,'This computer'],[/on the Mac\b/g,'on the computer'],[/the menu bar/g,'the system tray'],[/menu bar/g,'system tray'],[/Finder/g,'file manager']]},
    ja:{win:[[/macOS 内蔵の音声/g,'Windows 内蔵の音声'],[/macOS 内蔵/g,'Windows 内蔵'],[/macOS のキーチェーン/g,'Windows のデータ保護（DPAPI）'],[/この Mac ?/g,'このパソコン'],[/ ?Mac ?上/g,'パソコン上'],[/メニューバー/g,'通知領域'],[/Finder/g,'エクスプローラー']],
      linux:[[/macOS 内蔵の音声/g,'Linux のシステム音声（espeak-ng）'],[/macOS 内蔵/g,'Linux のシステム音声'],[/macOS のキーチェーン/g,'システムのキーリング'],[/この Mac ?/g,'このパソコン'],[/ ?Mac ?上/g,'パソコン上'],[/メニューバー/g,'システムトレイ'],[/Finder/g,'ファイルマネージャー']]}
  };
  function platformText(text,lang,os){
    if(os==='mac'||typeof text!=='string')return text;
    let out=text;
    for(const [re,to] of KEYS)out=out.replace(re,to);
    // the rules of every language run, the active one first: a string may quote another language's wording
    const order=[lang,...LANGS.filter(l=>l!==lang)];
    for(const l of order)for(const [re,to] of (WORDS[l]?.[os]||[]))out=out.replace(re,to);
    return out;
  }

  function interpolate(text,vars){
    if(!vars)return text;
    return text.replace(/\{(\w+)\}/g,(whole,name)=>Object.prototype.hasOwnProperty.call(vars,name)&&vars[name]!=null?String(vars[name]):whole);
  }
  const plurals={};
  function pick(value,lang,vars){
    if(value&&typeof value==='object'){
      const count=Number(vars?.count);
      let form='other';
      try{form=(plurals[lang]||=new Intl.PluralRules(lang)).select(Number.isFinite(count)?count:0);}catch{}
      return value[form]??value.other??Object.values(value)[0];
    }
    return value;
  }
  // dict: the active language's dictionary; fallbacks: further dictionaries tried in order when a key is missing
  function translate(dicts,lang,os,key,vars){
    let value;
    for(const dict of dicts){if(dict&&Object.prototype.hasOwnProperty.call(dict,key)){value=dict[key];break;}}
    if(value===undefined)return key;
    return platformText(interpolate(String(pick(value,lang,vars)),vars),lang,os);
  }
  // placeholder names in a value (all plural forms together), for the consistency test
  function placeholders(value){
    const text=value&&typeof value==='object'?Object.values(value).join('\n'):String(value);
    return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]))].sort();
  }

  const ATTRS=[['data-i18n-placeholder','placeholder'],['data-i18n-title','title'],['data-i18n-aria-label','aria-label']];
  // Fills data-i18n* elements under root with translated text (t is the translating function).
  // An element with child elements keeps them: only its first own text node is replaced (or one is added in front).
  function applyTo(root,t){
    if(!root||!root.querySelectorAll)return;
    const vars=el=>{const raw=el.getAttribute('data-i18n-vars');if(!raw)return undefined;try{return JSON.parse(raw);}catch{return undefined;}};
    const all=[...(root.matches?.('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label]')?[root]:[]),...root.querySelectorAll('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label]')];
    for(const el of all){
      const key=el.getAttribute('data-i18n');
      if(key){
        const text=t(key,vars(el));
        if(!el.firstElementChild){if(el.textContent!==text)el.textContent=text;}
        else{
          const node=[...el.childNodes].find(n=>n.nodeType===3&&n.nodeValue.trim());
          if(node){const lead=node.nodeValue.match(/^\s*/)[0],tail=node.nodeValue.match(/\s*$/)[0];node.nodeValue=lead+text+tail;}
          else el.insertBefore(el.ownerDocument.createTextNode(text),el.firstChild);
        }
      }
      for(const [attr,target] of ATTRS){const k=el.getAttribute(attr);if(k)el.setAttribute(target,t(k,vars(el)));}
    }
  }

  // A translator over loaded dictionaries: {lang, t(key, vars)}; English and then zh-Hant fill gaps.
  function create(lang,dicts,os){
    const order=[dicts[lang],dicts.en,dicts['zh-Hant']];
    return {lang,t:(key,vars)=>translate(order,lang,os,key,vars)};
  }

  // The page side: window.i18n.
  function page(win){
    const doc=win.document;
    const state={lang:'zh-Hant',dict:{},os:osOf(win.navigator?.platform)};
    const listeners=new Set();
    const api={
      LANGS,systemLanguage,resolve,platformText,
      get lang(){return state.lang;},
      get os(){return state.os;},
      t(key,vars){return translate([state.dict],state.lang,state.os,key,vars);},
      apply(rootEl){applyTo(rootEl||doc,api.t);},
      // set the language and dictionary (pages without a preload bridge, such as the phone page, fetch them)
      // platform (optional): the computer the wording is about, when it is not this device (the phone page)
      set(lang,dict,platform){
        state.lang=LANGS.includes(lang)?lang:'en';state.dict=dict||{};if(platform)state.os=osOf(platform);
        if(doc.documentElement)doc.documentElement.lang=state.lang;
        if(doc.readyState!=='loading')api.apply(doc);
        for(const fn of listeners){try{fn(state.lang);}catch(error){console.error(error);}}
        try{win.dispatchEvent(new win.CustomEvent('i18n:change',{detail:{lang:state.lang}}));}catch{}
      },
      // called with the new language whenever it changes (the page re-renders its dynamic text)
      onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}
    };
    const bridge=win.i18nBridge;
    if(bridge){
      try{const first=bridge.get();state.lang=first.lang;state.dict=first.dict||{};if(first.platform)state.os=osOf(first.platform);}catch(error){console.error('i18n:',error);}
      if(doc.documentElement)doc.documentElement.lang=state.lang;
      bridge.onChange?.(next=>api.set(next.lang,next.dict));
    }
    if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',()=>api.apply(doc));else api.apply(doc);
    win.t=api.t;
    return api;
  }

  return {LANGS,systemLanguage,resolve,osOf,platformText,interpolate,translate,placeholders,applyTo,create,page};
});
