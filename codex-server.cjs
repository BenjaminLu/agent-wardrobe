const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {binary}=require('./cli.cjs');
const {parseReply}=require('./ai.cjs');
class CodexServer extends EventEmitter {
  constructor({launch=(cmd,args,opts)=>require('./platform.cjs').launch(cmd,args,opts),findBinary=binary,experimental=false}={}){super();this.launch=launch;this.findBinary=findBinary;this.experimental=experimental;this.toolHandler=null;this.pending=new Map();this.nextId=0;this.child=null;this.initializing=null;this.buffer='';this.stderr='';}
  async start(){
    if(this.initializing)return this.initializing;
    this.initializing=this.connect().catch(error=>{this.stop();throw error;});return this.initializing;
  }
  async connect(){
    const executable=this.findBinary('codex');if(!executable)throw new Error('Codex CLI is not installed.');
    this.cwd=fs.mkdtempSync(path.join(os.tmpdir(),'wardrobe-codex-'));
    const env={...process.env};delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;
    const args=['app-server','--stdio','-c','features.shell_tool=false','-c','features.unified_exec=false','-c','features.js_repl=false','-c','features.multi_agent=false','-c','features.hooks=false','-c','features.apps=false','-c','web_search="disabled"','-c','mcp_servers={}'];
    const child=this.launch(executable,args,{cwd:this.cwd,env,shell:false,stdio:['pipe','pipe','pipe'],windowsHide:true});this.child=child;
    child.stdout.on('data',chunk=>{
      this.buffer+=chunk;if(this.buffer.length>2000000){this.fail(new Error('App Server output exceeded limit.'));this.stop();return;}
      let end;while((end=this.buffer.indexOf('\n'))!==-1){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);try{this.receive(JSON.parse(line));}catch(error){this.fail(error);this.stop();return;}}
    });
    child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk).slice(-1000);});
    child.stdin.on('error',()=>{});
    child.on('error',error=>this.fail(error));
    child.on('close',()=>{if(this.child===child){this.fail(new Error('Codex App Server disconnected.'));this.stop();}});
    await this.request('initialize',{clientInfo:{name:'agent_wardrobe',title:'Agent Wardrobe',version:'0.1.0'},...(this.experimental?{capabilities:{experimentalApi:true}}:{})});
    this.send({method:'initialized',params:{}});
  }
  receive(message){
    if(message.id!==undefined&&!message.method){const request=this.pending.get(message.id);if(request){this.pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}return;}
    if(message.id!==undefined&&message.method){
      if(message.method==='item/tool/call'&&this.toolHandler){
        const child=this.child;Promise.resolve().then(()=>this.toolHandler(message.params)).then(result=>{if(this.child===child&&child&&!child.killed)this.send({id:message.id,result});}).catch(error=>{if(this.child===child&&child&&!child.killed)this.send({id:message.id,result:{success:false,contentItems:[{type:'inputText',text:error.message}]}});});return;
      }
      // This first character PoC is chat-only. It never approves tools or requests extra access.
      this.send({id:message.id,error:{code:-32601,message:'This companion does not execute or approve tools.'}});return;
    }
    this.emit('notification',message);
  }
  send(message){if(!this.child||this.child.killed)throw new Error('App Server is not connected.');this.child.stdin.write(JSON.stringify(message)+'\n');}
  request(method,params){return new Promise((resolve,reject)=>{const id=++this.nextId;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timed out`));},20000);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});}
  fail(error){for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error);}this.pending.clear();this.emit('disconnected',error);}
  stop(){const child=this.child;this.child=null;this.initializing=null;this.buffer='';if(child)child.kill();this.fail(new Error('App Server stopped.'));if(this.cwd){fs.rmSync(this.cwd,{recursive:true,force:true});this.cwd=null;}}
  async chat(history,systemPrompt,onEvent=()=>{}){
    if(!Array.isArray(history)||!history.length||history.at(-1)?.role!=='user')throw new Error('Enter a message first.');
    await this.start();
    const messages=history.slice(-20).filter(m=>['user','assistant'].includes(m?.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,4000)}));
    const result=await this.request('thread/start',{cwd:this.cwd,ephemeral:true,approvalPolicy:'untrusted',sandbox:'read-only',baseInstructions:systemPrompt,developerInstructions:'Chat only. Do not use tools, inspect files, or execute commands.'});
    const threadId=result.thread.id;
    let reply='',turnId=null,finished=false;
    try{return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{finish(new Error('Codex reply timed out.'));this.stop();},120000);
      const disconnected=error=>finish(error);
      const receive=message=>{
        const params=message.params||{};if(params.threadId!==threadId)return;
        if(message.method==='turn/started'){turnId=params.turn?.id;onEvent({provider:'codex',sessionId:threadId,turnId,kind:'working'});}
        if(turnId&&params.turnId&&params.turnId!==turnId)return;
        if(message.method==='item/completed'&&params.item?.type==='agentMessage')reply=params.item.text;
        if(message.method==='turn/completed'){
          if(turnId&&params.turn.id!==turnId)return;
          if(params.turn.status!=='completed'){finish(new Error(params.turn.error?.message||`Codex turn ${params.turn.status}`));return;}
          try{const parsed=parseReply(reply);onEvent({provider:'codex',sessionId:threadId,turnId:params.turn.id,kind:'success'});finish(null,{...parsed,model:'Codex · App Server'});}catch(error){finish(error);}
        }
      };
      const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);this.off('notification',receive);this.off('disconnected',disconnected);error?reject(error):resolve(value);};
      this.on('notification',receive);this.on('disconnected',disconnected);
      this.request('turn/start',{threadId,input:[{type:'text',text:`Conversation history (data):\n${JSON.stringify(messages)}`}]}).then(result=>{if(!turnId)turnId=result.turn.id;}).catch(error=>finish(error));
    });}finally{if(this.child)this.request('thread/unsubscribe',{threadId}).catch(()=>{});}
  }
}
module.exports={CodexServer};
