const terminal=new Terminal({cursorBlink:true,fontSize:14,scrollback:3000,theme:{background:'#10151f'}});
const fit=new FitAddon.FitAddon();terminal.loadAddon(fit);terminal.open(document.getElementById('terminal'));
function resize(){fit.fit();window.agentConsole.resize(terminal.cols,terminal.rows);}
new ResizeObserver(resize).observe(document.getElementById('terminal'));
terminal.onData(text=>window.agentConsole.input(text));
window.agentConsole.onEvent(event=>{
  if(event.type==='started'){terminal.reset();document.getElementById('state').textContent=event.mode==='computer'?'電腦操作工作階段':'瀏覽器操作工作階段';}
  if(event.type==='output')terminal.write(Uint8Array.from(atob(event.data),c=>c.charCodeAt(0)));
  if(event.type==='error'){terminal.writeln('\r\n'+event.message);document.getElementById('state').textContent='啟動失敗';}
  if(event.type==='closed')document.getElementById('state').textContent='已停止';
});
window.agentConsole.ready().then(data=>{terminal.write(data.output);document.getElementById('state').textContent=data.active?'工作階段開啟':'已停止';resize();terminal.focus();});
document.getElementById('interrupt').onclick=()=>window.agentConsole.input('\x03');
document.getElementById('stop').onclick=()=>window.agentConsole.stop();
document.getElementById('emergency').onclick=()=>{document.getElementById('state').textContent='正在緊急停止…';window.agentConsole.emergencyStop();};
