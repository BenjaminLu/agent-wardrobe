// Runs the Electron smoke tests one by one, each with a fresh .smoke-userdata, and prints a summary.
// Usage: npm run smoke            (offline set, as in CI on macOS, Windows and Linux; Linux needs a display: xvfb-run -a npm run smoke)
//        npm run smoke -- --all   (adds network and local-model checks when their inputs exist)
//        LLM_MODEL_SRC: a folder with llama-<tag>/ and qwen3.5-2b/{model,mmproj}.gguf
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const electron = require('electron');
const fakeMic = path.join(root, 'evidence', 'fake-mic.wav');
// the voice studio smoke records from Chromium's fake microphone playing generated "speech" (no real mic, no real voice)
const voicelabMic = path.join(require('node:os').tmpdir(), `voicelab-fake-mic-${process.pid}.wav`);
const suites = [
  { name: 'companion, marketplace, web wardrobe', args: [], marker: 'POC_SMOKE' },
  { name: 'phone characters: skins, edit, library, photo (stand-ins)', args: ['--remote-characters-smoke'], marker: 'REMOTE_CHARACTERS_SMOKE', env: { LIBRARY_FIXTURE: '1' } },
  { name: 'avatar store: featured, VRoid Hub, Sketchfab glTF, redraw a picture (fixture data)', args: ['--library-smoke'], marker: 'LIBRARY_SMOKE', env: { LIBRARY_FIXTURE: '1' } },
  { name: 'AI-assisted download: local stand-in site, zip with VRM + 利用規約, stand-in Codex reads the terms', args: ['--assisted-smoke'], marker: 'ASSISTED_SMOKE' },
  { name: 'Live2D, MMD and VRM motions: consent, stand-in Cubism Core, idle and reaction motions, previews', args: ['--models-smoke'], marker: 'MODELS_SMOKE', env: { LIVE2D_CORE_FIXTURE: '1' } },
  { name: 'character from a photo (stand-in Codex)', args: ['--person-smoke'], marker: 'PERSON_SMOKE' },
  { name: 'chat panel sizes', args: ['--chat-size-smoke'], marker: 'CHAT_SIZE_SMOKE' },
  { name: 'phone remote: pair, chat, revoke', args: ['--remote-smoke'], marker: 'REMOTE_SMOKE' },
  { name: '開發夥伴: list sessions, attach, spoken reply, approvals by button / voice / phone, interrupt, leave (stand-in claude + codex)', args: ['--devsession-smoke'], marker: 'DEVSESSION_SMOKE' },
  { name: 'close keeps running in the background', args: ['--background-smoke'], marker: 'BACKGROUND_SMOKE' },
  { name: 'interface languages: settings, marketplace, phone switch live to en / ja / zh-Hans / zh-Hant', args: ['--i18n-smoke'], marker: 'I18N_SMOKE' },
  { name: 'first-run guide', args: ['--onboarding-smoke'], marker: 'ONBOARDING_SMOKE' },
  { name: 'mod renderers (svg, png, vrm)', args: ['--mods-smoke'], marker: 'MODS_SMOKE' },
  { name: 'auto routing and reply language', args: ['--auto-smoke'], marker: 'AUTO_SMOKE' },
  { name: 'files window', args: ['--files-smoke'], marker: 'NATIVE_FILES_SMOKE' },
  { name: 'memory and input (write)', args: ['--memory-smoke-write'], marker: 'MEMORY_RESTART_SMOKE', keep: true },
  { name: 'memory and input (read after restart)', args: ['--memory-smoke-read'], marker: 'MEMORY_RESTART_SMOKE', reuse: true },
  { name: 'OpenAI voice (local stand-in)', args: ['--voice-smoke'], marker: 'VOICE_SMOKE' },
  { name: 'voice profiles: 萌系混音 bound to Annie, packs, phone (stand-in Kokoro)', args: ['--voices-smoke'], marker: 'VOICES_SMOKE', env: { VOICES_SMOKE_STANDIN: '1' } },
  { name: '聲音工作室: consent, fake-mic recording, stand-in CosyVoice, save + bind, phone 錄音做聲音', args: ['--voicelab-smoke'], marker: 'VOICELAB_SMOKE', env: { VOICE_SIDECAR_FIXTURE: '1', AGENT_WARDROBE_FAKE_MIC: voicelabMic }, prepare: () => fs.writeFileSync(voicelabMic, require('../test/fixtures/voice/make-audio.cjs').speechWav(12, { rate: 48000 })), cleanup: () => fs.rmSync(voicelabMic, { force: true }) },
  { name: 'Kokoro and Edge voices', args: ['--kokoro-smoke'], marker: 'KOKORO_SMOKE', needs: ['KOKORO_MODEL_SRC'], online: true },
  { name: 'game (stand-in decisions)', args: ['--game-smoke'], marker: 'GAME_SMOKE' },
  { name: 'game with Jev (stand-in API, encrypted key)', args: ['--game-smoke'], marker: 'GAME_SMOKE', env: { GAME_SMOKE_ENGINE: 'jev' } },
  { name: 'game with Laya', args: ['--game-smoke'], marker: 'GAME_SMOKE', env: { GAME_SMOKE_REAL: '1' }, file: require('../src/main/platform.cjs').venvPython(path.join(root, '.laya', 'venv')), online: true },
  { name: 'built-in local model', args: ['--builtin-smoke'], marker: 'BUILTIN_SMOKE', needs: ['LLM_MODEL_SRC'] },
  { name: 'wake word handing off to Typeless (real app, fake mic)', args: ['--typeless-smoke'], marker: 'TYPELESS_SMOKE', env: { AGENT_WARDROBE_FAKE_MIC: fakeMic }, file: '/Applications/Typeless.app', online: true, only: 'darwin', reason: 'Typeless is a Mac app driven by its Fn shortcut' },
  { name: 'wake word and dictation', args: ['--wake-smoke'], marker: 'WAKE_SMOKE', needs: ['ASR_MODEL_SRC'], env: { AGENT_WARDROBE_FAKE_MIC: fakeMic }, file: fakeMic },
  // computer-use input: macOS checks the helper answers; Windows and X11 really move, click, type (CJK), drag and scroll in a test window
  { name: 'computer-use input backend', args: ['--native-input-smoke'], marker: 'NATIVE_INPUT_SMOKE', file: { darwin: path.join(root, 'bin', 'native-input'), win32: path.join(root, 'bin', 'native-input.exe') }[process.platform] || '/usr/bin/xdotool' }
];
// A keep/reuse pair shares its profile and must restart together after a failure.
// failed counts final failed suites; retried records every retried unit's final outcome.
function runAll(suites, { spawn, rm, ci, log, summaryFile, userData }) {
  let failed = 0;
  const retried = [];
  for (let i = 0; i < suites.length; i++) {
    const unit = [suites[i]];
    if (suites[i].keep && suites[i + 1]?.reuse) unit.push(suites[++i]);
    for (let attempt = 1; attempt <= (ci ? 2 : 1); attempt++) {
      const unitStarted = Date.now();
      let attemptFailed = 0;
      for (const suite of unit) {
        if (!suite.reuse) rm(userData);
        const started = Date.now();
        suite.prepare?.();
        const run = spawn(suite);
        const output = `${run.stdout}\n${run.stderr}`;
        const ok = run.status === 0 && output.includes(suite.marker) && !output.includes('POC_SMOKE_FAILED');
        log(`${ok ? 'pass' : ci && attempt === 1 ? 'FAIL (attempt 1 of 2)' : 'FAIL'}  ${suite.name} (${Math.round((Date.now() - started) / 1000)} s)`);
        if (!ok) {
          attemptFailed++;
          // the failure itself first; GPU and system noise (WebGL, XPC) would otherwise fill the summary
          const lines = output.split('\n').filter(line => line.trim() && !/gl_utils|GL_CONTEXT_LOST|GL_OUT_OF_MEMORY|XPC error|IMKCF|TSM AdjustCapsLock/.test(line));
          const at = lines.findIndex(line => line.includes('POC_SMOKE_FAILED'));
          log(run.error?.code === 'ETIMEDOUT' || run.signal ? `  timed out after ${Math.round((Date.now() - started) / 1000)} s; last output:` : '');
          log((at >= 0 ? lines.slice(at, at + 14) : lines.slice(-14)).map(line => `  ${line.slice(0, 300)}`).join('\n'));
        }
        suite.cleanup?.();
        if (!suite.keep) rm(userData);
      }
      if (attempt === 2) {
        const names = unit.map(suite => suite.name).join(' + ');
        const passed = attemptFailed === 0;
        retried.push({ names, passed });
        if (passed) log(`pass on retry  ${names} (${Math.round((Date.now() - unitStarted) / 1000)} s)`);
        if (summaryFile) fs.appendFileSync(summaryFile, `- ${passed ? 'passed on retry' : 'failed twice'}: ${names}\n`);
      }
      if (!attemptFailed || !ci || attempt === 2) {
        failed += attemptFailed;
        break;
      }
    }
  }
  const recovered = retried.filter(unit => unit.passed).map(unit => unit.names);
  const suffix = recovered.length ? ` (${recovered.length} passed on retry: ${recovered.join(', ')})` : '';
  log((failed ? `${failed} smoke suite(s) failed` : 'all smoke suites passed') + suffix);
  return { code: failed ? 1 : 0, failed, retried };
}

