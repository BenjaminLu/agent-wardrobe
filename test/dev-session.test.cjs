// 開發夥伴 adapters: stream-json mapping, the Claude permission tool round trip (stand-in claude + the real
// permission-mcp.cjs + the app's socket bridge), and Codex approval requests with a stand-in app-server.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');
const { ClaudeAdapter, CodexAdapter, PermissionBridge, mapClaude, claudeArgs } = require('../dev-session.cjs');
const { fakeBin } = require('../scripts/fake-bin.cjs');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-adapter-')), project = path.join(dir, 'project'), log = path.join(dir, 'log.jsonl');
  fs.mkdirSync(project);
  const bins = { claude: fakeBin(dir, 'claude', path.join(__dirname, 'fixtures', 'dev', 'fake-claude.cjs')), codex: fakeBin(dir, 'codex', path.join(__dirname, 'fixtures', 'dev', 'fake-codex.cjs')) };
  const env = { ...process.env, DEV_FAKE_LOG: log };
  const adapters = [];
  t.after(() => { for (const a of adapters) a.close(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 500); });
  const make = (Kind, options) => { const a = new Kind({ cwd: project, findBinary: name => bins[name], env, ...options }); adapters.push(a); return a; };
  const entries = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { dir, project, make, entries };
}
const next = (adapter, type, filter = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no ${type} event`)), 15000);
  const listener = event => { if (event.type === type && filter(event)) { clearTimeout(timer); adapter.off('event', listener); resolve(event); } };
  adapter.on('event', listener);
});

test('stream-json lines map to the shared events', () => {
  const state = {};
  assert.deepEqual(mapClaude({ type: 'system', subtype: 'init', session_id: 's1', cwd: '/p', permissionMode: 'default', mcp_servers: [{ name: 'wardrobe_permission', status: 'connected' }] }, state)[0], { type: 'ready', sessionId: 's1', cwd: '/p', mode: 'default', permissionTool: 'connected', model: null });
  assert.deepEqual(mapClaude({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } }, state), [{ type: 'delta', text: 'Hel' }]);
  assert.deepEqual(mapClaude({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } } }, state), []);
  assert.deepEqual(mapClaude({ type: 'assistant', parent_tool_use_id: 'toolu_x', message: { content: [{ type: 'tool_use', id: 'sub', name: 'Bash', input: {} }] } }, state), [], 'a subagent\'s own tools are not shown');
  const tool = mapClaude({ type: 'assistant', message: { content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }, state);
  assert.deepEqual(tool.map(e => e.type), ['progress', 'tool']); assert.equal(tool[1].name, 'Bash');
  assert.deepEqual(mapClaude({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }, state), [{ type: 'tool', phase: 'end', id: 't1', name: 'Bash', error: true }]);
  assert.deepEqual(mapClaude({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's1' }, state).map(e => [e.type, e.text || e.status]), [['message', 'Done.'], ['turn', 'completed']]);
  assert.deepEqual(mapClaude({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'too many', session_id: 's1' }, state).map(e => [e.type, e.status, e.error]), [['turn', 'failed', 'too many']]);
  state.interrupting = true;
  assert.deepEqual(mapClaude({ type: 'result', subtype: 'error_during_execution', is_error: true }, state).map(e => [e.type, e.status, e.error]), [['turn', 'interrupted', null]]);
});
test('claude is resumed in place with the permission tool and never with skipped permissions', () => {
  const args = claudeArgs({ id: 'abc', mode: 'acceptEdits', mcpConfig: '/tmp/m.json' });
  assert.deepEqual(args.slice(0, 3), ['-p', '--resume', 'abc']);
  assert.ok(!args.includes('--fork-session') && !args.includes('--dangerously-skip-permissions'));
  assert.equal(args[args.indexOf('--permission-prompt-tool') + 1], 'mcp__wardrobe_permission__approve');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits', 'the session\'s own mode');
  assert.ok(!claudeArgs({ id: 'abc', mode: 'bypassPermissions', mcpConfig: 'x' }).includes('--permission-mode'), 'a bypass session is resumed in the normal asking mode');
});

test('Claude: permission tool round trip through the MCP server, allow and deny, then interrupt', async t => {
  const { project, make, entries } = setup(t);
  const a = make(ClaudeAdapter, { id: '11111111-2222-4333-8444-555555555555', mode: 'acceptEdits' });
  await a.start();
  // a plain turn: streamed deltas, then the final message
  let deltas = ''; a.on('event', e => { if (e.type === 'delta') deltas += e.text; });
  let done = next(a, 'turn'); let reply = next(a, 'message'); a.send('你好');
  assert.equal((await done).status, 'completed'); assert.match((await reply).text, /收到：你好/); assert.match(deltas, /收到：你好/);
  // an approval: the request reaches the app with the tool and input; allow writes the file with the original input
  let approval = next(a, 'approval'); done = next(a, 'turn'); a.send('建立一個檔案');
  const request = await approval;
  assert.equal(request.tool, 'Write'); assert.equal(request.input.file_path, 'hello.txt');
  assert.throws(() => a.send('another'), /busy/, 'one turn at a time');
  assert.ok(a.approve(request.requestId)); assert.equal((await done).status, 'completed');
  assert.equal(fs.readFileSync(path.join(project, 'hello.txt'), 'utf8'), 'hi from the companion\n');
  // deny
  approval = next(a, 'approval'); done = next(a, 'turn'); reply = next(a, 'message'); a.send('跑測試');
  a.deny((await approval).requestId, 'No thanks'); await done;
  assert.match((await reply).text, /先不跑/);
  const decisions = entries().filter(e => e.decision).map(e => e.decision);
  assert.deepEqual(decisions[0], { behavior: 'allow', updatedInput: { file_path: 'hello.txt', content: 'hi from the companion\n' } });
  assert.deepEqual(decisions[1], { behavior: 'deny', message: 'No thanks' });
  // interrupt a running turn
  done = next(a, 'turn'); a.send('慢慢來'); await new Promise(r => setTimeout(r, 300));
  assert.ok(a.interrupt()); assert.equal((await done).status, 'interrupted');
  assert.ok(entries().some(e => e.stdin?.type === 'control_request' && e.stdin.request.subtype === 'interrupt'));
  // every claude start resumed the same session with the session's own permission mode
  const starts = entries().filter(e => e.bin === 'claude' && e.args);
  assert.equal(starts.length, 1, 'one process for all turns');
  assert.equal(starts[0].args[starts[0].args.indexOf('--resume') + 1], '11111111-2222-4333-8444-555555555555');
  assert.equal(starts[0].args[starts[0].args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(starts[0].cwd, fs.realpathSync(project));
  // leaving ends the process tree and withdraws nothing silently
  const pid = a.pid; a.close(); await new Promise(r => setTimeout(r, 800));
  assert.throws(() => process.kill(pid, 0), 'the claude process is gone');
});

test('the permission bridge only accepts its own token and denies when the app is gone', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-bridge-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bridge = new PermissionBridge({ dir }); const file = await bridge.listen(); const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const requests = []; bridge.on('request', r => requests.push(r));
  const talk = line => new Promise(resolve => { const s = net.connect(config.socket); let data = ''; s.on('connect', () => s.write(line + '\n')); s.on('data', d => { data += d; }); s.on('close', () => resolve(data)); s.on('error', () => resolve(data)); setTimeout(() => s.destroy(), 300); });
  assert.equal(await talk(JSON.stringify({ token: 'wrong', tool_name: 'Bash', input: {} })), '', 'a wrong token is dropped');
  assert.equal(requests.length, 0);
  // the MCP helper with the app unreachable: an explicit deny, never an allow
  bridge.close();
  const { spawn } = require('node:child_process');
  const helper = spawn(process.execPath, [path.join(__dirname, '..', 'permission-mcp.cjs'), file], { stdio: ['pipe', 'pipe', 'inherit'] });
  const answer = await new Promise(resolve => { let out = ''; helper.stdout.on('data', d => { out += d; if (out.includes('\n')) resolve(JSON.parse(out.split('\n')[0])); }); helper.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: { command: 'rm -rf /' } } } }) + '\n'); });
  helper.kill();
  assert.equal(JSON.parse(answer.result.content[0].text).behavior, 'deny');
});

test('Codex: thread/resume keeps the thread settings; approval requests wait for the user; unknown requests are declined', async t => {
  const { make, entries } = setup(t);
  const a = make(CodexAdapter, { id: '01a10000-0000-7000-8000-00000000c0de' });
  const ready = next(a, 'ready'); await a.start(); const info = await ready;
  assert.equal(info.mode, 'on-request'); assert.equal(info.reviewer, 'auto_review');
  const resume = entries().find(e => e.stdin?.method === 'thread/resume').stdin.params;
  assert.deepEqual(Object.keys(resume).sort(), ['excludeTurns', 'threadId'], 'no sandbox, approval or model overrides');
  // a plain turn
  let reply = next(a, 'message'), done = next(a, 'turn'); a.send('hello');
  assert.equal((await reply).text, 'Codex 收到：hello'); assert.equal((await done).status, 'completed');
  // a command approval: shown with the command, answered accept
  let approval = next(a, 'approval'); done = next(a, 'turn'); reply = next(a, 'message'); a.send('跑測試');
  const request = await approval;
  assert.equal(request.codex.kind, 'command'); assert.equal(request.codex.command, 'npm test');
  await new Promise(r => setTimeout(r, 200));
  assert.ok(!entries().some(e => e.decision !== undefined), 'nothing is answered before the user decides');
  assert.ok(a.approve(request.requestId)); await done;
  assert.match((await reply).text, /測試通過/);
  // a file change, declined
  approval = next(a, 'approval'); done = next(a, 'turn'); a.send('改一下');
  const files = await approval; assert.equal(files.codex.kind, 'files'); assert.match(files.codex.changes[0].path, /src\/app\.js$/); assert.match(files.codex.changes[0].diff, /\+new line/);
  a.deny(files.requestId); await done;
  const log = entries();
  assert.deepEqual(log.filter(e => e.decision !== undefined).map(e => e.decision), ['accept', 'decline']);
  assert.equal(log.find(e => e.unsupported).unsupported.error.code, -32601, 'a user-input request is declined');
  // interrupt
  done = next(a, 'turn'); a.send('慢慢做'); await new Promise(r => setTimeout(r, 300)); a.interrupt();
  assert.equal((await done).status, 'interrupted');
  assert.ok(entries().some(e => e.stdin?.method === 'turn/interrupt'));
  const pid = a.pid; a.close(); await new Promise(r => setTimeout(r, 800));
  assert.throws(() => process.kill(pid, 0), 'the app-server is gone');
});

test('Codex: the user can choose to answer approvals themselves instead of Codex\'s automatic reviewer', async t => {
  const { make, entries } = setup(t);
  const a = make(CodexAdapter, { id: '01a10000-0000-7000-8000-00000000c0de', askUser: true });
  const ready = next(a, 'ready'); await a.start();
  assert.equal((await ready).reviewer, 'user');
  assert.equal(entries().find(e => e.stdin?.method === 'thread/resume').stdin.params.approvalsReviewer, 'user');
});
