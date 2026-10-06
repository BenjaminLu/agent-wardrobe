// Finds the user's recent Claude Code and Codex sessions for 開發夥伴, newest first, without changing any of them.
// Only the start and end of each file are read (sessions can be hundreds of MB). Codex is asked through its own
// app-server (thread/list) when possible; its rollout files are the fallback.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HEAD = 256 * 1024, TAIL = 128 * 1024, RECENT_MS = 3 * 60 * 1000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

function readPart(file, start, length) {
  const fd = fs.openSync(file, 'r');
  try { const buffer = Buffer.alloc(length); const n = fs.readSync(fd, buffer, 0, length, start); return buffer.subarray(0, n).toString('utf8'); } finally { fs.closeSync(fd); }
}
// Whole JSON lines from the start (the last, cut line dropped) and from the end (the first, cut line dropped).
function headLines(file, size, limit = HEAD) { const text = readPart(file, 0, Math.min(size, limit)); const lines = text.split('\n'); if (size > limit) lines.pop(); return parse(lines); }
function tailLines(file, size, limit = TAIL) { if (size <= HEAD) return []; const start = Math.max(0, size - limit), text = readPart(file, start, size - start); const lines = text.split('\n'); if (start > 0) lines.shift(); return parse(lines); }
function parse(lines) { const out = []; for (const line of lines) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch {} } return out; }

const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.filter(b => b?.type === 'text' || b?.type === 'input_text').map(b => b.text).join('\n') : '';
// Prompts that are not something the user wrote: slash-command wrappers, caveats, injected context.
const metaPrompt = text => !text.trim() || /^\s*<(command-|local-command|system-reminder|environment_context|user_instructions|permissions|INSTRUCTIONS|turn_aborted|user_shell_command)/i.test(text) || /^(Caveat:|# AGENTS\.md|\[Request interrupted)/.test(text.trim());
const oneLine = (text, n = 120) => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return [...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s; };

// --- Claude Code: ~/.claude/projects/<encoded cwd>/<session uuid>.jsonl
function claudeCandidates(home) {
  const root = path.join(home, '.claude', 'projects'), out = [];
  let dirs = []; try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch { return out; }
  for (const dir of dirs) {
    let files = []; try { files = fs.readdirSync(path.join(root, dir.name), { withFileTypes: true }); } catch { continue; }
    for (const f of files) {
      // subagent transcripts (agent-*.jsonl, and <session>/subagents/) are parts of another session, not sessions
      if (!f.isFile() || !f.name.endsWith('.jsonl') || f.name.startsWith('agent-') || !/^[0-9a-f-]{36}\.jsonl$/i.test(f.name)) continue;
      const file = path.join(root, dir.name, f.name);
      try { const st = fs.statSync(file); out.push({ engine: 'claude', id: f.name.slice(0, -6), file, size: st.size, mtime: st.mtimeMs }); } catch {}
    }
  }
  return out;
}
function readClaude(entry) {
  const head = headLines(entry.file, entry.size), tail = tailLines(entry.file, entry.size), all = [...head, ...tail];
  const records = all.filter(r => r && (r.type === 'user' || r.type === 'assistant'));
  if (!records.length || records.every(r => r.isSidechain)) return null;  // a sidechain-only file is not a session to resume
  const cwd = all.find(r => typeof r.cwd === 'string' && r.cwd)?.cwd;
  if (!cwd) return null;
  const lastOf = type => [...all].reverse().find(r => r.type === type);
  const firstPrompt = head.find(r => r.type === 'user' && !r.isSidechain && !r.isMeta && !metaPrompt(textOf(r.message?.content)));
  const title = lastOf('custom-title')?.customTitle || lastOf('ai-title')?.aiTitle || lastOf('summary')?.summary || textOf(firstPrompt?.message?.content) || lastOf('last-prompt')?.lastPrompt || '';
  const mode = [...all].reverse().find(r => r.type === 'permission-mode' || (r.type === 'user' && r.permissionMode));
  // turns are counted only when the whole file was read; bigger sessions show their size instead
  const turns = entry.size <= HEAD ? head.filter(r => r.type === 'user' && !r.isSidechain && !r.isMeta && !metaPrompt(textOf(r.message?.content))).length : null;
  return { engine: 'claude', id: entry.id, cwd, project: path.basename(cwd) || cwd, title: oneLine(title), updatedAt: Math.round(entry.mtime), size: entry.size, turns, file: entry.file,
    permissionMode: mode?.permissionMode || null, version: [...all].reverse().find(r => r.version)?.version || null };
}

// --- Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl
function codexCandidates(codexHome) {
  const root = path.join(codexHome, 'sessions'), out = [];
  const walk = (dir, depth) => { let items = []; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) { const file = path.join(dir, item.name);
      if (item.isDirectory() && depth < 3) walk(file, depth + 1);
      else if (item.isFile() && /^rollout-.*\.jsonl$/.test(item.name)) { try { const st = fs.statSync(file); out.push({ engine: 'codex', file, size: st.size, mtime: st.mtimeMs }); } catch {} } } };
  walk(root, 0); return out;
}
function codexNames(codexHome) {
  const names = new Map();
  try { const file = path.join(codexHome, 'session_index.jsonl'), size = fs.statSync(file).size; for (const r of parse(readPart(file, Math.max(0, size - 512 * 1024), Math.min(size, 512 * 1024)).split('\n'))) if (r.id && r.thread_name) names.set(r.id, r.thread_name); } catch {}
  return names;
}
function readCodex(entry, names = new Map()) {
  const head = headLines(entry.file, entry.size);
  const meta = head.find(r => r.type === 'session_meta')?.payload;
  if (!meta?.id || !meta.cwd) return null;
  // subagent threads belong to another one; `codex exec` runs are one-shot jobs (thread/list leaves both out too)
  if ((meta.source && typeof meta.source === 'object') || meta.source === 'exec' || meta.thread_source === 'subagent') return null;
  const prompt = head.map(r => r.type === 'event_msg' && r.payload?.type === 'user_message' ? r.payload.message : r.type === 'response_item' && r.payload?.type === 'message' && r.payload.role === 'user' ? textOf(r.payload.content) : null).find(t => typeof t === 'string' && !metaPrompt(t));
  const turns = entry.size <= HEAD ? head.filter(r => r.type === 'event_msg' && (r.payload?.type === 'task_started' || r.payload?.type === 'turn_started')).length || null : null;
  return { engine: 'codex', id: meta.id, cwd: meta.cwd, project: path.basename(meta.cwd) || meta.cwd, title: oneLine(names.get(meta.id) || prompt || ''), updatedAt: Math.round(entry.mtime), size: entry.size, turns, file: entry.file, source: typeof meta.source === 'string' ? meta.source : null, version: meta.cli_version || null };
}
// A Thread from the app-server's thread/list.
function fromThread(t) {
  if (!t?.id || !t.cwd || t.ephemeral || t.parentThreadId) return null;
  const updated = (t.updatedAt || t.createdAt || 0) * 1000;
  let size = null; try { if (t.path) size = fs.statSync(t.path).size; } catch {}
  return { engine: 'codex', id: t.id, cwd: t.cwd, project: path.basename(t.cwd) || t.cwd, title: oneLine(t.name || t.preview || ''), updatedAt: updated, size, turns: null, file: t.path || null, source: typeof t.source === 'string' ? t.source : null, version: t.cliVersion || null };
}

