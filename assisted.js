// Toolbar of the assisted download window: site picker, back, search, status, "read the terms", and the import panel
// (what was found in the download, the AI's reading of the terms, and the choice to add one).
const $=id=>document.getElementById(id);const bridge=window.assisted;
let last=null,choice=null,height=0;
const clean=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
const KIND={vrm:'3D VRM',glb:'3D',live2d:'Live2D',mmd:'MMD',psd:()=>t('assisted.kind.psd'),image:()=>t('assisted.kind.image')};
const kindName=kind=>{const k=KIND[kind];return typeof k==='function'?k():k||kind;};
const FACT={yes:['yes','yes'],no:['no','no'],conditional:['maybe','conditional'],unknown:['maybe','unknown'],'personal-only':['maybe','personalOnly']};
// a message from main: {key, vars} in this window's language, or its text
const msgText=(m,fallback)=>m?(m.key?t(m.key,m.vars):m.text||fallback||''):fallback||'';
const list=items=>items.join(t('assisted.listSeparator'));
const mb=n=>n>1048576?`${(n/1048576).toFixed(1)} MB`:n?`${Math.max(1,Math.round(n/1024))} KB`:'';
function fact(label,value){const el=document.createElement('span');const [cls,text]=FACT[value]||FACT.unknown;el.className=`fact ${cls}`;el.textContent=t('assisted.fact.item',{label:t(`assisted.fact.${label}`),value:t(`assisted.fact.${text}`)});return el;}
function termsBox(answer,license,{files=[],unread=[],error=null}={}){
  const box=document.createElement('div');box.className='terms';const h=document.createElement('h3');h.textContent=t('assisted.terms.button');
  const badge=document.createElement('span');badge.className='badge';badge.textContent=t('assisted.terms.prevails');h.append(badge);box.append(h);
  if(answer){
    const facts=document.createElement('div');facts.className='facts';
    facts.append(fact('commercial',answer.commercial),fact('modification',answer.modification),fact('redistribution',answer.redistribution),fact('streaming',answer.streaming_ok));
    const credit=document.createElement('span');credit.className=`fact ${answer.credit_required?'maybe':'yes'}`;credit.textContent=t(answer.credit_required?'assisted.fact.creditRequired':'assisted.fact.noCredit');facts.append(credit);
    const summary=document.createElement('p');summary.id='terms-summary';summary.translate=false;summary.textContent=answer.summary_zh;box.append(facts,summary);
    if(answer.notes){const p=document.createElement('p');p.className='warn';p.textContent=t('assisted.terms.notes',{notes:answer.notes});box.append(p);}
    if(answer.credit_text){const p=document.createElement('p');p.textContent=t('assisted.terms.creditText',{text:answer.credit_text});box.append(p);}
  }else{const p=document.createElement('p');p.className=error?'error':'warn';p.textContent=error?t('assisted.terms.failed',{error}):t('assisted.terms.reading');box.append(p);}
  if(license){const p=document.createElement('p');p.className='files';p.textContent=t('assisted.terms.license',{label:license.label});box.append(p);}
  if(files.length||unread.length){const p=document.createElement('p');p.className='files';p.textContent=[files.length?t('assisted.terms.filesRead',{files:list(files)}):'',unread.length?t('assisted.terms.filesUnread',{files:list(unread)}):''].filter(Boolean).join(t('assisted.terms.partSeparator'));box.append(p);}
  return box;
}
function render(state){
  last=state;
  if([...$('site').options].map(o=>o.textContent).join('\n')!==state.sites.map(s=>s.name).join('\n'))$('site').replaceChildren(...state.sites.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=s.name;return o;}));
  if(document.activeElement!==$('site'))$('site').value=state.site;
  $('back').disabled=!state.canBack;$('status').textContent=msgText(state.statusMsg,state.status);$('url').textContent=state.url||'';
  const job=state.job,page=state.page;$('panel').hidden=!job&&!page;$('terms').disabled=Boolean(page?.busy);
  const summary=$('summary');summary.replaceChildren();$('candidates').replaceChildren();$('import').hidden=!job;
  if(job){
    if(job.state==='error'){const p=document.createElement('p');p.className='error';p.textContent=msgText(job.errorMsg,job.error);summary.append(p);}
    else if(['downloading','unpacking'].includes(job.state)){const p=document.createElement('p');p.textContent=t('assisted.job.working',{file:job.filename});summary.append(p);}
    else summary.append(termsBox(job.answer,job.license,{files:job.termsFiles,unread:job.unread,error:job.aiErrorMsg?msgText(job.aiErrorMsg):job.aiError}));
    if(job.skipped?.length){const p=document.createElement('p');p.className='files';p.textContent=t('assisted.job.skipped',{count:job.skipped.length});summary.append(p);}
    if(!job.candidates.some(c=>c.id===choice&&c.available))choice=job.candidates.find(c=>c.available)?.id||null;
    for(const c of job.candidates){
      const label=document.createElement('label');label.className=c.available?'':'off';
      const radio=document.createElement('input');radio.type='radio';radio.name='candidate';radio.value=c.id;radio.disabled=!c.available;radio.checked=c.id===choice;radio.onchange=()=>{choice=c.id;render(last);};
      const text=document.createElement('span');text.textContent=c.title;text.translate=false;const small=document.createElement('small');
      small.textContent=[kindName(c.kind),mb(c.size),c.motions?t('assisted.candidate.motions',{count:c.motions}):'',c.available?'':t('assisted.candidate.unavailable'),['image','psd'].includes(c.kind)?t('assisted.candidate.redraw'):'',c.file].filter(Boolean).join(' · ');
      label.append(radio,text,small);$('candidates').append(label);
    }
    $('import').disabled=!(job.state==='ready'&&choice);
    $('import').textContent=t(job.state==='importing'?'assisted.import.busy':job.state==='done'?'assisted.import.done':'assisted.import.button');
  }else if(page)summary.append(termsBox(page.answer,page.license,{error:page.errorMsg?msgText(page.errorMsg):page.error}));
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
// a new interface language: main's site names change too, so ask for a fresh state and draw everything again
i18n.onChange(()=>bridge.state().then(render).catch(()=>{if(last)render(last);}));