module.exports = { runAll, suites };

if (require.main === module) {
  const all = process.argv.includes('--all');
  const runnable = [];
  for (const suite of suites) {
    // suites that test something only one platform has are skipped elsewhere, with the reason
    if (suite.only && suite.only !== process.platform) { console.log(`skip  ${suite.name} (${suite.only} only: ${suite.reason})`); continue; }
    const missing = (suite.needs || []).filter(name => !process.env[name]).concat(suite.file && !fs.existsSync(suite.file) ? [path.relative(root, suite.file)] : []);
    if ((suite.online || suite.needs) && !all) { console.log(`skip  ${suite.name} (run with --all)`); continue; }
    if (missing.length) { console.log(`skip  ${suite.name} (needs ${missing.join(', ')})`); continue; }
    runnable.push(suite);
  }
  const { code } = runAll(runnable, {
    spawn: suite => {
      // suites read zh-Hant labels, so they pin the interface language; the i18n suite switches it itself
      const language = suite.args.includes('--i18n-smoke') ? [] : ['--ui-language=zh-Hant'];
      const run = spawnSync(electron, ['.', '--smoke-test', ...language, ...suite.args], { cwd: root, env: { ...process.env, ...suite.env }, encoding: 'utf8', timeout: (suite.minutes || (suite.online || suite.needs ? 10 : 4)) * 60 * 1000 });  // a stuck suite fails in minutes, not after CI's own limit
      return run;
    },
    rm: userData => fs.rmSync(userData, { recursive: true, force: true }),
    ci: !!process.env.CI,
    log: console.log,
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
    userData: path.join(root, '.smoke-userdata')
  });
  process.exit(code);
}
