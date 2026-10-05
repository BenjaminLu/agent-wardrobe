// Official hooks are the source of task outcomes, never terminal prose.
class TaskFeedback {
  begin(id,mode){this.id=id;this.mode=mode;this.finished=false;this.started=false;this.messages=new Map();}
  event(type,extra={}){return {type,id:this.id,mode:this.mode,...extra};}
  observe(data){
    if(!this.id||this.finished||data.sessionId!==this.id)return null;
    this.started=true;
    if(data.event==='PermissionRequest'||data.event==='Notification'&&data.permissionPrompt)return this.event('approval');
    if(data.event==='MessageDisplay'){
      if(typeof data.messageId!=='string'||typeof data.text!=='string'||!Number.isInteger(data.index)||data.index<0)return null;
      if(!this.messages.has(data.messageId)&&this.messages.size>=100)return null;
      const message=this.messages.get(data.messageId)||{parts:new Map(),next:0,text:'',final:false};
      if(message.final||data.index<message.next||message.parts.has(data.index))return null;
      message.parts.set(data.index,{text:data.text,final:data.final});
      if(message.parts.size>100)return null;
      let updated=false;
      while(message.parts.has(message.next)){
        const part=message.parts.get(message.next);message.parts.delete(message.next++);
        message.text=(message.text+part.text).slice(0,12000);message.final=part.final===true;updated=true;
        if(message.final)break;
      }
      this.messages.set(data.messageId,message);
      return updated&&message.text.trim()?this.event('progress',{messageId:data.messageId,text:message.text}):null;
    }

    if(['UserPromptSubmit','PreToolUse','PostToolUse'].includes(data.event))return this.event('working');
    if(data.event==='Stop'&&data.pending)return this.event('working');
    if(['Stop','StopFailure'].includes(data.event)){
      this.finished=true;
      const text=typeof data.result==='string'?data.result.trim().slice(0,12000):'';
      return this.event(data.event==='StopFailure'||!text?'error':'result',{text,error:data.error||(!text?'missing_result':undefined)});
    }
    return null;
  }
  cancel(){if(!this.id||this.finished)return null;this.finished=true;return this.event('cancelled');}
  closed(){if(!this.id||this.finished)return null;this.finished=true;return this.event('error',{text:'',error:'session_ended_without_result'});}
}
module.exports={TaskFeedback};
