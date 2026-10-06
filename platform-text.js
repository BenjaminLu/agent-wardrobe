// The interface is written for macOS (⌘⇧S, "this Mac", macOS voices). On Windows and Linux this rewrites what the pages show:
// shortcuts become Ctrl+Shift+S, "this Mac" becomes "this computer", and Mac-only rows (marked data-mac-only) are hidden.
// The wording rules are per language and live in i18n.js (load it first); t() already applies them, and this catches text
// a page builds without t(). It runs on text nodes and on title / placeholder / aria-label attributes, now and whenever
// the page changes, but never inside the conversation (what people and the AI wrote stays as written).
(()=>{
  const os=/Mac/i.test(navigator.platform)?'mac':/Win/i.test(navigator.platform)?'win':'linux';
  document.documentElement.dataset.os=os;
  const fix=text=>window.i18n?window.i18n.platformText(text,window.i18n.lang,os):text;
  window.platformText=fix;
  if(os==='mac')return;
  const skip=node=>node.parentElement?.closest?.('#conversation,textarea,input,[data-keep-text]');
  const ATTRS=['title','placeholder','aria-label'];
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
})();
