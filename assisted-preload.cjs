// The assisted download window's own toolbar. The site below it runs in a separate sandboxed view with no bridge at all.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('assisted',{
  state:()=>ipcRenderer.invoke('assisted:state'),
  open:(site,query)=>ipcRenderer.invoke('assisted:open',site,query),
  back:()=>ipcRenderer.invoke('assisted:back'),
  readTerms:()=>ipcRenderer.invoke('assisted:read-terms'),
  importChoice:id=>ipcRenderer.invoke('assisted:import',id),
  dismiss:()=>ipcRenderer.invoke('assisted:dismiss'),
  layout:height=>ipcRenderer.invoke('assisted:layout',height),
  onState:callback=>ipcRenderer.on('assisted:state',(_event,state)=>callback(state))
});