// --- "Possibly still open in a terminal": a running claude / codex that names the session, or runs in its folder.
function engineOf(command) {
  // the command-line tools are lower-case `claude` / `codex`; the desktop apps (Claude.app, Codex.app) are not terminals
  const parts = String(command).trim().split(/\s+/), exe = path.basename(parts[0] || '').replace(/\.exe$/i, '');
  if (exe === 'claude' || exe === 'codex') return exe;
  if (/^(node|bun|deno)$/.test(exe)) { const script = String(parts[1] || '').toLowerCase(); if (/claude-code|[\\/]claude(\.c?js)?$/.test(script)) return 'claude'; if (/[\\/@]openai[\\/]codex|[\\/]codex(\.c?js)?$/.test(script)) return 'codex'; }
  return null;
}
// `ps -axo pid=,ppid=,command=` lines -> [{pid, ppid, engine, command}], without this app's own children.
function parsePs(text, { self = process.pid } = {}) {
  const rows = String(text).split('\n').map(line => line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], command: m[3] }));
  const parent = new Map(rows.map(r => [r.pid, r.ppid]));
  const ours = pid => { for (let p = pid, i = 0; p && i < 64; p = parent.get(p), i++) if (p === self) return true; return false; };
  return rows.filter(r => !ours(r.pid)).map(r => ({ ...r, engine: engineOf(r.command) })).filter(r => r.engine);
}
function run(command, args, timeout = 2500) { return new Promise(resolve => execFile(command, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout) => resolve(error && !stdout ? '' : String(stdout)))); }
// Running agent CLIs with their command lines and (where the OS tells cheaply) working folders.
async function agentProcesses({ platform = process.platform, self = process.pid } = {}) {
  if (platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name like '%claude%' or Name like '%codex%' or Name like 'node%'\" | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)\" }"], 4000);
    return parsePs(out, { self }).map(p => ({ ...p, cwd: null }));
  }
  const list = parsePs(await run('ps', ['-axo', 'pid=,ppid=,command=']), { self });
  if (!list.length) return list;
  if (platform === 'linux') return list.map(p => { let cwd = null; try { cwd = fs.readlinkSync(`/proc/${p.pid}/cwd`); } catch {} return { ...p, cwd }; });
  const cwds = new Map(), out = await run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', list.map(p => p.pid).join(',')]);
  let pid = null; for (const line of out.split('\n')) { if (line.startsWith('p')) pid = +line.slice(1); else if (line.startsWith('n') && pid) cwds.set(pid, line.slice(1)); }
  return list.map(p => ({ ...p, cwd: cwds.get(p.pid) || null }));
}
// Marks sessions that may be open elsewhere: written in the last few minutes, named by a running process, or the newest
// session of that tool in a folder where that tool is running.
function markOpen(sessions, processes = [], { now = Date.now() } = {}) {
  const newestIn = new Map();
  for (const s of sessions) { const key = `${s.engine}\0${s.cwd}`; if (!newestIn.has(key) || newestIn.get(key).updatedAt < s.updatedAt) newestIn.set(key, s); }
  const norm = p => p ? path.resolve(String(p)).replace(/^\/private(?=\/)/, '') : null;
  return sessions.map(s => {
    const reasons = [];
    if (now - s.updatedAt < RECENT_MS) reasons.push('recent');
    if (processes.some(p => p.engine === s.engine && p.command.toLowerCase().includes(s.id.toLowerCase()))) reasons.push('process');
    else if (newestIn.get(`${s.engine}\0${s.cwd}`) === s && processes.some(p => p.engine === s.engine && p.cwd && norm(p.cwd) === norm(s.cwd) && !(p.command.match(UUID) || []).some(id => id.toLowerCase() !== s.id.toLowerCase()))) reasons.push('folder');
    return { ...s, maybeOpen: reasons.length > 0, openReasons: reasons };
  });
}

