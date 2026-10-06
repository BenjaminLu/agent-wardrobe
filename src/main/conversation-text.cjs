// Hide standalone transport/tool status lines; preserve actual assistant prose.
function conversationText(value){
  if(typeof value!=='string')return '';
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').split('\n').filter(line=>{
    const text=line.trim();
    return !/^(?:(?:Running|正在執行)\s*[:：]\s*)?(?:mcp_+[\w:.-]+|(?:browser|computer|chrome|chrom)_[\w]+)(?:\s*[,，]\s*Running:\s*mcp_+[\w:.-]+)?\s*$/i.test(text);
  }).join('\n').trim().slice(0,12000);
}
module.exports={conversationText};
