// Stand-in for `claude -p --resume <id> --input-format stream-json --output-format stream-json …` (開發夥伴 tests).
// Like the real CLI it starts the MCP servers from --mcp-config and calls the --permission-prompt-tool before a tool
// that needs permission, then acts on the answer. Every argument list and decision is appended to DEV_FAKE_LOG.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const log = entry => { if (process.env.DEV_FAKE_LOG) fs.appendFileSync(process.env.DEV_FAKE_LOG, JSON.stringify({ bin: 'claude', ...entry }) + '\n'); };
log({ args, cwd: process.cwd(), pid: process.pid });
const id = opt('--resume'), tool = opt('--permission-prompt-tool');
const out = item => process.stdout.write(JSON.stringify(item) + '\n');
if (!id || !args.includes('-p') || opt('--input-format') !== 'stream-json' || opt('--output-format') !== 'stream-json' || args.includes('--dangerously-skip-permissions')) { process.stderr.write('fake claude: unexpected arguments\n'); process.exit(2); }

// the permission MCP server, started the way Claude Code starts stdio servers
const config = JSON.parse(fs.readFileSync(opt('--mcp-config'), 'utf8')).mcpServers.wardrobe_permission;
const mcp = spawn(config.command, config.args, { env: { ...process.env, ...config.env }, stdio: ['pipe', 'pipe', 'inherit'] });
let mcpBuffer = '', mcpNext = 0; const mcpWaiting = new Map();
mcp.stdout.setEncoding('utf8');
mcp.stdout.on('data', chunk => { mcpBuffer += chunk; let i; while ((i = mcpBuffer.indexOf('\n')) >= 0) { const m = JSON.parse(mcpBuffer.slice(0, i)); mcpBuffer = mcpBuffer.slice(i + 1); mcpWaiting.get(m.id)?.(m); mcpWaiting.delete(m.id); } });
const mcpCall = (method, params) => new Promise(resolve => { const rid = ++mcpNext; mcpWaiting.set(rid, resolve); mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }) + '\n'); });
const ready = (async () => { await mcpCall('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '1' } }); const list = await mcpCall('tools/list', {}); return list.result.tools.map(t => t.name); })();
async function askPermission(toolName, input, toolUseId) {
  const tools = await ready;
  if (tool !== `mcp__wardrobe_permission__${tools[0]}`) throw new Error(`permission tool ${tool} not served`);
  const response = await mcpCall('tools/call', { name: tools[0], arguments: { tool_name: toolName, input, tool_use_id: toolUseId } });
  const decision = JSON.parse(response.result.content[0].text);
  log({ decision, toolName, input }); return decision;
}

let turn = null, n = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function finish(result, { error = false, subtype = 'success' } = {}) { out({ type: 'result', subtype, is_error: error, result, session_id: id }); turn = null; }
function say(text) { for (const part of text.match(/[\s\S]{1,12}/g) || []) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } }, parent_tool_use_id: null, session_id: id }); out({ type: 'assistant', message: { content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: id }); }
async function useTool(name, input) {
  const toolUseId = `toolu_${++n}`;
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: toolUseId, name, input }] }, parent_tool_use_id: null, session_id: id });
  const decision = await askPermission(name, input, toolUseId);
  if (decision.behavior === 'allow') { if (name === 'Write') fs.writeFileSync(path.resolve(process.cwd(), decision.updatedInput.file_path), decision.updatedInput.content); }
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: decision.behavior !== 'allow', content: decision.behavior === 'allow' ? 'ok' : decision.message }] }, parent_tool_use_id: null, session_id: id });
  return decision.behavior === 'allow';
}
async function run(text) {
  out({ type: 'system', subtype: 'init', session_id: id, cwd: process.cwd(), permissionMode: opt('--permission-mode') || 'default', mcp_servers: [{ name: 'wardrobe_permission', status: 'connected' }], model: 'fake' });
  const current = turn = { text };
  if (/slow|慢/.test(text)) { out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `toolu_${++n}`, name: 'Bash', input: { command: 'sleep 600' } }] }, parent_tool_use_id: null, session_id: id }); return; }  // runs until interrupted
  if (/file|檔案/.test(text)) { const ok = await useTool('Write', { file_path: 'hello.txt', content: 'hi from the companion\n' }); if (turn !== current) return; say(ok ? '建立好了，`hello.txt` 在專案資料夾裡。' : '好，那我不建立檔案。'); return finish(ok ? '建立好了，`hello.txt` 在專案資料夾裡。' : '好，那我不建立檔案。'); }
  if (/test|測試/.test(text)) { const ok = await useTool('Bash', { command: 'npm test', description: 'Run the tests' }); if (turn !== current) return; const reply = ok ? '測試全部通過。' : '好，我先不跑測試。'; say(reply); return finish(reply); }
  await sleep(50);
  const reply = `收到：${text}。我看了 \`/Users/someone/projects/alpha/src/main.cjs\`，改法如下：\n\`\`\`js\nconsole.log('patched');\n\`\`\`\n就這樣。`;
  say(reply); finish(reply);
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk; let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const item = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    log({ stdin: item });
    if (item.type === 'control_request' && item.request?.subtype === 'interrupt') { out({ type: 'control_response', response: { subtype: 'success', request_id: item.request_id, response: {} } }); if (turn) finish('', { error: true, subtype: 'error_during_execution' }); continue; }
    if (item.type === 'user') { const text = item.message.content.map(b => b.text).join(''); run(text).catch(error => { process.stderr.write(String(error.stack)); finish(String(error.message), { error: true, subtype: 'error_during_execution' }); }); }
  }
});
process.stdin.on('end', () => { mcp.kill(); process.exit(0); });
process.on('SIGTERM', () => { mcp.kill(); process.exit(0); });
