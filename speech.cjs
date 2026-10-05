// Spoken replies: the worn character's own voice profile (voices.cjs) when it has one, otherwise macOS say, OpenAI, local Kokoro or Edge voices,
// plus the voice settings IPC.
// Lip-sync follows the 'bula:speaking' events and runtime.speaking(); stop() ends any voice at once.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { shell } = require('electron');
const tts = require('./tts.cjs');
const kokoro = require('./kokoro.cjs');
const edgeTts = require('./edge-tts.cjs');
const { boundProfile } = require('./voices.cjs');

function createSpeech({ app, handle, getWin, getRuntime, getSettings, getSecrets, kokoroDir, getVoices = () => null }) {
  let speech = null, speechAbort = null, localVoice = null, kokoroDownload = null;
  // Smoke tests point OpenAI calls at a local stand-in; a normal launch always uses api.openai.com.
  const openaiBase = () => process.argv.includes('--smoke-test') && process.env.AGENT_WARDROBE_OPENAI_BASE || 'https://api.openai.com/v1';
  
  function stopSpeech() {
    speechAbort?.abort(); speechAbort = null;
    if (speech) { speech.kill(); speech = null; }
    if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('bula:speaking', false);
    if (getRuntime()) getRuntime().speaking(false);
  }
  
  function speak(text, override) {
    stopSpeech();
    const voice = { ...getSettings(), ...override };
    if (!voice.volume || voice.voiceProvider === 'off' || process.platform !== 'darwin') return;
    // a profile: one asked for (preview, a draft from the sliders), or the one bound to the worn character when no provider was asked for
    const voices = getVoices(), profile = voices && (override?.voiceDraft || override?.voiceProfile || (!override?.voiceProvider && boundProfile(voice.characterVoices, getRuntime()?.state.modId, voices)));
    if (profile) return speakSentences(text, 'wav', (part, signal) => typeof profile === 'string' ? voices.speak(profile, part, { signal }) : voices.speakProfile(profile, part, { signal }));
    if (voice.voiceProvider === 'openai') return speakOpenAI(text, voice);
    if (voice.voiceProvider === 'kokoro') { localVoice ||= new kokoro.Kokoro(kokoroDir()); return speakSentences(text, 'wav', part => localVoice.synthesize(part, voice.kokoroVoice, voice.kokoroSpeed)); }
    if (voice.voiceProvider === 'edge') return speakSentences(text, 'mp3', (part, signal) => edgeTts.synthesize(part, voice.edgeVoice, voice.edgeRate, { signal }));
    const replyVoice=/[\u3040-\u30ff]/.test(text)?'Kyoko':/[\u3400-\u9fff]/.test(text)?'Eddy (Chinese (Taiwan))':getSettings().voice;
    const child = spawn('/usr/bin/say', ['-v', replyVoice, '-r', '185'], { stdio: ['pipe', 'ignore', 'pipe'] });
    speech = child;
    getWin().webContents.send('bula:speaking', true);
    getRuntime().speaking(true);
    let error = '';
    child.stderr.on('data', chunk => { error += chunk.toString(); });
    child.on('error', () => finish('系統語音未能啟動。'));
    child.on('close', code => finish(code ? `語音失敗：${error.slice(0, 100)}` : null));
    child.stdin.on('error', () => {});
    child.stdin.end(String(text).slice(0, 600));
    function finish(message) {
      if (speech !== child) return;
      speech = null;
      if (!getWin() || getWin().isDestroyed()) return;
      getWin().webContents.send('bula:speaking', false);
      getRuntime().speaking(false);
      if (message) getWin().webContents.send('bula:notice', message);
    }
  }
  
  async function speakOpenAI(text, voice) {
    const abort = new AbortController(); speechAbort = abort;
    let audio;
    try { audio = await tts.openaiSpeech({ key: getSecrets().get('openai'), text, voice: voice.openaiVoice, model: voice.openaiModel, instructions: voice.openaiStyle, signal: abort.signal, base: openaiBase() }); }
    catch (error) { if (speechAbort === abort) { speechAbort = null; if (error.name !== 'AbortError' && getWin() && !getWin().isDestroyed()) getWin().webContents.send('bula:notice', error.message); } return; }
    if (speechAbort !== abort) return;
    speechAbort = null;
    const file = path.join(app.getPath('temp'), `agent-wardrobe-speech-${process.pid}.mp3`);
    fs.writeFileSync(file, audio, { mode: 0o600 });
    const child = spawn('/usr/bin/afplay', [file], { stdio: ['ignore', 'ignore', 'pipe'] });
    speech = child; getWin().webContents.send('bula:speaking', true); getRuntime().speaking(true);
    const finish = message => { if (speech !== child) return; speech = null; if (!getWin() || getWin().isDestroyed()) return; getWin().webContents.send('bula:speaking', false); getRuntime().speaking(false); if (message) getWin().webContents.send('bula:notice', message); };
    child.on('error', () => finish('無法播放語音。'));
    child.on('close', code => finish(code && code !== null && !child.killed ? '語音播放失敗。' : null));
  }
  
  // Kokoro and Edge voices: synthesize the next sentence while the current one plays.
  async function speakSentences(text, ext, synthesize) {
    const abort = new AbortController(); speechAbort = abort;
    const parts = kokoro.sentences(String(text).slice(0, 2000)).slice(0, 40);
    if (!parts.length) return;
    const notice = message => { if (getWin() && !getWin().isDestroyed()) getWin().webContents.send('bula:notice', message); };
    const done = () => { if (!getWin() || getWin().isDestroyed()) return; getWin().webContents.send('bula:speaking', false); getRuntime().speaking(false); };
    let started = false;
    try {
      let next = synthesize(parts[0], abort.signal);
      for (let i = 0; i < parts.length; i++) {
        let audio = await next, type = ext;
        if (abort.signal.aborted) return;
        if (audio && !Buffer.isBuffer(audio)) { type = audio.mime === 'audio/mpeg' ? 'mp3' : 'wav'; audio = audio.audio; }  // voice profiles say what they return
        next = i + 1 < parts.length ? synthesize(parts[i + 1], abort.signal) : null;
        next?.catch(() => {});
        const file = path.join(app.getPath('temp'), `agent-wardrobe-speech-${process.pid}-${i % 2}.${type}`);
        fs.writeFileSync(file, audio, { mode: 0o600 });
        if (!started) { started = true; getWin().webContents.send('bula:speaking', true); getRuntime().speaking(true); }
        const child = spawn('/usr/bin/afplay', [file], { stdio: 'ignore' }); speech = child;
        await new Promise(resolve => { child.on('close', resolve); child.on('error', resolve); });
        if (abort.signal.aborted || speech !== child) return;
        speech = null;
      }
      if (speechAbort === abort) speechAbort = null;
      done();
    } catch (error) { if (speechAbort === abort) { speechAbort = null; if (error.name !== 'AbortError') notice(error.message); if (started) done(); } }
  }
  
  
  // AI voice: the key goes in once, is verified, encrypted, and never comes back to a page.
  handle('bula:voice-status', () => ({ hasOpenAIKey: getSecrets().has('openai'), voices: tts.OPENAI_VOICES, models: tts.OPENAI_MODELS,
    kokoro: { installed: kokoro.installed(kokoroDir()), downloading: kokoroDownload !== null, voices: kokoro.VOICES }, edge: { voices: edgeTts.VOICES } }));
  // One model download at a time; progress streams to the settings panel, cancellable by quitting.
  handle('bula:kokoro-install', async () => {
    if (kokoro.installed(kokoroDir())) return { installed: true };
    if (kokoroDownload) return kokoroDownload;
    const send = (channel, value) => { if (getWin() && !getWin().isDestroyed()) getWin().webContents.send(channel, value); };
    let last = 0;
    kokoroDownload = kokoro.install(kokoroDir(), { onProgress: p => { if (p - last >= .01 || p === 1) { last = p; send('bula:kokoro-progress', p); } } })
      .then(() => ({ installed: true }))
      .finally(() => { kokoroDownload = null; });
    return kokoroDownload;
  });
  handle('bula:set-openai-key', async key => {
    // Remove whitespace a copy/paste can add, including inside the key.
    key = String(key || '').replace(/\s+/g, '');
    if (!tts.looksLikeOpenAIKey(key)) throw new Error('這看起來不是 OpenAI API key（應以 sk- 開頭，中間不含空格）。');
    // Verify with the permission the App actually needs: a one-word speech request (a fraction of a cent).
    try { await tts.openaiSpeech({ key, text: 'ok', voice: 'alloy', model: 'tts-1', base: openaiBase() }); }
    catch (error) {
      // 429 means OpenAI accepted the key; keep it so it works as soon as the account has credit.
      if (error.code) { getSecrets().set('openai', key); return { hasOpenAIKey: true, warning: `${error.message} key 已驗證並保存。` }; }
      throw new Error(`${error.message.replace(/請到 AI 設定重新輸入。/g, '')} key 尚未儲存。`);
    }
    getSecrets().set('openai', key);
    return { hasOpenAIKey: true };
  });
  handle('bula:clear-openai-key', () => { getSecrets().clear('openai'); return { hasOpenAIKey: false }; });
  handle('bula:preview-voice', data => { speak(String(data?.text || '').slice(0, 300), { voiceProvider: data?.voiceProvider, openaiVoice: data?.openaiVoice, openaiModel: data?.openaiModel, openaiStyle: data?.openaiStyle, kokoroVoice: data?.kokoroVoice, kokoroSpeed: data?.kokoroSpeed, edgeVoice: data?.edgeVoice, edgeRate: data?.edgeRate, volume: true }); return true; });
  const OPENAI_PAGES = { keys: 'https://platform.openai.com/api-keys', billing: 'https://platform.openai.com/settings/organization/billing/overview', usage: 'https://platform.openai.com/usage' };
  handle('bula:open-openai', page => { if (!OPENAI_PAGES[page]) throw new Error('Unknown page'); return shell.openExternal(OPENAI_PAGES[page]); });
  handle('bula:speak', text => { speak(String(text)); return true; });
  handle('bula:stop', stopSpeech);
  return { speak, stop: stopSpeech, isSpeaking: () => Boolean(speech || speechAbort) };
}
module.exports = { createSpeech };
