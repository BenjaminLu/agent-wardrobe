const fs=require('node:fs');const path=require('node:path');
const reportTool={name:'report_save',description:'Save a requested report or comparison as a document in this task’s Desktop folder. Use readable Markdown for reports, CSV for tables, TXT or JSON for data. Files are never overwritten. Returns the verified saved path.',inputSchema:{type:'object',properties:{filename:{type:'string'},content:{type:'string',maxLength:150000}},required:['filename','content'],additionalProperties:false}};
const outputInstructions='When the user asks to organize information, prepare a report/comparison/table, or save/export data, create useful complete documents with report_save. Default to a readable Markdown report and CSV when a comparison table is useful. Include verified sources, dimensions and links when available, distinguish unknown facts, and use prior conversation context. Do not save only your short final spoken reply. The App saves to a task folder on the Desktop and provides an Open folder button. Use report_save instead of shell or other filesystem tools for these deliverables. Do not claim a file was saved without a successful tool response.';
function wantsDocument(text){
  return /^(?:整理|彙整|彙總|匯整|汇总|存成|存檔|儲存|保存|匯出)/.test(text.trim())||/(?:整理|彙整|匯整|汇总|存成|存檔|存档|儲存|保存|匯出|导出|export|organize|summarize)/i.test(text)&&/(?:請|幫|帮|麻煩|我要|我想|please|can you|organize|summarize|export)/i.test(text)
    ||/(?:製作|制作|產生|生成|寫|寫成|做成|給我|幫我做|prepare|create|generate|write|make).*?(?:報告|报告|比較表|比较表|比較清單|report|table|document)/i.test(text)
    ||/(?:資料|結果|報告|文件|檔案).*?(?:存到|放到|放在|放進).*?(?:桌面|資料夾|文件夾)/.test(text)
    ||/\bsave\b.*\b(?:report|file|data|document|csv)\b/i.test(text);
}
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
function filename(name){if(typeof name!=='string'||name.length>100||name.startsWith('.')||/[\\/\x00-\x1f]/.test(name)||!name.trim()||!/^.+\.(md|csv|txt|json)$/i.test(name))throw new Error('Use a plain .md, .csv, .txt or .json filename without directories');return name;}
function directory(value){if(!fs.existsSync(value))fs.mkdirSync(value,{recursive:true});if(fs.lstatSync(value).isSymbolicLink()||!fs.statSync(value).isDirectory())throw new Error('Output directory must not be a symbolic link');}
class OutputStore{
  constructor(root,plans){this.root=path.resolve(root);this.plans=path.resolve(plans);directory(this.plans);}
  planFile(id){if(!validId(id))throw new Error('Invalid output task');return path.join(this.plans,id+'.json');}
  create(id,title){
    const label=String(title).replace(/[\\/\x00-\x1f<>:"|?*]/g,' ').replace(/\s+/g,' ').trim().slice(0,35)||'整理資料';
    const date=new Date().toLocaleDateString('en-CA');const plan={id,root:this.root,folder:path.join(this.root,date+'_'+label+'_'+id.slice(0,6)),title:label,active:true,files:[]};
    fs.writeFileSync(this.planFile(id),JSON.stringify(plan),{mode:0o600,flag:'wx'});return plan;
  }
  read(id){const file=this.planFile(id);if(fs.lstatSync(file).isSymbolicLink())throw new Error('Invalid output plan');const plan=JSON.parse(fs.readFileSync(file,'utf8'));if(plan.id!==id||plan.root!==this.root||path.dirname(plan.folder)!==this.root)throw new Error('Invalid output location');return plan;}
  writePlan(plan){const file=this.planFile(plan.id);fs.writeFileSync(file+'.tmp',JSON.stringify(plan),{mode:0o600});fs.renameSync(file+'.tmp',file);}
  save(id,name,content){
    name=filename(name);if(typeof content!=='string'||!content.trim()||content.length>150000||Buffer.byteLength(content)>600000||content.includes('\0'))throw new Error('Invalid or oversized document content');
    if(/\.json$/i.test(name))JSON.parse(content);
    const plan=this.read(id);if(!plan.active)throw new Error('Task ended; no further writes allowed');if(plan.files.length>=20)throw new Error('Document limit reached');
    directory(this.root);directory(plan.folder);
    const extension=path.extname(name),stem=path.basename(name,extension);let file;
    for(let n=1;n<=100;n++){
      const candidate=path.join(plan.folder,n===1?name:`${stem} (${n})${extension}`);
      try{const descriptor=fs.openSync(candidate,'wx',0o600);try{fs.writeFileSync(descriptor,content,'utf8');fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}file=candidate;break;}catch(error){if(error.code!=='EEXIST')throw error;}
    }
    if(!file)throw new Error('Could not create unique document');
    plan.files.push(path.basename(file));this.writePlan(plan);
    return {saved:true,path:file,folder:plan.folder,filename:path.basename(file)};
  }
  artifact(id){
    let plan;try{plan=this.read(id);}catch{return null;}
    if(!plan.files.length||!fs.existsSync(plan.folder)||fs.lstatSync(plan.folder).isSymbolicLink())return null;
    const files=plan.files.filter(name=>{try{filename(name);const file=path.join(plan.folder,name);return !fs.lstatSync(file).isSymbolicLink()&&fs.statSync(file).isFile();}catch{return false;}});
    return files.length?{id,title:plan.title,folder:plan.folder,files}:null;
  }
  list(query=''){
    const search=String(query).trim().toLocaleLowerCase();
    return fs.readdirSync(this.plans).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).flatMap(name=>{
      const id=name.slice(0,-5),artifact=this.artifact(id);if(!artifact)return [];
      if(search&&![artifact.title,...artifact.files].join(' ').toLocaleLowerCase().includes(search))return [];
      return [{...artifact,updatedAt:fs.statSync(this.planFile(id)).mtime.toISOString()}];
    }).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  file(id,name){filename(name);const artifact=this.artifact(id);if(!artifact||!artifact.files.includes(name))throw new Error('Saved file is unavailable');this.folder(id);return path.join(artifact.folder,name);}
  rootFolder(){directory(this.root);return this.root;}
  close(id){try{const plan=this.read(id);plan.active=false;this.writePlan(plan);}catch{}}
  folder(id){const result=this.artifact(id);if(!result)throw new Error('Saved files are unavailable');if(fs.lstatSync(this.root).isSymbolicLink())throw new Error('Output directory changed');return result.folder;}
}
module.exports={OutputStore,reportTool,outputInstructions,wantsDocument};
