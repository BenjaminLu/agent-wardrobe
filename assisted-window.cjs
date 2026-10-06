// The assisted download window: the app's own toolbar (assisted.html) above the site itself (a WebContentsView in its own
// persistent, sandboxed session 'persist:assisted'). The user browses and signs in by themselves — the app never types into
// a page or presses anything on it. Only the allow-listed sites load here; anything else opens in the system browser.
// A download is caught into a private temporary folder, unpacked, searched for characters and its terms are read by the
// user's AI (Codex); the summary is shown before anything is added. Page text goes nowhere but that AI.
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const archive=require('./archive.cjs');const terms=require('./assisted.cjs');const L=require('./locales.cjs');const {t}=L;
// Messages kept as {key, vars} (or {text} for an error without a key) so the toolbar and the phone show them in their own language
const msg=(key,vars)=>({key,vars});
const errMsg=error=>error?.i18nKey?{key:error.i18nKey,vars:error.i18nVars}:{text:String(error?.message??error)};
const msgText=m=>m?(m.key?t(m.key,m.vars):m.text||''):'';
const PARTITION='persist:assisted';
// Live2D / MMD support comes from model-formats.cjs, which may not be installed in this build
function loadFormats(){try{return require('./model-formats.cjs');}catch(error){if(error.code==='MODULE_NOT_FOUND'&&/model-formats/.test(error.message))return null;throw error;}}
const cleanTitle=t=>{const s=String(t||'').replace(/\s*[-|｜–—]\s*(BOOTH|nizima|ニコニ立体|Gumroad|模之屋|BowlRoll|Picrew|VRoid Hub)[^|｜]*$/i,'').trim();return s.slice(0,40);};
const safeFile=name=>String(name||'download').replace(/[\/\\:\0-\x1f]/g,'_').replace(/^\.+/,'').slice(-120)||'download';
const PAGE_TEXT=`(()=>{const t=document.body?document.body.innerText:'';return t.slice(0,20000);})()`;

