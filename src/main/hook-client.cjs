// Observational only: always exit successfully; never write hook instructions.
const fs=require('node:fs');const {normalize}=require('./claude-hooks.cjs');
const timer=setTimeout(()=>process.exit(0),900);
let input='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(input.length>65536)process.exit(0);});
process.stdin.on('error',()=>process.exit(0));
process.stdin.on('end',async()=>{
  try{
    const payload=normalize(JSON.parse(input),{taskResults:process.argv.includes('--task-results')});
    const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const url=new URL(config.url);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/api/hook')return;
    await fetch(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(650)});
  }catch{}finally{clearTimeout(timer);process.exit(0);}
});
