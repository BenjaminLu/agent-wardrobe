// Toolbar of the assisted download window: site picker, back, search, status, "AI 看條款", and the import panel
// (what was found in the download, the AI's reading of the terms, and the choice to add one).
const $=id=>document.getElementById(id);const bridge=window.assisted;
let last=null,choice=null,height=0;
const clean=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
const KIND={vrm:'3D VRM',glb:'3D',live2d:'Live2D',mmd:'MMD',psd:'PSD 立ち絵',image:'圖片'};
const FACT={yes:['yes','可以'],no:['no','不行'],conditional:['maybe','有條件'],unknown:['maybe','不明'],'personal-only':['maybe','僅限個人']};
const mb=n=>n>1048576?`${(n/1048576).toFixed(1)} MB`:n?`${Math.max(1,Math.round(n/1024))} KB`:'';
function fact(label,value){const el=document.createElement('span');const [cls,text]=FACT[value]||FACT.unknown;el.className=`fact ${cls}`;el.textContent=`${label}：${text}`;return el;}
function termsBox(answer,license,{files=[],unread=[],error=null}={}){
  const box=document.createElement('div');box.className='terms';const h=document.createElement('h3');h.textContent='AI 看條款';
  const badge=document.createElement('span');badge.className='badge';badge.textContent='以原作者條款為準';h.append(badge);box.append(h);
  if(answer){
    const facts=document.createElement('div');facts.className='facts';
    facts.append(fact('商用',answer.commercial),fact('改造',answer.modification),fact('再配布',answer.redistribution),fact('直播',answer.streaming_ok));
    const credit=document.createElement('span');credit.className=`fact ${answer.credit_required?'maybe':'yes'}`;credit.textContent=answer.credit_required?'需要標註作者':'不必標註';facts.append(credit);
    const summary=document.createElement('p');summary.id='terms-summary';summary.textContent=answer.summary_zh;box.append(facts,summary);
    if(answer.notes){const p=document.createElement('p');p.className='warn';p.textContent=`注意：${answer.notes}`;box.append(p);}
    if(answer.credit_text){const p=document.createElement('p');p.textContent=`標註文字：${answer.credit_text}`;box.append(p);}
  }else{const p=document.createElement('p');p.className=error?'error':'warn';p.textContent=error?`AI 沒看成條款：${error}。請自己讀過原作者的條款再決定。`:'AI 正在看條款…';box.append(p);}
  if(license){const p=document.createElement('p');p.className='files';p.textContent=`寫進角色資料的條款：${license.label}`;box.append(p);}
  if(files.length||unread.length){const p=document.createElement('p');p.className='files';p.textContent=[files.length?`讀了：${files.join('、')}`:'',unread.length?`沒讀到（請自己看）：${unread.join('、')}`:''].filter(Boolean).join('　');box.append(p);}
  return box;
}
function render(state){
  last=state;
  if($('site').options.length!==state.sites.length)$('site').replaceChildren(...state.sites.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));
  if(document.activeElement!==$('site'))$('site').value=state.site;
  $('back').disabled=!state.canBack;$('status').textContent=state.status||'';$('url').textContent=state.url||'';
  const job=state.job,page=state.page;$('panel').hidden=!job&&!page;$('terms').disabled=Boolean(page?.busy);
  const summary=$('summary');summary.replaceChildren();$('candidates').replaceChildren();$('import').hidden=!job;
  if(job){
    if(job.state==='error'){const p=document.createElement('p');p.className='error';p.textContent=job.error;summary.append(p);}
    else if(['downloading','unpacking'].includes(job.state)){const p=document.createElement('p');p.textContent=`處理「${job.filename}」中…`;summary.append(p);}
    else summary.append(termsBox(job.answer,job.license,{files:job.termsFiles,unread:job.unread,error:job.aiError}));
    if(job.skipped?.length){const p=document.createElement('p');p.className='files';p.textContent=`略過了 ${job.skipped.length} 個捷徑（symlink）或特殊檔案。`;summary.append(p);}
    if(!job.candidates.some(c=>c.id===choice&&c.available))choice=job.candidates.find(c=>c.available)?.id||null;
    for(const c of job.candidates){
      const label=document.createElement('label');label.className=c.available?'':'off';
      const radio=document.createElement('input');radio.type='radio';radio.name='candidate';radio.value=c.id;radio.disabled=!c.available;radio.checked=c.id===choice;radio.onchange=()=>{choice=c.id;render(last);};
      const text=document.createElement('span');text.textContent=c.title;const small=document.createElement('small');
      small.textContent=[KIND[c.kind]||c.kind,mb(c.size),c.motions?`含 ${c.motions} 個動作`:'',c.available?'':'這版還不能加入',['image','psd'].includes(c.kind)?'由 Codex 重畫成角色':'',c.file].filter(Boolean).join(' · ');
      label.append(radio,text,small);$('candidates').append(label);
    }
    $('import').disabled=!(job.state==='ready'&&choice);
    $('import').textContent=job.state==='importing'?'加入中…':job.state==='done'?'已加入 ✓':'加入我的角色';
  }else if(page)summary.append(termsBox(page.answer,page.license,{error:page.error}));
  requestAnimationFrame(()=>{const h=document.body.scrollHeight;if(h!==height){height=h;bridge.layout(h);}});
}
const go=()=>bridge.open($('site').value,$('query').value).catch(e=>{$('status').textContent=clean(e);});
$('site').onchange=go;
$('find').onsubmit=event=>{event.preventDefault();go();};
$('back').onclick=()=>bridge.back();
$('terms').onclick=()=>bridge.readTerms().then(render).catch(e=>{$('status').textContent=clean(e);});
$('import').onclick=()=>{if(choice)bridge.importChoice(choice).catch(e=>{$('status').textContent=clean(e);});};
$('dismiss').onclick=()=>bridge.dismiss().then(render);
bridge.onState(render);bridge.state().then(render);
