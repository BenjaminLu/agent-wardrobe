// A long-lived connection to one existing coding session (開發夥伴): Claude Code resumed with stream-json in and out, or a
// Codex thread resumed through its app-server. Both adapters emit the same events and take the same calls.
//
// events ('event', {type, ...}):
//   ready {sessionId, cwd, mode}        the session is loaded (mode: its permission mode / approval policy)
//   delta {text}                        reply text as it streams
//   progress {text}                     one assistant message finished (the turn may go on; shown, not spoken)
//   tool {phase:'start'|'end', id, name, input, error}
//   approval {requestId, tool, input, codex}   the session asks permission; answer with approve()/deny()
//   approval-closed {requestId}         a request went away without an answer (turn ended, interrupted)
//   message {text}                      the final reply of a turn
//   turn {status:'completed'|'interrupted'|'failed', error}
//   notice {text} / error {message} / closed {code}
// calls: start(), send(text), interrupt(), approve(id), deny(id, message), close()
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const platform = require('./platform.cjs');

const MAX_LINE = 8 * 1024 * 1024, MAX_TEXT = 200000;
// Newline-delimited JSON from a stream; a line over the cap is skipped, not fatal (tool results can be huge).
function jsonLines(stream, onItem) {
  let buffer = '', skipping = false;
  stream.setEncoding?.('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) { if (buffer.length > MAX_LINE) { buffer = ''; skipping = true; } return; }
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (skipping) { skipping = false; continue; }
      if (!line.trim()) continue;
      let item; try { item = JSON.parse(line); } catch { continue; }
      onItem(item);
    }
  });
}
// The environment for a child CLI: the user's own, minus markers of the Claude Code session this app may run inside
// and API keys that would replace the signed-in account.
function childEnv(env = process.env, executable) {
  const out = { ...env };
  for (const key of ['CLAUDECODE', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'ELECTRON_RUN_AS_NODE']) delete out[key];
  for (const key of Object.keys(out)) if (key.startsWith('CLAUDE_CODE_')) delete out[key];
  if (executable) out.PATH = `${path.dirname(executable)}${path.delimiter}${out.PATH || ''}`;
  return out;
}

// --- The app's end of the Claude permission tool: a private socket (Unix socket in a 0700 folder / a named pipe on
// Windows) that only accepts lines carrying this session's random token.
class PermissionBridge extends EventEmitter {
  constructor({ dir }) { super(); this.dir = dir; this.token = crypto.randomBytes(32).toString('hex'); this.prefix = crypto.randomBytes(4).toString('hex'); this.pending = new Map(); this.server = null; this.next = 0; }
  async listen() {
    this.socket = process.platform === 'win32' ? `\\\\.\\pipe\\wardrobe-permission-${crypto.randomBytes(12).toString('hex')}` : path.join(this.dir, 'permission.sock');
    this.server = net.createServer(connection => this.accept(connection));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.socket, resolve); });
    if (process.platform !== 'win32') fs.chmodSync(this.socket, 0o600);
    const file = path.join(this.dir, 'permission.json');
    fs.writeFileSync(file, JSON.stringify({ socket: this.socket, token: this.token }), { mode: 0o600 });
    return file;
  }
  accept(connection) {
    let buffer = '', id = null;
    connection.setEncoding('utf8');
    connection.on('data', chunk => {
      if (id) return; buffer += chunk;
      if (buffer.length > 4e6) { connection.destroy(); return; }
      const end = buffer.indexOf('\n'); if (end < 0) return;
      let request; try { request = JSON.parse(buffer.slice(0, end)); } catch { connection.destroy(); return; }
      const a = Buffer.from(String(request.token || '')), b = Buffer.from(this.token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || typeof request.tool_name !== 'string') { connection.destroy(); return; }
      id = `perm-${this.prefix}-${++this.next}`;
      this.pending.set(id, connection);
      this.emit('request', { requestId: id, tool: request.tool_name, input: request.input && typeof request.input === 'object' ? request.input : {}, toolUseId: request.tool_use_id || null });
    });
    const gone = () => { if (id && this.pending.get(id) === connection) { this.pending.delete(id); this.emit('closed', id); } };
    connection.on('close', gone); connection.on('error', () => {});
  }
  answer(requestId, allow, message) {
    const connection = this.pending.get(requestId); if (!connection) return false;
    this.pending.delete(requestId);
    connection.end(JSON.stringify(allow ? { behavior: 'allow' } : { behavior: 'deny', message: message || 'The user denied this.' }) + '\n');
    return true;
  }
  denyAll(message) { for (const id of [...this.pending.keys()]) this.answer(id, false, message); }
  close() { this.denyAll('The desktop companion left this session.'); try { this.server?.close(); } catch {} this.server = null; }
}

