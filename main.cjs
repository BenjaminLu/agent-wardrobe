const { Notification, app, BrowserWindow, WebContentsView, session, ipcMain, Menu, Tray, nativeImage, screen, globalShortcut, dialog, systemPreferences, shell, desktopCapturer, clipboard, safeStorage } = require('electron');
const tts = require('./tts.cjs');
const { createSpeech } = require('./speech.cjs');
const kokoro = require('./kokoro.cjs');
const edgeTts = require('./edge-tts.cjs');
const { createWake } = require('./wake-service.cjs');
const { createVoiceService } = require('./voice-service.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ai = require('./ai.cjs');
const cli = require('./cli.cjs');
const mods = require('./mods.cjs');
const { Runtime } = require('./runtime.cjs');
const { startControl } = require('./control-server.cjs');
const {loadIdentity,saveIdentity}=require('./control-identity.cjs');
const { CodexServer } = require('./codex-server.cjs');
const codex = new CodexServer();
const hooks = require('./claude-hooks.cjs');
const {AgentSession}=require('./agent-session.cjs');
const {randomUUID}=require('node:crypto');
const agentSession=new AgentSession();
const {TaskFeedback}=require('./task-feedback.cjs');
const taskFeedback=new TaskFeedback();
const {OperationTools,specs:operationSpecs,computerSupport}=require('./operation-tools.cjs');
const {runCodex,runLocal,newTaskServer}=require('./task-agents.cjs');
const cliSetup=require('./cli-setup.cjs');
const {LocalLlm,MODELS,recommended:recommendedModel}=require('./local-llm.cjs');
const {conversationText}=require('./conversation-text.cjs');
const {ConversationStore}=require('./conversation-store.cjs');
const {OutputStore,outputInstructions,wantsDocument}=require('./output-store.cjs');
let conversations,outputs,llm;
let toolTask=null;
let lastTaskProvider='claude',taskLog=[];
let agentWindow, consoleAutomatic=false, setupTimer, finishTimer;
function taskEvent(event){
  if(!event)return;
  event.provider=lastTaskProvider;
  remoteEvent('task', { ...event });
  const zh=settings.language?.startsWith('zh');
  if(event.type==='working'||event.type==='progress'){runtime.activity('working');}
  if(event.type==='progress'){
    if(event.tool)taskLog.push(event.tool);
    event.text=conversationText(event.text);
    if(!event.text)return;
    conversations?.append('assistant',event.text,{id:event.messageId?event.id+':'+event.messageId:undefined,taskId:event.id,provider:lastTaskProvider,kind:'progress'});
  }
  if(event.type==='approval'){
    runtime.activity('waiting_for_approval');
    event.text=zh?'我需要你確認一次官方授權，確認後會繼續，結果由我告訴你。':'I need you to confirm an official permission prompt. I’ll continue and explain the result here.';
    openAgentConsole({automatic:true}).catch(error=>console.error(error.message));
  }
  if(['result','error','cancelled'].includes(event.type)){
    clearTimeout(setupTimer);
    if(!event.text)event.text=event.type==='cancelled'?(zh?'操作已停止。':'The operation has been stopped.'):event.type==='result'?(zh?'工作階段已結束，但沒有收到結果說明；請查看詳細紀錄。':'The session ended without a result explanation. Please check the detailed log.'):(zh?'這次操作沒有完成。你可以查看詳細紀錄，確認登入、額度或工具設定後再試。':'This operation did not complete. Check the detailed log for sign-in, quota, or tool setup issues before retrying.');
    const artifact=outputs?.artifact(event.id);event.artifacts=artifact?[artifact]:[];outputs?.close(event.id);
    if(event.type==='result'&&event.mode==='files'&&!artifact){event.type='error';event.text+=(zh?'\n尚未產生可開啟的檔案。':'\nNo saved document was produced.');}
    conversations?.finishTask(event.id,event.text,lastTaskProvider,event.type,event.artifacts);
    if(filesWindow&&!filesWindow.isDestroyed())filesWindow.webContents.send('files:refresh');
    runtime.activity(event.type==='result'?'success':event.type==='cancelled'?'idle':'error',event.type==='result'?'happy':event.type==='error'?'nervous':'neutral');
    if(consoleAutomatic&&agentWindow&&!agentWindow.isDestroyed())agentWindow.hide();
    // Let the observational hook return before closing the owned interactive session.
    if(['result','error'].includes(event.type)){
      clearTimeout(finishTimer);const id=event.id;
      finishTimer=setTimeout(()=>{if(agentSession.id===id)agentSession.stop();},300);
    }
    if(event.type!=='cancelled')speak(event.text);
  }
  if(win&&!win.isDestroyed())win.webContents.send('bula:task-event',event);
}
function emergencyStop(){
  clearTimeout(setupTimer);clearTimeout(finishTimer);stopSpeech();taskEvent(taskFeedback.cancel());agentSession.emergencyStop();
  if(toolTask){toolTask.controller.abort();toolTask.tools.stop();toolTask.server?.stop();}
  return {requested:Boolean(agentSession.child||toolTask)};
}
agentSession.on('event',data=>{
  if(agentWindow&&!agentWindow.isDestroyed())agentWindow.webContents.send('agent-console:event',data);
  if(data.type==='closed'&&runtime)taskEvent(taskFeedback.closed());
  if(data.type==='error'&&runtime){taskFeedback.finished=true;taskEvent(taskFeedback.event('error',{text:data.message}));}
});
async function openAgentConsole({automatic=false}={}){
  consoleAutomatic=automatic;
  if(agentWindow&&!agentWindow.isDestroyed()){agentWindow.show();agentWindow.focus();return;}
  agentWindow=new BrowserWindow({width:1000,height:700,minWidth:650,minHeight:450,title:'Agent 操作視窗',backgroundColor:'#10151f',show:false,webPreferences:{preload:path.join(__dirname,'agent-console-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  agentWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  agentWindow.webContents.on('will-navigate',event=>event.preventDefault());
  agentWindow.once('ready-to-show',()=>{agentWindow.show();agentWindow.focus();});
  agentWindow.on('closed',()=>{taskEvent(taskFeedback.cancel());agentSession.stop();agentWindow=null;});
  await agentWindow.loadFile('agent-console.html');
}
ipcMain.handle('agent-console:ready',event=>{
  if(event.sender!==agentWindow?.webContents)throw new Error('Unknown console');
  return {output:agentSession.output,active:Boolean(agentSession.child)};
});
for(const [name,action] of [['input',text=>agentSession.input(text)],['resize',(cols,rows)=>agentSession.resize(cols,rows)],['stop',()=>{taskEvent(taskFeedback.cancel());agentSession.stop();}],['emergency',emergencyStop]]){
  ipcMain.on('agent-console:'+name,(event,...args)=>{if(event.sender!==agentWindow?.webContents)return;try{action(...args);}catch{}});
}

app.setName('Agent Wardrobe');
// A packaged smoke must not write inside the signed bundle; that breaks its seal and the privacy grants tied to it.
// app.isPackaged is false here because the bundle keeps Electron's executable name; Windows and Linux builds (renamed, an AppImage is read-only) report it.
// Wake smoke: Chromium plays a WAV file as the microphone, so no real mic or permission prompt is involved.
if (process.argv.includes('--smoke-test') && process.env.AGENT_WARDROBE_FAKE_MIC) { app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.AGENT_WARDROBE_FAKE_MIC); app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess,AudioServiceSandbox'); }
// Smoke runs check what would be opened (the path must exist) without opening Finder windows, documents or web pages.
if (process.argv.includes('--smoke-test')) {
  const opened = []; global.smokeOpened = opened;
  shell.openPath = async target => { opened.push(target); return fs.existsSync(target) ? '' : `No such file: ${target}`; };
  shell.showItemInFolder = target => { opened.push(target); };
  shell.openExternal = async url => { opened.push(url); };
}
if (process.argv.includes('--smoke-test')) app.setPath('userData', __dirname.includes('.app/Contents/Resources/') || app.isPackaged ? path.join(app.getPath('temp'), 'agent-wardrobe-smoke') : path.join(__dirname, '.smoke-userdata'));
if (!app.requestSingleInstanceLock()) app.exit(0);
let win, marketWindow, filesWindow, tray, runtime, control, streaming = false, chatBusy = false;
// Skipped Mods are logged and shown once in the companion; the rest still load.
const modErrors = [];
const catalog = mods.loadCatalog(undefined, { onError: (id, error) => { modErrors.push({ id, message: error.message }); console.error(`Mod ${id} skipped: ${error.message}`); } });
let settings = { provider: 'codex', base: 'http://127.0.0.1:1234/v1', model: '', voice: 'Eddy (Chinese (Taiwan))', volume: true, voiceProvider: 'system', openaiVoice: 'marin', openaiModel: 'gpt-4o-mini-tts', openaiStyle: 'Speak in a warm, lively and friendly tone, like a cute desktop companion.', kokoroVoice: 'zf_xiaoxiao', kokoroSpeed: 1, edgeVoice: 'zh-TW-HsiaoChenNeural', edgeRate: 1, characterVoices: {}, scale: 1, wakeEnabled: false, wakePhrases: '', wakeSensitivity: 'high', dictationEngine: 'local', replyLanguage: 'auto', chatSize: 'large', gameEngine: 'laya', game: 'lane', localEngine: 'lmstudio', builtinModel: recommendedModel() };
// Window size for the companion: the character area grows with the scale, the chat panel keeps its width.
// Chat panel sizes (panel width, extra conversation height); keep in step with the CSS in styles.css.
const CHAT_SIZES = { normal: [350, 0], large: [460, 154], xl: [580, 314] };
function companionSize(quiet, scale = settings.scale || 1) {
  const [panel, extra] = CHAT_SIZES[settings.chatSize] || CHAT_SIZES.large;
  return { width: Math.round(Math.max(390, 390 + 300 * (scale - 1), quiet ? 0 : panel + 40)), height: Math.round((quiet ? 340 : 620 + extra) + 260 * (scale - 1)) };
}
let secrets, voiceService;
const kokoroDir = () => path.join(app.getPath('userData'), 'models', 'kokoro-multi-lang-v1_0');
const settingsPath = () => path.join(app.getPath('userData'), 'bula-settings.json');
const voice = createSpeech({ app, handle, getWin: () => win, getRuntime: () => runtime, getSettings: () => settings, getSecrets: () => secrets, kokoroDir, getVoices: () => voiceService?.voices });
const { speak, stop: stopSpeech } = voice;
const wakeService = createWake({ app, handle, ipcMain, systemPreferences, getWin: () => win, getRuntime: () => runtime, getSettings: () => settings, persist, speech: voice });
const gameService = require('./game-service.cjs').createGame({ ipcMain, handle, getRuntime: () => runtime, getSettings: () => settings, getSecrets: () => secrets, persist, speak });
// Watch mode needs a local model that can see images: the chosen local brain, or the built-in model if it is downloaded.
async function watchModel() {
  if (settings.provider === 'local' && settings.localEngine !== 'builtin') { const base = ai.localBase(settings.base); return { base, model: settings.model || await ai.defaultModel(base), headers: ai.authHeader(base), structured: false }; }
  const id = settings.provider === 'local' ? settings.builtinModel : llm.status().models.find(m => m.installed)?.id;
  if (!id) throw new Error('看畫面吐槽需要能看圖的本機模型：請在「設定 → AI 大腦」下載內建模型，或在 LM Studio 載入看圖模型。');
  const info = await llm.ensure(id); ai.setKey(info.base, info.key); return { base: info.base, model: info.model, headers: ai.authHeader(info.base), structured: true };
}
// Live2D's Cubism Core, downloaded into userData only after the user agrees in a window (smoke runs use an offline stand-in).
const live2dCore = require('./live2d-core.cjs').createLive2dCore({ dir: path.join(app.getPath('userData'), 'live2d'), ...(process.argv.includes('--smoke-test') && process.env.LIVE2D_CORE_FIXTURE ? { fetchImpl: async () => new Response(fs.readFileSync(require('./test/fixtures/models/make.cjs').STANDIN_CORE)) } : {}) });
handle('bula:live2d-core', () => live2dCore.url());
handle('bula:live2d-core-install', () => live2dCore.install().then(() => live2dCore.url()));
// Characters drawn by Codex from a photo of someone (private Mods in userData/my-mods), in Annie's style.
const personService = require('./person-service.cjs').createPerson({ app, handle, ipcMain, systemPreferences, catalog, live2dCore,
  onSaved: (mod, { skinId } = {}) => { selectMod({ modId: mod.id, skinId: skinId || mod.defaultSkin, personaId: mod.defaultPersona }); refreshMarketplace(); win?.webContents.send('bula:notice', settings.language.startsWith('zh') ? `做好了！${mod.name} 已經換上` : `${mod.name} is ready`); } });
handle('bula:person-open', () => personService.open(settings.language).then(() => true));
handle('bula:person-edit', (id, skinId) => personService.open(settings.language, { edit: id, skinId }).then(() => true));
handle('bula:person-delete', id => { if (runtime.state.modId === id) selectMod({ modId: 'annie' }); personService.remove(id); refreshMarketplace(); return true; });
// smoke tests use fixture data shaped like the real libraries instead of the network
// VRoid Hub / Sketchfab sign-ins live in the encrypted Secrets store, which exists once the app is ready
let libraryAccounts = null;
const accountsFor = () => libraryAccounts ||= require('./library-accounts.cjs').createAccounts({ secrets, BrowserWindow });
const libraryLinks = { vroid: { token: () => accountsFor().vroid.token(), expired: () => accountsFor().vroid.expired() }, sketchfab: { token: () => accountsFor().sketchfab.token() } };
const library = require('./asset-library.cjs').createLibrary(process.argv.includes('--smoke-test') && process.env.LIBRARY_FIXTURE ? { fetchImpl: require('./test/fixtures/library/make.cjs').fetchFixture(), accounts: { vroid: { token: async () => 'fixture-token' }, sketchfab: { token: () => 'f'.repeat(32) } } } : { accounts: libraryLinks, shrink: data => { const image = nativeImage.createFromBuffer(data); return image.isEmpty() ? null : image.resize({ width: 256, quality: 'good' }).toPNG(); } });
// a picture becomes the reference for Codex, which redraws it as an editable character in Annie's style
async function openRedraw({ data, name, credit, target = 'window' }) {
  const image = nativeImage.createFromBuffer(data); if (image.isEmpty()) throw new Error('讀不了這張圖。');
  const size = image.getSize(), png = (Math.max(size.width, size.height) > 1024 ? image.resize(size.width > size.height ? { width: 1024 } : { height: 1024 }) : image).toPNG();
  const image_ = { png, name: String(name).slice(0, 24), credit };
  if (target === 'phone') { const editor = phoneEditor(); editor.begin({ image: image_ }); return { opened: 'phone-editor', edit: await editor.loaded() }; }
  await personService.open(settings.language, { image: image_ }); return { opened: 'editor' };
}
// A character of your own in userData/my-mods: write(dir) puts the model (and any motions) in its folder and returns
// {model, motions}; the manifest is then checked like any Mod (a valid, self-contained model) before it is worn.
async function installCharacter({ name, author, description, license, renderer, write }) {
  const userRoot = path.join(app.getPath('userData'), 'my-mods');
  const base = String(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'avatar';
  const id = `me-${base}-${Date.now().toString(36).slice(-5)}`, dir = path.join(userRoot, id), title = String(name).slice(0, 40);
  fs.mkdirSync(dir, { recursive: true });
  let reason = null, mod;
  try {
    const { model, motions = [] } = await write(dir);
    const persona = JSON.parse(fs.readFileSync(path.join(__dirname, 'mods', 'annie', 'mod.json'), 'utf8')).personas;
    const kind = { vrm: '3D', gltf: '3D', mmd: '3D', live2d: 'Live2D' }[renderer] || '';
    fs.writeFileSync(path.join(dir, 'mod.json'), JSON.stringify({ schemaVersion: 2, id, name: title, description, author, license,
      identity: `A ${kind ? `${kind} ` : ''}desktop companion called ${title}. Friendly and playful.`, renderer, defaultSkin: 'default', defaultPersona: persona[0].id,
      skins: [{ id: 'default', name: title, model, states: { idle: 'neutral', working: 'smug', waiting_for_approval: 'surprised', speaking: 'neutral', success: 'happy', error: 'nervous' }, ...(motions.length ? { motions } : {}) }], personas: persona }, null, 1));
    mod = mods.loadCatalog(userRoot, { onError: (modId, error) => { if (modId === id) reason = error; }, personal: true }).find(m => m.id === id);
  } catch (error) { reason ||= error; }
  if (!mod) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`這個角色沒有通過檢查（檔案格式不對或引用了外部檔案），沒有加入。${reason?.message ? `（${reason.message}）` : ''}`);
  }
  mod.private = true; mod.root = userRoot; catalog.push(mod); selectMod({ modId: id }); refreshMarketplace(); return { opened: 'worn', id };
}
async function importFromLibrary(key, { target = 'window' } = {}) {
  const { item, credit, data } = await library.download(key);
  if (item.kind === 'image') return openRedraw({ data, name: item.title, credit, target });
  // a 3D avatar is added as it is, as your own private character
  const gltf = item.kind === 'glb', modelFile = gltf ? 'model.glb' : 'model.vrm';
  return installCharacter({ name: item.title, author: item.author || item.source, description: `${item.source}：${item.title}（${item.license.label}）`, license: `${credit}.`, renderer: gltf ? 'gltf' : 'vrm',
    write: dir => { fs.writeFileSync(path.join(dir, modelFile), data); return { model: modelFile }; } });
}
// AI-assisted download (sites without an API): the user browses and signs in in the assisted window; the download is
// unpacked, the terms are read by the user's Codex, and the character is added here.
const archive = require('./archive.cjs');
const motionFile = (m, i) => `motion-${i + 1}-${m.use}-${String(m.name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'clip'}${path.extname(m.file).toLowerCase()}`;
const motionEntry = (m, file) => ({ file, name: String(m.name || m.file).slice(0, 80), loop: typeof m.loop === 'boolean' ? m.loop : m.use === 'idle', use: ['idle', 'react', 'talk'].includes(m.use) ? m.use : 'react' });
async function installAssisted({ candidate, dir, motions, name, source, record, formats }) {
  const from = rel => { const file = path.resolve(dir, rel); if (!file.startsWith(path.resolve(dir) + path.sep)) throw new Error('不安全的檔案路徑。'); return file; };
  if (candidate.kind === 'image' || candidate.kind === 'psd') {
    const data = fs.readFileSync(from(candidate.file));
    return openRedraw({ data: candidate.kind === 'psd' ? archive.flattenPsd(data).png : data, name, credit: record.license });
  }
  if (candidate.kind === 'vrm' || candidate.kind === 'glb') {
    const modelFile = candidate.kind === 'glb' ? 'model.glb' : 'model.vrm';
    return installCharacter({ name, author: source, description: record.description, license: record.license, renderer: candidate.kind === 'glb' ? 'gltf' : 'vrm',
      write: target => { fs.copyFileSync(from(candidate.file), path.join(target, modelFile));
        // motions in the same download (.vrma / .vmd) come along, so the character animates; a plain glTF plays its own clips
        const list = (candidate.kind === 'vrm' ? motions || [] : []).filter(m => /\.(vrma|vmd)$/i.test(m.file)).slice(0, 40).map((m, i) => { const file = motionFile(m, i); fs.copyFileSync(from(m.file), path.join(target, file)); return motionEntry(m, file); });
        return { model: modelFile, motions: list }; } });
  }
  // Live2D / MMD: model-formats.cjs copies the model with its textures and motions
  if (!formats?.install) throw new Error('這版 App 還不能加入 Live2D / MMD 角色。');
  return installCharacter({ name, author: source, description: record.description, license: record.license, renderer: candidate.renderer,
    write: async target => { const result = await formats.install({ srcDir: dir, entry: candidate.entry, renderer: candidate.renderer, destDir: target });
      return { model: result.model, motions: (result.motions || []).map(m => motionEntry(m, m.file)) }; } });
}
let assistedInstance = null;
const assistedExtraSites = {};  // the assisted smoke adds a local test site here
function assisted() {
  return assistedInstance ||= require('./assisted-window.cjs').createAssisted({ BrowserWindow, WebContentsView, session, shell, ipcMain, sites: { ...require('./assisted.cjs').SITES, ...assistedExtraSites }, install: installAssisted,
    onState: data => remoteEvent('assist', { status: data.status, site: data.site, job: data.job && { state: data.job.state, filename: data.job.filename, error: data.job.error } }) });
}
function refreshMarketplace() { if (marketWindow && !marketWindow.isDestroyed()) marketWindow.webContents.send('marketplace:refresh'); remoteEvent('characters', {}); }
const watchService = require('./game-watch.cjs').createWatch({ desktopCapturer, app, handle, getWin: () => win, getSettings: () => settings, getRuntime: () => runtime,
  getPrompt: () => { const { mod, persona } = runtime.snapshot(); return `You are ${mod.name}. Character identity: ${mod.identity}\nPersonality: ${persona.prompt}`; }, speak, localModel: watchModel });
function setStreaming(on) {
  streaming = Boolean(on);
  win.setIgnoreMouseEvents(streaming, { forward: true });
  win.setFocusable(!streaming);
  win.webContents.send('bula:streaming', streaming);
}

function restore() {
  setStreaming(false); win.show(); win.focus();
}
async function openWardrobe() {
  if(marketWindow&&!marketWindow.isDestroyed()){
    if(marketWindow.isMinimized())marketWindow.restore();
    marketWindow.show();marketWindow.focus();marketWindow.webContents.send('marketplace:focus-search');return;
  }
  const wasStreaming=streaming;
  setStreaming(true);
  marketWindow=new BrowserWindow({width:1060,height:820,minWidth:700,minHeight:600,title:'Mod Marketplace · Agent Wardrobe',show:false,backgroundColor:'#f5f8fc',
    webPreferences:{preload:path.join(__dirname,'marketplace-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const opened=marketWindow;
  opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  opened.webContents.on('will-navigate',event=>event.preventDefault());
  opened.once('ready-to-show',()=>{opened.show();opened.focus();});
  opened.on('closed',()=>{if(marketWindow===opened)marketWindow=null;if(!wasStreaming&&win&&!win.isDestroyed())restore();});
  await opened.loadFile('marketplace.html');
}

async function openFiles(){
  if(filesWindow&&!filesWindow.isDestroyed()){if(filesWindow.isMinimized())filesWindow.restore();filesWindow.show();filesWindow.focus();filesWindow.webContents.send('files:refresh');return;}
  filesWindow=new BrowserWindow({width:900,height:680,minWidth:620,minHeight:480,title:settings.language.startsWith('zh')?'角色文件':'Character files',backgroundColor:'#f4f9fd',show:false,webPreferences:{preload:path.join(__dirname,'files-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const opened=filesWindow;opened.webContents.setWindowOpenHandler(()=>({action:'deny'}));opened.webContents.on('will-navigate',event=>event.preventDefault());opened.once('ready-to-show',()=>opened.show());opened.on('closed',()=>{if(filesWindow===opened)filesWindow=null;});await opened.loadFile('files.html');
}

app.whenReady().then(async () => {
  if (app.dock && !__dirname.includes('.app/Contents/Resources/')) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));  // dev runs show Annie in the Dock too
  secrets = new tts.Secrets(path.join(app.getPath('userData'), 'secrets.json'), safeStorage);
  // voice profiles; the voices smoke speaks through a stand-in for sherpa-onnx's Kokoro
  voiceService = createVoiceService({ app, handle, dialog, getWin: () => win, getSettings: () => settings, persist, getRuntime: () => runtime, speech: voice, secrets, kokoroDir, remoteEvent: (type, data) => remoteEvent(type, data),
    sherpa: process.argv.includes('--smoke-test') && process.env.VOICES_SMOKE_STANDIN ? require('./scripts/voices-smoke.cjs').standinSherpa : undefined });
  try { registerVoiceEngines(); } catch (error) { console.error(`錄音複製 engines: ${error.message}`); }  // CosyVoice, GPT-SoVITS, ElevenLabs; never blocks start-up
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; ai.localBase(settings.base); }
  catch { settings.base = 'http://127.0.0.1:1234/v1'; }
  // Smoke suites start from empty data; only the onboarding smoke should meet the first-run guide.
  if (process.argv.includes('--smoke-test') && !process.argv.includes('--onboarding-smoke')) settings.onboarded = true;
  llm=new LocalLlm(path.join(app.getPath('userData'),'models','llm'));
  outputs=new OutputStore(process.argv.includes('--smoke-test')?path.join(app.getPath('userData'),'Desktop','Agent Wardrobe'):path.join(app.getPath('desktop'),'Agent Wardrobe'),path.join(app.getPath('userData'),'output-plans'));
  conversations=new ConversationStore(path.join(app.getPath('userData'),'conversation-history.json'));
  if(!process.argv.includes('--smoke-test')){
    const cwd=path.join(app.getPath('userData'),'agent-workspace');
    const directory=path.join(app.getPath('home'),'.claude','projects',cwd.replace(/[^a-zA-Z0-9]/g,'-'));
    conversations.importLegacy(directory,cwd);
  }
  settings.language = app.getPreferredSystemLanguages()[0] || app.getLocale() || 'en';
  settings.voice = settings.language.startsWith('zh') ? (/Hans|CN|SG/i.test(settings.language) ? 'Tingting' : 'Eddy (Chinese (Taiwan))') : settings.language.startsWith('ja') ? 'Kyoko' : 'Samantha';
  try { require('./voice-lab.cjs').sweepTemp(app.getPath('temp')); } catch {}  // raw recordings left by a crash
  personService.loadSaved((id, error) => { modErrors.push({ id, message: error.message }); console.error(`Mod ${id} skipped: ${error.message}`); });
  runtime = new Runtime(catalog, settings);
  settings.provider = runtime.state.provider;
  // a saved character or skin that is no longer bundled was replaced with the default; save that so the file is current
  if (settings.modId && ['modId', 'skinId', 'personaId'].some(key => settings[key] !== runtime.state[key])) persist();
  if (settings.wakeEnabled) { wakeService.configure(); if (process.platform === 'darwin' && !process.env.AGENT_WARDROBE_FAKE_MIC && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') await systemPreferences.askForMediaAccess('microphone'); }
  let wakeMod = runtime.state.modId;
  runtime.on('change', state => {
    // the default wake phrase follows the character's name
    if (state.modId !== wakeMod) { wakeMod = state.modId; if (settings.wakeEnabled && !settings.wakePhrases) wakeService.configure(); }
    if (win && !win.isDestroyed()) {win.webContents.send('bula:state', state);win.setTitle(`${state.mod.name} · Agent Wardrobe`);}
    if(marketWindow&&!marketWindow.isDestroyed())marketWindow.webContents.send('bula:state',state);
    if(tray)tray.setToolTip(`Agent Wardrobe · ${state.mod.name}`);
  });
  const controlOptions={ runtime, catalog, language: settings.language, onSelect: selectMod, onProvider: provider => { runtime.provider(provider); settings.provider=provider; persist(); return runtime.snapshot(); }, onConnectClaude:connectClaude, onHook:observeHook,onInspectDesktop:inspectDesktop,identity:loadIdentity(app.getPath('userData'))};
  control = await startControl(controlOptions);
  saveIdentity(app.getPath('userData'),{token:control.token,port:control.port});
  fs.mkdirSync(app.getPath('userData'),{recursive:true});
  fs.writeFileSync(path.join(app.getPath('userData'),'claude-bridge.json'),JSON.stringify({url:control.origin+'/api/hook',token:control.token}),{mode:0o600});
  const area = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    ...companionSize(false), x: area.x + area.width - companionSize(false).width - 20, y: area.y + area.height - companionSize(false).height - 20,
    frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true,
    resizable: false, hasShadow: false, show: false, title: 'Agent Wardrobe',
    // keeps listening for the wake word and running reminders while hidden in the background
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  win.setAlwaysOnTop(true, 'floating');
  // Closing the companion sends it to the background; only Quit (menu bar, ⌘Q) ends the app.
  win.on('close', event => { if (!quitting) { event.preventDefault(); hideToBackground(); } });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('context-menu',(_event,params)=>{
    const zh=settings.language.startsWith('zh');const menu=[];
    if(params.selectionText)menu.push({label:zh?'複製選取文字':'Copy selected text',click:()=>clipboard.writeText(params.selectionText)});
    if(params.isEditable)menu.push({role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'});
    if(menu.length)Menu.buildFromTemplate(menu).popup({window:win});
  });
  // Everything stays denied except the microphone (audio only) for the companion page while wake is on.
  const micAllowed = (contents, permission, details) => contents === win.webContents && permission === 'media' && settings.wakeEnabled
    && (details?.mediaTypes ? details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'audio') : details?.mediaType !== 'video');
  win.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => callback(micAllowed(contents, permission, details)));
  win.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) => permission === 'media' && micAllowed(contents, permission, details));
  const zh=settings.language.startsWith('zh');
  const labels={game:zh?'讓角色玩遊戲（實驗）':'Let the character play (experimental)',show:zh?'顯示／恢復人物':'Show / restore companion',files:zh?'角色文件（搜尋與開啟）':'Character files (search & open)',wardrobe:zh?'Mod 市集（搜尋角色與 Skin）':'Mod Marketplace (search characters & skins)',connect:zh?'連接 Claude 專案 hooks…':'Connect Claude project hooks…',remove:zh?'移除 Claude 觀察 hooks':'Remove Claude observation hooks',stop:zh?'停止說話':'Stop speaking',stream:zh?'直播模式（滑鼠穿透）':'Stream mode (click-through)',quit:zh?'結束 Agent Wardrobe':'Quit Agent Wardrobe'};
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Agent Wardrobe', submenu: [
    { label: labels.show, click: restore },
    { label: labels.wardrobe, accelerator: 'CommandOrControl+Shift+S', click: openWardrobe },
    { label: labels.files, accelerator:'CommandOrControl+Shift+O',click:openFiles },
    { label: labels.game, click: () => gameService.open() },
    { label: labels.connect, click: () => connectClaude().catch(error=>dialog.showErrorBox('Claude hooks',error.message)) },
    { label: labels.remove, click: () => {try{if(settings.claudeProject){hooks.configure({project:settings.claudeProject,remove:true});delete settings.claudeProject;persist();}}catch(error){dialog.showErrorBox('Claude hooks',error.message);}} },
    { label: labels.stop, click: stopSpeech }, { type: 'separator' }, { role: 'quit', label: labels.quit }
  ] },{role:'editMenu'}]));
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon-256.png')).resize({ width: 20, height: 20, quality: 'best' });
  tray = new Tray(icon);
  tray.setToolTip('Agent Wardrobe');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: labels.show, click: restore },
    { label: labels.wardrobe, accelerator: 'CommandOrControl+Shift+S', click: openWardrobe },
    { label: labels.files,click:openFiles },
    { label: labels.game, click: () => gameService.open() },
    { label: labels.stream, click: () => setStreaming(true) },
    { label: labels.stop, click: stopSpeech },
    { label: labels.quit, click: () => app.quit() }
  ]));
  tray.on('click', restore);
  globalShortcut.register('CommandOrControl+Shift+B', restore);
  if(!globalShortcut.register('CommandOrControl+Shift+O',openFiles))console.warn('Files shortcut unavailable; use the folder button.');
  globalShortcut.register('CommandOrControl+Shift+Return',()=>{restore();win.webContents.send('bula:focus-chat');});
  if(!globalShortcut.register('CommandOrControl+Shift+X',emergencyStop))console.warn('Emergency shortcut unavailable; use the red emergency-stop buttons.');
  if (!globalShortcut.register('CommandOrControl+Shift+S', openWardrobe)) console.warn('Skin shortcut unavailable; use the application menu.');
  win.once('ready-to-show', () => win.show());
  await win.loadFile('index.html');
  warmLocal();
  // learn this Mac's tailnet name first, or phones would be refused as an unknown host after a restart
  if (settings.remoteEnabled && !process.argv.includes('--smoke-test')) remoteStatus().then(startRemote).then(port => tailscale.serve(port)).catch(error => console.error(`Phone remote: ${error.message}`));
  if (modErrors.length) win.webContents.send('bula:notice', `${modErrors.length} 個 Mod 無法載入，已略過：${modErrors.map(e => `${e.id}（${e.message}）`).join('、')}`);
  if (process.argv.includes('--open-wardrobe') && !process.argv.includes('--smoke-test')) await openWardrobe();
  if (process.argv.includes('--smoke-test')) {
    try { if(process.argv.includes('--voicelab-smoke'))await require('./scripts/voicelab-smoke.cjs').run({win,openVoiceLab,getVoiceLab:()=>voiceLab,voices:voiceService.voices,startRemote,getSettings:()=>settings,runtime});else if(process.argv.includes('--models-smoke'))await require('./scripts/models-smoke.cjs').run({win,runtime,catalog,personService});else if(process.argv.includes('--assisted-smoke'))await require('./scripts/assisted-smoke.cjs').run({runtime,assisted,extraSites:assistedExtraSites});else if(process.argv.includes('--remote-characters-smoke'))await require('./scripts/remote-characters-smoke.cjs').run({win,startRemote,runtime});else if(process.argv.includes('--library-smoke'))await require('./scripts/library-smoke.cjs').run({runtime,openWardrobe,getMarket:()=>marketWindow,personService});else if(process.argv.includes('--person-smoke'))await require('./scripts/person-smoke.cjs').run({win,personService,runtime,openWardrobe,getMarket:()=>marketWindow});else if(process.argv.includes('--chat-size-smoke'))await require('./scripts/chat-size-smoke.cjs').run({win});else if(process.argv.includes('--remote-smoke'))await require('./scripts/remote-smoke.cjs').run({win,startRemote});else if(process.argv.includes('--background-smoke'))await require('./scripts/background-smoke.cjs').run({win});else if(process.argv.includes('--watch-smoke'))await require('./scripts/watch-smoke.cjs').run({win});else if(process.argv.includes('--pikachu-smoke'))await require('./scripts/pikachu-smoke.cjs').run({gameService,win});else if(process.argv.includes('--typeless-smoke'))await require('./scripts/typeless-smoke.cjs').run({win});else if(process.argv.includes('--game-smoke'))await require('./scripts/game-smoke.cjs').run({gameService,runtime,win});else if(process.argv.includes('--builtin-smoke'))await require('./scripts/builtin-smoke.cjs').run({win});else if(process.argv.includes('--onboarding-smoke'))await require('./scripts/onboarding-smoke.cjs').run({win});else if(process.argv.includes('--wake-smoke'))await require('./scripts/wake-smoke.cjs').run({win});else if(process.argv.includes('--kokoro-smoke'))await require('./scripts/kokoro-smoke.cjs').run({win,runtime});else if(process.argv.includes('--voices-smoke'))await require('./scripts/voices-smoke.cjs').run({win,runtime,voiceService,startRemote});else if(process.argv.includes('--voice-smoke'))await require('./scripts/voice-smoke.cjs').run({win,runtime});else if(process.argv.includes('--mods-smoke')){const evidence=path.join(__dirname,'evidence');fs.mkdirSync(evidence,{recursive:true});await require('./scripts/mods-smoke.cjs').run({win,runtime,evidence});}else if(process.argv.includes('--auto-smoke'))await require('./scripts/auto-smoke.cjs').run({win,getToolTask:()=>toolTask});else if(process.argv.includes('--computer-smoke'))await require('./scripts/computer-smoke.cjs').run();else if(process.argv.includes('--native-input-smoke'))await require('./scripts/native-input-smoke.cjs').run();else if(process.argv.includes('--files-smoke'))await require('./scripts/files-smoke.cjs').run({win,outputs,openFiles,getFilesWindow:()=>filesWindow});else if(process.argv.includes('--output-smoke')||process.argv.includes('--output-restore-smoke'))await require('./scripts/output-smoke.cjs').run({win,agentSession,getToolTask:()=>toolTask,restoreOnly:process.argv.includes('--output-restore-smoke')});else if(process.argv.includes('--memory-smoke-write')||process.argv.includes('--memory-smoke-read'))await require('./scripts/memory-smoke.cjs').run({win,read:process.argv.includes('--memory-smoke-read')});else if(process.argv.includes('--task-smoke'))await require('./scripts/task-smoke.cjs').run({win,runtime,agentSession,getAgentWindow:()=>agentWindow,getToolTask:()=>toolTask,openAgentConsole,emergencyStop});else if(process.argv.includes('--agent-smoke'))await require('./scripts/app-smoke.cjs').agentSmokeTest(smokeContext);else await require('./scripts/app-smoke.cjs').smokeTest(smokeContext); app.quit(); }
    catch(error) { console.error('POC_SMOKE_FAILED',error); app.exit(1); }
  }
}).catch(error=>{
  console.error('Startup failed:', error);
  const message=error.code==='EADDRINUSE' ? `The local control port ${error.port||loadIdentity(app.getPath('userData')).port} is already in use. Close the conflicting service and reopen Agent Wardrobe. The app will keep its existing control address.` : error.message;
  dialog.showErrorBox('Agent Wardrobe could not start',message);app.quit();
});

