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
