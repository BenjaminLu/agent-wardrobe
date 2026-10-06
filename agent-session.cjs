const {spawn}=require('node:child_process');
const L=require('./locales.cjs');
const {EventEmitter}=require('node:events');
const path=require('node:path');
const {StringDecoder}=require('node:string_decoder');
const {binary}=require('./cli.cjs');
function argumentsFor({mode,text,id,persona,setup=false,mcpConfig=null}) {
  if(!['computer','browser','files'].includes(mode))throw new Error('Unknown task mode');
  if(!setup&&(typeof text!=='string'||!text.trim()||text.length>2000||/[\x00-\x08\x0b-\x1f\x7f]/.test(text)))throw new Error('Invalid task');
  const instructions=mode==='files'?'Organize the requested information into useful documents using report_save. If web browsing is needed, use the official Claude in Chrome integration.':mode==='computer'?'Use the official built-in computer-use integration for this task. If unavailable, explain setup via /mcp; do not install or substitute other automation tools.':'Use the official Claude in Chrome integration for this task. If unavailable, explain setup via /chrome; do not install or substitute other automation tools.';
  return ['--session-id',id,'--permission-mode','auto',...(mode!=='computer'?['--chrome']:[]),...(mcpConfig?['--mcp-config',JSON.stringify(mcpConfig)]:[]),'--append-system-prompt',`${persona}\n${instructions}\nDuring multi-step work, briefly explain meaningful progress and changes in approach in natural language for the user. Do not narrate internal tool names or hidden reasoning. Your final answer is spoken by the desktop character, not a terminal operator. Explain what you actually did, the key findings, and any remaining issue in the user's language. Use plain prose, normally 2–4 short sentences and under 600 characters. Never claim an action succeeded unless verified. If a tool is unavailable, explain that limitation and direct the user to AI settings -> Official Claude setup. Do not create background tasks or scheduled jobs.`,...(setup?[]:['--',text])];
}
class AgentSession extends EventEmitter {
  constructor(){super();this.child=null;this.buffer='';this.output='';this.id=null;}
  start(options){
    if(this.child)throw L.error('tasks.sessionOpen');
    // agent-pty.py gives Claude Code a real terminal through Python's pty module, which Windows does not have
    if(process.platform==='win32')throw L.error('tasks.claudeWindowsUnsupported');
    const args=argumentsFor(options);const claude=binary('claude'),python=binary('python3');
    if(!claude||!python)throw L.error('tasks.needClaudePython');
    const env={...process.env,PATH:`${path.dirname(claude)}:${process.env.PATH||''}`};
    for(const key of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','CODEX_API_KEY','CLAUDECODE'])delete env[key];
    // A launch from inside Claude Code leaks CLAUDE_CODE_* session markers (e.g. CHILD_SESSION disables transcripts).
    for(const key of Object.keys(env))if(key.startsWith('CLAUDE_CODE_'))delete env[key];
    this.output='';this.buffer='';this.id=options.id;
    const decoder=new StringDecoder('utf8');
    const child=spawn(python,[path.join(__dirname,'agent-pty.py'),claude,...args],{cwd:options.cwd,env,stdio:['pipe','pipe','pipe'],shell:false});this.child=child;
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{
      this.buffer+=chunk.toString();const lines=this.buffer.split('\n');this.buffer=lines.pop();
      for(const line of lines){let item;try{item=JSON.parse(line);}catch{continue;}
        if(item.type==='output'){this.output=(this.output+decoder.write(Buffer.from(item.data,'base64'))).slice(-200000);}
        this.emit('event',item);
      }
    });
    child.stderr.on('data',chunk=>this.emit('event',{type:'output',data:Buffer.from(chunk).toString('base64')}));
    child.on('error',error=>this.emit('event',{type:'error',message:error.message}));
    child.on('close',code=>{if(this.child===child){this.child=null;this.emit('event',{type:'closed',code});}});
    this.emit('event',{type:'started',mode:options.mode});
    return {id:this.id,mode:options.mode};
  }
  write(item){if(this.child&&!this.child.stdin.destroyed)this.child.stdin.write(JSON.stringify(item)+'\n');}
  input(text){if(typeof text!=='string'||text.length>20000)throw new Error('Invalid terminal input');this.write({type:'input',data:Buffer.from(text).toString('base64')});}
  resize(cols,rows){if(Number.isInteger(cols)&&Number.isInteger(rows))this.write({type:'resize',cols,rows});}
  stop(){this.write({type:'stop'});}
  emergencyStop(){this.write({type:'emergency'});}
}
module.exports={AgentSession,argumentsFor};
