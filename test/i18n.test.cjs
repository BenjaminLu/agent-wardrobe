const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const i18n=require('../i18n.js');const lint=require('../scripts/i18n-lint.cjs');
const ROOT=path.join(__dirname,'..');
const load=lang=>JSON.parse(fs.readFileSync(path.join(ROOT,'locales',`${lang}.json`),'utf8'));
const dicts=Object.fromEntries(i18n.LANGS.map(lang=>[lang,load(lang)]));

test('every key exists in all four locales, none is empty, and placeholders match the zh-Hant source',()=>{
  const source=dicts['zh-Hant'];
  assert.ok(Object.keys(source).length>100,'zh-Hant has the interface text');
  for(const lang of i18n.LANGS){
    const dict=dicts[lang];
    assert.deepEqual(Object.keys(dict).filter(k=>!(k in source)),[],`${lang}: keys zh-Hant does not have`);
    assert.deepEqual(Object.keys(source).filter(k=>!(k in dict)),[],`${lang}: keys missing`);
    for(const [key,value] of Object.entries(dict)){
      const forms=value&&typeof value==='object'?Object.values(value):[value];
      assert.ok(forms.length&&forms.every(f=>typeof f==='string'&&f.length),`${lang}: ${key} is empty`);
      if(value&&typeof value==='object')assert.ok('other' in value,`${lang}: ${key} plural needs "other"`);
      assert.deepEqual(i18n.placeholders(value),i18n.placeholders(source[key]),`${lang}: ${key} placeholders differ from zh-Hant`);
    }
  }
});

test('English and Japanese have no Chinese-only text, and zh-Hans is not left in Traditional characters',()=>{
  // characters whose Traditional form differs from the Simplified one (a sample of very common ones)
  const traditional=/[這個們說會時來對後還沒裡點開關聲語設體從應發現實務請處載動選擇確認據錄網頁圖檔單視]/;
  const endonyms=/日本語|繁體中文|简体中文/g;  // language names are shown in their own language, so they may appear in any locale
  const leftovers=Object.entries(dicts['zh-Hans']).filter(([,v])=>traditional.test((typeof v==='string'?v:Object.values(v).join(' ')).replace(endonyms,'')));
  assert.deepEqual(leftovers.map(([k])=>k),[],'zh-Hans values still in Traditional characters');
  const han=/[\u4e00-\u9fff]/;
  const enCjk=Object.entries(dicts.en).filter(([,v])=>/[\u3040-\u30ff\u4e00-\u9fff]/.test((typeof v==='string'?v:Object.values(v).join(' ')).replace(endonyms,'')));
  assert.deepEqual(enCjk.map(([k])=>k).filter(k=>!/^lang\./.test(k)),[],'English values with Chinese or Japanese characters');
  // Japanese UI text uses kana; a value that is all kanji and long is most likely untranslated Chinese
  const jaChinese=Object.entries(dicts.ja).filter(([k,v])=>{const s=typeof v==='string'?v:Object.values(v).join(' ');return !/^lang\./.test(k)&&han.test(s)&&!/[\u3040-\u30ff]/.test(s)&&s.replace(/[^\u4e00-\u9fff]/g,'').length>6;});
  assert.deepEqual(jaChinese.map(([k])=>k),[],'Japanese values that look like Chinese');
});

test('system languages map to the four interface languages; the setting wins over the system',()=>{
  for(const [tag,lang] of [['zh-TW','zh-Hant'],['zh-HK','zh-Hant'],['zh-MO','zh-Hant'],['zh-Hant-TW','zh-Hant'],['zh-CN','zh-Hans'],['zh-SG','zh-Hans'],['zh','zh-Hans'],['zh-Hans','zh-Hans'],['ja-JP','ja'],['ja','ja'],['en-US','en'],['fr-FR','en'],['de','en'],['','en'],[undefined,'en']])
    assert.equal(i18n.resolve('auto',tag),lang,tag);
  assert.equal(i18n.resolve('ja','zh-TW'),'ja');assert.equal(i18n.resolve('bogus','ja-JP'),'ja');
});

