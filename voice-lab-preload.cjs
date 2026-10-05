const {contextBridge,ipcRenderer}=require('electron');
// The studio page sees results and audio, never API keys or file paths.
contextBridge.exposeInMainWorld('voiceLab',{
  init:()=>ipcRenderer.invoke('voicelab:init'),
  method:value=>ipcRenderer.invoke('voicelab:method',value),
  consent:value=>ipcRenderer.invoke('voicelab:consent',value),
  micAccess:()=>ipcRenderer.invoke('voicelab:mic-access'),
  addTake:value=>ipcRenderer.invoke('voicelab:add-take',value),
  removeTake:id=>ipcRenderer.invoke('voicelab:remove-take',id),
  engines:()=>ipcRenderer.invoke('voicelab:engines'),
  install:id=>ipcRenderer.invoke('voicelab:install',id),
  create:value=>ipcRenderer.invoke('voicelab:create',value),
  design:value=>ipcRenderer.invoke('voicelab:design',value),
  designPick:value=>ipcRenderer.invoke('voicelab:design-pick',value),
  importPack:value=>ipcRenderer.invoke('voicelab:import-pack',value),
  preview:value=>ipcRenderer.invoke('voicelab:preview',value),
  save:value=>ipcRenderer.invoke('voicelab:save',value),
  cancelJob:id=>ipcRenderer.invoke('voicelab:job-cancel',id),
  setElevenKey:key=>ipcRenderer.invoke('voicelab:eleven-key',key),
  clearElevenKey:()=>ipcRenderer.invoke('voicelab:eleven-key-clear'),
  close:()=>ipcRenderer.invoke('voicelab:close'),
  onInstallProgress:callback=>ipcRenderer.on('voicelab:install-progress',(_event,value)=>callback(value)),
  onJob:callback=>ipcRenderer.on('voicelab:job',(_event,value)=>callback(value)),
  // Windows / Linux: imported audio is decoded in this page (WebAudio) and handed back as samples
  onDecode:callback=>ipcRenderer.on('voicelab:decode',(_event,value)=>callback(value)),
  decoded:(id,result)=>ipcRenderer.invoke('voicelab:decoded',id,result)
});
