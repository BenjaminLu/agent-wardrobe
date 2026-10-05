// App-owned stdio MCP document writer; no shell, arbitrary paths or read tools.
const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');const {OutputStore,reportTool}=require('./output-store.cjs');
const planFile=path.resolve(process.argv[2]);const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));const store=new OutputStore(plan.root,path.dirname(planFile));
const respond=(id,result,error)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...(error?{error}:{result})})+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  let request;try{if(line.length>650000)throw new Error('Request too large');request=JSON.parse(line);if(request.id===undefined)return;
    if(request.method==='initialize')return respond(request.id,{protocolVersion:request.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'wardrobe-documents',version:'1.0.0'}});
    if(request.method==='ping')return respond(request.id,{});
    if(request.method==='tools/list')return respond(request.id,{tools:[reportTool]});
    if(request.method==='tools/call'){
      try{const args=request.params?.arguments;if(request.params?.name!=='report_save'||!args||Object.keys(args).some(k=>!['filename','content'].includes(k)))throw new Error('Invalid document tool');const result=store.save(plan.id,args.filename,args.content);return respond(request.id,{content:[{type:'text',text:JSON.stringify(result)}]});}
      catch(error){return respond(request.id,{isError:true,content:[{type:'text',text:error.message}]});}
    }
    respond(request.id,null,{code:-32601,message:'Unknown method'});
  }catch(error){if(request?.id!==undefined)respond(request.id,null,{code:-32602,message:error.message});}
});
