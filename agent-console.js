const terminal=new Terminal({cursorBlink:true,fontSize:14,scrollback:3000,theme:{background:'#10151f'}});
const fit=new FitAddon.FitAddon();terminal.loadAddon(fit);terminal.open(document.getElementById('terminal'));
function resize(){fit.fit();window.agentConsole.resize(terminal.cols,terminal.rows);}
new ResizeObserver(resize).observe(document.getElementById('terminal'));
terminal.onData(text=>window.agentConsole.input(text));
// the state line keeps its key so a language change re-renders it
let stateKey='console.state.preparing';
function showState(key){stateKey=key;document.getElementById('state').textContent=t(key);}
showState(stateKey);i18n.onChange(()=>showState(stateKey));
window.agentConsole.onEvent(event=>{
  if(event.type==='started'){terminal.reset();showState(event.mode==='computer'?'console.state.computer':'console.state.browser');}
  if(event.type==='output')terminal.write(Uint8Array.from(atob(event.data),c=>c.charCodeAt(0)));
  if(event.type==='error'){terminal.writeln('\r\n'+event.message);showState('console.state.failed');}
  if(event.type==='closed')showState('console.state.stopped');
});
window.agentConsole.ready().then(data=>{terminal.write(data.output);showState(data.active?'console.state.active':'console.state.stopped');resize();terminal.focus();});
document.getElementById('interrupt').onclick=()=>window.agentConsole.input('\x03');
document.getElementById('stop').onclick=()=>window.agentConsole.stop();
document.getElementById('emergency').onclick=()=>{showState('console.state.stopping');window.agentConsole.emergencyStop();};
