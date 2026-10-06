const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {binary}=require('../src/main/cli.cjs');const hooks=require('../src/main/claude-hooks.cjs');const {Runtime}=require('../src/main/runtime.cjs');const {loadCatalog}=require('../src/main/mods.cjs');const {startControl}=require('../src/main/control-server.cjs');
async function main(){
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'wardrobe-claude-live-'));let control;
  try{
    const observed=[];const catalog=loadCatalog();const runtime=new Runtime(catalog,{provider:'claude'});
    control=await startControl({runtime,catalog,language:'en',onSelect:v=>runtime.select(v),onProvider:v=>runtime.provider(v),onHook:data=>{observed.push(data.event);return {ok:true};}});
    const bridge=path.join(project,'bridge.json');fs.writeFileSync(bridge,JSON.stringify({url:control.origin+'/api/hook',token:control.token}),{mode:0o600});
    hooks.configure({project,executable:process.execPath,client:path.resolve(__dirname,'../src/main/hook-client.cjs'),bridge});
    const env={...process.env};delete env.ANTHROPIC_API_KEY;delete env.CLAUDECODE;
    const output=await new Promise((resolve,reject)=>{
      const child=spawn(binary('claude'),['-p','--output-format','json','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--setting-sources','local'],{cwd:project,env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
      const timer=setTimeout(()=>{child.kill();reject(new Error('Claude live hook test timed out'));},60000);
      child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr=(stderr+chunk).slice(-500));
      child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);if(code){let reason=stderr;try{reason=JSON.parse(stdout).result||reason;}catch{}reject(new Error(String(reason||'Claude failed').slice(0,300)+'; observed hooks: '+observed.join(',')));}else resolve(stdout);});child.stdin.end('Say hello in one short sentence. Do not use tools.');
    });
    const reply=JSON.parse(output);if(reply.is_error)throw new Error(reply.result);
    if(!observed.includes('UserPromptSubmit')||!observed.includes('Stop'))throw new Error('Expected real hooks did not arrive: '+observed.join(','));
    console.log(JSON.stringify({provider:'claude',replyReceived:typeof reply.result==='string',observed}));
  }finally{if(control)await control.close();fs.rmSync(project,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
