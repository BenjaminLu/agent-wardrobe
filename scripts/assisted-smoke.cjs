const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const {app}=require('electron');
const {makeZip,sjis}=require('../test/fixtures/zip.cjs');
// AI-assisted download against a local stand-in site: the window only follows allow-listed pages, a download (a zip with a VRM,
// a Shift-JIS 利用規約.txt and an idle motion) is caught and unpacked, a stand-in Codex reads the terms, the summary is shown
// before anything is added, and the VRM is worn with the terms and the motion in its mod.json.
async function run({runtime,assisted,extraSites}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'assisted-smoke-')),fake=path.join(dir,'fake-codex.cjs');
  // the stand-in AI only gives its summary when both the page text and the archive's terms reached it, with the terms schema
  fs.writeFileSync(fake,`const fs=require('fs');const args=process.argv.slice(2);const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));let p='';
process.stdin.on('data',d=>p+=d).on('end',()=>{const ok=p.includes('FIXTURE PAGE TERMS')&&p.includes('利用規約テスト：商用利用OK')&&Boolean(schema.properties.summary_zh);
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({summary_zh:ok?'SMOKE 摘要：可以商用，可以直播，不必標註。':'MISSING TEXT',commercial:'yes',modification:'yes',redistribution:'no',credit_required:false,credit_text:'',streaming_ok:'yes',notes:''})}}));});`);
  process.env.CODEX_BIN=require('./fake-bin.cjs').fakeBin(dir,'codex',fake);
  const zip=makeZip([{name:sjis('テストちゃん/テストちゃん.vrm'),data:fs.readFileSync(path.join(__dirname,'..','mods','vrm-sample','sample.vrm')),deflate:true},
    {name:sjis('テストちゃん/利用規約.txt'),data:sjis('利用規約テスト：商用利用OK。クレジット不要。'),deflate:true},{name:'テストちゃん/motions/idle_loop.vrma',utf8:true,data:require('../test/fixtures/models/make.cjs').vrma()}]);
  const server=http.createServer((req,res)=>{
    if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><title>テストちゃん - BOOTH</title><h1>テストちゃん</h1><p>FIXTURE PAGE TERMS 商用OK</p><a id="dl" href="/download/test.zip">無料ダウンロード</a>');return;}
    if(req.url==='/download/test.zip'){res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="test.zip"','Content-Length':zip.length});res.end(zip);return;}
    res.writeHead(404);res.end();});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  extraSites.fixture={name:'Fixture',hosts:[],auth:[],origins:[origin],search:()=>`${origin}/`};
  const wait=async(fn,label,timeout=30000)=>{const until=Date.now()+timeout;while(!await fn()){if(Date.now()>until)throw new Error(`Assisted smoke timed out: ${label} status=${a.snapshot().status} job=${JSON.stringify(a.snapshot().job)?.slice(0,300)}`);await new Promise(r=>setTimeout(r,150));}};
  const a=assisted();
  try{
    a.open({site:'fixture'});const view=()=>a.getView().webContents,bar=code=>a.getWindow().webContents.executeJavaScript(code);
    await wait(()=>view().getURL()===`${origin}/`&&!view().isLoading(),'page');
    await wait(()=>bar(`document.querySelector('#site').value==='fixture'`).catch(()=>false),'toolbar');
    // a page outside the allow-list goes to the system browser instead
    await view().executeJavaScript(`location.href='https://example.com/elsewhere';true`);await wait(()=>global.smokeOpened.includes('https://example.com/elsewhere'),'external');
    assert.equal(view().getURL(),`${origin}/`);
    assert.throws(()=>a.open({page:'https://example.com/'}),/允許/);
    await view().executeJavaScript(`document.getElementById('dl').click();true`);
    // the summary and what was found are shown before anything is added
    await wait(()=>bar(`(document.querySelector('#terms-summary')?.textContent||'').includes('SMOKE 摘要')&&!document.querySelector('#import').disabled`),'summary');
    const panel=await bar(`document.querySelector('#panel').textContent`);
    assert.match(panel,/以原作者條款為準/);assert.match(panel,/含 1 個動作/);assert.match(panel,/讀了：テストちゃん\/利用規約\.txt/);assert.match(panel,/商用：可以/);
    assert.ok(!runtime.state.modId.startsWith('me-'));
    await bar(`document.querySelector('#import').click();true`);
    await wait(()=>runtime.state.modId.startsWith('me-'),'worn');
    const modDir=path.join(app.getPath('userData'),'my-mods',runtime.state.modId),manifest=JSON.parse(fs.readFileSync(path.join(modDir,'mod.json'),'utf8'));
    assert.equal(manifest.name,'テストちゃん');assert.equal(manifest.renderer,'vrm');
    assert.match(manifest.license,new RegExp(`Based on "テストちゃん" from Fixture \\(Fixture條款（AI 摘要）：可商用・可改造・可直播\\), ${origin.replace(/[.]/g,'\\.')}/`));
    assert.match(manifest.license,/SMOKE 摘要：可以商用/);assert.match(manifest.description,/AI 摘要：SMOKE 摘要.*以原作者條款為準/);
    assert.deepEqual(manifest.skins[0].motions,[{file:'motion-1-idle-idle-loop.vrma',name:'idle loop',loop:true,use:'idle'}]);
    assert.ok(fs.readFileSync(path.join(modDir,'motion-1-idle-idle-loop.vrma')).equals(require('../test/fixtures/models/make.cjs').vrma()));
    await wait(()=>bar(`document.querySelector('#status').textContent.includes('已加入並換上')`),'done status');
    assert.equal(a.snapshot().job.state,'done');
    await new Promise(r=>setTimeout(r,400));fs.mkdirSync(path.join(__dirname,'..','evidence'),{recursive:true});fs.writeFileSync(path.join(__dirname,'..','evidence','assisted.png'),(await a.getWindow().capturePage()).toPNG());
    console.log('ASSISTED_SMOKE',JSON.stringify({allowList:true,downloadCaught:true,shiftJisTerms:true,summaryShown:true,vrmWorn:true,termsInManifest:true,motions:1}));
  }finally{
    a.close();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});
  }
}
module.exports={run};
