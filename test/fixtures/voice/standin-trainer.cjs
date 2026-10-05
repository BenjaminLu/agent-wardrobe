// A stand-in for voice-engines/sovits_train.py: same arguments and "@voice" progress lines, writes fake weights.
// VOICE_TRAINER_STEP_MS sets how long each step takes (default 30 ms); VOICE_TRAINER_PID=<file> records its pid.
const fs=require('node:fs');const path=require('node:path');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const say=m=>process.stdout.write('@voice '+JSON.stringify(m)+'\n');
if(process.env.VOICE_TRAINER_PID)fs.writeFileSync(process.env.VOICE_TRAINER_PID,String(process.pid));
const lines=fs.readFileSync(arg('--list'),'utf8').trim().split('\n');
if(lines.some(l=>l.split('|').length<4||!fs.existsSync(l.split('|')[0]))){say({fatal:'bad list'});process.exit(1);}
const step=+(process.env.VOICE_TRAINER_STEP_MS||30);
(async()=>{
  for(const [stage,epochs] of [['features',4],['gpt',+arg('--gpt-epochs')],['sovits',+arg('--sovits-epochs')]])
    for(let e=1;e<=epochs;e++){await new Promise(r=>setTimeout(r,step));say({stage,progress:e/epochs,detail:`${stage} ${e}/${epochs}`});}
  fs.mkdirSync(arg('--out'),{recursive:true});
  fs.writeFileSync(path.join(arg('--out'),'gpt.ckpt'),'gpt');fs.writeFileSync(path.join(arg('--out'),'sovits.pth'),'sovits');
  say({done:true});
})();
