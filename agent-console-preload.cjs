const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('agentConsole',{
  ready:()=>ipcRenderer.invoke('agent-console:ready'),
  input:text=>ipcRenderer.send('agent-console:input',text),
  resize:(cols,rows)=>ipcRenderer.send('agent-console:resize',cols,rows),
  stop:()=>ipcRenderer.send('agent-console:stop'),
  emergencyStop:()=>ipcRenderer.send('agent-console:emergency'),
  onEvent:callback=>ipcRenderer.on('agent-console:event',(_event,data)=>callback(data))
});
