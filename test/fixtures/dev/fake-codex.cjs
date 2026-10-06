// Stand-in for `codex app-server --stdio` (開發夥伴 tests): thread/list, thread/resume, turn/start with streamed agent
// messages, a command or file-change approval request that waits for the client's decision, and turn/interrupt.
// Client messages and decisions are appended to DEV_FAKE_LOG; DEV_FAKE_THREADS (JSON) is what thread/list returns.
const fs = require('node:fs');
const log = entry => { if (process.env.DEV_FAKE_LOG) fs.appendFileSync(process.env.DEV_FAKE_LOG, JSON.stringify({ bin: 'codex', ...entry }) + '\n'); };
log({ args: process.argv.slice(2), cwd: process.cwd(), pid: process.pid });
if (process.argv[2] !== 'app-server') { process.stderr.write('fake codex: only app-server\n'); process.exit(2); }
const out = message => process.stdout.write(JSON.stringify(message) + '\n');
let thread = null, turn = null, turns = 0, serverId = 0; const waiting = new Map();
const ask = (method, params) => new Promise(resolve => { const id = `srv-${++serverId}`; waiting.set(id, resolve); out({ id, method, params }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
function agentSays(text) { const itemId = `msg-${Math.random().toString(36).slice(2)}`; for (const part of text.match(/[\s\S]{1,10}/g) || []) out({ method: 'item/agentMessage/delta', params: { threadId: thread, turnId: turn.id, itemId, delta: part } }); out({ method: 'item/completed', params: { threadId: thread, turnId: turn.id, item: { type: 'agentMessage', id: itemId, text } } }); }
function complete(status = 'completed') { out({ method: 'turn/completed', params: { threadId: thread, turn: { id: turn.id, status, error: null, items: [] } } }); turn = null; }
async function run(text) {
  const current = turn;
  out({ method: 'turn/started', params: { threadId: thread, turn: { id: turn.id, status: 'inProgress', items: [] } } });
  if (/slow|慢/.test(text)) return;  // until turn/interrupt
  if (/test|測試/.test(text)) {
    // something the companion does not support must be declined, not answered
    const unsupported = await ask('item/tool/requestUserInput', { threadId: thread, turnId: turn.id, itemId: 'q-1', questions: [] }); log({ unsupported });
    agentSays('我先跑一下測試。');
    const item = { type: 'commandExecution', id: 'cmd-1', command: 'npm test', cwd: process.cwd(), status: 'inProgress', commandActions: [] };
    out({ method: 'item/started', params: { threadId: thread, turnId: turn.id, item } });
    const answer = await ask('item/commandExecution/requestApproval', { threadId: thread, turnId: turn.id, itemId: 'cmd-1', command: 'npm test', cwd: process.cwd(), reason: 'Run the test suite?' });
    log({ decision: answer.result?.decision ?? null, error: answer.error || null });
    if (turn !== current) return;
    const ok = answer.result?.decision === 'accept';
    out({ method: 'item/completed', params: { threadId: thread, turnId: turn.id, item: { ...item, status: ok ? 'completed' : 'declined' } } });
    agentSays(ok ? '測試通過，全部 12 個都綠了。' : '好，我不跑測試。'); return complete();
  }
  if (/patch|改/.test(text)) {
    const item = { type: 'fileChange', id: 'fc-1', status: 'inProgress', changes: [{ path: `${process.cwd()}/src/app.js`, kind: { type: 'update', move_path: null }, diff: '@@\n-old line\n+new line\n+another\n' }] };
    out({ method: 'item/started', params: { threadId: thread, turnId: turn.id, item } });
    const answer = await ask('item/fileChange/requestApproval', { threadId: thread, turnId: turn.id, itemId: 'fc-1', reason: null });
    log({ decision: answer.result?.decision ?? null });
    if (turn !== current) return;
    out({ method: 'item/completed', params: { threadId: thread, turnId: turn.id, item: { ...item, status: answer.result?.decision === 'accept' ? 'completed' : 'declined' } } });
    agentSays(answer.result?.decision === 'accept' ? '改好了。' : '好，不改。'); return complete();
  }
  await sleep(30); agentSays(`Codex 收到：${text}`); complete();
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk; let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    log({ stdin: m });
    if (m.id !== undefined && !m.method) { waiting.get(m.id)?.(m); waiting.delete(m.id); continue; }
    if (m.method === 'initialize') out({ id: m.id, result: { userAgent: 'fake-codex' } });
    else if (m.method === 'thread/list') out({ id: m.id, result: { data: JSON.parse(process.env.DEV_FAKE_THREADS || '[]'), nextCursor: null, backwardsCursor: null } });
    else if (m.method === 'thread/resume') { thread = m.params.threadId; out({ id: m.id, result: { thread: { id: thread, turns: [] }, cwd: process.cwd(), model: 'fake', approvalPolicy: 'on-request', approvalsReviewer: m.params.approvalsReviewer || 'auto_review', sandbox: { type: 'workspaceWrite' } } }); }
    else if (m.method === 'turn/start') { if (turn) { out({ id: m.id, error: { code: -32000, message: 'turn already running' } }); continue; } turn = { id: `turn-${++turns}` }; out({ id: m.id, result: { turn: { id: turn.id, status: 'inProgress', items: [] } } }); run(m.params.input.map(x => x.text).join('')); }
    else if (m.method === 'turn/interrupt') { out({ id: m.id, result: {} }); if (turn && turn.id === m.params.turnId) { for (const [id, resolve] of waiting) { resolve({ id, result: { decision: 'cancel' } }); waiting.delete(id); } complete('interrupted'); } }
    else if (m.method === 'thread/unsubscribe') out({ id: m.id, result: { status: 'unsubscribed' } });
    else if (m.id !== undefined) out({ id: m.id, error: { code: -32601, message: `unknown ${m.method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
