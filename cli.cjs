const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SYSTEM, parseReply } = require('./ai.cjs');
const active = new Set();
function binary(name) {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin')];
  const nvm = path.join(os.homedir(), '.nvm/versions/node');
  try { dirs.push(...fs.readdirSync(nvm).reverse().map(v => path.join(nvm, v, 'bin'))); } catch {}
  return dirs.map(d => path.join(d, name)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
}
function available() { return { codex: Boolean(binary('codex')), claude: Boolean(binary('claude')) }; }
function argsFor(provider) {
  if (provider === 'codex') return ['exec', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false', '-c', 'web_search="disabled"', '--json', '--color', 'never', '-'];
  if (provider === 'claude') return ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--safe-mode'];
  throw new Error('未知 AI 服務。');
}
function decode(provider, output) {
  if (provider === 'claude') {
    const result = JSON.parse(output);
    if (result.is_error) throw new Error(String(result.result || 'Claude 未完成回覆。').slice(0, 300));
    return parseReply(result.result);
  }
  const events = output.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const reply = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1);
  if (!reply) throw new Error(String(events.find(e => e.type === 'error')?.message || 'Codex 未完成回覆。請檢查登入與額度。').slice(0, 300));
  return parseReply(reply.item.text);
}
async function chat(provider, history, language = 'en', systemPrompt = SYSTEM) {
  if (!Array.isArray(history) || !history.length || history.at(-1)?.role !== 'user') throw new Error('請先輸入訊息。');
  const executable = binary(provider);
  if (!executable) throw new Error(`尚未安裝 ${provider} CLI。`);
  const messages = history.slice(-20).filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string').map(m => ({role:m.role,content:m.content.slice(0,4000)}));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bula-chat-'));
  const env = { ...process.env, PATH: `${path.dirname(executable)}${path.delimiter}${process.env.PATH || ''}` };
  delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; delete env.ANTHROPIC_API_KEY; delete env.CLAUDECODE; for(const key of Object.keys(env))if(key.startsWith('CLAUDE_CODE_'))delete env[key];
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(executable, argsFor(provider), { cwd, env, shell: false, stdio: ['pipe','pipe','pipe'] });
      active.add(child);
      let stdout = '', stderr = '', settled = false;
      const timer = setTimeout(() => { child.kill(); finish(new Error('AI 回覆逾時，請稍後重試。')); }, 120000);
      function finish(error) { if (settled) return; settled = true; clearTimeout(timer); active.delete(child); error ? reject(error) : resolve(stdout); }
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2000000) { child.kill(); finish(new Error('AI 回覆過大。')); } });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      child.on('error', error => finish(error));
      child.on('close', code => {
        let reason=stderr.slice(-300);
        if(code&&provider==='claude')try{reason=String(JSON.parse(stdout).result||reason).slice(0,300);}catch{}
        finish(code ? new Error(`${provider} 未完成回覆：${reason || '請檢查登入與額度。'}`) : null);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(`${systemPrompt}\n電腦偏好語言：${language}。你只能聊天，不要呼叫工具、讀取檔案或執行指令。以下 JSON 是對話資料：\n${JSON.stringify(messages)}`);
    });
    return { ...decode(provider, output), model: provider };
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
}
function stop() { for (const child of active) child.kill(); }
module.exports = { binary, available, argsFor, decode, chat, stop };