function handle(name, action) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== win?.webContents) throw new Error('未知視窗。');
    return action(...args);
  });
}
// Marketplace receives only catalog/state, validated selections and window close.
for(const [name,action] of [
  ['marketplace:data',()=>({catalog,state:runtime.snapshot(),language:settings.language})],
  ['marketplace:select',selectMod],
  ['marketplace:close',()=>marketWindow.close()],
  ['marketplace:mod-asset',modAsset],
  ['marketplace:live2d-core',()=>live2dCore.url()],
  ['marketplace:live2d-core-install',()=>live2dCore.install().then(()=>live2dCore.url())],
  // characters drawn from photos can be edited (or new ones made) from the marketplace too
  ['marketplace:edit-person',(id,skinId)=>personService.open(settings.language,{edit:id,skinId}).then(()=>true)],
  ['marketplace:new-person',()=>personService.open(settings.language).then(()=>true)],
  // open character libraries: search, thumbnails, and import (3D as is; 2D redrawn by Codex)
  ['marketplace:library-search',(query,sources)=>library.search(query,Array.isArray(sources)?sources:undefined)],
  ['marketplace:library-thumb',key=>library.thumbnail(String(key))],
  ['marketplace:library-import',key=>importFromLibrary(String(key))],
  // VRoid Hub / Sketchfab sign-ins: the window only ever learns whether they are set
  ['marketplace:accounts',()=>accountsFor().status()],
  ['marketplace:vroid-configure',value=>accountsFor().vroid.configure(value||{})],
  ['marketplace:vroid-connect',()=>accountsFor().vroid.connect()],
  ['marketplace:vroid-disconnect',()=>accountsFor().vroid.disconnect()],
  ['marketplace:sketchfab-token',value=>value?accountsFor().sketchfab.configure({token:value}):accountsFor().sketchfab.clear()],
  // sites without an API open in the assisted download window, at the item's page or a search for the query
  ['marketplace:assist-open',value=>assisted().open({site:String(value?.site||''),query:String(value?.query||'').slice(0,80),page:value?.page?String(value.page):undefined})],
  ['marketplace:open-page',url=>{if(/^https:\/\/(hub\.vroid\.com|sketchfab\.com|safebooru\.org|www\.opensourceavatars\.com|vroid\.pixiv\.help|vrm\.dev|unity-chan\.com|zunko\.jp|www\.live2d\.com|3d\.nicovideo\.jp)\//.test(String(url)))shell.openExternal(String(url));return true;}]
])ipcMain.handle(name,(event,...args)=>{
  if(event.sender!==marketWindow?.webContents)throw new Error('Unknown marketplace window');
  return action(...args);
});
for(const [name,action] of [
  ['files:list',query=>{if(typeof query!=='string'||query.length>200)throw new Error('Invalid search');return {items:outputs.list(query),root:outputs.root,language:settings.language};}],
  ['files:open-folder',async id=>{const error=await shell.openPath(outputs.folder(id));if(error)throw new Error(error);return true;}],
  ['files:open-file',async data=>{const error=await shell.openPath(outputs.file(data?.id,data?.name));if(error)throw new Error(error);return true;}],
  ['files:reveal',data=>{shell.showItemInFolder(outputs.file(data?.id,data?.name));return true;}],
  ['files:open-root',async()=>{const error=await shell.openPath(outputs.rootFolder());if(error)throw new Error(error);return true;}],
  ['files:close',()=>filesWindow.close()]
])ipcMain.handle(name,(event,...args)=>{if(event.sender!==filesWindow?.webContents)throw new Error('Unknown files window');return action(...args);});
handle('bula:settings', () => settings);
handle('bula:onboarded', () => { settings.onboarded = true; persist(); return true; });
handle('bula:providers', () => cli.available());
handle('bula:open-game', (engine, game) => { let changed = false; if (['laya','jev'].includes(engine) && settings.gameEngine !== engine) { settings.gameEngine = engine; changed = true; } if (['lane','pikachu'].includes(game) && settings.game !== game) { settings.game = game; changed = true; gameService.close(); } if (changed) persist(); gameService.open(); return true; });
// Subscription brains: the official installer and sign-in open in Terminal; the app polls the result.
handle('bula:cli-status', () => cliSetup.status());
handle('bula:cli-setup', async name => { if (!cliSetup.TOOLS[name]) throw new Error('Unknown tool'); const error = await shell.openPath(cliSetup.writeScript(name, app.getPath('temp'))); if (error) throw new Error(error); return true; });
let compacted=false;
// Resize around the bottom-right corner so the character stays where the user put it.
function resizeCompanion(){const bounds=win.getBounds(),size=companionSize(compacted);if(bounds.width!==size.width||bounds.height!==size.height)win.setBounds({x:bounds.x+bounds.width-size.width,y:bounds.y+bounds.height-size.height,...size});}
handle('bula:compact',on=>{compacted=Boolean(on);resizeCompanion();});
handle('bula:chat-size', size => { if (CHAT_SIZES[size]) { settings.chatSize = size; persist(); resizeCompanion(); } return settings.chatSize; });
handle('bula:scale',value=>{const scale=Math.round(Math.max(.6,Math.min(1.6,Number(value)||1))*100)/100;if(scale!==settings.scale){settings.scale=scale;persist();resizeCompanion();}return scale;});
handle('bula:state', () => runtime.snapshot());
handle('bula:catalog', () => catalog);
// Mod assets for the model renderers (pages are file:// and cannot fetch); only catalog-validated files.
// Live2D and MMD assets are paths inside the Mod folder ('tex/face.png'); they must still resolve inside it.
function modAsset(modId,file){
  const mod=catalog.find(item=>item.id===modId);
  if(typeof file!=='string'||!mod?.assets?.includes(file))throw new Error('Unknown Mod asset');
  const dir=path.join(mod.root||path.join(__dirname,'mods'),mod.id),target=path.resolve(dir,file);
  if(!target.startsWith(dir+path.sep)||fs.lstatSync(target).isSymbolicLink())throw new Error('Unknown Mod asset');
  return fs.readFileSync(target);
}
handle('bula:mod-asset',modAsset);
handle('bula:select', selectMod);
handle('bula:wardrobe', openWardrobe);
handle('bula:files',openFiles);
handle('bula:agent-console',()=>lastTaskProvider==='claude'&&agentSession.id?openAgentConsole():{log:taskLog.join('\n')||'No operation log yet.'});
handle('bula:official-setup',async()=>{
  if(chatBusy||toolTask||agentSession.child)throw new Error('請先停止目前工作階段，再開啟官方設定。');
  const cwd=path.join(app.getPath('userData'),'agent-workspace');fs.mkdirSync(cwd,{recursive:true});
  hooks.configure({project:cwd,executable:process.execPath,client:path.join(__dirname,'hook-client.cjs'),bridge:path.join(app.getPath('userData'),'claude-bridge.json'),taskResults:true});
  clearTimeout(finishTimer);lastTaskProvider='claude';const id=randomUUID();taskFeedback.begin(id,'browser');
  agentSession.start({setup:true,mode:'browser',id,cwd,persona:'Help the user configure the official computer-use and Chrome integrations. Do not perform other actions.'});
  runtime.activity('waiting_for_approval');await openAgentConsole();return {id};
});
handle('bula:computer-support',()=>computerSupport());
handle('bula:operation-permissions',async kind=>{
  if(process.platform!=='darwin')throw new Error('Native computer operation currently requires macOS.');
  if(kind==='accessibility'){systemPreferences.isTrustedAccessibilityClient(true);await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');}
  else if(kind==='screen'){
    // An explicit settings-button click initiates the OS permission request;
    // no captured image is forwarded or stored during permission setup.
    try{await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1,height:1}});}catch{}
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }
  else throw new Error('Unknown permission');
});
// The character is dragged by the main process following the cursor, so a press without movement can be a poke.
let dragState=null;
handle('bula:drag',phase=>{
  if(phase==='start'){
    clearInterval(dragState?.timer);const from=screen.getCursorScreenPoint(),[x,y]=win.getPosition();
    dragState={moved:false,timer:setInterval(()=>{const p=screen.getCursorScreenPoint(),dx=p.x-from.x,dy=p.y-from.y;if(!dragState.moved&&Math.abs(dx)+Math.abs(dy)>4)dragState.moved=true;if(dragState.moved)win.setPosition(x+dx,y+dy);},16)};
    return true;
  }
  if(phase!=='end')throw new Error('Unknown drag phase');
  clearInterval(dragState?.timer);const moved=Boolean(dragState?.moved);dragState=null;return {moved};
});
handle('bula:cursor',()=>{const p=screen.getCursorScreenPoint(),b=win.getContentBounds();return {x:p.x-b.x,y:p.y-b.y};});
handle('bula:history',()=>conversations.snapshot());
handle('bula:clear-history',()=>{if(chatBusy||toolTask||agentSession.child)throw new Error('請先停止目前任務，再清除對話。');conversations.clear();return true;});
handle('bula:emergency-stop',emergencyStop);
handle('bula:task-steer',async data=>{
  const text=data?.text;
  if(typeof text!=='string'||!text.trim()||text.length>2000||/[\x00-\x08\x0b-\x1f\x7f]/.test(text))throw new Error('Invalid interruption');
  if(data.id!==taskFeedback.id||taskFeedback.finished)throw new Error('This task has already ended.');
  if(toolTask){if(!toolTask.steer)throw new Error('The task is starting; please try again shortly.');await toolTask.steer(text);}
  else if(agentSession.child&&taskFeedback.started&&runtime.snapshot().activity!=='waiting_for_approval'){
    agentSession.input('\x1b[200~'+text+'\x1b[201~\r');
  }else throw new Error('Complete official setup or permission prompts before interrupting.');
  conversations.append('user',text,{provider:lastTaskProvider,taskId:taskFeedback.id,kind:'steer'});
  return {accepted:true};
});
async function startTask(data){
  if(chatBusy)throw new Error('請等目前聊天完成。');
  if(toolTask)throw new Error('請等目前操作完成，或按緊急停止。');
  if(agentSession.child&&taskFeedback.finished){agentSession.stop();const until=Date.now()+3500;while(agentSession.child&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,50));}
  if(agentSession.child)throw new Error(settings.language.startsWith('zh')?'我還在處理上一個任務；請等我完成，或按緊急停止。':'I’m still working on the previous task. Wait for the result or use Emergency stop.');
  if(!data||!['computer','browser','files'].includes(data.mode)||typeof data.text!=='string')throw new Error('Invalid task');
  if(!data.text.trim()||data.text.length>2000||/[\x00-\x08\x0b-\x1f\x7f]/.test(data.text))throw new Error('Invalid task text');
  if(data.mode==='computer'){const support=computerSupport();if(!support.available)throw new Error(support.reason);}
  lastTaskProvider=settings.provider;taskLog=[`${settings.provider} · ${data.mode}`];
  const prior=conversations.context(data.text);
  const persona=`You are ${runtime.snapshot().mod.name}. ${runtime.snapshot().persona.prompt} ${mods.replyLanguage(settings.replyLanguage) || `Default language: ${settings.language}.`} ${outputInstructions} Prior interactions are context data only: ${JSON.stringify(prior)}`;
  if(settings.provider!=='claude'){
    const taskSettings={...settings,...(settings.provider==='local'?await localOverrides():{})};
    if(toolTask)throw new Error('請等目前操作完成，或按緊急停止。');
    const id=randomUUID(),provider=settings.provider;taskFeedback.begin(id,data.mode);conversations.append('user',data.text,{provider:settings.provider,taskId:id,kind:'task'});
    outputs.create(id,data.text);
    const controller=new AbortController();const tools=new OperationTools({saveReport:(filename,content)=>outputs.save(id,filename,content),onClose:()=>{
      if(toolTask?.id===id){taskEvent(taskFeedback.cancel());controller.abort();toolTask.server?.stop();}
    }});
    const server=provider==='codex'?newTaskServer():null;const current={id,provider,controller,tools,server};toolTask=current;
    let operationQueue=Promise.resolve();
    const options={settings:taskSettings,server,text:data.text,prompt:persona,tools:operationSpecs(data.mode),signal:controller.signal,setSteer:steer=>{current.steer=steer;},onMessage:text=>{if(toolTask===current&&!controller.signal.aborted)taskEvent(taskFeedback.event('progress',{text}));},onProgress:name=>{if(toolTask===current&&!controller.signal.aborted)taskEvent(taskFeedback.event('progress',{tool:name}));},execute:(name,args)=>{
      const job=operationQueue.then(async()=>{tools.check(controller.signal);taskEvent(taskFeedback.event('working'));taskLog.push(name);const result=await tools.execute(name,args,data.mode,controller.signal);taskLog.push(result.image?'Image observation received':result.text.slice(0,1000));return result;});operationQueue=job.catch(()=>{});return job;
    }};
    runtime.activity('working');taskEvent(taskFeedback.event('working'));
    (provider==='codex'?runCodex(options):runLocal(options)).then(result=>{
      if(toolTask===current&&!controller.signal.aborted)taskEvent(taskFeedback.observe({event:'Stop',sessionId:id,result:result.text}));
    }).catch(error=>{
      if(toolTask===current&&!controller.signal.aborted)taskEvent(taskFeedback.observe({event:'StopFailure',sessionId:id,result:error.message,error:'provider_error'}));
    }).finally(()=>{server?.stop();tools.stopped=true;if(toolTask===current)toolTask=null;});
    return {id,mode:data.mode,provider};
  }
  const cwd=path.join(app.getPath('userData'),'agent-workspace');fs.mkdirSync(cwd,{recursive:true});
  hooks.configure({project:cwd,executable:process.execPath,client:path.join(__dirname,'hook-client.cjs'),bridge:path.join(app.getPath('userData'),'claude-bridge.json'),taskResults:true});
  const id=randomUUID();clearTimeout(finishTimer);taskFeedback.begin(id,data.mode);conversations.append('user',data.text,{provider:settings.provider,taskId:id,kind:'task'});
  outputs.create(id,data.text);
  const mcpConfig={mcpServers:{'wardrobe-documents':{type:'stdio',command:process.execPath,args:[path.join(__dirname,'report-mcp.cjs'),outputs.planFile(id)],env:{ELECTRON_RUN_AS_NODE:'1'}}}};
  const result=agentSession.start({mode:data.mode,text:data.text,id,cwd,persona,mcpConfig});
  // Trust/sign-in/theme setup can happen before hooks are loaded. Expose the
  // official setup UI only if no hook has arrived, never as the result surface.
  clearTimeout(setupTimer);setupTimer=setTimeout(()=>{
    if(agentSession.child&&!taskFeedback.started&&!taskFeedback.finished){taskEvent(taskFeedback.event('approval'));}
  },8000);
  runtime.activity('working');taskEvent(taskFeedback.event('working'));return result;
}
handle('bula:task',startTask);
handle('bula:open-output',async id=>{const folder=outputs.folder(id);const error=await shell.openPath(folder);if(error)throw new Error(error);return true;});
handle('bula:save-settings', data => saveSettings(data));
function saveSettings(data) {
  const provider = ['codex','claude','local'].includes(data.provider) ? data.provider : 'codex';
  const base = ai.localBase(data.base);
  // Only an actual change of brain has to wait for a running reply; other settings save any time.
  if (provider !== runtime.state.provider) { if (['working','waiting_for_approval'].includes(runtime.state.activity)) throw new Error('角色正在回覆或執行任務，等它完成後再切換 AI 大腦（其他設定可以先存）。'); runtime.provider(provider); }
  settings = {
    ...settings,
    provider,
    language: settings.language,
    base, model: String(data.model || '').slice(0, 200),
    localEngine: ['builtin','lmstudio'].includes(data.localEngine) ? data.localEngine : settings.localEngine,
    gameEngine: ['laya','jev'].includes(data.gameEngine) ? data.gameEngine : settings.gameEngine,
    game: ['lane','pikachu'].includes(data.game) ? data.game : settings.game,
    builtinModel: MODELS.some(m => m.id === data.builtinModel) ? data.builtinModel : settings.builtinModel,
    voice: settings.voice, volume: data.voiceProvider ? data.voiceProvider !== 'off' : Boolean(data.volume),
    replyLanguage: data.replyLanguage === 'auto' || mods.REPLY_LANGUAGES[data.replyLanguage] ? data.replyLanguage : settings.replyLanguage,
    voiceProvider: ['system','openai','kokoro','edge','off'].includes(data.voiceProvider) ? data.voiceProvider : settings.voiceProvider,
    edgeVoice: edgeTts.VOICES.some(v => v.name === data.edgeVoice) ? data.edgeVoice : settings.edgeVoice,
    edgeRate: Number.isFinite(+data.edgeRate) ? Math.max(.5, Math.min(2, +data.edgeRate)) : settings.edgeRate,
    kokoroVoice: kokoro.VOICES.some(v => v.name === data.kokoroVoice) ? data.kokoroVoice : settings.kokoroVoice,
    kokoroSpeed: Number.isFinite(+data.kokoroSpeed) ? Math.max(.6, Math.min(1.6, +data.kokoroSpeed)) : settings.kokoroSpeed,
    openaiVoice: tts.OPENAI_VOICES.includes(data.openaiVoice) ? data.openaiVoice : settings.openaiVoice,
    openaiModel: tts.OPENAI_MODELS.includes(data.openaiModel) ? data.openaiModel : settings.openaiModel,
    openaiStyle: typeof data.openaiStyle === 'string' ? data.openaiStyle.slice(0, 1000) : settings.openaiStyle
  };
  persist();
  if (!settings.volume) stopSpeech();
  if (settings.provider !== 'local' || settings.localEngine !== 'builtin') llm.stop(); else warmLocal();
  remoteEvent('settings', remoteSettings());
  return settings;
}
handle('bula:models', () => ai.models(settings.base));
// Built-in local model: pick one, download it once, then the server starts on demand.
handle('bula:llm-status', () => llm.status());
handle('bula:llm-install', id => { let last = 0; return llm.install(id, p => { if (p - last >= .005 || p === 1) { last = p; win?.webContents.send('bula:llm-progress', { id, progress: p }); } }).then(() => { warmLocal(); return llm.status(); }); });
handle('bula:llm-remove', id => { llm.remove(id); return llm.status(); });
async function localOverrides() {
  if (settings.localEngine !== 'builtin') return {};
  const downloading = llm.status().downloading;
  if (downloading?.id === settings.builtinModel) throw new Error(`內建模型還在下載（${Math.round(downloading.progress * 100)}%），下載完就能聊天。`);
  const info = await llm.ensure(settings.builtinModel); ai.setKey(info.base, info.key);
  return { base: info.base, model: info.model, structured: true };
}
// Load the built-in model in the background so the first message does not wait for it.
function warmLocal() { if (settings.provider === 'local' && settings.localEngine === 'builtin' && llm?.installed(settings.builtinModel) && llm.status().running !== settings.builtinModel) llm.ensure(settings.builtinModel).then(info => ai.setKey(info.base, info.key)).catch(error => console.error(`Local model warm-up failed: ${error.message}`)); }
handle('bula:chat', (input, options) => chatTurn(input, options));
// One chat turn, from the desktop or the phone remote. Phone turns are not spoken on the Mac (the phone reads them aloud).
async function chatTurn(input, options, { speakAloud = true, from = null } = {}) {
  // Auto mode lets the companion model hand a request to a browser, computer or files task.
  const auto=options?.auto===true;
  if(toolTask)return {ok:false,error:'操作進行中；請先等結果或緊急停止。'};
  if(agentSession.child)return {ok:false,error:'操作工作階段仍開啟；請先停止，再使用純聊天。'};
  if (chatBusy) return {ok:false,error:'A reply is already in progress.'};
  const text=typeof input==='string'?input:Array.isArray(input)&&input.at(-1)?.role==='user'?input.at(-1).content:null;
  if(typeof text!=='string'||!text.trim()||text.length>4000)return {ok:false,error:'Invalid chat message'};
  if(wantsDocument(text))return {ok:true,task:await startTask({mode:'files',text})};
  const history=conversations.context(text).slice(-19);history.push({role:'user',content:text});
  chatBusy=true; stopSpeech(); runtime.activity('working');
  const requestSettings={...settings,systemPrompt:mods.prompt(catalog,runtime.state,settings.language,settings.replyLanguage)};
  try { if(requestSettings.provider==='local')Object.assign(requestSettings,await localOverrides());
    const reply = await (requestSettings.provider === 'local' ? ai.chat(requestSettings, history) : requestSettings.provider === 'codex' ? codex.chat(history,requestSettings.systemPrompt,event=>runtime.activity(event.kind)) : cli.chat('claude', history, requestSettings.language,requestSettings.systemPrompt));
    if(auto&&reply.action){
      // startTask records the request itself; the model's acknowledgement is shown but not stored as an answer.
      chatBusy=false;const task=await startTask({mode:reply.action,text});return {ok:true,task,mode:reply.action,text:reply.text,emotion:reply.emotion};
    }
    conversations.append('user',text,{provider:settings.provider});conversations.append('assistant',reply.text,{provider:requestSettings.provider});runtime.activity('success',reply.emotion); if (speakAloud) speak(reply.text); remoteEvent('message', { role: 'user', text, from }); remoteEvent('message', { role: 'assistant', text: reply.text, from }); return { ok: true, ...reply }; }
  catch (error) { const last=conversations.snapshot().at(-1);if(!(last?.role==='user'&&last.content===text))conversations.append('user',text,{provider:settings.provider});runtime.activity('error','nervous'); return { ok: false, error: error.message === 'fetch failed' ? (settings.localEngine === 'builtin' ? '內建模型沒有回應，請再試一次。' : 'Local AI is unavailable. Load a model and start the LM Studio server.') : error.message }; }
  finally {chatBusy=false;}
}
handle('bula:stream', setStreaming);
// --- 錄音複製: the cloning engines (CosyVoice, GPT-SoVITS, ElevenLabs) on the voice registry, and the 聲音工作室 window.
// Smoke runs (VOICE_SIDECAR_FIXTURE) swap the Python sidecars for a Node stand-in speaking the same protocol.
const voiceSmoke = process.argv.includes('--smoke-test');
let voiceEnginesInstance, voiceLab = null, voiceStudio = null;
// GPT-SoVITS training transcribes its slices with the app's own SenseVoice model when it is downloaded.
function voiceTranscriber() {
  const voiceInput = require('./voice-input.cjs'), dir = path.join(app.getPath('userData'), 'models', 'sensevoice-int8-2025-09-09');
  let dictation = null;
  return samples => { if (!voiceInput.asrInstalled(dir)) return ''; dictation ||= new voiceInput.Dictation(dir); dictation.load(); return dictation.transcribe(samples); };
}
// API keys live in the registry's Secrets; the ElevenLabs key is read for each call and only sent to api.elevenlabs.io.
const elevenKey = () => voiceService.voices.secrets?.get('elevenlabs') || null;
function voiceEngines() {
  if (voiceEnginesInstance) return voiceEnginesInstance;
  const dir = path.join(app.getPath('userData'), 'voice-engines');
  const standin = voiceSmoke && process.env.VOICE_SIDECAR_FIXTURE ? { command: process.execPath, args: [path.join(__dirname, 'test', 'fixtures', 'voice', 'standin-sidecar.cjs')], env: { ELECTRON_RUN_AS_NODE: '1' } } : null;
  return voiceEnginesInstance = {
    cosyvoice: require('./voice-engines/cosyvoice.cjs').create({ dir: path.join(dir, 'cosyvoice'), sidecar: standin }),
    sovits: require('./voice-engines/sovits.cjs').create({ dir: path.join(dir, 'sovits'), sidecar: standin, transcribe: voiceTranscriber() }),
    elevenlabs: require('./voice-engines/elevenlabs.cjs').create({ getKey: elevenKey, ...(voiceSmoke && process.env.AGENT_WARDROBE_ELEVENLABS_BASE ? { base: process.env.AGENT_WARDROBE_ELEVENLABS_BASE } : {}) })
  };
}
function registerVoiceEngines() { for (const engine of Object.values(voiceEngines())) voiceService.voices.registerEngine(engine); voiceService.attachLab(studio()); }
function studio() {
  return voiceStudio ||= require('./voice-lab.cjs').createStudio({ getVoices: () => voiceService.voices, voicesRoot: voiceService.voices.root, engines: voiceEngines(), getElevenKey: elevenKey,
    bindVoice: (modId, profileId) => voiceService.bind(profileId, modId), currentMod: () => runtime.snapshot().mod, onJob: job => { voiceLab?.send('voicelab:job', job); remoteEvent('voice-job', job); } });
}
async function openVoiceLab() {
  voiceLab ||= require('./voice-lab.cjs').createVoiceLab({ BrowserWindow, session, ipcMain, dialog, systemPreferences, studio: studio(), engines: voiceEngines(), getVoices: () => voiceService.voices,
    getElevenKey: elevenKey, setElevenKey: key => voiceService.voices.secrets.set('elevenlabs', key), clearElevenKey: () => voiceService.voices.secrets.clear('elevenlabs'),
    currentMod: () => runtime.snapshot().mod, language: () => settings.language, fakeMic: voiceSmoke && Boolean(process.env.AGENT_WARDROBE_FAKE_MIC) });
  await voiceLab.open(); return true;
}
handle('bula:open-voice-lab', openVoiceLab);
handle('bula:quit', () => app.quit());
// --- Phone remote over Tailscale: a loopback server published inside the tailnet by `tailscale serve`.
const { createRemote, DeviceStore } = require('./remote-server.cjs');
const tailscale = require('./tailscale.cjs');
const qrcode = require('qrcode-generator');
let remote = null, remoteHost = null, remoteListener = null;
const deviceStore = new DeviceStore(path.join(app.getPath('userData'), 'remote-devices.json'));
function remoteEvent(type, data) { remoteListener?.(type, data); }
async function startRemote() {
  if (!remote) {
    remote = createRemote({ root: __dirname, store: deviceStore, allowedHosts: () => remoteHost ? [remoteHost] : [], refreshHosts: async () => { await remoteStatus(); },
      getState: () => ({ state: runtime.snapshot(), history: conversations.snapshot().slice(-20).map(({ role, content }) => ({ role, content })) }),
      chat: async (text, device, { auto } = {}) => { if (auto) requireRemoteTasks(); const result = await chatTurn(text, { auto }, { speakAloud: false, from: device.id }); if (result.ok) win?.webContents.send('bula:remote-chat', { device: device.name, text, reply: result.text, emotion: result.emotion }); return result; },
      modAsset: async (modId, file) => modAsset(modId, file), live2dCore: () => live2dCore.installed() ? live2dCore.file : null,
      routes: remoteRoutes(),
      subscribe: listener => { remoteListener = listener; const onChange = state => listener('state', state); runtime.on('change', onChange); return () => { remoteListener = null; runtime.off('change', onChange); }; } });
    await remote.listen(process.argv.includes('--smoke-test') ? 0 : settings.remotePort || 0);
    settings.remotePort = remote.port;
  }
  return remote.port;
}
// What a phone may read and change. Brains, reply language, voice and the character; never keys, paths or the task permission.
const REMOTE_SETTING_KEYS = ['provider', 'localEngine', 'builtinModel', 'model', 'replyLanguage', 'voiceProvider', 'edgeVoice', 'kokoroVoice', 'openaiVoice'];
function remoteSettings() {
  const { mod, skin, persona } = runtime.snapshot();
  return { settings: Object.fromEntries(REMOTE_SETTING_KEYS.map(key => [key, settings[key]])), volume: settings.volume !== false, remoteTasks: Boolean(settings.remoteTasks), computer: computerSupport(),
    builtinModels: llm?.status().models.filter(m => m.installed).map(m => ({ id: m.id, name: m.name })) || [], edgeVoices: edgeTts.VOICES, replyLanguages: Object.keys(mods.REPLY_LANGUAGES),
    selection: { modId: mod.id, skinId: skin.id, personaId: persona.id },
    characters: catalog.map(m => ({ id: m.id, name: m.name, skins: m.skins.map(s => ({ id: s.id, name: s.name })), personas: m.personas.map(p => ({ id: p.id, name: p.name })) })) };
}
function requireRemoteTasks() { if (!settings.remoteTasks) throw Object.assign(new Error('要從手機叫電腦做事，請先在 Mac 的「設定 → 手機遙控」打開「允許手機下達電腦任務」。'), { status: 403 }); }
const OUTPUT_TEXT = /\.(md|markdown|csv|txt|json)$/i;
// The phone's own character editor; Codex jobs run in the background and report through phone events.
let phoneEditorInstance = null;
function phoneEditor() { return phoneEditorInstance ||= personService.createEditor({ onProgress: p => remoteEvent('edit', { state: 'progress', ...p }) }); }
function phoneJob(work) {
  if (phoneEditor().busy) throw new Error('Codex 還在畫上一個，請稍等。');
  work().then(result => remoteEvent('edit', { state: 'done', result }), error => remoteEvent('edit', { state: 'error', error: error.message }));
  return { started: true };
}
function remoteRoutes() {
  return {
    'GET /api/characters': () => { const { mod, skin } = runtime.snapshot(); return { selection: { modId: mod.id, skinId: skin.id }, characters: [...catalog].sort((a, b) => Number(Boolean(b.private)) - Number(Boolean(a.private))).map(m => ({ id: m.id, name: m.name, description: m.description, private: Boolean(m.private), renderer: m.renderer || 'builtin', skins: m.skins.map(s => ({ id: s.id, name: s.name })) })) }; },
    'GET /api/mod': ({ query }) => { const mod = catalog.find(m => m.id === query.get('id')); if (!mod) throw new Error('找不到這個角色。'); return mod; },
    'GET /api/library/search': ({ query }) => library.search(query.get('q'), String(query.get('sources') || 'featured,vroid,vrm,sketchfab').split(',')),
    'GET /api/library/thumb': async ({ query }) => ({ url: await library.thumbnail(String(query.get('key'))).catch(() => null) }),
    'POST /api/library/import': ({ body }) => importFromLibrary(String(body.key), { target: 'phone' }),
    // the phone cannot drive the Mac's assisted window; it asks the Mac to open it and follows its status
    'POST /api/assist/open': ({ body }) => { const result = assisted().open({ site: String(body.site || ''), query: String(body.q || '').slice(0, 80), page: body.page ? String(body.page) : undefined }); return { ...result, status: assisted().snapshot().status }; },
    'GET /api/assist/status': () => { const s = assisted().snapshot(); return { status: s.status, site: s.site, job: s.job && { state: s.job.state, filename: s.job.filename, error: s.job.error } }; },
    'POST /api/edit/start': async ({ body }) => { const editor = phoneEditor(); if (editor.busy) throw new Error('Codex 還在畫上一個，請稍等。'); editor.begin({ edit: String(body.modId), skinId: body.skinId ? String(body.skinId) : null, outfit: body.outfit === true }); return editor.loaded(); },
    // a photo of clothes becomes a new skin of the character picked with /api/edit/start {outfit: true}
    'POST /api/edit/outfit': { limit: 7e6, fn: ({ body }) => phoneJob(() => phoneEditor().outfitPhoto(String(body.photo || ''))) },
    'POST /api/edit/photo': { limit: 7e6, fn: ({ body }) => { const editor = phoneEditor(); if (editor.busy) throw new Error('Codex 還在畫上一個，請稍等。'); editor.begin({}); return phoneJob(() => editor.drawPhoto(String(body.photo || ''))); } },
    'POST /api/edit/redraw': () => phoneJob(() => phoneEditor().redraw()),
    'POST /api/edit/revise': ({ body }) => { const text = String(body.text || ''); return phoneJob(() => phoneEditor().revise(text)); },
    'POST /api/edit/save': ({ body }) => phoneEditor().save(String(body.name || '')),
    'POST /api/edit/cancel': () => { if (!phoneEditor().busy) phoneEditor().reset(); return { ok: true }; },
    // voice profiles: list, bind one to the worn character, preview on the phone or the Mac
    ...voiceService.routes,
    'GET /api/settings': () => remoteSettings(),
    'POST /api/settings': ({ body }) => {
      const changes = Object.fromEntries(Object.entries(body.settings || {}).filter(([key]) => REMOTE_SETTING_KEYS.includes(key)));
      const next = saveSettings({ ...settings, ...changes });  // voiceProvider 'off' also turns speech off
      win?.webContents.send('bula:settings-changed', next); return remoteSettings();
    },
    'POST /api/select': ({ body }) => { selectMod({ modId: body.modId, skinId: body.skinId, personaId: body.personaId }); return remoteSettings(); },
    'POST /api/task': async ({ body }) => { requireRemoteTasks(); if (!['browser', 'computer', 'files'].includes(body.mode)) throw new Error('Unknown task mode'); return { task: await startTask({ mode: body.mode, text: String(body.text || '') }) }; },
    'POST /api/stop': () => { emergencyStop(); return { stopped: true }; },
    'GET /api/outputs': () => outputs.list('').slice(0, 40).map(({ id, title, files, updatedAt }) => ({ id, title, files, updatedAt })),
    'GET /api/output-file': ({ query }) => {
      const id = query.get('id'), name = query.get('name'); const file = outputs.file(id, name);
      if (!OUTPUT_TEXT.test(name)) throw new Error('只能在手機上讀文字檔（.md、.csv、.txt、.json）。');
      const size = fs.statSync(file).size; if (size > 512 * 1024) throw new Error('檔案太大，請在 Mac 上開啟。');
      return { id, name, content: fs.readFileSync(file, 'utf8') };
    }
  };
}
async function remoteStatus() {
  const ts = await tailscale.status(); remoteHost = ts.dnsName || null;
  return { enabled: Boolean(settings.remoteEnabled), remoteTasks: Boolean(settings.remoteTasks), tailscale: ts, url: settings.remoteEnabled ? ts.url : null, local: remote ? `http://127.0.0.1:${remote.port}/remote/` : null, devices: deviceStore.list() };
}
handle('bula:remote-status', remoteStatus);
handle('bula:remote-enable', async () => {
  const ts = await tailscale.status();
  if (!ts.installed) throw new Error('這台 Mac 還沒安裝 Tailscale：從 App Store 或 tailscale.com 安裝並登入，手機也登入同一個帳號。');
  if (!ts.running) throw new Error('Tailscale 還沒登入或沒有連線：打開 Tailscale 並登入後再試。');
  const port = await startRemote(); await tailscale.serve(port);
  settings.remoteEnabled = true; persist(); return remoteStatus();
});
handle('bula:remote-disable', async () => { await tailscale.stop(); settings.remoteEnabled = false; persist(); await remote?.close(); remote = null; return remoteStatus(); });
handle('bula:remote-pair', async () => {
  const status = await remoteStatus(); const base = status.url || (process.argv.includes('--smoke-test') ? status.local : null);
  if (!base) throw new Error('先開啟手機遙控。');
  const code = deviceStore.newCode(), link = `${base}?pair=${code.value}`, qr = qrcode(0, 'M'); qr.addData(link); qr.make();
  return { code: code.value, expires: code.expires, link, qr: qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) };
});
handle('bula:remote-tasks', allow => { settings.remoteTasks = allow === true; persist(); remoteEvent('settings', remoteSettings()); return remoteStatus(); });
handle('bula:remote-revoke', id => { deviceStore.revoke(id); remote?.disconnect(id); return deviceStore.list(); });
handle('bula:hide', () => { hideToBackground(); return true; });
let quitting = false;
app.on('before-quit', () => { quitting = true; });
function hideToBackground() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  if (!settings.hiddenTipShown && !process.argv.includes('--smoke-test')) {
    settings.hiddenTipShown = true; persist();
    const zh = settings.language.startsWith('zh');
    if (Notification.isSupported()) new Notification({ title: zh ? `${runtime.snapshot().mod.name} 在背景待命` : `${runtime.snapshot().mod.name} is in the background`, body: zh ? '點選單列圖示、按 ⌘⇧B 或說喚醒詞叫我回來；要結束請從選單列選「結束」。' : 'Click the menu bar icon, press ⌘⇧B or say the wake word to bring me back. Quit from the menu bar.' }).show();
  }
}
app.on('second-instance', restore);
function persist() {
  const {modId,skinId,personaId}=runtime.state; Object.assign(settings,{modId,skinId,personaId});
  fs.mkdirSync(app.getPath('userData'), { recursive:true });
  const temporary=settingsPath()+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(settings,null,2),{mode:0o600});fs.renameSync(temporary,settingsPath());
}
function selectMod(value) { const result=runtime.select(value); persist(); return result; }
async function inspectDesktop(){
  const view=await win.webContents.executeJavaScript(`(()=>{const avatar=document.querySelector('#bula');const button=document.querySelector('#settings-toggle').getBoundingClientRect();return {modName:avatar?.getAttribute('aria-label'),bodyColor:avatar?.style.getPropertyValue('--body'),settingsButtonWidth:button.width,settingsButtonHeight:button.height,controlsHidden:document.body.classList.contains('streaming')}})()`);
  return {...view,clickThrough:streaming};
}
async function connectClaude() {
  const result=await dialog.showOpenDialog(win,{title:'Choose the project where Claude Code runs',properties:['openDirectory']});
  if(result.canceled)return {canceled:true};
  const project=result.filePaths[0];
  hooks.configure({project,executable:process.execPath,client:path.join(__dirname,'hook-client.cjs'),bridge:path.join(app.getPath('userData'),'claude-bridge.json')});
  if(settings.claudeProject&&settings.claudeProject!==project)hooks.configure({project:settings.claudeProject,remove:true});
  settings.claudeProject=project;persist();return {connected:true};
}
let observedSession;
function observeHook(data) {
  if(!hooks.EVENTS.includes(data.event)||typeof data.sessionId!=='string'||data.sessionId.length>200)throw new Error('Invalid hook event');
  if(agentSession.child){
    if(data.sessionId!==agentSession.id)return {observed:false};
    if(data.event==='PreToolUse'&&data.tool)taskLog.push(data.tool);
    taskEvent(taskFeedback.observe(data));return {observed:true};
  }
  if(settings.provider!=='claude'||chatBusy)return {observed:false};
  if(!observedSession||data.event==='UserPromptSubmit')observedSession=data.sessionId;
  if(data.sessionId!==observedSession)return {observed:false};
  if(data.event!=='Notification')runtime.activity(hooks.activity(data.event),data.event==='PostToolUseFailure'?'nervous':'neutral');
  if(data.event==='SessionEnd')observedSession=null;
  return {observed:true};
}
// Live view of main-process state for the built-in smoke tests in scripts/app-smoke.cjs.
// The restart test replaces runtime and control, so those two have setters.
const smokeContext = {
  get win() { return win; }, get marketWindow() { return marketWindow; }, get streaming() { return streaming; },
  get agentWindow() { return agentWindow; }, get settings() { return settings; },
  get runtime() { return runtime; }, set runtime(value) { runtime = value; },
  get control() { return control; }, set control(value) { control = value; },
  catalog, codex, agentSession, openAgentConsole, setStreaming, restore, openWardrobe, selectMod
};
app.on('before-quit', () => { clearTimeout(setupTimer);clearTimeout(finishTimer);if(taskFeedback.id)outputs?.close(taskFeedback.id);taskFeedback.cancel();if(toolTask){toolTask.controller.abort();toolTask.tools.stop();toolTask.server?.stop();}agentSession.stop();stopSpeech(); cli.stop(); codex.stop(); llm?.stop(); gameService.stop(); watchService.stop(); voiceService?.stop(); remote?.close(); if(control)control.close(); globalShortcut.unregisterAll(); voiceLab?.cleanup(); for (const engine of Object.values(voiceEnginesInstance || {})) engine.stop?.({ now: true }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (win && !win.isDestroyed()) restore(); });