// Recent sessions from both tools, newest first. `codexList` (optional) asks the app-server; it returns Threads or throws.
async function listSessions({ home = os.homedir(), codexHome = process.env.CODEX_HOME || path.join(home, '.codex'), limit = 40, now = Date.now(), codexList = null, processes = agentProcesses, engines = ['claude', 'codex'] } = {}) {
  const sessions = [];
  if (engines.includes('claude')) {
    for (const entry of claudeCandidates(home).sort((a, b) => b.mtime - a.mtime)) {
      if (sessions.filter(s => s.engine === 'claude').length >= limit) break;
      try { const s = readClaude(entry); if (s) sessions.push(s); } catch {}
    }
  }
  if (engines.includes('codex')) {
    let threads = null;
    if (codexList) { try { threads = (await codexList({ limit })).map(fromThread).filter(Boolean); } catch { threads = null; } }
    if (!threads?.length) {
      const names = codexNames(codexHome); threads = [];
      for (const entry of codexCandidates(codexHome).sort((a, b) => b.mtime - a.mtime)) { if (threads.length >= limit) break; try { const s = readCodex(entry, names); if (s) threads.push(s); } catch {} }
    }
    // the app-server's updatedAt can lag behind the rollout file: use whichever is newer
    for (const t of threads) { try { if (t.file) t.updatedAt = Math.max(t.updatedAt, Math.round(fs.statSync(t.file).mtimeMs)); } catch {} sessions.push(t); }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  let procs = []; try { procs = typeof processes === 'function' ? await processes() : processes || []; } catch {}
  return markOpen(sessions.slice(0, limit * 2), procs, { now });
}
// The saved session file for a pick, checked again at attach time (it must still exist, and match the engine).
function findSession(list, engine, id) { return list.find(s => s.engine === engine && s.id === id) || null; }
// One session by id, however old (a saved session offered again at start-up may be past the recent list).
function lookupSession({ home = os.homedir(), codexHome = process.env.CODEX_HOME || path.join(home, '.codex'), engine, id }) {
  try {
    if (engine === 'claude') { const entry = claudeCandidates(home).find(e => e.id === id); return entry ? readClaude(entry) : null; }
    if (engine === 'codex') { const entry = codexCandidates(codexHome).find(e => path.basename(e.file).includes(id)); const s = entry ? readCodex(entry, codexNames(codexHome)) : null; return s?.id === id ? s : null; }
  } catch {}
  return null;
}
module.exports = { listSessions, lookupSession, readClaude, readCodex, fromThread, claudeCandidates, codexCandidates, codexNames, markOpen, parsePs, engineOf, agentProcesses, findSession, headLines, tailLines, RECENT_MS };
