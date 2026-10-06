const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('person',{
  cameraAccess:()=>ipcRenderer.invoke('person:camera-access'),
  draw:dataUrl=>ipcRenderer.invoke('person:draw',dataUrl),
  revise:instruction=>ipcRenderer.invoke('person:revise',instruction),
  save:name=>ipcRenderer.invoke('person:save',name),
  close:()=>ipcRenderer.invoke('person:close'),
  loaded:()=>ipcRenderer.invoke('person:loaded'),
  redraw:()=>ipcRenderer.invoke('person:redraw'),
  onProgress:callback=>ipcRenderer.on('person:progress',(_event,value)=>callback(value))
});
// the interface language for i18n.js: the dictionary once, synchronously, before the page renders; then every change
contextBridge.exposeInMainWorld('i18nBridge',{get:()=>ipcRenderer.sendSync('i18n:get'),onChange:callback=>ipcRenderer.on('i18n:changed',(_event,value)=>callback(value))});
