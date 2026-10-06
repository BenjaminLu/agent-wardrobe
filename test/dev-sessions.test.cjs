// 開發夥伴 session discovery: Claude Code jsonl and Codex rollouts from a fixture home, and the "still open" heuristic.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dev = require('../src/main/dev-sessions.cjs');
const { makeHome, IDS } = require('./fixtures/dev/make-home.cjs');

function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-sessions-')); return { root, ...makeHome(root) }; }

test('Claude sessions: cwd from the records, titles, newest first, subagent and sidechain files skipped', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const list = await dev.listSessions({ home: f.home, processes: [], engines: ['claude'] });
  assert.deepEqual(list.map(s => s.id), [IDS.beta, IDS.alpha, IDS.meta], 'newest first; agent-*.jsonl and the sidechain-only file are not sessions');
  const [beta, alpha, meta] = list;
  assert.equal(alpha.cwd, f.alpha, 'the folder comes from the records, not the encoded directory name');
  assert.equal(alpha.project, 'alpha');
  assert.equal(alpha.title, '登入頁錯誤訊息', 'an AI title wins over the first prompt');
  assert.equal(alpha.permissionMode, 'acceptEdits');
  assert.equal(beta.title, '把 README 的安裝步驟補完整', 'slash-command wrappers are not the title');
  assert.equal(meta.title, 'Delta cleanup', 'a custom title wins');
  assert.equal(alpha.turns, 1);
  assert.ok(alpha.size > 0 && alpha.updatedAt > 0);
});

test('Codex sessions from rollouts: first real prompt or index name, exec runs skipped; or from thread/list', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const fromFiles = await dev.listSessions({ home: f.home, processes: [], engines: ['codex'] });
  assert.deepEqual(fromFiles.map(s => [s.id, s.cwd, s.title]), [[IDS.codex, f.gamma, 'gamma 單元測試']], 'the exec run is left out');
  // without a thread name, the first prompt that is not injected context
  fs.rmSync(path.join(f.home, '.codex', 'session_index.jsonl'));
  assert.equal((await dev.listSessions({ home: f.home, processes: [], engines: ['codex'] }))[0].title, '幫 gamma 加上單元測試');
  // the app-server's list is preferred when it answers; a failure falls back to the files
  const viaServer = await dev.listSessions({ home: f.home, processes: [], engines: ['codex'], codexList: async () => [{ ...f.threads[0], name: 'from the server' }, { id: 'sub', cwd: f.gamma, parentThreadId: IDS.codex }] });
  assert.deepEqual(viaServer.map(s => s.title), ['from the server'], 'subagent threads are left out');
  const fallback = await dev.listSessions({ home: f.home, processes: [], engines: ['codex'], codexList: async () => { throw new Error('no app-server'); } });
  assert.equal(fallback[0].id, IDS.codex);
});

test('only the head and tail of a big session file are read', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const file = path.join(f.home, '.claude', 'projects', f.alpha.replace(/[^a-zA-Z0-9]/g, '-'), `${IDS.alpha}.jsonl`);
  const filler = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'y'.repeat(2000) }] }, cwd: f.alpha, sessionId: IDS.alpha }) + '\n';
  fs.appendFileSync(file, filler.repeat(1500)); fs.appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: 'renamed at the end', sessionId: IDS.alpha }) + '\n');
  const reads = []; const original = fs.readSync; fs.readSync = (...args) => { reads.push(args[2]); return original(...args); };
  try { const s = dev.readClaude({ engine: 'claude', id: IDS.alpha, file, size: fs.statSync(file).size, mtime: Date.now() }); assert.equal(s.title, 'renamed at the end'); assert.equal(s.turns, null, 'turns are not counted from a partial read'); }
  finally { fs.readSync = original; }
  assert.ok(reads.reduce((a, b) => a + b, 0) < 600 * 1024, `read ${reads.reduce((a, b) => a + b, 0)} bytes of ${fs.statSync(file).size}`);
});

test('"possibly still open": recent writes, a process naming the session, or the newest session in a running tool\'s folder', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const ps = `  100     1 /usr/local/bin/claude --resume ${IDS.alpha}\n  200     1 node /opt/node_modules/@openai/codex/bin/codex.js\n  300     1 /Applications/Claude.app/Contents/MacOS/Claude\n  400  4242 claude --resume ${IDS.meta}\n  401   400 /bin/zsh\n`;
  const processes = dev.parsePs(ps, { self: 4242 }).map(p => ({ ...p, cwd: p.pid === 200 ? f.gamma : null }));
  assert.deepEqual(processes.map(p => [p.pid, p.engine]), [[100, 'claude'], [200, 'codex']], 'the desktop app and this app\'s own children are not terminals');
  const list = await dev.listSessions({ home: f.home, processes, engines: ['claude', 'codex'] });
  const by = id => list.find(s => s.id === id);
  assert.deepEqual(by(IDS.beta).openReasons, ['recent']);
  assert.deepEqual(by(IDS.alpha).openReasons, ['process']);
  assert.deepEqual(by(IDS.codex).openReasons, ['folder']);
  assert.equal(by(IDS.meta).maybeOpen, false);
  assert.equal(dev.engineOf('/Users/x/.local/bin/claude -p'), 'claude');
  assert.equal(dev.engineOf('/opt/homebrew/bin/codex resume'), 'codex');
  assert.equal(dev.engineOf('/usr/bin/vim claude.md'), null);
});

test('a saved session is found by id even when it is not in the recent list', async t => {
  const f = fixture(); t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  assert.equal(dev.lookupSession({ home: f.home, engine: 'claude', id: IDS.meta }).title, 'Delta cleanup');
  assert.equal(dev.lookupSession({ home: f.home, engine: 'codex', id: IDS.codex }).cwd, f.gamma);
  assert.equal(dev.lookupSession({ home: f.home, engine: 'claude', id: '00000000-0000-4000-8000-000000000000' }), null);
});