function createAssisted({BrowserWindow,WebContentsView,session,shell,ipcMain,root=__dirname,sites=terms.SITES,askTerms=terms.askTerms,install,formats=loadFormats(),onState=()=>{},limit=archive.LIMIT,tmp=os.tmpdir()}){
  let win=null,view=null,barHeight=104,job=null,sessionReady=false;
  const state={site:'booth',url:'',title:'',status:null,canBack:false,page:null};
  const siteName=id=>sites[id]?.name||t('assisted.site.official');
  const alive=()=>win&&!win.isDestroyed();
  const publicJob=()=>job&&{id:job.id,filename:job.filename,state:job.state,error:job.error?msgText(job.error):null,errorMsg:job.error||null,aiError:job.aiError?msgText(job.aiError):null,aiErrorMsg:job.aiError||null,answer:job.answer||null,license:job.license||null,
    termsFiles:job.termsFiles||[],unread:job.unread||[],skipped:job.skipped||[],result:job.result||null,
    candidates:(job.candidates||[]).map(c=>({id:c.id,kind:c.kind,title:c.title,file:c.file,size:c.size||0,available:c.available,motions:['vrm','glb'].includes(c.kind)?(job.motions||[]).length:(c.motions||[]).length}))};
  const snapshot=()=>({sites:Object.entries(sites).filter(([,s])=>!s.hidden).map(([id,s])=>({id,name:s.name})),site:state.site,url:state.url,title:state.title,status:msgText(state.status),statusMsg:state.status,canBack:state.canBack,page:state.page&&{...state.page,error:state.page.error?msgText(state.page.error):undefined,errorMsg:state.page.error},job:publicJob()});
  function send(){const data=snapshot();if(alive())win.webContents.send('assisted:state',data);onState(data);}
  // status(key, vars), status(errMsg(error)) or status(null)
  const status=(key,vars)=>{state.status=key&&typeof key==='object'?key:key?msg(key,vars):null;send();};
  const external=url=>{if(/^https?:\/\//i.test(url))shell.openExternal(url);};
  function cleanup(){if(job?.dir)fs.rmSync(job.dir,{recursive:true,force:true});}

  function setupSession(){
    if(sessionReady)return;sessionReady=true;const ses=session.fromPartition(PARTITION);
    // no camera, microphone, notifications, location… for these sites
    ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    ses.on('will-download',onDownload);
  }
  // main-frame navigation stays on allow-listed sites; sign-in popups of those sites are allowed, other popups load here or go outside
  function guard(contents,{popup=false}={}){
    const check=(event,url)=>{url=event.url||url;if(terms.siteFor(url,sites))return;event.preventDefault();external(url);};
    contents.on('will-navigate',check);contents.on('will-redirect',(event,url)=>{if(event.isMainFrame===false)return;check(event,url);});
    contents.setWindowOpenHandler(({url})=>{
      if(terms.isAuth(url,sites))return {action:'allow',overrideBrowserWindowOptions:{width:520,height:720,parent:win,autoHideMenuBar:true,webPreferences:{partition:PARTITION,sandbox:true,contextIsolation:true,nodeIntegration:false}}};
      if(!popup&&terms.siteFor(url,sites))view.webContents.loadURL(url).catch(()=>{});else external(url);
      return {action:'deny'};
    });
    contents.on('did-create-window',child=>guard(child.webContents,{popup:true}));
  }
  function layout(){if(!alive())return;const [width,height]=win.getContentSize();view.setBounds({x:0,y:barHeight,width,height:Math.max(0,height-barHeight)});}
  function ensureWindow(){
    if(alive())return;setupSession();
    win=new BrowserWindow({width:1180,height:860,minWidth:760,minHeight:560,title:t('assisted.windowTitle'),backgroundColor:'#f5f8fc',show:false,
      webPreferences:{preload:path.join(root,'assisted-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
    view=new WebContentsView({webPreferences:{partition:PARTITION,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
    win.contentView.addChildView(view);guard(view.webContents);layout();win.on('resize',layout);
    const contents=view.webContents,history=()=>contents.navigationHistory||contents;
    const track=()=>{state.url=contents.getURL();state.title=contents.getTitle();state.canBack=history().canGoBack();const site=terms.siteFor(state.url,sites,{auth:false});if(site)state.site=site;send();};
    contents.on('did-navigate',track);contents.on('did-navigate-in-page',track);contents.on('page-title-updated',track);
    contents.on('did-start-loading',()=>status('assisted.status.loading'));contents.on('did-stop-loading',()=>{if(state.status?.key==='assisted.status.loading')status(null);track();});
    contents.on('did-fail-load',(_e,code,description,url,isMainFrame)=>{if(isMainFrame&&code!==-3)status('assisted.status.loadFailed',{description});});
    const opened=win;opened.once('ready-to-show',()=>{opened.show();opened.focus();});
    opened.on('closed',()=>{if(!contents.isDestroyed())contents.close();if(win===opened){win=null;view=null;}cleanup();job=null;state.page=null;state.status=null;onState(snapshot());});
    win.loadFile(path.join(root,'assisted.html'));
  }
  // site: a SITES key (or an alias); page: a page of an allow-listed site; query: what to search for
  function open({site,query='',page}={}){
    site=terms.siteId(String(site||''));
    if(page){site=terms.siteFor(String(page),sites,{auth:false});if(!site)throw L.error('assisted.error.notAllowed');}
    if(!sites[site])site=state.site in sites?state.site:Object.keys(sites)[0];
    const url=page?String(page):sites[site].search(String(query||'').slice(0,80));
    ensureWindow();state.site=site;state.status=msg('assisted.status.opening',{site:siteName(site)});
    view.webContents.loadURL(url).catch(()=>{});if(win.isMinimized())win.restore();win.show();win.focus();send();
    return {opened:true,site,url};
  }
  const pageText=()=>view&&!view.webContents.isDestroyed()?view.webContents.executeJavaScriptInIsolatedWorld(1000,[{code:PAGE_TEXT}]).then(String).catch(()=>''):Promise.resolve('');

  function onDownload(_event,item){
    if(!alive()){item.cancel();return;}
    if(job&&['downloading','unpacking','reading','importing'].includes(job.state)){item.cancel();status('assisted.status.busy');return;}
    if(item.getTotalBytes()>limit){item.cancel();status('assisted.status.tooBig',{mb:Math.round(limit/1048576)});return;}
    cleanup();const dir=fs.mkdtempSync(path.join(tmp,'assisted-'));fs.chmodSync(dir,0o700);fs.mkdirSync(path.join(dir,'download'),{mode:0o700});
    const filename=safeFile(item.getFilename()),site=state.site;
    const current={id:crypto.randomUUID().slice(0,8),dir,filename,file:path.join(dir,'download',filename),state:'downloading',site,page:view.webContents.getURL(),title:cleanTitle(view.webContents.getTitle())};
    current.pageText=pageText();job=current;item.setSavePath(current.file);
    let shown=0;
    item.on('updated',()=>{const got=item.getReceivedBytes();if(got>limit){item.cancel();return;}if(Date.now()-shown>500){shown=Date.now();status('assisted.status.downloading',{mb:(got/1048576).toFixed(1)});}});
    item.once('done',(_e,result)=>{if(job!==current)return;
      if(result!=='completed'){current.state='error';current.error=msg(result==='cancelled'?'assisted.status.cancelled':'assisted.status.downloadFailed');status(current.error);return;}
      unpackJob(current).catch(error=>{current.state='error';current.error=errMsg(error);status(current.error);});});
    send();
  }
  async function unpackJob(current){
    current.state='unpacking';status('assisted.status.unpacking',{file:current.filename});await new Promise(r=>setTimeout(r,20));
    const out=path.join(current.dir,'files');const unpacked=archive.unpack(current.file,out,{limit,name:current.filename});current.skipped=unpacked.skipped;
    fs.rmSync(current.file,{force:true});
    current.candidates=archive.findModels(out,{formats});
    if(!current.candidates.length)throw L.error('assisted.error.noCharacter');
    current.motions=archive.findMotions(out,{formats});
    const found=archive.collectTerms(out);current.termsFiles=found.files;current.unread=found.unread;
    const meta=current.candidates.filter(c=>c.kind==='vrm').slice(0,2).map(c=>archive.vrmMeta(path.join(out,c.file))).filter(Boolean).join('\n\n');
    current.state='reading';status('assisted.status.reading');
    const page=await current.pageText;
    try{current.answer=await askTerms({title:current.title,url:current.page,page,files:found.text,meta});current.license=terms.termsLicense(current.answer,{source:siteName(current.site)});
      status('assisted.status.read');}
    catch(error){current.answer=null;current.aiError=errMsg(error);current.license=terms.UNREAD_LICENSE(siteName(current.site));status('assisted.status.aiFailed',{error:error.message});}
    if(job!==current)return;current.state='ready';send();
  }
  async function importChoice(id){
    if(!job||job.state!=='ready')throw L.error('assisted.error.nothingReady');
    const candidate=job.candidates.find(c=>c.id===id);if(!candidate)throw L.error('assisted.error.noChoice');
    if(!candidate.available)throw L.error('assisted.error.unavailable');
    const current=job,sameKind=current.candidates.filter(c=>c.kind===candidate.kind).length===1;
    const name=(sameKind&&current.title)||candidate.title,source=siteName(current.site);
    const record=terms.termsRecord({title:name,source,page:current.page,license:current.license,answer:current.answer});
    current.state='importing';current.error=null;status('assisted.status.importing',{name});
    try{const result=await install({candidate,dir:path.join(current.dir,'files'),motions:['vrm','glb'].includes(candidate.kind)?current.motions:(candidate.motions||[]),name,source,page:current.page,license:current.license,answer:current.answer,record,formats});
      current.state='done';current.result=result;cleanup();
      status(result.opened==='worn'?msg('assisted.status.worn',{name}):msg('assisted.status.redraw'));return result;}
    catch(error){current.state='ready';current.error=errMsg(error);status(current.error);throw error;}
  }
  // the toolbar's "read the terms" button: the current page only
  async function readPage(){
    if(!view)throw L.error('assisted.error.noWindow');
    state.page={busy:true};status('assisted.status.readingPage');
    try{const answer=await askTerms({title:cleanTitle(view.webContents.getTitle()),url:view.webContents.getURL(),page:await pageText()});
      state.page={answer,license:terms.termsLicense(answer,{source:siteName(state.site)})};status('assisted.status.readPage');}
    catch(error){state.page={error:errMsg(error)};status('assisted.status.aiFailedPage',{error:error.message});}
    return snapshot();
  }
  function dismiss(){if(job&&['downloading','unpacking','reading','importing'].includes(job.state))return snapshot();cleanup();job=null;state.page=null;send();return snapshot();}
  const ROUTES={
    'assisted:state':()=>snapshot(),
    'assisted:open':(site,query)=>open({site,query}),
    'assisted:back':()=>{const h=view?.webContents.navigationHistory||view?.webContents;if(h?.canGoBack())h.goBack();return true;},
    'assisted:read-terms':()=>readPage(),
    'assisted:import':id=>importChoice(String(id)),
    'assisted:dismiss':()=>dismiss(),
    'assisted:layout':height=>{barHeight=Math.max(80,Math.min(560,Math.round(Number(height)||104)));layout();return true;}
  };
  for(const [name,fn] of Object.entries(ROUTES))ipcMain.handle(name,(event,...args)=>{if(!alive()||event.sender!==win.webContents)throw new Error('Unknown assisted window');return fn(...args);});
  return {open,importChoice,readPage,dismiss,snapshot,getWindow:()=>alive()?win:null,getView:()=>view,close:()=>{if(alive())win.close();}};
}
module.exports={createAssisted,cleanTitle,PARTITION};
