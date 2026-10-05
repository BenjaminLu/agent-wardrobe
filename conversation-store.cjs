const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
const {conversationText}=require('./conversation-text.cjs');
const MAX_MESSAGES=2000;
class ConversationStore{
  constructor(file){
    this.file=file;this.data={version:1,messages:[],legacyImported:false};
    try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1||!Array.isArray(data.messages))throw new Error('Invalid conversation memory');this.data={version:1,messages:data.messages.filter(m=>['user','assistant'].includes(m?.role)&&typeof m.content==='string'&&typeof m.id==='string').slice(-MAX_MESSAGES),legacyImported:data.legacyImported===true};}
    catch(error){if(error.code!=='ENOENT')throw new Error('Conversation memory could not be loaded; existing file was left unchanged.');}
  }
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.data)+'\n',{mode:0o600});fs.renameSync(temp,this.file);}
  append(role,content,meta={}){
    if(!['user','assistant'].includes(role)||typeof content!=='string')throw new Error('Invalid conversation message');
    content=(role==='assistant'?conversationText(content):content.trim()).slice(0,12000);if(!content)return;
    const key=meta.id;const existing=key&&this.data.messages.find(m=>m.id===key);
    if(existing){existing.content=content;existing.kind=meta.kind||existing.kind;}
    else this.data.messages.push({id:key||randomUUID(),role,content,provider:meta.provider,taskId:meta.taskId,kind:meta.kind||'chat',...(meta.artifacts?.length?{artifacts:meta.artifacts}:{}),timestamp:meta.timestamp||new Date().toISOString()});
    this.data.messages=this.data.messages.slice(-MAX_MESSAGES);this.save();
  }
  finishTask(id,text,provider,kind,artifacts=[]){
    this.data.messages=this.data.messages.filter(m=>!(m.taskId===id&&m.role==='assistant'&&m.content.trim()===text.trim()));
    this.append('assistant',text,{taskId:id,provider,kind,artifacts});
  }
  snapshot(){return this.data.messages.map(m=>({...m}));}
  context(query=''){
    const all=this.data.messages;const recent=all.slice(-15);
    const terms=String(query).toLowerCase().match(/[a-z0-9]{3,}|[\p{Script=Han}]{2,}/gu)||[];
    const tokens=terms.flatMap(term=>/\p{Script=Han}/u.test(term)?Array.from({length:term.length-1},(_,i)=>term.slice(i,i+2)):[term]);
    const older=all.slice(0,-15).map((m,index)=>({index,m,score:tokens.reduce((n,t)=>n+(m.content.toLowerCase().includes(t)?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,4).sort((a,b)=>a.index-b.index).map(x=>x.m);
    return [...older,...recent].map(m=>({role:m.role,content:(m.content.slice(0,m.artifacts?.length?3000:4000)+(m.artifacts?.length?'\nVerified saved documents: '+JSON.stringify(m.artifacts.map(a=>({folder:a.folder,files:a.files}))):'')).slice(0,4000)}));
  }
  clear(){this.data.messages=[];this.data.legacyImported=true;this.save();}
  importLegacy(directory,cwd){
    if(this.data.legacyImported)return 0;
    let files=[];try{files=fs.readdirSync(directory).filter(f=>/^[a-f0-9-]+\.jsonl$/.test(f));}catch(error){if(error.code!=='ENOENT')throw error;}
    const entries=[];
    for(const file of files){
      const full=path.join(directory,file);if(fs.lstatSync(full).isSymbolicLink()||fs.statSync(full).size>20000000)continue;
      for(const line of fs.readFileSync(full,'utf8').split('\n')){
        let row;try{row=JSON.parse(line);}catch{continue;}
        if(row.cwd!==cwd||row.isSidechain||row.isMeta||!['user','assistant'].includes(row.type))continue;
        const value=row.message?.content;
        const text=typeof value==='string'?value:Array.isArray(value)?value.filter(part=>part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n'):'';
        if(!text.trim()||/^<(?:local-command|command-name|system-reminder)/.test(text.trim()))continue;
        entries.push({id:'legacy:'+file+':'+(row.uuid||entries.length),role:row.type,content:row.type==='assistant'?conversationText(text):text.trim(),provider:'claude',kind:'imported',timestamp:row.timestamp||''});
      }
    }
    entries.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
    const known=new Set(this.data.messages.map(m=>m.id));const imported=entries.filter(m=>m.content&&!known.has(m.id)).map(m=>({...m,content:m.content.slice(0,12000)}));
    this.data.messages=[...imported,...this.data.messages].slice(-MAX_MESSAGES);this.data.legacyImported=true;this.save();return imported.length;
  }
}
module.exports={ConversationStore};
