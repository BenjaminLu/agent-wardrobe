// The permission prompt tool for an attached Claude Code session (開發夥伴). Claude Code starts this as a stdio MCP
// server (--mcp-config) and calls its one tool, `approve`, through --permission-prompt-tool whenever it would ask the
// user. Each request goes to the app over a private local socket (its path and a token are in a 0600 file inside a 0700
// folder, given as argv[2]); the app asks the user and sends back the answer.
// It talks MCP only on stdio, listens on nothing, and never answers by itself: no app, no answer or a bad answer is a deny.
// An allow always returns the tool's original input unchanged.
const fs = require('node:fs');
const net = require('node:net');
const readline = require('node:readline');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const TOOL = { name: 'approve', description: 'Asks the person using the desktop companion to allow or deny one tool use. Returns their decision.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } };
const respond = (id, result, error) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');

function ask(args) {
  return new Promise(resolve => {
    let done = false, buffer = '';
    const finish = decision => { if (done) return; done = true; socket.destroy(); resolve(decision); };
    const deny = message => finish({ behavior: 'deny', message });
    const socket = net.connect(config.socket);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(JSON.stringify({ token: config.token, tool_name: String(args.tool_name), input: args.input, tool_use_id: args.tool_use_id ? String(args.tool_use_id) : null }) + '\n'));
    socket.on('data', chunk => {
      buffer += chunk; if (buffer.length > 65536) return deny('The answer from the desktop companion was not understood, so this was not allowed.');
      const end = buffer.indexOf('\n'); if (end < 0) return;
      let answer; try { answer = JSON.parse(buffer.slice(0, end)); } catch { return deny('The answer from the desktop companion was not understood, so this was not allowed.'); }
      if (answer.behavior === 'allow') finish({ behavior: 'allow', updatedInput: args.input });
      else deny(String(answer.message || 'The user denied this.').slice(0, 500));
    });
    socket.on('error', () => deny('The desktop companion could not be reached, so this was not allowed.'));
    socket.on('close', () => deny('The request was withdrawn before the user answered.'));
  });
}

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let request;
  try {
    if (line.length > 4e6) throw new Error('Request too large');
    request = JSON.parse(line); if (request.id === undefined) return;
    if (request.method === 'initialize') return respond(request.id, { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'wardrobe_permission', version: '1.0.0' } });
    if (request.method === 'ping') return respond(request.id, {});
    if (request.method === 'tools/list') return respond(request.id, { tools: [TOOL] });
    if (request.method === 'tools/call') {
      const args = request.params?.arguments;
      if (request.params?.name !== 'approve' || !args || typeof args.tool_name !== 'string') return respond(request.id, { content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: 'Invalid permission request.' }) }] });
      const decision = await ask(args);
      return respond(request.id, { content: [{ type: 'text', text: JSON.stringify(decision) }] });
    }
    respond(request.id, null, { code: -32601, message: 'Unknown method' });
  } catch (error) { if (request?.id !== undefined) respond(request.id, null, { code: -32602, message: error.message }); }
});