// --- Claude Code: one `claude -p --resume <id>` process, many turns written to stdin as stream-json user messages.
// Turn events from one stream-json line. state carries what a turn has seen so far.
function mapClaude(item, state = {}) {
  const out = [];
  if (!item || typeof item !== 'object') return out;
  if (item.type === 'system' && item.subtype === 'init') {
    state.sessionId = item.session_id;
    const bridge = (item.mcp_servers || []).find(s => s.name === 'wardrobe_permission');
    out.push({ type: 'ready', sessionId: item.session_id, cwd: item.cwd, mode: item.permissionMode || null, permissionTool: bridge ? bridge.status : 'missing', model: item.model || null });
    return out;
  }
  if (item.parent_tool_use_id) return out;  // a subagent's own messages: its Task/Agent tool shows as one tool
  if (item.type === 'stream_event') {
    const e = item.event || {};
    if (e.type === 'message_start') state.streamed = '';
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) { state.streamed = ((state.streamed || '') + e.delta.text).slice(-MAX_TEXT); out.push({ type: 'delta', text: e.delta.text }); }
    return out;
  }
  if (item.type === 'assistant') {
    const blocks = Array.isArray(item.message?.content) ? item.message.content : [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    const tools = blocks.filter(b => b.type === 'tool_use');
    if (text) { state.lastText = text.slice(0, MAX_TEXT); out.push({ type: 'progress', text: state.lastText }); }
    for (const b of tools) { (state.tools ||= new Map()).set(b.id, b.name); out.push({ type: 'tool', phase: 'start', id: b.id, name: b.name, input: b.input || {} }); }
    return out;
  }
  if (item.type === 'user') {
    const blocks = Array.isArray(item.message?.content) ? item.message.content : [];
    for (const b of blocks) if (b.type === 'tool_result') { const name = state.tools?.get(b.tool_use_id) || null; state.tools?.delete(b.tool_use_id); out.push({ type: 'tool', phase: 'end', id: b.tool_use_id, name, error: Boolean(b.is_error) }); }
    return out;
  }
  if (item.type === 'result') {
    const text = typeof item.result === 'string' && item.result.trim() ? item.result : state.lastText || '';
    const interrupted = state.interrupting || item.subtype === 'error_during_execution' && /interrupt|abort/i.test(JSON.stringify(item.errors || item.result || ''));
    if (text && !item.is_error) out.push({ type: 'message', text: String(text).slice(0, MAX_TEXT) });
    const status = state.interrupting ? 'interrupted' : item.is_error || item.subtype !== 'success' ? (interrupted ? 'interrupted' : 'failed') : 'completed';
    out.push({ type: 'turn', status, error: status === 'failed' ? String((typeof item.result === 'string' && item.result) || (item.errors || []).join(' ') || item.subtype || 'error').slice(0, 500) : null, sessionId: item.session_id || null });
    state.lastText = ''; state.streamed = ''; state.tools?.clear(); state.interrupting = false;
    return out;
  }
  return out;
}
// Claude Code accepts these permission modes on the command line; a session saved in bypassPermissions is resumed in the
// normal asking mode instead (a voice companion never silently skips permissions).
const CLAUDE_MODES = ['acceptEdits', 'auto', 'plan', 'manual', 'dontAsk'];
function claudeArgs({ id, mode, mcpConfig }) {
  return ['-p', '--resume', id, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ...(CLAUDE_MODES.includes(mode) ? ['--permission-mode', mode] : []),
    '--permission-prompt-tool', 'mcp__wardrobe_permission__approve', '--mcp-config', mcpConfig];
}
class ClaudeAdapter extends EventEmitter {
  constructor({ id, cwd, mode = null, findBinary, launch = platform.launch, killTree = platform.killTree, env = process.env, helper = path.join(__dirname, 'permission-mcp.cjs'), node = process.execPath, tmp = os.tmpdir(), interruptGraceMs = 5000 }) {
    super(); Object.assign(this, { id, sessionId: id, cwd, mode, findBinary, launch, killTree, env, helper, node, tmp, interruptGraceMs });
    this.engine = 'claude'; this.child = null; this.busy = false; this.state = {}; this.stderr = ''; this.closed = false; this.requests = 0;
  }
  async start() {
    const claude = this.findBinary('claude'); if (!claude) throw new Error('找不到 Claude Code（claude）。');
    if (!fs.existsSync(this.cwd)) throw new Error(`專案資料夾不見了：${this.cwd}`);
    this.dir = fs.mkdtempSync(path.join(this.tmp, 'wardrobe-dev-')); fs.chmodSync(this.dir, 0o700);
    this.bridge = new PermissionBridge({ dir: this.dir });
    const bridgeFile = await this.bridge.listen();
    this.bridge.on('request', request => { this.emit('event', { type: 'approval', ...request }); });
    this.bridge.on('closed', requestId => this.emit('event', { type: 'approval-closed', requestId }));
    this.mcpConfig = path.join(this.dir, 'mcp.json');
    fs.writeFileSync(this.mcpConfig, JSON.stringify({ mcpServers: { wardrobe_permission: { type: 'stdio', command: this.node, args: [this.helper, bridgeFile], env: { ELECTRON_RUN_AS_NODE: '1' } } } }), { mode: 0o600 });
    this.executable = claude; this.spawn();
  }
  spawn() {
    const child = this.launch(this.executable, claudeArgs({ id: this.sessionId, mode: this.mode, mcpConfig: this.mcpConfig }), { cwd: this.cwd, env: childEnv(this.env, this.executable), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    this.child = child; this.state = {};
    child.stdin.on('error', () => {});
    jsonLines(child.stdout, item => { if (this.child === child) this.receive(item); });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });
    child.on('error', error => { if (this.child === child) this.emit('event', { type: 'error', message: error.message }); });
    child.on('close', code => {
      if (this.child !== child) return; this.child = null;
      if (this.busy) { this.busy = false; this.emit('event', { type: 'turn', status: this.state.interrupting ? 'interrupted' : 'failed', error: this.state.interrupting ? null : (this.stderr.trim().split('\n').pop() || `claude exited (${code})`).slice(0, 500) }); }
      this.bridge?.denyAll('Claude Code stopped.');
      if (!this.closed && code && !this.state.interrupting && !this.readyOnce) this.emit('event', { type: 'error', message: (this.stderr.trim().split('\n').slice(-3).join(' ') || `claude exited (${code})`).slice(0, 500) });
    });
  }
  receive(item) {
    if (item.type === 'control_response') { if (item.response?.request_id === this.interruptId) this.interruptAcked = true; return; }
    if (item.type === 'control_request') { this.write({ type: 'control_response', response: { subtype: 'error', request_id: item.request_id, error: 'Not supported by this host' } }); return; }
    for (const event of mapClaude(item, this.state)) {
      if (event.type === 'ready') {
        this.readyOnce = true;
        // resuming keeps the session id unless Claude Code had to fork it; later restarts follow the id it reports
        if (event.sessionId && event.sessionId !== this.sessionId) { this.emit('event', { type: 'notice', text: 'session-forked', sessionId: event.sessionId, previous: this.sessionId }); this.sessionId = event.sessionId; }
        if (event.permissionTool !== 'connected') this.emit('event', { type: 'error', message: `permission tool ${event.permissionTool}` });
      }
      if (event.type === 'turn') { this.busy = false; clearTimeout(this.interruptTimer); this.bridge?.denyAll('The turn ended.'); }
      this.emit('event', event);
    }
  }
  write(item) { if (this.child && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(item) + '\n'); }
  send(text) {
    if (this.closed) throw new Error('closed');
    if (this.busy) throw Object.assign(new Error('busy'), { code: 'BUSY' });
    if (!this.child) this.spawn();  // after an interrupt that had to end the process, or a crash: resume again
    this.busy = true; this.state.interrupting = false;
    this.write({ type: 'user', session_id: this.sessionId, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: String(text) }] } });
  }
  // Asks Claude Code to stop the turn; if it hasn't within the grace period, the process is ended (the next message
  // resumes the session again).
  interrupt() {
    if (!this.busy || !this.child) return false;
    this.state.interrupting = true; this.interruptAcked = false; this.interruptId = `interrupt-${++this.requests}`;
    this.bridge?.denyAll('The user interrupted.');
    this.write({ type: 'control_request', request_id: this.interruptId, request: { subtype: 'interrupt' } });
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => { if (this.busy && this.child) this.killTree(this.child); }, this.interruptGraceMs);
    return true;
  }
  approve(requestId) { return this.bridge?.answer(requestId, true) || false; }
  deny(requestId, message) { return this.bridge?.answer(requestId, false, message || 'The user denied this.') || false; }
  get pid() { return this.child?.pid || null; }
  close() {
    if (this.closed) return; this.closed = true; clearTimeout(this.interruptTimer);
    this.bridge?.close();
    const child = this.child; this.child = null;
    if (child) { try { child.stdin.end(); } catch {} this.killTree(child); const timer = setTimeout(() => this.killTree(child, 'SIGKILL'), 3000); timer.unref?.(); child.once('close', () => clearTimeout(timer)); }
    if (this.dir) { const dir = this.dir; setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 200).unref?.(); }
    this.emit('event', { type: 'closed' });
  }
}

