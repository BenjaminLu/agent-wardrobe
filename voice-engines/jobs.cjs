// Background jobs for long voice work (GPT-SoVITS training, engine installs): stages with weights, overall progress,
// a time estimate that starts from a guess and follows the measured pace, and cancel through an AbortSignal.
const crypto=require('node:crypto');

function createJobs({onChange=()=>{},now=()=>Date.now()}={}){
  const jobs=new Map();
  const snapshot=job=>({id:job.id,kind:job.kind,title:job.title,state:job.state,stage:job.stage,stageLabel:job.stages.find(s=>s.id===job.stage)?.label||'',
    stages:job.stages.map(s=>({id:s.id,label:s.label})),progress:+job.progress.toFixed(4),detail:job.detail,startedAt:job.startedAt,finishedAt:job.finishedAt||null,
    eta:job.state==='running'?eta(job):0,estimate:job.estimate,error:job.error||null,result:job.state==='done'?job.result:null});
  // Seconds left: the guess counts most at the start, the measured pace once there is enough progress.
  function eta(job){
    const elapsed=(now()-job.startedAt)/1000,p=job.progress,guess=Math.max(0,job.estimate*(1-p));
    if(p<.02)return Math.round(Math.max(guess,job.estimate-elapsed));
    const measured=elapsed/p*(1-p),w=Math.min(1,p*1.5);return Math.round(guess*(1-w)+measured*w);
  }
  const emit=job=>{try{onChange(snapshot(job));}catch{}};
  function start({kind,title,stages,estimate=60,run}){
    if([...jobs.values()].some(j=>j.kind===kind&&j.state==='running'))throw new Error('已經有一個同類的工作在進行，等它完成或取消後再開始。');
    const total=stages.reduce((a,s)=>a+(s.weight||1),0);
    const job={id:crypto.randomUUID(),kind,title,stages,estimate,state:'running',stage:stages[0]?.id,progress:0,detail:'',startedAt:now(),controller:new AbortController(),result:null};
    jobs.set(job.id,job);
    const offset=id=>{let sum=0;for(const s of stages){if(s.id===id)return sum/total;sum+=(s.weight||1);}return 1;};
    const weight=id=>(stages.find(s=>s.id===id)?.weight||1)/total;
    const ctx={signal:job.controller.signal,
      stage(id,detail=''){if(job.state!=='running')return;if(!stages.some(s=>s.id===id))throw new Error(`Unknown stage ${id}`);job.stage=id;job.progress=Math.max(job.progress,offset(id));job.detail=detail;emit(job);},
      progress(fraction,detail){if(job.state!=='running')return;const f=Math.max(0,Math.min(1,Number(fraction)||0));job.progress=Math.max(job.progress,offset(job.stage)+weight(job.stage)*f);if(detail!==undefined)job.detail=String(detail).slice(0,200);emit(job);},
      check(){if(job.controller.signal.aborted)throw Object.assign(new Error('已取消。'),{name:'AbortError'});}};
    emit(job);
    // a cancel ends the job at once, even if the work only notices the signal later
    const stopped=new Promise((_,reject)=>job.controller.signal.addEventListener('abort',()=>reject(Object.assign(new Error('已取消。'),{name:'AbortError'})),{once:true}));
    job.promise=Promise.race([Promise.resolve().then(()=>run(ctx)),stopped]).then(result=>{
      if(job.state!=='running')return;
      if(job.controller.signal.aborted){job.state='cancelled';}else{job.state='done';job.result=result??null;job.progress=1;}
    },error=>{if(job.state!=='running')return;job.state=job.controller.signal.aborted||error?.name==='AbortError'?'cancelled':'error';job.error=job.state==='error'?String(error?.message||error):null;})
      .finally(()=>{job.finishedAt=now();emit(job);});
    return snapshot(job);
  }
  function cancel(id){const job=jobs.get(id);if(!job||job.state!=='running')return false;job.controller.abort();job.detail='正在取消…';emit(job);return true;}
  return {start,cancel,get:id=>jobs.has(id)?snapshot(jobs.get(id)):null,wait:id=>jobs.get(id)?.promise,list:()=>[...jobs.values()].map(snapshot),
    cancelAll(){for(const id of jobs.keys())cancel(id);},forget(id){const job=jobs.get(id);if(job&&job.state!=='running')jobs.delete(id);}};
}
module.exports={createJobs};