test('t interpolates, picks plurals, falls back to English then zh-Hant then the key, and rewrites Mac wording off the Mac',()=>{
  const dicts={en:{hi:'Hi {name}',files:{one:'{count} file',other:'{count} files'},only:'English'},'zh-Hant':{hi:'嗨 {name}',zhOnly:'只有中文',mac:'在這台 Mac 上按 ⌘⇧S'},ja:{hi:'こんにちは {name}'}};
  const ja=i18n.create('ja',dicts,'mac').t;
  assert.equal(ja('hi',{name:'Annie'}),'こんにちは Annie');assert.equal(ja('only'),'English');assert.equal(ja('zhOnly'),'只有中文');assert.equal(ja('nope'),'nope');
  const en=i18n.create('en',dicts,'mac').t;
  assert.equal(en('files',{count:1}),'1 file');assert.equal(en('files',{count:3}),'3 files');assert.equal(en('hi'),'Hi {name}','a missing variable stays visible');
  const zhWin=i18n.create('zh-Hant',dicts,'win').t;
  assert.equal(zhWin('mac'),'在這台電腦上按 Ctrl+Shift+S');
  assert.equal(i18n.platformText('Open Finder on this Mac (⌘O)','en','linux'),'Open file manager on this computer (Ctrl+O)');
  assert.equal(i18n.platformText('この Mac の Finder','ja','win'),'このパソコンの エクスプローラー');
  assert.equal(i18n.platformText('这台 Mac 的菜单栏','zh-Hans','win'),'这台电脑的任务栏通知区域');
  assert.equal(i18n.platformText('在這台 Mac 上','zh-Hant','mac'),'在這台 Mac 上','unchanged on the Mac');
});

test('applyTranslations fills data-i18n text and attributes, keeping child elements',()=>{
  // a tiny DOM stand-in: enough of Element for applyTo
  const text=value=>({nodeType:3,nodeValue:value});
  function el(attrs,children=[]){
    const e={attrs:{...attrs},childNodes:children,get firstElementChild(){return children.find(c=>c.nodeType===1)||null;},nodeType:1,
      getAttribute:n=>e.attrs[n]??null,setAttribute:(n,v)=>{e.attrs[n]=v;},
      get textContent(){return children.map(c=>c.nodeType===3?c.nodeValue:c.textContent).join('');},set textContent(v){children.length=0;children.push(text(v));},
      ownerDocument:{createTextNode:text},insertBefore(node){children.unshift(node);}};
    return e;
  }
  const label=el({'data-i18n':'label'},[el({},[])]);const plain=el({'data-i18n':'plain','data-i18n-title':'tip','data-i18n-vars':'{"n":2}'});const input=el({'data-i18n-placeholder':'hint','data-i18n-aria-label':'aria'});
  const root={querySelectorAll:()=>[label,plain,input],matches:()=>false};
  const dict={label:'Language',plain:'{n} items',tip:'Tip',hint:'Type…',aria:'Chat'};
  i18n.applyTo(root,(k,v)=>i18n.interpolate(dict[k],v));
  assert.equal(label.childNodes[0].nodeValue,'Language');assert.equal(label.childNodes.length,2,'the select inside the label stays');
  assert.equal(plain.textContent,'2 items');assert.equal(plain.attrs.title,'Tip');
  assert.equal(input.attrs.placeholder,'Type…');assert.equal(input.attrs['aria-label'],'Chat');
});

test('main-process errors carry their key so another screen can show them in its own language',()=>{
  const L=require('../locales.cjs');
  const before=L.language;
  L.setLanguage('zh-Hant');const error=L.error('errors.invalidValue');
  assert.equal(error.message,dicts['zh-Hant']['errors.invalidValue']);
  assert.equal(L.messageIn(error,'en'),dicts.en['errors.invalidValue']);assert.equal(L.messageIn(new Error('plain'),'ja'),'plain');
  L.setLanguage('ja');assert.equal(L.t('errors.invalidValue'),dicts.ja['errors.invalidValue']);
  const bundle=L.bundle('en');assert.equal(bundle.lang,'en');assert.equal(bundle.dict['errors.invalidValue'],dicts.en['errors.invalidValue']);
  L.setLanguage(before);
});

test('the lint finds hard-coded strings in code, templates and HTML, but not in comments, regexes or translate="no"',()=>{
  const js=`// 註解不檢查\nconst a='中文';/* 區塊 */const r=/停下來/;const b=\`x \${y?'好':'no'} 這裡\`;const c=x/2/'n';const d={k:\`\${'嗨'}\`};`;
  assert.deepEqual(lint.jsLiterals(js).filter(l=>lint.CJK.test(l.text)).map(l=>l.text),["'中文'","'好'",' 這裡`',"'嗨'"]);
  const html='<p>你好</p><option translate="no">繁體中文</option><b title="提示">x</b><!-- 註解 --><script>const s="略過";</script>';
  assert.deepEqual(lint.htmlStrings(html).filter(l=>lint.CJK.test(l.text)).map(l=>l.text),['你好','title="提示"']);
});

test('no hard-coded interface text: every page, page script and main-process file goes through locales/',()=>{
  const problems=lint.files().flatMap(file=>lint.scan(file));
  assert.deepEqual(problems.map(p=>`${p.file}:${p.line} ${p.text}`),[],'move these into locales/*.json and show them with t(), or (rarely) add a documented ALLOW rule in scripts/i18n-lint.cjs');
  assert.deepEqual(lint.staleRules().map(r=>`${r.file}: ${r.region||r.literal}`),[],'ALLOW rules that no longer match anything');
  // every rule says why
  for(const rule of lint.ALLOW)assert.ok(rule.why&&rule.why.length>10,`${rule.file}: say why`);
});
