const fs=require('node:fs');const path=require('node:path');
const EVENTS=['SessionStart','UserPromptSubmit','MessageDisplay','PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','Notification','Stop','StopFailure','SessionEnd'];
const PREFIX='/usr/bin/env WARDROBE_HOOK=1 ELECTRON_RUN_AS_NODE=1 ';
const quote=value=>`'${String(value).replaceAll("'", "'\\''")}'`;
function configure({project,executable,client,bridge,remove=false,taskResults=false}){
  const file=path.join(project,'.claude/settings.local.json');
  let data={};if(fs.existsSync(file))data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!data||typeof data!=='object'||Array.isArray(data)||data.hooks&&(typeof data.hooks!=='object'||Array.isArray(data.hooks)))throw new Error('Invalid Claude settings; left unchanged.');
  const before=JSON.stringify(data);const hooks=data.hooks||{};
  const command=PREFIX+[executable,client,bridge].map(quote).join(' ')+(taskResults?' --task-results':'');
  for(const event of new Set([...Object.keys(hooks),...EVENTS])){
    if(hooks[event]&&!Array.isArray(hooks[event]))throw new Error('Invalid hook entries; left unchanged.');
    const kept=(hooks[event]||[]).flatMap(entry=>{
      if(!Array.isArray(entry?.hooks))return [entry];
      const inner=entry.hooks.filter(h=>!h?.command?.startsWith(PREFIX));
      return inner.length||!entry.hooks.length?[{...entry,hooks:inner}]:[];
    });
    if(!remove&&EVENTS.includes(event)&&(event!=='MessageDisplay'||taskResults))kept.push({hooks:[{type:'command',command,timeout:2}]});
    if(kept.length)hooks[event]=kept;else delete hooks[event];
  }
  if(Object.keys(hooks).length)data.hooks=hooks;else delete data.hooks;
  if(JSON.stringify(data)!==before){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.wardrobe-tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
  return {file,changed:JSON.stringify(data)!==before};
}
function normalize(payload,{taskResults=false}={}){
  if(!payload||!EVENTS.includes(payload.hook_event_name)||typeof payload.session_id!=='string'||payload.session_id.length>200)throw new Error('Invalid hook event');
  const data={event:payload.hook_event_name,sessionId:payload.session_id,tool:['Read','Edit','Write','Bash','Grep','Glob'].includes(payload.tool_name)?payload.tool_name:undefined};
  if(taskResults){
    if(data.event==='MessageDisplay'&&typeof payload.delta==='string'&&typeof payload.message_id==='string'&&payload.message_id.length<=200&&Number.isInteger(payload.index)&&payload.index>=0){
      data.messageId=payload.message_id;data.index=payload.index;data.final=payload.final===true;
      data.text=payload.delta.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').slice(0,12000);
    }

    if(['PreToolUse','PostToolUse','PostToolUseFailure'].includes(data.event)&&typeof payload.tool_name==='string')data.tool=payload.tool_name.replace(/[^a-zA-Z0-9_:.-]/g,'').slice(0,120);
    if(['Stop','StopFailure'].includes(data.event)&&typeof payload.last_assistant_message==='string')data.result=payload.last_assistant_message.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').slice(0,12000);
    if(data.event==='Stop')data.pending=Boolean(payload.background_tasks?.length||payload.session_crons?.length);
    if(data.event==='StopFailure')data.error=String(payload.error||'unknown').slice(0,100);
    if(data.event==='Notification'&&payload.notification_type==='permission_prompt')data.permissionPrompt=true;
  }
  return data;
}
function activity(event){return {SessionStart:'idle',UserPromptSubmit:'working',PreToolUse:'working',PostToolUse:'working',PostToolUseFailure:'working',PermissionRequest:'waiting_for_approval',Notification:'waiting_for_approval',Stop:'idle',StopFailure:'error',SessionEnd:'idle'}[event];}
module.exports={EVENTS,configure,normalize,activity};
