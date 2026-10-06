// 開發夥伴 speech: replies made speakable, tool one-liners, approval questions and spoken answers.
const test = require('node:test'); const assert = require('node:assert/strict');
const { speakable, describeTool, StatusVoice, describeApproval, parseApprovalAnswer, isStopCommand } = require('../dev-speech.cjs');

test('code blocks, tables, links and long paths become short notes', () => {
  const reply = '我改好了 `/Users/me/project/src/renderer/main.cjs`，重點如下：\n\n```js\nconst a = 1;\nconsole.log(a);\n```\n\n| 檔案 | 行數 |\n|---|---|\n| a.js | 3 |\n\n詳情看 https://example.com/pr/12 。另外 **記得** 跑 `npm test`。';
  const s = speakable(reply);
  assert.match(s, /main\.cjs/); assert.doesNotMatch(s, /\/Users\/me/);
  assert.match(s, /（附了一段程式碼）/); assert.doesNotMatch(s, /console\.log/);
  assert.match(s, /（附了一個表格）/); assert.doesNotMatch(s, /\|/);
  assert.match(s, /（連結）/); assert.doesNotMatch(s, /https?:/);
  assert.match(s, /記得 跑 npm test|記得跑 npm test/); assert.doesNotMatch(s, /\*\*|`/);
  assert.equal((s.match(/附了一段程式碼/g) || []).length, 1);
});
test('a long reply is cut at a sentence and points to the chat', () => {
  const long = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 點，這裡說明一個改動的細節。`).join('');
  const s = speakable(long, { max: 120 });
  assert.ok([...s].length <= 140, s.length); assert.match(s, /。完整內容在聊天框。$/);
  const en = speakable('This is a sentence. '.repeat(40), { language: 'en', max: 100 });
  assert.match(en, /\. The full reply is in the chat\.$/);
  assert.equal(speakable('短短一句。'), '短短一句。');
});
test('tool descriptions and debounced spoken one-liners', () => {
  assert.equal(describeTool('Bash', { command: 'npm test' }).label, '正在執行 npm test');
  assert.equal(describeTool('Bash', { command: 'npm test' }).spoken, '我在跑測試');
  assert.equal(describeTool('Edit', { file_path: '/a/b/main.cjs' }).label, '正在編輯 main.cjs');
  assert.equal(describeTool('Read', { file_path: '/a/b/x.md' }).spoken, null, 'reading is not worth saying');
  assert.equal(describeTool('commandExecution', { command: 'ls' }, { language: 'en' }).label, 'running ls');
  let now = 0; const voice = new StatusVoice({ gap: 20000, settle: 5000, now: () => now });
  const test = describeTool('Bash', { command: 'npm test' }), edit = describeTool('Edit', { file_path: 'a.js' });
  voice.turn();
  assert.equal(voice.offer(test), null, 'nothing in the first seconds of a turn');
  now = 6000; assert.equal(voice.offer(test), '我在跑測試');
  now = 9000; assert.equal(voice.offer(edit), null, 'not two within the gap');
  now = 30000; assert.equal(voice.offer(test), null, 'not the same kind twice in a row');
  assert.equal(voice.offer(edit, { speaking: true }), null, 'not over the character speaking');
  assert.equal(voice.offer(edit), '我在改 a.js');
});
test('approval questions say what is asked', () => {
  assert.equal(describeApproval({ tool: 'Bash', input: { command: 'npm test' } }).question, '要讓我執行 npm test 嗎？');
  assert.equal(describeApproval({ tool: 'Bash', input: { command: 'x'.repeat(80) } }).question, '要讓我執行一個指令嗎？');
  const edit = describeApproval({ tool: 'Edit', input: { file_path: '/p/src/main.cjs', old_string: 'a\nb', new_string: 'c' } });
  assert.equal(edit.question, '要讓我修改 main.cjs 嗎？'); assert.match(edit.diff, /−2 \+1/);
  assert.equal(describeApproval({ tool: 'Write', input: { file_path: 'hello.txt', content: 'hi' } }).question, '要讓我寫入 hello.txt 嗎？');
  const files = describeApproval({ codex: { kind: 'files', changes: [{ path: '/p/a.js', kind: 'update', diff: '-x\n+y\n+z' }] } });
  assert.equal(files.question, '要讓我修改 a.js 嗎？'); assert.match(files.diff, /\+2 −1/);
  assert.equal(describeApproval({ codex: { kind: 'command', command: 'npm test', cwd: '/p' } }).question, '要讓我執行 npm test 嗎？');
  assert.equal(describeApproval({ tool: 'mcp__github__create_issue', input: { title: 'x' } }).question, '要讓我使用 github · create_issue 嗎？');
  assert.equal(describeApproval({ tool: 'Bash', input: { command: 'ls' } }, { language: 'en' }).question, 'Can I run ls?');
});
test('spoken answers: short yes / no only, negatives first', () => {
  for (const yes of ['允許', '好', '好的', '可以', '可以啊', 'yes', 'OK', 'Sure!', '好，執行吧']) assert.equal(parseApprovalAnswer(yes), 'allow', yes);
  for (const no of ['拒絕', '不要', '不行', '不可以', '不好', 'no', 'Nope', '別這樣', '取消']) assert.equal(parseApprovalAnswer(no), 'deny', no);
  for (const other of ['', '你好', '今天天氣怎麼樣', '好啦我想想看這個檔案到底要不要改比較好', 'what does this do']) assert.equal(parseApprovalAnswer(other), null, other);
  for (const stop of ['停下來', '停下來。', 'Stop', '停止']) assert.ok(isStopCommand(stop), stop);
  assert.ok(!isStopCommand('不要停下來繼續做'));
});
