// 開發夥伴 in the app: messages go to the session, spoken yes / no only while an approval is pending, the character's
// activity follows the session, replies are spoken in a speakable form, and the attached session is remembered.
const test = require('node:test'); const assert = require('node:assert/strict');
require('../src/main/locales.cjs').setLanguage('zh-Hant');  // the zh-Hant interface text
const { EventEmitter } = require('node:events');
const { createDevCompanion } = require('../src/main/dev-companion.cjs');

class FakeAdapter extends EventEmitter {
  constructor(options) { super(); this.options = options; this.sent = []; this.answers = []; this.closed = false; this.interrupted = 0; }
  async start() { this.emit('event', { type: 'ready', sessionId: this.options.id, mode: 'default' }); }
  send(text) { if (this.busy) throw Object.assign(new Error('busy'), { code: 'BUSY' }); this.busy = true; this.sent.push(text); }
  approve(id) { this.answers.push([id, true]); return true; }
  deny(id) { this.answers.push([id, false]); return true; }
  interrupt() { this.interrupted++; return true; }
  close() { this.closed = true; }
  turn(status = 'completed') { this.busy = false; this.emit('event', { type: 'turn', status }); }
}
function setup({ blocked = null } = {}) {
  const settings = { language: 'zh-TW' }, spoken = [], events = [], activity = [], adapters = [];
  let persisted = 0;
  const companion = createDevCompanion({
    getWin: () => ({ isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } }),
    getRuntime: () => ({ activity: (value, emotion) => activity.push(value) }), getSettings: () => settings, persist: () => { persisted++; },
    speak: text => spoken.push(text), stopSpeech: () => {}, findBinary: () => '/bin/true', canAttach: () => blocked,
    listSessions: async () => [{ engine: 'claude', id: '11111111-2222-4333-8444-555555555555', cwd: '/p/alpha', project: 'alpha', title: 'Login errors', updatedAt: 1, maybeOpen: false, permissionMode: 'acceptEdits' }],
    createAdapter: (engine, options) => { const a = new FakeAdapter({ engine, ...options }); adapters.push(a); return a; } });
  return { companion, settings, spoken, events, activity, adapters, persisted: () => persisted };
}
const ID = '11111111-2222-4333-8444-555555555555';

test('attaching remembers the session; quitting keeps it for a re-attach offer; leaving forgets it', async () => {
  const { companion, settings, adapters, events } = setup();
  const state = await companion.attach({ engine: 'claude', id: ID });
  assert.equal(state.attached.project, 'alpha'); assert.equal(adapters[0].options.mode, 'acceptEdits', 'the session\'s own permission mode');
  assert.equal(settings.devSession.id, ID);
  companion.close();
  assert.ok(adapters[0].closed); assert.equal(settings.devSession.id, ID, 'kept for next start');
  assert.deepEqual(companion.snapshot().offer.id, ID, 'offered again, not attached by itself');
  assert.equal(companion.snapshot().attached, null);
  await companion.attach({ engine: 'claude', id: ID });
  companion.leave();
  assert.equal(settings.devSession, undefined);
  assert.match(events.at(-1).resumeCommand, /^claude --resume 11111111/);
});

test('attaching waits for a running chat or task', async () => {
  const { companion } = setup({ blocked: '請先等目前的聊天或任務結束' });
  await assert.rejects(companion.attach({ engine: 'claude', id: ID }), /請先等/);
  await assert.rejects(setup().companion.attach({ engine: 'claude', id: '../../etc' }), /不認得/);
});

test('yes / no words are answers only while an approval is pending', async () => {
  const { companion, adapters, spoken, activity } = setup();
  await companion.attach({ engine: 'claude', id: ID }); const a = adapters[0];
  assert.deepEqual(companion.input('好'), { ok: true, sent: true }, 'with nothing pending, 好 is a message');
  assert.deepEqual(a.sent, ['好']);
  a.emit('event', { type: 'tool', phase: 'start', name: 'Bash', input: { command: 'npm test' } });
  assert.equal(activity.at(-1), 'working');
  a.emit('event', { type: 'approval', requestId: 'perm-1', tool: 'Bash', input: { command: 'npm test' } });
  assert.equal(activity.at(-1), 'waiting_for_approval');
  assert.equal(spoken.at(-1), '要讓我執行 npm test 嗎？');
  assert.equal(companion.input('幫我順便看一下 README').ok, false, 'other words wait for a decision');
  assert.deepEqual(a.answers, []);
  assert.equal(companion.input('好').answered, 'allow');
  assert.deepEqual(a.answers, [['perm-1', true]]);
  assert.equal(activity.at(-1), 'working');
  a.emit('event', { type: 'approval', requestId: 'perm-2', tool: 'Write', input: { file_path: 'x.txt', content: '' } });
  assert.equal(companion.input('不要').answered, 'deny');
  assert.deepEqual(a.answers.at(-1), ['perm-2', false]);
  // a button answer for a request that is gone is refused
  assert.equal(companion.respond('perm-2', true).ok, false);
  assert.equal(companion.input('還有一件事').busy, true, 'one turn at a time');
  a.emit('event', { type: 'message', text: '好了，改在 `/Users/me/p/src/a.js`：\n```js\nx()\n```' });
  assert.equal(spoken.at(-1), '好了，改在 a.js：（附了一段程式碼）');
  a.turn();
  assert.equal(activity.at(-1), 'success');
  assert.equal(companion.input('好').sent, true, 'after the turn 好 is a message again');
});

test('停下來 interrupts and withdraws pending approvals; phone turns are not spoken on the Mac', async () => {
  const { companion, adapters, spoken, events } = setup();
  await companion.attach({ engine: 'claude', id: ID }); const a = adapters[0];
  companion.input('慢慢做');
  a.emit('event', { type: 'approval', requestId: 'perm-9', tool: 'Bash', input: { command: 'make' } });
  assert.equal(companion.input('停下來').interrupted, true);
  assert.equal(a.interrupted, 1); assert.deepEqual(a.answers, [['perm-9', false]]);
  assert.ok(events.some(e => e.type === 'resolved' && e.requestId === 'perm-9' && e.result === 'denied'));
  a.turn('interrupted');
  assert.equal(events.at(-1).status, 'interrupted');
  const before = spoken.length;
  companion.input('從手機問的', { source: 'phone', device: 'dev-1' });
  assert.equal(events.filter(e => e.type === 'user').at(-1).from, 'dev-1', 'the remote server skips the phone that sent it');
  a.emit('event', { type: 'message', text: '手機的回覆' }); a.turn();
  assert.equal(spoken.length, before, 'the phone reads its own replies');
  assert.equal(events.filter(e => e.type === 'reply').at(-1).spoken, '手機的回覆');
});
