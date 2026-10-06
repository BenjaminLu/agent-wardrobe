// What the companion says while it is attached to a coding session (開發夥伴): replies made speakable, short tool
// one-liners (rate-limited), approval questions, and the spoken answers to them. Pure functions, no I/O.
const path = require('node:path');

const isZh = language => String(language || 'zh').startsWith('zh');
const clip = (text, n) => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return [...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s; };
const base = file => String(file || '').split(/[\\/]/).filter(Boolean).pop() || String(file || '');

// A reply written for a terminal, reduced to something a character can say: code blocks, tables and long paths are
// replaced by a short note, markdown is dropped, and a long reply stops after a few sentences with a pointer to the chat.
function speakable(text, { language = 'zh', max = 240 } = {}) {
  const zh = isZh(language);
  const CODE = zh ? '（附了一段程式碼）' : '(I included some code.)', TABLE = zh ? '（附了一個表格）' : '(I included a table.)', LINK = zh ? '（連結）' : '(link)';
  let s = String(text || '').replace(/\r/g, '');
  s = s.replace(/```[\s\S]*?(```|$)/g, `\n${CODE}\n`);
  s = s.split('\n').map(line => /^\s*\|.*\|\s*$/.test(line) ? (/^\s*\|[\s:|-]+\|\s*$/.test(line) ? '' : TABLE) : line).join('\n');
  s = s.replace(new RegExp(`(${TABLE.replace(/[()（）.]/g, '\\$&')}\\s*)+`, 'g'), TABLE + '\n');
  s = s.replace(/https?:\/\/\S+/g, LINK);
  // inline code: short words stay (npm test), anything long becomes its last path part or is dropped
  s = s.replace(/`([^`\n]*)`/g, (_m, code) => code.length <= 28 && !/[\\/]/.test(code) ? code : /[\\/]/.test(code) && !/\s/.test(code) ? base(code) : '');
  // file paths with folders: say just the file name
  s = s.replace(/(?:~|\.{1,2})?(?:[\\/][\w.@+-]+){2,}[\\/]?/g, m => base(m)).replace(/\b[A-Za-z]:\\[^\s]+/g, m => base(m));
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/^\s*>\s?/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2').replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$)/g, '$1$2').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.split('\n').map(line => line.trim()).filter(Boolean).join(zh ? '' : ' ').replace(/\s+/g, ' ').trim();
  // the same note twice in a row is said once
  for (const note of [CODE, TABLE]) while (s.includes(note + note)) s = s.replaceAll(note + note, note);
  if ([...s].length <= max) return s;
  const MORE = zh ? '完整內容在聊天框。' : 'The full reply is in the chat.';
  const chars = [...s].slice(0, max).join('');
  const cut = Math.max(...['。', '！', '？', '. ', '! ', '? ', '；'].map(mark => chars.lastIndexOf(mark)));
  const head = cut > max * 0.4 ? chars.slice(0, cut + 1).trim() : chars.replace(/[，,、\s]*\S{0,6}$/, '') + '…';
  return `${head}${zh ? '' : ' '}${MORE}`;
}

// A tool use described for the status line ("正在編輯 main.cjs") and, sometimes, said aloud ("我在改 main.cjs").
function describeTool(name, input = {}, { language = 'zh' } = {}) {
  const zh = isZh(language); input = input && typeof input === 'object' ? input : {};
  const file = base(input.file_path || input.notebook_path || input.path || '');
  const command = clip(input.command || input.cmd || '', 60);
  const kind = /^(Bash|PowerShell|commandExecution|shell|exec_command|local_shell)$/i.test(name) ? 'run'
    : /^(Edit|MultiEdit|Write|NotebookEdit|fileChange|apply_patch)$/i.test(name) ? 'edit'
    : /^(Read|NotebookRead)$/i.test(name) ? 'read' : /^(Grep|Glob|LS|webSearch|search)$/i.test(name) ? 'search'
    : /^(WebFetch|WebSearch)$/i.test(name) ? 'web' : /^(Task|Agent)$/i.test(name) ? 'agent' : /^(TodoWrite|TaskCreate|TaskUpdate|plan)$/i.test(name) ? 'plan' : 'tool';
  const test = kind === 'run' && /\b(test|jest|vitest|mocha|pytest|go test|cargo test|smoke|check)\b/i.test(command);
  const label = zh
    ? { run: `正在執行 ${command || '指令'}`, edit: `正在編輯 ${file || '檔案'}`, read: `正在讀 ${file || '檔案'}`, search: '正在搜尋程式碼', web: '正在查網路資料', agent: '交給子代理處理', plan: '正在整理待辦', tool: `正在用 ${name}` }[kind]
    : { run: `running ${command || 'a command'}`, edit: `editing ${file || 'a file'}`, read: `reading ${file || 'a file'}`, search: 'searching the code', web: 'looking things up online', agent: 'handing work to a subagent', plan: 'updating the plan', tool: `using ${name}` }[kind];
  const spoken = zh
    ? (test ? '我在跑測試' : { run: '我在執行指令', edit: `我在改 ${file || '檔案'}`, read: null, search: null, web: '我上網查一下', agent: '我請幫手處理一部分', plan: null, tool: null }[kind])
    : (test ? 'Running the tests' : { run: 'Running a command', edit: `Editing ${file || 'a file'}`, read: null, search: null, web: 'Looking it up online', agent: 'Getting a helper on part of it', plan: null, tool: null }[kind]);
  return { kind, label, spoken, test };
}

// One-liners said while tools run: never two within `gap` ms, never while the character is already talking, never the
// same kind twice in a row, and none in the first `settle` ms of a turn (short turns just answer).
class StatusVoice {
  constructor({ gap = 25000, settle = 6000, now = () => Date.now() } = {}) { this.gap = gap; this.settle = settle; this.now = now; this.last = -Infinity; this.lastKind = null; this.turnStart = 0; }
  turn() { this.turnStart = this.now(); this.lastKind = null; }
  offer(tool, { speaking = false } = {}) {
    if (!tool?.spoken || speaking) return null;
    const t = this.now(), kind = tool.test ? 'test' : tool.kind;
    if (t - this.turnStart < this.settle || t - this.last < this.gap || kind === this.lastKind) return null;
    this.last = t; this.lastKind = kind; return tool.spoken;
  }
}

// What is being asked, for the approval card and the spoken question. Claude tools (Bash, Edit, Write…) and Codex requests.
function describeApproval({ tool, input = {}, codex = null }, { language = 'zh' } = {}) {
  const zh = isZh(language); input = input && typeof input === 'object' ? input : {};
  const lines = s => String(s || '').split('\n').length;
  if (codex?.kind === 'command' || /^(Bash|PowerShell)$/.test(tool)) {
    const command = String(codex?.command ?? input.command ?? ''), short = clip(command, 48);
    return { title: zh ? '執行指令' : 'Run a command', command: clip(command, 600), cwd: codex?.cwd || null, reason: clip(codex?.reason || input.description || '', 200) || null,
      question: zh ? (short.length <= 40 && short ? `要讓我執行 ${short} 嗎？` : '要讓我執行一個指令嗎？') : (short ? `Can I run ${short}?` : 'Can I run a command?') };
  }
  if (codex?.kind === 'files') {
    const files = codex.changes || [], names = files.map(f => base(f.path));
    const summary = files.slice(0, 8).map(f => { const add = (String(f.diff || '').match(/^\+(?!\+\+)/gm) || []).length, del = (String(f.diff || '').match(/^-(?!--)/gm) || []).length; return `${f.kind || 'update'} ${f.path}${f.diff ? `（+${add} −${del}）` : ''}`; }).join('\n');
    return { title: zh ? '修改檔案' : 'Change files', files: names, diff: summary || null, reason: clip(codex.reason || '', 200) || null,
      question: zh ? (names.length === 1 ? `要讓我修改 ${names[0]} 嗎？` : names.length ? `要讓我修改 ${names.length} 個檔案嗎？` : '要讓我修改檔案嗎？') : (names.length === 1 ? `Can I change ${names[0]}?` : 'Can I change these files?') };
  }
  if (codex?.kind === 'permissions') return { title: zh ? '額外權限' : 'Extra permissions', detail: clip(JSON.stringify(codex.permissions || {}), 400), reason: clip(codex.reason || '', 200) || null, question: zh ? '要給我額外的權限嗎？' : 'Can I have extra permissions?' };
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) {
    const file = base(input.file_path || input.notebook_path);
    const edits = tool === 'MultiEdit' ? input.edits || [] : tool === 'Edit' ? [input] : [];
    const diff = tool === 'Write' ? (zh ? `寫入 ${lines(input.content)} 行` : `writes ${lines(input.content)} lines`) : edits.length ? edits.slice(0, 4).map(e => `−${lines(e.old_string)} +${lines(e.new_string)}：${clip(e.new_string, 80)}`).join('\n') : null;
    return { title: zh ? (tool === 'Write' ? '寫入檔案' : '修改檔案') : (tool === 'Write' ? 'Write a file' : 'Edit a file'), files: [input.file_path || input.notebook_path || file].filter(Boolean), diff,
      question: zh ? (tool === 'Write' ? `要讓我寫入 ${file || '檔案'} 嗎？` : `要讓我修改 ${file || '檔案'} 嗎？`) : (tool === 'Write' ? `Can I write ${file || 'a file'}?` : `Can I edit ${file || 'a file'}?`) };
  }
  if (/^(WebFetch|WebSearch)$/.test(tool)) return { title: zh ? '上網' : 'Go online', detail: clip(input.url || input.query || '', 300), question: zh ? '要讓我上網查資料嗎？' : 'Can I look this up online?' };
  const name = String(tool || '').replace(/^mcp__([^_]+)__/, '$1 · ');
  return { title: zh ? `使用 ${name}` : `Use ${name}`, detail: clip(JSON.stringify(input), 400), question: zh ? `要讓我使用 ${clip(name, 30)} 嗎？` : `Can I use ${clip(name, 30)}?` };
}

// A spoken (or typed) answer to a pending approval. Only short replies count, so a sentence that merely contains 好 is
// not a yes; negatives are checked first (不好, 不可以, 不要).
function parseApprovalAnswer(text) {
  const s = String(text || '').toLowerCase().replace(/[\s,.!?;:~，。！？；：、「」"'…]+/g, ' ').trim();
  if (!s || [...s.replace(/ /g, '')].length > 12 || s.split(' ').length > 4) return null;
  if (/(不要|不行|不可以|不好|不准|不用|拒絕|拒绝|取消|別|别|不同意|^no\b|nope|deny|don't|do not|reject|cancel|stop)/.test(s)) return 'deny';
  // a yes is made only of yes-words (好, 可以, 執行吧, ok…), so 你好 or a question is not one
  if (/^(?:(?:好|好的|可以|行|允許|允许|同意|准|確定|确定|沒問題|没问题|執行|执行|去|做|ok|okay|yes|yeah|yep|sure|allow|approve|go ahead|do it|please)[啊吧喔哦呀的了]*\s*)+$/.test(s)) return 'allow';
  return null;
}
// 「停下來」: interrupts the running turn (only as a short command on its own).
function isStopCommand(text) {
  const s = String(text || '').toLowerCase().replace(/[\s,.!?;:~，。！？；：、]+/g, '').trim();
  return /^(停下來|停下来|停止|停一下|先停|停|暫停|暂停|stop|stopit|wait|hold on|holdon|算了先停)$/.test(s);
}
module.exports = { speakable, describeTool, StatusVoice, describeApproval, parseApprovalAnswer, isStopCommand, clip, base };
