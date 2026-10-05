// npm test: every test/*.test.cjs with node --test. The file list is built here because Windows' shell does not expand globs.
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const dir=path.join(__dirname,'..','test');
const files=fs.readdirSync(dir).filter(name=>name.endsWith('.test.cjs')).sort().map(name=>path.join('test',name));
const run=spawnSync(process.execPath,['--test','--test-timeout=90000',...process.argv.slice(2),...files],{cwd:path.join(__dirname,'..'),stdio:'inherit'});
process.exit(run.status??1);
