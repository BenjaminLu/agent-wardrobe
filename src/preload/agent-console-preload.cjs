const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('agentConsole',{
  ready:()=>ipcRenderer.invoke('agent-console:ready'),
  input:text=>ipcRenderer.send('agent-console:input',text),
  resize:(cols,rows)=>ipcRenderer.send('agent-console:resize',cols,rows),
  stop:()=>ipcRenderer.send('agent-console:stop'),
  emergencyStop:()=>ipcRenderer.send('agent-console:emergency'),
  onEvent:callback=>ipcRenderer.on('agent-console:event',(_event,data)=>callback(data))
});
// the interface language for src/renderer/shared/i18n.js: the dictionary once, synchronously, before the page renders; then every change
contextBridge.exposeInMainWorld('i18nBridge',{get:()=>ipcRenderer.sendSync('i18n:get'),onChange:callback=>ipcRenderer.on('i18n:changed',(_event,value)=>callback(value))});
