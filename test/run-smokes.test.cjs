const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAll, suites } = require('../scripts/run-smokes.cjs');

const suite = (name, extra = {}) => ({ name, marker: 'SMOKE_OK', args: [], ...extra });
const pass = { status: 0, stdout: 'SMOKE_OK', stderr: '' };
const fail = { status: 1, stdout: 'gl_utils noise\nPOC_SMOKE_FAILED expected failure\ndetail', stderr: '' };
function harness(t, ci, answer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-smokes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const summaryFile = path.join(dir, 'summary.md');
  fs.writeFileSync(summaryFile, 'Existing summary\n');
  const userData = path.join(dir, 'userdata');
  const calls = [], logs = [], events = [];
  const options = {
    ci, summaryFile, userData,
    spawn(s) { calls.push(s.name); events.push(`spawn:${s.name}`); return answer(s, calls.length); },
    rm(p) { assert.equal(p, userData); events.push('rm'); },
    log(line) { logs.push(line); events.push(`log:${line}`); }
  };
  return { calls, logs, events, options, summary: () => fs.readFileSync(summaryFile, 'utf8') };
}

test('outside CI a failure runs once', t => {
  const h = harness(t, false, () => fail);
  const result = runAll([suite('single')], h.options);
  assert.equal(result.code, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(h.calls, ['single']);
  assert.equal(h.logs.at(-1), '1 smoke suite(s) failed');
  assert.equal(h.summary(), 'Existing summary\n');
  assert.match(h.logs[0], /^FAIL  single \(\d+ s\)$/);
});

test('CI retries a failure once and reports recovery in the log and summary', t => {
  const h = harness(t, true, (_, n) => n === 1 ? fail : pass);
  const result = runAll([suite('flaky')], h.options);
  assert.deepEqual(h.calls, ['flaky', 'flaky']);
  assert.equal(result.code, 0);
  assert.equal(result.failed, 0);
  assert.match(h.logs[0], /^FAIL \(attempt 1 of 2\)  flaky \(\d+ s\)$/);
  assert.ok(h.logs.includes('  POC_SMOKE_FAILED expected failure\n  detail'));
  assert.ok(!h.logs.join('\n').includes('gl_utils'));
  assert.ok(h.events.indexOf('log:  POC_SMOKE_FAILED expected failure\n  detail') < h.events.lastIndexOf('spawn:flaky'));
  assert.ok(h.logs.some(line => /^pass on retry  flaky \(\d+ s\)$/.test(line)));
  assert.equal(h.logs.at(-1), 'all smoke suites passed (1 passed on retry: flaky)');
  assert.equal(h.summary(), 'Existing summary\n- passed on retry: flaky\n');
});

test('CI stops after two failures and reports failed twice', t => {
  const h = harness(t, true, () => fail);
  const result = runAll([suite('broken')], h.options);
  assert.deepEqual(h.calls, ['broken', 'broken']);
  assert.equal(result.code, 1);
  assert.equal(result.failed, 1);
  assert.ok(h.logs.some(line => /^FAIL  broken \(\d+ s\)$/.test(line)));
  assert.equal(h.logs.at(-1), '1 smoke suite(s) failed');
  assert.equal(h.summary(), 'Existing summary\n- failed twice: broken\n');
});

test('CI runs a passing suite once', t => {
  const h = harness(t, true, () => pass);
  assert.equal(runAll([suite('healthy')], h.options).code, 0);
  assert.deepEqual(h.calls, ['healthy']);
  assert.equal(h.logs.at(-1), 'all smoke suites passed');
  assert.equal(h.summary(), 'Existing summary\n');
});

test('each attempt preserves removal, prepare, spawn and cleanup order', t => {
  const h = harness(t, true, (_, n) => n === 1 ? fail : pass);
  runAll([suite('fixture', {
    prepare: () => h.events.push('prepare'), cleanup: () => h.events.push('cleanup')
  })], h.options);
  assert.deepEqual(h.events.filter(e => !e.startsWith('log:')), [
    'rm', 'prepare', 'spawn:fixture', 'cleanup', 'rm',
    'rm', 'prepare', 'spawn:fixture', 'cleanup', 'rm'
  ]);
});

for (const failedMember of ['write', 'read']) {
  test(`a failing ${failedMember} retries the whole keep/reuse pair in order`, t => {
    const h = harness(t, true, (s, n) => n <= 2 && s.name === failedMember ? fail : pass);
    const pair = [suite('write', { keep: true }), suite('read', { reuse: true })];
    assert.equal(runAll(pair, h.options).code, 0);
    assert.deepEqual(h.calls, ['write', 'read', 'write', 'read']);
    assert.deepEqual(h.events.filter(e => !e.startsWith('log:')), [
      'rm', 'spawn:write', 'spawn:read', 'rm', 'rm', 'spawn:write', 'spawn:read', 'rm'
    ]);
    assert.ok(h.logs.some(line => line.startsWith(`pass  ${failedMember === 'write' ? 'read' : 'write'} `)));
    assert.equal(h.logs.at(-1), 'all smoke suites passed (1 passed on retry: write + read)');
    assert.equal(h.summary(), 'Existing summary\n- passed on retry: write + read\n');
  });
}

test('retry results replace both first-attempt results', t => {
  const h = harness(t, true, (_, n) => n === 2 || n === 3 ? fail : pass);
  const result = runAll([suite('write', { keep: true }), suite('read', { reuse: true })], h.options);
  assert.equal(result.code, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(h.calls, ['write', 'read', 'write', 'read']);
  assert.equal(h.summary(), 'Existing summary\n- failed twice: write + read\n');
  assert.equal(h.logs.at(-1), '1 smoke suite(s) failed');
});

test('caller-omitted suites are never spawned, including during retries', t => {
  const h = harness(t, true, (_, n) => n === 1 ? fail : pass);
  const available = [suite('included'), suite('skipped')];
  runAll(available.slice(0, 1), h.options);
  assert.deepEqual(h.calls, ['included', 'included']);
});

test('real definitions group only memory write/read into one retry unit', t => {
  const pairs = suites.flatMap((s, i) => s.keep && suites[i + 1]?.reuse ? [[s.name, suites[i + 1].name]] : []);
  assert.deepEqual(pairs, [['memory and input (write)', 'memory and input (read after restart)']]);
  // Retain real metadata but replace fixture hooks: this test must not create audio or launch Electron.
  const definitions = suites.map(s => ({ ...s, prepare: undefined, cleanup: undefined }));
  const h = harness(t, true, () => fail);
  runAll(definitions, h.options);
  const expected = [];
  for (const s of definitions) {
    if (s.name === pairs[0][0]) expected.push(...pairs[0], ...pairs[0]);
    else if (s.name !== pairs[0][1]) expected.push(s.name, s.name);
  }
  assert.deepEqual(h.calls, expected);
});

test('success still requires status zero, a marker and no failure marker', t => {
  const failures = [
    { ...pass, status: 1 }, { ...pass, stdout: 'no marker' },
    { ...pass, stderr: 'POC_SMOKE_FAILED' }, { ...pass, status: null, signal: 'SIGTERM' }
  ];
  for (const output of failures) {
    const h = harness(t, true, () => output);
    assert.equal(runAll([suite('invalid')], h.options).code, 1);
    assert.equal(h.calls.length, 2);
  }
});

test('a final failure retains the names of other units that recovered', t => {
  const h = harness(t, true, (s, n) => s.name === 'recovered' && n === 2 ? pass : fail);
  assert.equal(runAll([suite('recovered'), suite('broken')], h.options).code, 1);
  assert.equal(h.logs.at(-1), '1 smoke suite(s) failed (1 passed on retry: recovered)');
  assert.equal(h.summary(), 'Existing summary\n- passed on retry: recovered\n- failed twice: broken\n');
});
