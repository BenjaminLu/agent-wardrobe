// A fixture home for 開發夥伴: Claude Code projects and Codex rollouts shaped like the real ones (2.1.x / 0.159.x),
// plus files that must be skipped (subagent transcripts, sidechain-only files, `codex exec` runs).
const fs = require('node:fs');
const path = require('node:path');
const IDS = { alpha: '11111111-2222-4333-8444-555555555555', beta: '66666666-7777-4888-9999-aaaaaaaaaaaa', meta: '12121212-3434-4565-8787-909090909090', side: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', codex: '01a10000-0000-7000-8000-00000000c0de', exec: '01a10000-0000-7000-8000-0000000e0e0e' };
const lines = records => records.map(r => JSON.stringify(r)).join('\n') + '\n';
const touch = (file, ms) => { const t = new Date(ms); fs.utimesSync(file, t, t); };
function makeHome(root, { now = Date.now() } = {}) {
  const home = path.join(root, 'home'), projects = path.join(root, 'projects');
  const cwd = name => { const dir = path.join(projects, name); fs.mkdirSync(dir, { recursive: true }); return dir; };
  const alpha = cwd('alpha'), beta = cwd('beta'), gamma = cwd('gamma'), delta = cwd('delta');
  const claudeDir = dir => { const d = path.join(home, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-')); fs.mkdirSync(d, { recursive: true }); return d; };
  const base = (id, dir) => ({ sessionId: id, cwd: dir, version: '2.1.290', gitBranch: 'main', userType: 'external', entrypoint: 'cli' });
  // alpha: an older session with an AI title and a permission mode
  let file = path.join(claudeDir(alpha), `${IDS.alpha}.jsonl`);
  fs.writeFileSync(file, lines([{ type: 'permission-mode', permissionMode: 'acceptEdits', sessionId: IDS.alpha },
    { type: 'user', isSidechain: false, message: { role: 'user', content: '幫我把登入頁的錯誤訊息改清楚一點' }, uuid: 'u1', timestamp: new Date(now - 3600e3).toISOString(), permissionMode: 'acceptEdits', ...base(IDS.alpha, alpha) },
    { type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: '好，我來改。' }] }, uuid: 'a1', ...base(IDS.alpha, alpha) },
    { type: 'ai-title', aiTitle: '登入頁錯誤訊息', sessionId: IDS.alpha }]));
  touch(file, now - 20 * 60e3);
  // a subagent transcript in the same folder: not a session of its own
  fs.writeFileSync(path.join(claudeDir(alpha), 'agent-a1b2c3.jsonl'), lines([{ type: 'user', isSidechain: true, message: { role: 'user', content: 'subtask' }, ...base(IDS.alpha, alpha) }]));
  // beta: written a minute ago (may still be open in a terminal); the first prompt is a slash command wrapper
  file = path.join(claudeDir(beta), `${IDS.beta}.jsonl`);
  fs.writeFileSync(file, lines([{ type: 'user', isMeta: true, message: { role: 'user', content: '<command-name>/clear</command-name>' }, ...base(IDS.beta, beta) },
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '把 README 的安裝步驟補完整' }] }, ...base(IDS.beta, beta) },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '好' }] }, ...base(IDS.beta, beta) }]));
  touch(file, now - 60e3);
  // meta: custom title wins over the first prompt
  file = path.join(claudeDir(delta), `${IDS.meta}.jsonl`);
  fs.writeFileSync(file, lines([{ type: 'user', message: { role: 'user', content: 'hello' }, ...base(IDS.meta, delta) }, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, ...base(IDS.meta, delta) }, { type: 'custom-title', customTitle: 'Delta cleanup', sessionId: IDS.meta }]));
  touch(file, now - 5 * 3600e3);
  // a sidechain-only file is skipped
  file = path.join(claudeDir(delta), `${IDS.side}.jsonl`);
  fs.writeFileSync(file, lines([{ type: 'user', isSidechain: true, message: { role: 'user', content: 'side' }, ...base(IDS.side, delta) }]));
  touch(file, now - 30e3);
  // Codex: a CLI thread (named in session_index.jsonl) and an exec run that is skipped
  const day = path.join(home, '.codex', 'sessions', '2026', '10', '05'); fs.mkdirSync(day, { recursive: true });
  file = path.join(day, `rollout-2026-10-05T10-00-00-${IDS.codex}.jsonl`);
  fs.writeFileSync(file, lines([{ timestamp: new Date(now - 7200e3).toISOString(), type: 'session_meta', payload: { id: IDS.codex, session_id: IDS.codex, cwd: gamma, originator: 'codex_cli_rs', cli_version: '0.159.3', source: 'cli', thread_source: 'user', base_instructions: { text: 'x'.repeat(5000) } } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/x</cwd>\n</environment_context>' }] } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '幫 gamma 加上單元測試' }] } }]));
  touch(file, now - 40 * 60e3);
  fs.writeFileSync(path.join(home, '.codex', 'session_index.jsonl'), lines([{ id: IDS.codex, thread_name: 'gamma 單元測試', updated_at: new Date(now).toISOString() }]));
  file = path.join(day, `rollout-2026-10-05T11-00-00-${IDS.exec}.jsonl`);
  fs.writeFileSync(file, lines([{ type: 'session_meta', payload: { id: IDS.exec, cwd: gamma, source: 'exec', cli_version: '0.159.3' } }]));
  touch(file, now - 10 * 60e3);
  return { home, projects, alpha, beta, gamma, delta, ids: IDS,
    // what the stand-in app-server's thread/list answers (the shape of a v2 Thread)
    threads: [{ id: IDS.codex, sessionId: IDS.codex, forkedFromId: null, parentThreadId: null, preview: '幫 gamma 加上單元測試', ephemeral: false, modelProvider: 'openai', model: null, createdAt: Math.round((now - 7200e3) / 1000), updatedAt: Math.round((now - 40 * 60e3) / 1000), status: { type: 'notLoaded' }, path: file.replace(IDS.exec, IDS.codex).replace('T11-00-00', 'T10-00-00'), cwd: gamma, cliVersion: '0.159.3', source: 'cli', name: 'gamma 單元測試', turns: [] }] };
}
module.exports = { makeHome, IDS };
