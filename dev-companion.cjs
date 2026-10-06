// 開發夥伴: the companion becomes one of the user's existing Claude Code / Codex sessions. Typed and spoken messages
// go to that session, its replies are spoken (made speakable), its tool activity drives the character, and its
// permission requests become a card plus a spoken question answered only by the user (button, typing or voice).
// Nothing is sent to the session that the user did not type or say; nothing is ever approved without them.
const devSessions = require('./dev-sessions.cjs');
const { createAdapter: makeAdapter, listCodexThreads } = require('./dev-session.cjs');
const { speakable, describeTool, StatusVoice, describeApproval, parseApprovalAnswer, isStopCommand } = require('./dev-speech.cjs');

const ENGINE_NAMES = { claude: 'Claude', codex: 'Codex' };
function createDevCompanion({ getWin, getRuntime, speak, stopSpeech, isSpeaking = () => false, getSettings, persist, remoteEvent = () => {}, findBinary, home, codexHome, canAttach = () => null, onAttention = () => {},
  createAdapter = makeAdapter, listSessions = devSessions.listSessions, codexList = null, processes = undefined, now = () => Date.now() }) {
  let adapter = null, info = null, busy = false, lastFrom = null, cache = null, interrupting = false;
  const pending = new Map(), voice = new StatusVoice({ now });
  // home folders may be given as functions (smoke runs set theirs after start-up)
  const homes = () => ({ home: typeof home === 'function' ? home() : home, codexHome: typeof codexHome === 'function' ? codexHome() : codexHome });
  const zh = () => String(getSettings().language || 'zh').startsWith('zh');
  const lang = () => getSettings().language;
  const activity = (value, emotion) => { try { getRuntime()?.activity(value, emotion); } catch {} };
  function emit(event) {
    if (event.type !== 'delta' && !event.state) event = { ...event, state: snapshot() };  // pages keep busy / pending in step
    const win = getWin(); if (win && !win.isDestroyed()) win.webContents.send('bula:dev', event);
    if (event.type !== 'delta') remoteEvent('dev', event);
  }
  const say = text => { if (text && lastFrom !== 'phone') speak(text); };
  function snapshot() {
    const saved = getSettings().devSession;
    return { attached: info ? { ...info } : null, busy, pending: [...pending.values()], offer: !info && saved?.engine && saved?.id ? { ...saved } : null,
      resumeCommand: info ? resumeCommand(info) : null };
  }
  const resumeCommand = s => s.engine === 'claude' ? `claude --resume ${s.sessionId || s.id}` : `codex resume ${s.sessionId || s.id}`;
  const publicSession = s => ({ engine: s.engine, id: s.id, cwd: s.cwd, project: s.project, title: s.title, updatedAt: s.updatedAt, size: s.size, turns: s.turns, maybeOpen: s.maybeOpen, openReasons: s.openReasons, permissionMode: s.permissionMode || null });

  async function sessions() {
    const list = await listSessions({ ...homes(), codexList: codexList || (options => listCodexThreads({ findBinary, ...options })), ...(processes ? { processes } : {}) });
    cache = list; return list.map(publicSession);
  }
  async function lookup(engine, id) {
    const found = (cache && devSessions.findSession(cache, engine, id)) || devSessions.lookupSession({ ...homes(), engine, id });
    if (found) return found;
    await sessions(); return devSessions.findSession(cache, engine, id);
  }
  async function attach({ engine, id, askUser = Boolean(getSettings().devCodexAskMe) } = {}) {
    if (!ENGINE_NAMES[engine] || typeof id !== 'string' || !/^[0-9a-zA-Z-]{8,80}$/.test(id)) throw new Error(zh() ? '不認得這個工作階段。' : 'Unknown session.');
    const blocked = canAttach(); if (blocked) throw new Error(blocked);
    const session = await lookup(engine, id);
    if (!session) throw new Error(zh() ? '找不到這個工作階段（檔案可能被搬走或刪掉了）。' : 'That session could not be found.');
    if (adapter) leave({ quiet: true });
    if (getSettings().devCodexAskMe !== Boolean(askUser)) { getSettings().devCodexAskMe = Boolean(askUser); persist(); }
    const next = createAdapter(engine, { id, cwd: session.cwd, mode: session.permissionMode, askUser: engine === 'codex' && Boolean(askUser), findBinary, env: process.env });
    adapter = next; busy = false; pending.clear(); interrupting = false;
    info = { engine, id, sessionId: id, cwd: session.cwd, project: session.project, title: session.title, maybeOpen: session.maybeOpen, mode: null, engineName: ENGINE_NAMES[engine] };
    next.on('event', event => { if (adapter === next) handle(event); });
    try { await next.start(); }
    catch (error) { if (adapter === next) { adapter = null; info = null; } try { next.close(); } catch {} emit({ type: 'state', state: snapshot() }); throw error; }
    if (adapter !== next) throw new Error(zh() ? '已經離開了。' : 'Left already.');
    getSettings().devSession = { engine, id: info.sessionId, cwd: info.cwd, project: info.project, title: info.title, at: now() }; persist();
    activity('idle', 'happy');
    emit({ type: 'attached', state: snapshot() });
    return snapshot();
  }
  function handle(event) {
    const z = zh();
    if (event.type === 'ready') {
      if (event.mode) info.mode = event.mode; if (event.reviewer) info.reviewer = event.reviewer;
      emit({ type: 'state', state: snapshot() }); return;
    }
    if (event.type === 'notice' && event.text === 'session-forked') {
      info.sessionId = event.sessionId; if (getSettings().devSession) { getSettings().devSession.id = event.sessionId; persist(); }
      emit({ type: 'notice', text: z ? `Claude 把這段對話接成了新的工作階段 ${event.sessionId}。` : `Claude continued this as a new session ${event.sessionId}.` }); return;
    }
    if (event.type === 'delta') { emit({ type: 'delta', text: event.text }); return; }
    if (event.type === 'progress') { emit({ type: 'progress', text: event.text }); return; }
    if (event.type === 'tool' && event.phase === 'start') {
      const tool = describeTool(event.name, event.input, { language: lang() });
      if (!pending.size) activity('working', 'smug');
      emit({ type: 'tool', label: tool.label, kind: tool.kind });
      const line = voice.offer(tool, { speaking: isSpeaking() || pending.size > 0 }); if (line) say(line);
      return;
    }
    if (event.type === 'approval') {
      const desc = describeApproval({ tool: event.tool, input: event.input, codex: event.codex }, { language: lang() });
      const approval = { requestId: event.requestId, tool: event.tool, ...desc, at: now() };
      pending.set(event.requestId, approval);
      activity('waiting_for_approval', 'surprised');
      emit({ type: 'approval', approval });
      onAttention();  // a companion hidden in the background comes back for the question
      say(desc.question);
      return;
    }
    if (event.type === 'approval-closed') {
      if (pending.delete(event.requestId)) emit({ type: 'resolved', requestId: event.requestId, result: 'withdrawn' });
      if (!pending.size && busy) activity('working'); return;
    }
    if (event.type === 'message') {
      const spoken = speakable(event.text, { language: lang() });
      emit({ type: 'reply', text: event.text, spoken });
      say(spoken); return;
    }
    if (event.type === 'turn') {
      busy = false; for (const id of [...pending.keys()]) { pending.delete(id); emit({ type: 'resolved', requestId: id, result: 'withdrawn' }); }
      const status = interrupting ? 'interrupted' : event.status; interrupting = false;
      activity(status === 'completed' ? 'success' : status === 'interrupted' ? 'idle' : 'error', status === 'completed' ? 'happy' : status === 'failed' ? 'nervous' : 'neutral');
      emit({ type: 'turn', status, error: event.error || null });
      if (status === 'interrupted') say(z ? '好，停下來了。' : 'Okay, stopped.');
      else if (status === 'failed') say(z ? '這一輪沒有完成，細節在聊天框。' : 'That turn did not finish; details are in the chat.');
      return;
    }
    if (event.type === 'error') { emit({ type: 'error', message: event.message }); return; }
  }
  // A typed or spoken message. While an approval is pending, only an answer (or 停下來) is accepted.
  // source: 'desktop' or 'phone'; device: the phone's id, so the remote server does not echo a phone's own line back to it
  function input(text, { source = 'desktop', device = null } = {}) {
    const z = zh();
    if (!adapter) return { ok: false, error: z ? '還沒有接入工作階段。' : 'No session attached.' };
    text = String(text || '').trim();
    if (!text || text.length > 8000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return { ok: false, error: z ? '訊息不能是空的或太長。' : 'Invalid message.' };
    if (isStopCommand(text) && (busy || pending.size)) { interrupt(); return { ok: true, interrupted: true }; }
    if (pending.size) {
      const answer = parseApprovalAnswer(text);
      if (answer) { const first = [...pending.keys()][0]; respond(first, answer === 'allow', { source, how: 'words' }); return { ok: true, answered: answer }; }
      say(z ? '請說允許或拒絕。' : 'Please say allow or deny.');
      return { ok: false, waiting: true, error: z ? '還在等你決定：說「允許」或「拒絕」，或按卡片上的按鈕。' : 'Waiting for your decision: say “allow” or “deny”, or use the buttons.' };
    }
    if (busy) return { ok: false, busy: true, error: z ? '我還在處理上一句；要打斷可以說「停下來」。' : 'Still working on the last one; say “stop” to interrupt.' };
    try { adapter.send(text); } catch (error) { return { ok: false, error: error.code === 'BUSY' ? (z ? '我還在處理上一句。' : 'Still working.') : error.message }; }
    busy = true; lastFrom = source; voice.turn(); stopSpeech();
    activity('working', 'neutral');
    emit({ type: 'user', text, source, ...(device ? { from: device } : {}) });
    return { ok: true, sent: true };
  }
  // The user's decision on one request: from the card's buttons (desktop or phone) or their words.
  function respond(requestId, allow, { source = 'desktop', how = 'button' } = {}) {
    if (!adapter || !pending.has(requestId)) return { ok: false, error: zh() ? '這個請求已經不在了。' : 'That request is gone.' };
    const done = allow ? adapter.approve(requestId) : adapter.deny(requestId, 'The user denied this.');
    pending.delete(requestId);
    stopSpeech();
    emit({ type: 'resolved', requestId, result: allow ? 'allowed' : 'denied', source, how });
    if (!pending.size) activity(busy ? 'working' : 'idle');
    return { ok: done !== false };
  }
  function interrupt() {
    if (!adapter || (!busy && !pending.size)) return { ok: false };
    interrupting = true;
    for (const id of [...pending.keys()]) { adapter.deny(id, 'The user interrupted.'); pending.delete(id); emit({ type: 'resolved', requestId: id, result: 'denied', how: 'interrupt' }); }
    stopSpeech(); adapter.interrupt();
    emit({ type: 'interrupting' });
    return { ok: true };
  }
  // Leaving ends this app's connection only; the session stays on disk and can be resumed in a terminal later.
  function leave({ quiet = false, keep = false } = {}) {
    const was = info;
    if (adapter) { const a = adapter; adapter = null; try { a.close(); } catch {} }
    info = null; busy = false; pending.clear(); interrupting = false;
    if (!keep) { delete getSettings().devSession; persist(); }
    if (!quiet) { activity('idle'); emit({ type: 'left', state: snapshot(), resumeCommand: was ? resumeCommand(was) : null, project: was?.project || null }); }
    return snapshot();
  }
  function dismissOffer() { delete getSettings().devSession; persist(); emit({ type: 'state', state: snapshot() }); return snapshot(); }
  // App quit: close the connection but remember the session, so the next start can offer to reconnect.
  function close() { leave({ quiet: true, keep: true }); }
  return { sessions, attach, input, respond, interrupt, leave, dismissOffer, close, snapshot, get attached() { return Boolean(adapter); }, get busy() { return busy; }, get adapter() { return adapter; } };
}
module.exports = { createDevCompanion, ENGINE_NAMES };