// --- Codex: its own `codex app-server`, thread/resume, then turn/start per message. Approval requests from the server
// are passed on and answered only with the user's decision.
class Rpc extends EventEmitter {
  constructor(child) {
    super(); this.child = child; this.pending = new Map(); this.next = 0;
    jsonLines(child.stdout, message => this.receive(message));
    child.stdin.on('error', () => {});
    child.on('close', code => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(`codex app-server exited (${code})`)); } this.pending.clear(); this.emit('close', code); });
  }
  receive(message) {
    if (message.id !== undefined && !message.method) { const p = this.pending.get(message.id); if (!p) return; this.pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(Object.assign(new Error(message.error.message || 'request failed'), { rpc: message.error })) : p.resolve(message.result); return; }
    if (message.id !== undefined && message.method) { this.emit('request', message); return; }
    if (message.method) this.emit('notification', message);
  }
  send(message) { if (this.child.stdin.destroyed) throw new Error('codex app-server is not running'); this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const id = ++this.next, timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  reply(id, result) { try { this.send({ id, result }); } catch {} }
  fail(id, code, message) { try { this.send({ id, error: { code, message } }); } catch {} }
}
async function startCodexServer({ findBinary, launch = platform.launch, env = process.env, cwd }) {
  const codex = findBinary('codex'); if (!codex) throw new Error('找不到 Codex（codex）。');
  // the user's own config: their model, sandbox and approval settings, MCP servers and features
  const child = launch(codex, ['app-server', '--stdio'], { cwd, env: childEnv(env, codex), stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
  let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const rpc = new Rpc(child); rpc.stderr = () => stderr;
  const failed = new Promise((_, reject) => { child.once('error', reject); child.once('close', code => reject(new Error((stderr.trim().split('\n').pop() || `codex app-server exited (${code})`).slice(0, 400)))); });
  failed.catch(() => {});
  await Promise.race([rpc.request('initialize', { clientInfo: { name: 'agent_wardrobe', title: 'Agent Wardrobe', version: '0.1.0' }, capabilities: null }, 30000), failed]);
  rpc.send({ method: 'initialized', params: {} });
  return { child, rpc };
}
// Codex's thread list (newest activity first), from a short-lived app-server; it reads its state database only.
async function listCodexThreads({ findBinary, launch, env, killTree = platform.killTree, limit = 40 }) {
  const { child, rpc } = await startCodexServer({ findBinary, launch, env, cwd: os.homedir() });
  try { const result = await rpc.request('thread/list', { limit, sortKey: 'updated_at', sortDirection: 'desc', useStateDbOnly: true }, 15000); return result?.data || []; }
  finally { try { child.stdin.end(); } catch {} killTree(child); }
}
const CODEX_TOOLS = { commandExecution: 'commandExecution', fileChange: 'fileChange', mcpToolCall: 'mcpToolCall', webSearch: 'webSearch', dynamicToolCall: 'dynamicToolCall', collabAgentToolCall: 'Agent', imageGeneration: 'imageGeneration' };
function codexToolInput(item) {
  if (item.type === 'commandExecution') return { command: item.command, cwd: item.cwd };
  if (item.type === 'fileChange') return { path: item.changes?.[0]?.path, files: (item.changes || []).map(c => c.path) };
  if (item.type === 'mcpToolCall') return { server: item.server, tool: item.tool };
  if (item.type === 'webSearch') return { query: item.query };
  return {};
}
class CodexAdapter extends EventEmitter {
  constructor({ id, cwd, findBinary, launch = platform.launch, killTree = platform.killTree, env = process.env, interruptGraceMs = 8000, askUser = false }) {
    super(); Object.assign(this, { id, sessionId: id, cwd, findBinary, launch, killTree, env, interruptGraceMs, askUser });
    this.engine = 'codex'; this.busy = false; this.turnId = null; this.closed = false; this.items = new Map(); this.requests = new Map(); this.next = 0; this.messages = [];
  }
  async start() {
    if (!fs.existsSync(this.cwd)) throw new Error(`專案資料夾不見了：${this.cwd}`);
    const { child, rpc } = await startCodexServer({ findBinary: this.findBinary, launch: this.launch, env: this.env, cwd: this.cwd });
    this.child = child; this.rpc = rpc;
    rpc.on('notification', message => this.notification(message));
    rpc.on('request', message => this.serverRequest(message));
    rpc.on('close', code => { if (this.closed) return; this.child = null; if (this.busy) { this.busy = false; this.emit('event', { type: 'turn', status: 'failed', error: `codex app-server exited (${code})` }); } this.dropRequests(); this.emit('event', { type: 'error', message: (rpc.stderr().trim().split('\n').pop() || `codex app-server exited (${code})`).slice(0, 400) }); });
    // no overrides: the thread keeps its own model, sandbox and approval policy. The one change the user can choose:
    // approval requests come to them instead of Codex's automatic reviewer (approvals_reviewer = "auto_review").
    const result = await rpc.request('thread/resume', { threadId: this.id, excludeTurns: true, ...(this.askUser ? { approvalsReviewer: 'user' } : {}) });
    this.sessionId = result.thread?.id || this.id;
    this.emit('event', { type: 'ready', sessionId: this.sessionId, cwd: result.cwd || this.cwd, mode: typeof result.approvalPolicy === 'string' ? result.approvalPolicy : JSON.stringify(result.approvalPolicy), reviewer: result.approvalsReviewer || null, sandbox: result.sandbox?.type || null, model: result.model || null });
  }
  mine(params) { return params && params.threadId === this.sessionId && (!this.turnId || !params.turnId || params.turnId === this.turnId || params.turn?.id === this.turnId); }
  notification({ method, params }) {
    if (!params || params.threadId !== this.sessionId) return;
    if (method === 'turn/started') { this.turnId = params.turn?.id || this.turnId; return; }
    if (!this.mine(params)) return;
    if (method === 'item/agentMessage/delta' && params.delta) { this.emit('event', { type: 'delta', text: params.delta }); return; }
    if (method === 'item/started' || method === 'item/completed') {
      const item = params.item || {};
      if (item.type === 'agentMessage') { if (method === 'item/completed' && item.text) { this.messages.push(item.text.slice(0, MAX_TEXT)); this.emit('event', { type: 'progress', text: item.text.slice(0, MAX_TEXT) }); } return; }
      const name = CODEX_TOOLS[item.type]; if (!name) return;
      if (method === 'item/started') { this.items.set(item.id, item); this.emit('event', { type: 'tool', phase: 'start', id: item.id, name, input: codexToolInput(item) }); }
      else { this.items.delete(item.id); this.emit('event', { type: 'tool', phase: 'end', id: item.id, name, error: /failed|declined|error/i.test(String(item.status || '')) }); }
      return;
    }
    if (method === 'serverRequest/resolved') { for (const [id, r] of this.requests) if (String(r.rpcId) === String(params.requestId)) { this.requests.delete(id); this.emit('event', { type: 'approval-closed', requestId: id }); } return; }
    if (method === 'turn/completed') {
      const turn = params.turn || {}; if (this.turnId && turn.id && turn.id !== this.turnId) return;
      clearTimeout(this.interruptTimer);
      const text = this.messages.at(-1) || ''; this.messages = []; this.busy = false; this.turnId = null; this.dropRequests();
      if (text && turn.status === 'completed') this.emit('event', { type: 'message', text });
      this.emit('event', { type: 'turn', status: ['completed', 'interrupted', 'failed'].includes(turn.status) ? turn.status : 'failed', error: turn.error?.message || null });
    }
  }
  serverRequest(message) {
    const params = message.params || {};
    const approval = { 'item/commandExecution/requestApproval': 'command', 'item/fileChange/requestApproval': 'files', 'item/permissions/requestApproval': 'permissions', execCommandApproval: 'legacy-command', applyPatchApproval: 'legacy-files' }[message.method];
    // anything else the server might ask (user input forms, MCP elicitation, dynamic tools, auth) is declined
    if (!approval || (params.threadId && params.threadId !== this.sessionId) || (params.conversationId && params.conversationId !== this.sessionId)) { this.rpc.fail(message.id, -32601, 'Not supported by Agent Wardrobe'); return; }
    const requestId = `codex-${this.prefix ||= crypto.randomBytes(4).toString('hex')}-${++this.next}`;
    let codex;
    if (approval === 'command' || approval === 'legacy-command') codex = { kind: 'command', command: params.command ?? (Array.isArray(params.command) ? params.command.join(' ') : ''), cwd: params.cwd || null, reason: params.reason || null };
    else if (approval === 'files' || approval === 'legacy-files') { const item = this.items.get(params.itemId); const changes = item?.changes || Object.entries(params.fileChanges || {}).map(([p, c]) => ({ path: p, kind: Object.keys(c || {})[0], diff: c?.update?.unified_diff || '' })); codex = { kind: 'files', changes: changes.map(c => ({ path: c.path, kind: typeof c.kind === 'object' ? c.kind?.type : c.kind, diff: String(c.diff || '').slice(0, 20000) })), reason: params.reason || null }; }
    else codex = { kind: 'permissions', permissions: params.permissions || {}, reason: params.reason || null };
    if (Array.isArray(codex.command)) codex.command = codex.command.join(' ');
    this.requests.set(requestId, { rpcId: message.id, approval, params });
    this.emit('event', { type: 'approval', requestId, tool: approval.replace('legacy-', ''), input: {}, codex });
  }
  answer(requestId, allow) {
    const r = this.requests.get(requestId); if (!r) return false; this.requests.delete(requestId);
    const legacy = r.approval.startsWith('legacy-');
    if (r.approval === 'permissions') this.rpc.reply(r.rpcId, allow ? { permissions: r.params.permissions || {}, scope: 'turn' } : { permissions: {}, scope: 'turn' });
    else this.rpc.reply(r.rpcId, { decision: legacy ? (allow ? 'approved' : 'denied') : (allow ? 'accept' : 'decline') });
    return true;
  }
  dropRequests() { for (const id of [...this.requests.keys()]) { this.answer(id, false); this.emit('event', { type: 'approval-closed', requestId: id }); } }
  approve(requestId) { return this.answer(requestId, true); }
  deny(requestId) { return this.answer(requestId, false); }
  send(text) {
    if (this.closed || !this.rpc || !this.child) throw new Error('closed');
    if (this.busy) throw Object.assign(new Error('busy'), { code: 'BUSY' });
    this.busy = true; this.messages = [];
    this.rpc.request('turn/start', { threadId: this.sessionId, input: [{ type: 'text', text: String(text), text_elements: [] }] })
      .then(result => { if (result?.turn?.id && !this.turnId) this.turnId = result.turn.id; })
      .catch(error => { if (!this.busy) return; this.busy = false; this.emit('event', { type: 'turn', status: 'failed', error: error.message }); });
  }
  interrupt() {
    if (!this.busy) return false;
    this.dropRequests();
    const ask = () => this.turnId ? this.rpc.request('turn/interrupt', { threadId: this.sessionId, turnId: this.turnId }).catch(() => {}) : null;
    if (!ask()) setTimeout(ask, 500);  // turn/start has not answered yet
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => { if (this.busy) { this.busy = false; this.turnId = null; this.emit('event', { type: 'turn', status: 'interrupted', error: null }); } }, this.interruptGraceMs);
    return true;
  }
  get pid() { return this.child?.pid || null; }
  close() {
    if (this.closed) return; this.closed = true; clearTimeout(this.interruptTimer);
    this.dropRequests();
    const child = this.child; this.child = null;
    if (child) { try { this.rpc.request('thread/unsubscribe', { threadId: this.sessionId }, 1000).catch(() => {}); } catch {} setTimeout(() => { try { child.stdin.end(); } catch {} this.killTree(child); }, 150); const timer = setTimeout(() => this.killTree(child, 'SIGKILL'), 3000); timer.unref?.(); child.once('close', () => clearTimeout(timer)); }
    this.emit('event', { type: 'closed' });
  }
}
function createAdapter(engine, options) { if (engine === 'claude') return new ClaudeAdapter(options); if (engine === 'codex') return new CodexAdapter(options); throw new Error('Unknown engine'); }
module.exports = { createAdapter, ClaudeAdapter, CodexAdapter, PermissionBridge, mapClaude, claudeArgs, childEnv, listCodexThreads, startCodexServer, jsonLines, CLAUDE_MODES };
