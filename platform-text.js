// The interface is written for macOS (⌘⇧S, "this Mac", macOS voices). On Windows and Linux this rewrites what the pages show:
// shortcuts become Ctrl+Shift+S, "this Mac" becomes "this computer", and Mac-only rows (marked data-mac-only) are hidden.
// It runs on text nodes and on title / placeholder / aria-label / data-en attributes, now and whenever the page changes,
// but never inside the conversation (what people and the AI wrote stays as written).
(()=>{
  const os=/Mac/i.test(navigator.platform)?'mac':/Win/i.test(navigator.platform)?'win':'linux';
  document.documentElement.dataset.os=os;
  if(os==='mac')return;
  const win=os==='win';
  const RULES=[
    [/⌘⇧/g,'Ctrl+Shift+'],[/⌘(?=[A-Z0-9↩])/g,'Ctrl+'],[/⌘\s?[＋+]?\s?(?=捲動|scroll|-scroll)/g,'Ctrl＋'],[/⌘/g,'Ctrl'],[/⌥/g,'Alt+'],
    [/macOS 內建語音/g,win?'Windows 內建語音':'Linux 系統語音（espeak-ng）'],[/macOS 內建/g,win?'Windows 內建':'Linux 系統語音'],[/macOS voices?/g,win?'Windows voice':'Linux voice (espeak-ng)'],
    [/由 macOS 鑰匙圈保護/g,win?'由 Windows 的資料保護（DPAPI）保護':'由系統的金鑰圈（Secret Service）保護'],[/macOS Keychain/g,win?'Windows data protection (DPAPI)':'the system keyring'],
    [/這台 Mac/g,'這台電腦'],[/这台 Mac/g,'这台电脑'],[/this Mac/g,'this computer'],[/on the Mac\b/g,'on the computer'],[/在 Mac 上/g,'在電腦上'],[/Mac 上/g,'電腦上'],
    [/選單列/g,win?'工作列通知區域':'系統匣'],[/menu bar/g,win?'notification area':'system tray'],[/Finder/g,win?'檔案總管':'檔案管理員']
  ];
  const fix=text=>{let out=text;for(const [re,to] of RULES)out=out.replace(re,to);return out;};
  const skip=node=>node.parentElement?.closest?.('#conversation,textarea,input,[data-keep-text]');
  const ATTRS=['title','placeholder','aria-label','data-en'];
  function element(el){
    if(el.closest('#conversation'))return false;
    for(const a of ATTRS)if(el.hasAttribute(a)){const v=el.getAttribute(a),t=fix(v);if(t!==v)el.setAttribute(a,t);}
    if(el.matches('[data-mac-only]')&&!el.hidden){el.hidden=true;if('disabled' in el)el.disabled=true;}
    return true;
  }
  function visit(root){
    if(root.nodeType===3){if(!skip(root)){const t=fix(root.nodeValue);if(t!==root.nodeValue)root.nodeValue=t;}return;}
    if(root.nodeType!==1||!element(root))return;
    for(const child of root.childNodes)visit(child);
  }
  const start=()=>{visit(document.body);new MutationObserver(list=>{for(const m of list){if(m.type==='characterData')visit(m.target);else if(m.type==='attributes')element(m.target);else m.addedNodes.forEach(visit);}})
    .observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:[...ATTRS,'hidden']});};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start);
  window.platformText=fix;
})();
