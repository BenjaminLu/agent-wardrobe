const test=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');const path=require('node:path');
// People's recorded or cloned voices stay on their own computer: the repository must never track an audio file
// (.gitignore keeps them out; this also catches one added with `git add -f`).
test('no audio recordings are tracked in the repository',t=>{
  const r=spawnSync('git',['ls-files'],{cwd:path.join(__dirname,'..'),encoding:'utf8'});
  if(r.status!==0){t.skip('not a git checkout');return;}
  const audio=r.stdout.split('\n').filter(f=>/\.(wav|mp3|m4a|aac|flac|ogg|opus|webm|caf|aiff?)$/i.test(f));
  assert.deepEqual(audio,[],'audio files must not be committed');
});
