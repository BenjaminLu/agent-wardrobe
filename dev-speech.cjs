// What the companion says while it is attached to a coding session (開發夥伴): replies made speakable, short tool
// one-liners (rate-limited), approval questions, and the spoken answers to them. Pure functions, no I/O.
const path = require('node:path');
const L = require('./locales.cjs');

// language: an interface language (zh-Hant, zh-Hans, en, ja); the current interface language when not given
const tr = language => L.t.in(L.LANGS.includes(language) ? language : L.language);
// Chinese and Japanese sentences run on without spaces between them
const runOn = language => /^(zh|ja)/.test(L.LANGS.includes(language) ? language : L.language);
const clip = (text, n) => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return [...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s; };
const base = file => String(file || '').split(/[\\/]/).filter(Boolean).pop() || String(file || '');

// A reply written for a terminal, reduced to something a character can say: code blocks, tables and long paths are
// replaced by a short note, markdown is dropped, and a long reply stops after a few sentences with a pointer to the chat.
function speakable(text, { language, max = 240 } = {}) {
  const t = tr(language), join = runOn(language) ? '' : ' ';
  const CODE = t('devCompanion.speech.code'), TABLE = t('devCompanion.speech.table'), LINK = t('devCompanion.speech.link');
  let s = String(text || '').replace(/\r/g, '');
  s = s.replace(/```[\s\S]*?(```|$)/g, `\n${CODE}\n`);
  s = s.split('\n').map(line => /^\s*\|.*\|\s*$/.test(line) ? (/^\s*\|[\s:|-]+\|\s*$/.test(line) ? '' : TABLE) : line).join('\n');
  s = s.replace(new RegExp(`(${TABLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*)+`, 'g'), TABLE + '\n');
  s = s.replace(/https?:\/\/\S+/g, LINK);
  // inline code: short words stay (npm test), anything long becomes its last path part or is dropped
  s = s.replace(/`([^`\n]*)`/g, (_m, code) => code.length <= 28 && !/[\\/]/.test(code) ? code : /[\\/]/.test(code) && !/\s/.test(code) ? base(code) : '');
  // file paths with folders: say just the file name
  s = s.replace(/(?:~|\.{1,2})?(?:[\\/][\w.@+-]+){2,}[\\/]?/g, m => base(m)).replace(/\b[A-Za-z]:\\[^\s]+/g, m => base(m));
  s = s.replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '').replace(/^\s*>\s?/gm, '');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2').replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$)/g, '$1$2').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  s = s.split('\n').map(line => line.trim()).filter(Boolean).join(join).replace(/\s+/g, ' ').trim();
  // the same note twice in a row is said once
  for (const note of [CODE, TABLE]) while (s.includes(note + note)) s = s.replaceAll(note + note, note);
  if ([...s].length <= max) return s;
  const MORE = t('devCompanion.speech.more');
  const chars = [...s].slice(0, max).join('');
  // the end of the last whole sentence (marks of the reply's own language, whatever the interface language)
  const cut = Math.max(-1, ...[...chars.matchAll(/[。！？；]|[.!?] /g)].map(m => m.index));
  const head = cut > max * 0.4 ? chars.slice(0, cut + 1).trim() : chars.replace(/[，,、\s]*\S{0,6}$/, '') + '…';
  return `${head}${join}${MORE}`;
}

// A tool use described for the status line ("正在編輯 main.cjs") and, sometimes, said aloud ("我在改 main.cjs").
function describeTool(name, input = {}, { language } = {}) {
  const t = tr(language); input = input && typeof input === 'object' ? input : {};
  const file = base(input.file_path || input.notebook_path || input.path || '');
  const command = clip(input.command || input.cmd || '', 60);
  const kind = /^(Bash|PowerShell|commandExecution|shell|exec_command|local_shell)$/i.test(name) ? 'run'
    : /^(Edit|MultiEdit|Write|NotebookEdit|fileChange|apply_patch)$/i.test(name) ? 'edit'
    : /^(Read|NotebookRead)$/i.test(name) ? 'read' : /^(Grep|Glob|LS|webSearch|search)$/i.test(name) ? 'search'
    : /^(WebFetch|WebSearch)$/i.test(name) ? 'web' : /^(Task|Agent)$/i.test(name) ? 'agent' : /^(TodoWrite|TaskCreate|TaskUpdate|plan)$/i.test(name) ? 'plan' : 'tool';
  const test = kind === 'run' && /\b(test|jest|vitest|mocha|pytest|go test|cargo test|smoke|check)\b/i.test(command);
  const label = {
    run: () => command ? t('devCompanion.tool.run', { command }) : t('devCompanion.tool.runAny'),
    edit: () => file ? t('devCompanion.tool.edit', { file }) : t('devCompanion.tool.editAny'),
    read: () => file ? t('devCompanion.tool.read', { file }) : t('devCompanion.tool.readAny'),
    search: () => t('devCompanion.tool.search'), web: () => t('devCompanion.tool.web'), agent: () => t('devCompanion.tool.agent'), plan: () => t('devCompanion.tool.plan'),
    tool: () => t('devCompanion.tool.tool', { name }) }[kind]();
  const spoken = test ? t('devCompanion.toolSpoken.test') : {
    run: () => t('devCompanion.toolSpoken.run'), edit: () => file ? t('devCompanion.toolSpoken.edit', { file }) : t('devCompanion.toolSpoken.editAny'),
    web: () => t('devCompanion.toolSpoken.web'), agent: () => t('devCompanion.toolSpoken.agent') }[kind]?.() ?? null;
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
function describeApproval({ tool, input = {}, codex = null }, { language } = {}) {
  const t = tr(language); input = input && typeof input === 'object' ? input : {};
  const lines = s => String(s || '').split('\n').length;
  if (codex?.kind === 'command' || /^(Bash|PowerShell)$/.test(tool)) {
    const command = String(codex?.command ?? input.command ?? ''), short = clip(command, 48);
    return { title: t('devCompanion.approval.runTitle'), command: clip(command, 600), cwd: codex?.cwd || null, reason: clip(codex?.reason || input.description || '', 200) || null,
      question: short && short.length <= 40 ? t('devCompanion.approval.runQuestion', { command: short }) : t('devCompanion.approval.runQuestionAny') };
  }
  if (codex?.kind === 'files') {
    const files = codex.changes || [], names = files.map(f => base(f.path));
    const summary = files.slice(0, 8).map(f => { const add = (String(f.diff || '').match(/^\+(?!\+\+)/gm) || []).length, del = (String(f.diff || '').match(/^-(?!--)/gm) || []).length; return `${f.kind || 'update'} ${f.path}${f.diff ? t('devCompanion.approval.fileDiff', { add, del }) : ''}`; }).join('\n');
    return { title: t('devCompanion.approval.changeTitle'), files: names, diff: summary || null, reason: clip(codex.reason || '', 200) || null,
      question: names.length === 1 ? t('devCompanion.approval.changeOne', { file: names[0] }) : names.length ? t('devCompanion.approval.changeMany', { count: names.length }) : t('devCompanion.approval.changeAny') };
  }
  if (codex?.kind === 'permissions') return { title: t('devCompanion.approval.permissionsTitle'), detail: clip(JSON.stringify(codex.permissions || {}), 400), reason: clip(codex.reason || '', 200) || null, question: t('devCompanion.approval.permissionsQuestion') };
  if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(tool)) {
    const file = base(input.file_path || input.notebook_path);
    const edits = tool === 'MultiEdit' ? input.edits || [] : tool === 'Edit' ? [input] : [];
    const diff = tool === 'Write' ? t('devCompanion.approval.writeLines', { count: lines(input.content) }) : edits.length ? edits.slice(0, 4).map(e => t('devCompanion.approval.editLine', { del: lines(e.old_string), add: lines(e.new_string), text: clip(e.new_string, 80) })).join('\n') : null;
    const kind = tool === 'Write' ? 'write' : 'edit';
    return { title: t(`devCompanion.approval.${kind}Title`), files: [input.file_path || input.notebook_path || file].filter(Boolean), diff,
      question: file ? t(`devCompanion.approval.${kind}Question`, { file }) : t(`devCompanion.approval.${kind}QuestionAny`) };
  }
  if (/^(WebFetch|WebSearch)$/.test(tool)) return { title: t('devCompanion.approval.webTitle'), detail: clip(input.url || input.query || '', 300), question: t('devCompanion.approval.webQuestion') };
  const name = String(tool || '').replace(/^mcp__([^_]+)__/, '$1 · ');
  return { title: t('devCompanion.approval.useTitle', { name }), detail: clip(JSON.stringify(input), 400), question: t('devCompanion.approval.useQuestion', { name: clip(name, 30) }) };
}

// A spoken (or typed) answer to a pending approval. Only short replies count, so a sentence that merely contains 好 is
// not a yes; negatives are checked first (不好, 不可以, 不要).
function parseApprovalAnswer(text) {
  const s = String(text || '').toLowerCase().replace(/[\s,.!?;:~，。！？；：、「」"'…]+/g, ' ').trim();
  if (!s || [...s.replace(/ /g, '')].length > 12 || s.split(' ').length > 4) return null;
  if (/(不要|不行|不可以|不好|不准|不用|拒絕|拒绝|取消|別|别|不同意|いいえ|だめ|ダメ|やめて|拒否|キャンセル|^no\b|nope|deny|don't|do not|reject|cancel|stop)/.test(s)) return 'deny';
  // a yes is made only of yes-words (好, 可以, 執行吧, ok…), so 你好 or a question is not one
  if (/^(?:(?:好|好的|可以|行|允許|允许|同意|准|確定|确定|沒問題|没问题|執行|执行|去|做|ok|okay|yes|yeah|yep|sure|allow|approve|go ahead|do it|please|はい|いいよ|いいです|オッケー|オーケー|どうぞ|許可|お願いします|お願い)[啊吧喔哦呀的了ねよ]*\s*)+$/.test(s)) return 'allow';
  return null;
}
// 「停下來」: interrupts the running turn (only as a short command on its own).
function isStopCommand(text) {
  const s = String(text || '').toLowerCase().replace(/[\s,.!?;:~，。！？；：、]+/g, '').trim();
  return /^(停下來|停下来|停止|停一下|先停|停|暫停|暂停|stop|stopit|wait|hold on|holdon|算了先停|止めて|とめて|止まって|ストップ|待って|ちょっと待って)$/.test(s);
}
module.exports = { speakable, describeTool, StatusVoice, describeApproval, parseApprovalAnswer, isStopCommand, clip, base };
