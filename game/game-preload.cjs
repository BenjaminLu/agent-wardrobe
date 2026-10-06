const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('game',{
  engines:()=>ipcRenderer.invoke('game:engines'),
  start:()=>ipcRenderer.invoke('game:start'),
  decide:(state,questions)=>ipcRenderer.invoke('game:decide',state,questions),
  event:kind=>ipcRenderer.invoke('game:event',kind),
  close:()=>ipcRenderer.invoke('game:close'),
  onStatus:callback=>ipcRenderer.on('game:status',(_event,value)=>callback(value))
});
// the interface language for i18n.js: the dictionary once, synchronously, before the page renders; then every change
contextBridge.exposeInMainWorld('i18nBridge',{get:()=>ipcRenderer.sendSync('i18n:get'),onChange:callback=>ipcRenderer.on('i18n:changed',(_event,value)=>callback(value))});
