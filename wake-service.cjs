// Hands-free input: microphone chunks from the page -> wake word -> dictation -> text sent back to the chat.
// Audio stays in memory; only levels and detection state go to wake-diagnostics.json.
const fs = require('node:fs');
const path = require('node:path');
const voiceInput = require('./voice-input.cjs');
const { execFile } = require('node:child_process');
const { typelessStatus, SpeechEnd } = require('./typeless.cjs');

function createWake({ app, handle, ipcMain, systemPreferences, getWin, getRuntime, getSettings, persist, speech }) {
  const asrDir = () => path.join(app.getPath('userData'), 'models', 'sensevoice-int8-2025-09-09');
  // --- Hands-free input: wake word, then dictation of the following utterance, sent to the chat.
  const WAKE_NAMES = { annie: '安妮', miso: '米索', byte: '拜特' };
  // A wake word is a short name to call, not a sentence: a dictated question pasted into the field must not become one.
  const splitPhrases = text => String(text || '').split(/[,，、]/).map(p => p.trim()).filter(Boolean);
  const badPhrase = p => /[?？。！!.:：;；]/.test(p) || (/[\u3400-\u9fff\u3040-\u30ff]/.test(p) ? [...p].length > 8 : p.length > 24);
  function wakePhrases() {
    const custom = splitPhrases(getSettings().wakePhrases).filter(p => !badPhrase(p));
    if (custom.length) return custom.slice(0, 5);
    const mod = getRuntime().snapshot().mod; return [WAKE_NAMES[mod.id] ? `嘿${WAKE_NAMES[mod.id]}` : null, `Hey ${mod.name.split(/\s+/)[0]}`].filter(Boolean);
  }
  let wake = null, dictation = null, listenMode = 'wake', listenTimer = null, listenStarted = 0, wakeError = null, speechEnd = null;
  const useTypeless = () => getSettings().dictationEngine === 'typeless' && typelessStatus().supported;
  const tapFn = () => new Promise((resolve, reject) => execFile(path.join(__dirname, 'bin', 'native-input'), [JSON.stringify({ action: 'fn' })], { timeout: 4000 }, (error, _out, stderr) => error ? reject(new Error(String(stderr || error.message).includes('Accessibility') ? '要用 Typeless 辨識，請在「系統設定 → 隱私權與安全性 → 輔助使用」允許 Agent Wardrobe。' : `無法啟動 Typeless：${stderr || error.message}`)) : resolve()));
  // Wake -> bring the chat box forward -> Fn starts Typeless -> a pause ends the question -> Fn again; Typeless pastes the text.
  async function startTypeless() {
    const win = getWin(); listenMode = 'typeless'; speechEnd = new SpeechEnd();
    win.show(); app.focus({ steal: true }); win.focus();
    await new Promise(resolve => setTimeout(resolve, 350));
    // Typeless pastes into the focused field: only start it once the chat box has focus, never a settings field
    const focused = () => win.webContents.executeJavaScript(`(()=>{const p=document.getElementById('prompt');if(document.activeElement!==p){document.activeElement?.blur?.();p?.focus();}return document.activeElement===p;})()`).catch(() => false);
    if (!await focused()) { await new Promise(resolve => setTimeout(resolve, 250)); if (!await focused()) { listenMode = 'wake'; win.webContents.send('bula:typeless', { state: 'error', error: '聊天輸入框沒有拿到游標，這次先不啟動 Typeless，再叫我一次。' }); return; } }
    try { await tapFn(); } catch (error) { listenMode = 'wake'; win.webContents.send('bula:typeless', { state: 'error', error: error.message }); }
  }
  async function finishTypeless(result) {
    listenMode = 'finishing'; micStats.lastDictation = { engine: 'typeless', result, at: new Date().toISOString() };
    try { await tapFn(); getWin()?.webContents.send('bula:typeless', { state: result === 'done' ? 'processing' : 'nothing' }); }
    catch (error) { getWin()?.webContents.send('bula:typeless', { state: 'error', error: error.message }); }
    setTimeout(() => { listenMode = 'wake'; }, 1500); // let Typeless finish before the wake word listens again
  }
  function configureWake() {
    wakeError = null;
    // repair a sentence saved as a wake word by an earlier version (Typeless pasting into the field)
    const saved = splitPhrases(getSettings().wakePhrases); if (saved.some(badPhrase)) { getSettings().wakePhrases = saved.filter(p => !badPhrase(p)).join(', '); persist(); }
    try { wake ||= new voiceInput.WakeWord(path.join(__dirname, 'models', 'kws'), { keywordsFile: path.join(app.getPath('userData'), 'wake-keywords.txt') }); wake.configure(wakePhrases(), getSettings().wakeSensitivity); }
    catch (error) { wake = null; wakeError = error.message; }
    return { phrases: wakePhrases(), error: wakeError };
  }
  function endListening(text) {
    micStats.lastDictation = { chars: (text || '').length, at: new Date().toISOString() };
    clearTimeout(listenTimer); listenMode = 'wake';
    if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('bula:dictation', { text: text || '' });
  }
  // Levels and detection state only (never audio), so "it doesn't react" can be diagnosed.
  const micStats = { chunks: 0, peak: 0, recentPeak: 0, lastWake: null, lastDictation: null, skippedWhileSpeaking: 0 };
  let micStatsTimer = null;
  function onMicAudio(samples) {
    if (!getSettings().wakeEnabled || !(samples instanceof Float32Array) || samples.length > 16000) return;
    micStats.chunks++; let peak = 0; for (const v of samples) peak = Math.max(peak, Math.abs(v)); micStats.recentPeak = Math.max(micStats.recentPeak * .9, peak);
    if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('bula:mic-level', micStats.recentPeak);
    micStatsTimer ||= setInterval(() => { try { fs.writeFileSync(path.join(app.getPath('userData'), 'wake-diagnostics.json'), JSON.stringify({ at: new Date().toISOString(), micAccess: systemPreferences.getMediaAccessStatus?.('microphone'), phrases: wakePhrases(), error: wakeError, mode: listenMode, ...micStats })); } catch {} micStats.peak = 0; }, 2000);
    micStats.peak = Math.max(micStats.peak, peak);
    if (speech.isSpeaking()) { micStats.skippedWhileSpeaking++; return; } // never hear the companion's own voice
    if (listenMode === 'wake') {
      const hit = wake?.accept(samples); if (!hit) return;
      micStats.lastWake = { phrase: hit, at: new Date().toISOString() };
      if (!getWin().isVisible()) getWin().show();  // the wake word also brings back a companion hidden in the background
      if (useTypeless()) { getWin().webContents.send('bula:wake', { phrase: hit, dictation: true, typeless: true }); startTypeless(); return; }
      getWin().webContents.send('bula:wake', { phrase: hit, dictation: voiceInput.asrInstalled(asrDir()) });
      if (!voiceInput.asrInstalled(asrDir())) return;
      try {
        dictation ||= new voiceInput.Dictation(asrDir(), { convert: require('opencc-js').Converter({ from: 'cn', to: app.getPreferredSystemLanguages().some(lang => /Hant|-(TW|HK|MO)$/i.test(lang)) ? 'twp' : 'cn' }) });
        dictation.begin(); listenMode = 'listen'; listenStarted = Date.now();
        // Give up after 6 s without speech, or 20 s overall.
        listenTimer = setInterval(() => { const elapsed = Date.now() - listenStarted; if ((!dictation.heard && elapsed > 6000) || elapsed > 20000) endListening(dictation.finish()); }, 250);
      } catch (error) { getWin().webContents.send('bula:notice', error.message); }
      return;
    }
    if (listenMode === 'typeless') { const end = speechEnd.accept(samples); if (end) finishTypeless(end); return; }
    if (listenMode !== 'listen') return;
    const result = dictation.accept(samples);
    if (result.done) endListening(result.text);
  }
  ipcMain.on('bula:mic',(event,samples)=>{if(event.sender===getWin()?.webContents)try{onMicAudio(samples);}catch(error){console.error(error);}});
  handle('bula:wake-status',()=>({enabled:getSettings().wakeEnabled,engine:getSettings().dictationEngine||'local',typeless:typelessStatus(),sensitivity:getSettings().wakeSensitivity,phrases:wakePhrases(),custom:getSettings().wakePhrases||'',error:wakeError,asr:{installed:voiceInput.asrInstalled(asrDir()),downloading:asrDownload!==null}}));
  handle('bula:wake-settings',async data=>{
    if(typeof data?.wakePhrases==='string'){const bad=splitPhrases(data.wakePhrases).find(badPhrase);if(bad)throw new Error(`「${bad.slice(0,20)}」不像喚醒詞：請用短短的稱呼，例如「嘿安妮」（中文 8 字內、不加標點）。`);getSettings().wakePhrases=data.wakePhrases.slice(0,200);}
    if(['normal','high'].includes(data?.wakeSensitivity))getSettings().wakeSensitivity=data.wakeSensitivity;
    if(['local','typeless'].includes(data?.dictationEngine))getSettings().dictationEngine=data.dictationEngine;
    if(typeof data?.wakeEnabled==='boolean'){
      if(data.wakeEnabled&&process.platform==='darwin'&&!process.env.AGENT_WARDROBE_FAKE_MIC&&systemPreferences.getMediaAccessStatus('microphone')!=='granted'&&!(await systemPreferences.askForMediaAccess('microphone')))throw new Error('需要麥克風權限才能使用語音喚醒。到「系統設定 → 隱私權與安全性 → 麥克風」允許 Agent Wardrobe。');
      getSettings().wakeEnabled=data.wakeEnabled;
    }
    persist();const status=configureWake();if(status.error&&typeof data?.wakePhrases==='string')throw new Error(status.error);
    return {enabled:getSettings().wakeEnabled,...status};
  });
  let asrDownload=null;
  handle('bula:asr-install',async()=>{
    if(voiceInput.asrInstalled(asrDir()))return {installed:true};if(asrDownload)return asrDownload;let last=0;
    asrDownload=voiceInput.installAsr(asrDir(),{onProgress:p=>{if(p-last>=.01||p===1){last=p;if(getWin()&&!getWin().isDestroyed())getWin().webContents.send('bula:asr-progress',p);}}}).then(()=>({installed:true})).finally(()=>{asrDownload=null;});
    return asrDownload;
  });
  return { configure: configureWake, tapFn };
}
module.exports = { createWake };
