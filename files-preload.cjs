const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('wardrobeFiles',{
  list:query=>ipcRenderer.invoke('files:list',query),
  openFolder:id=>ipcRenderer.invoke('files:open-folder',id),
  openFile:data=>ipcRenderer.invoke('files:open-file',data),
  reveal:data=>ipcRenderer.invoke('files:reveal',data),
  openRoot:()=>ipcRenderer.invoke('files:open-root'),
  close:()=>ipcRenderer.invoke('files:close'),
  onRefresh:callback=>ipcRenderer.on('files:refresh',()=>callback())
});
// the interface language for i18n.js: the dictionary once, synchronously, before the page renders; then every change
contextBridge.exposeInMainWorld('i18nBridge',{get:()=>ipcRenderer.sendSync('i18n:get'),onChange:callback=>ipcRenderer.on('i18n:changed',(_event,value)=>callback(value))});
