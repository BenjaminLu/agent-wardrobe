const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('game',{
  engines:()=>ipcRenderer.invoke('game:engines'),
  start:()=>ipcRenderer.invoke('game:start'),
  decide:(state,questions)=>ipcRenderer.invoke('game:decide',state,questions),
  event:kind=>ipcRenderer.invoke('game:event',kind),
  close:()=>ipcRenderer.invoke('game:close'),
  onStatus:callback=>ipcRenderer.on('game:status',(_event,value)=>callback(value))
});
