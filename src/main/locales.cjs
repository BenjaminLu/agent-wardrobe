const {ROOT}=require('./root.cjs');
// The main process's interface language: the uiLanguage setting ('auto' follows the system) and the dictionaries in locales/.
// Everything the main process and its services show or say goes through t(); errors meant for people are made with
// error(key, vars), which carries its key so a screen in another language (a phone with its own setting) can show it in its own.
const fs=require('node:fs');const path=require('node:path');
const i18n=require('../renderer/shared/i18n.js');
const DIR=path.join(ROOT,'locales');
const cache={};
function dict(lang){
  if(cache[lang])return cache[lang];
  let data={};
  try{data=JSON.parse(fs.readFileSync(path.join(DIR,`${lang}.json`),'utf8'));}catch(error){if(error.code!=='ENOENT')console.error(`locales/${lang}.json: ${error.message}`);}
  return cache[lang]=data;
}
const os=i18n.osOf(process.platform);
let current=i18n.resolve('auto',[process.env.LC_ALL,process.env.LANG].find(Boolean)||'en');
const listeners=new Set();
function translator(lang){const l=i18n.LANGS.includes(lang)?lang:current;return i18n.create(l,{[l]:dict(l),en:dict('en'),'zh-Hant':dict('zh-Hant')},os);}
// t(key, vars) in the interface language; t.in(lang)(key, vars) in another one
function t(key,vars){return translator(current).t(key,vars);}
t.in=lang=>translator(lang).t;
module.exports={
  t,
  LANGS:i18n.LANGS,
  get language(){return current;},
  // uiLanguage: the setting; system: the system language tag. Returns the language now in use.
  setLanguage(uiLanguage,system){
    const next=i18n.resolve(uiLanguage,system);
    if(next!==current){current=next;for(const fn of listeners){try{fn(next);}catch(error){console.error(error);}}}
    return current;
  },
  onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  dict,
  // what a page needs: the language, its dictionary with English and zh-Hant filling any gaps, and the platform
  bundle(lang=current){return {lang,dict:{...dict('zh-Hant'),...dict('en'),...dict(lang)},platform:process.platform};},
  // an Error shown to people: message in the interface language, key and vars kept for other screens
  error(key,vars,extra){return Object.assign(new Error(t(key,vars)),{i18nKey:key,i18nVars:vars},extra);},
  // the message of an error in a given language (keyed errors are re-translated; others pass through)
  messageIn(error,lang){return error?.i18nKey?t.in(lang)(error.i18nKey,error.i18nVars):String(error?.message??error);},
  // tests only: drop the loaded dictionaries
  _reload(){for(const key of Object.keys(cache))delete cache[key];}
};
