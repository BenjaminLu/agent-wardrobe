const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('person',{
  draw:dataUrl=>ipcRenderer.invoke('person:draw',dataUrl),
  revise:instruction=>ipcRenderer.invoke('person:revise',instruction),
  save:name=>ipcRenderer.invoke('person:save',name),
  close:()=>ipcRenderer.invoke('person:close'),
  loaded:()=>ipcRenderer.invoke('person:loaded'),
  redraw:()=>ipcRenderer.invoke('person:redraw'),
  onProgress:callback=>ipcRenderer.on('person:progress',(_event,value)=>callback(value))
});
