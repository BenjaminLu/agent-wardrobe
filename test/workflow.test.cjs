const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lines = fs.readFileSync(path.join(__dirname, '../.github/workflows/app.yml'), 'utf8').split(/\r?\n/);

// Read only two-space children of a top-level section, not nested step names.
// This deliberately checks the workflow's text structure without a YAML dependency.
function children(section) {
  const start = lines.indexOf(`${section}:`);
  assert.notEqual(start, -1, `missing ${section} section`);
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^  ([\w-]+):\s*$/.exec(line);
    if (match) entries.push({ id: match[1], lines: [] });
    else if (entries.length) entries.at(-1).lines.push(line);
  }
  return entries;
}

const jobs = children('jobs');
function job(id) {
  const matches = jobs.filter(entry => entry.id === id);
  assert.equal(matches.length, 1, `expected one job with id ${id}`);
  return matches[0].lines;
}

test('app workflow reports exactly one aggregate check named test', () => {
  const namedTest = jobs.filter(entry => entry.lines.includes('    name: test'));
  assert.deepEqual(namedTest.map(entry => entry.id), ['test']);
  assert.ok(!job('test').includes('    strategy:'), 'aggregate must not be a matrix');
});

test('aggregate waits for test-os even when the matrix does not succeed', () => {
  const aggregate = job('test');
  assert.ok(aggregate.includes('    needs: [test-os]'));
  assert.ok(aggregate.includes('    if: always()'));
  assert.ok(aggregate.includes('    runs-on: ubuntu-latest'));
});

test('aggregate prints the matrix result and fails unless it is success', () => {
  const aggregate = job('test');
  assert.equal(aggregate.filter(line => /^      - /.test(line)).length, 1);
  assert.ok(!aggregate.some(line => /uses:/.test(line)), 'aggregate needs no checkout');
  const runIndex = aggregate.indexOf('        run: |');
  assert.notEqual(runIndex, -1, 'aggregate has a shell run step');
  const script = [];
  for (const line of aggregate.slice(runIndex + 1)) {
    if (line && !line.startsWith('          ')) break;
    if (line.trim()) script.push(line.slice(10));
  }
  // The final shell test returns nonzero for failure, cancelled, skipped or empty.
  assert.deepEqual(script, [
    'result="${{ needs.test-os.result }}"',
    'echo "test-os result: $result"',
    '[ "$result" = "success" ]',
  ]);
});

test('matrix preserves its OS check names and all three runners', () => {
  const matrix = job('test-os');
  assert.ok(matrix.includes('    name: test (${{ matrix.os }})'));
  assert.ok(matrix.includes('    strategy:'));
  assert.ok(matrix.includes('      fail-fast: false'));
  assert.ok(matrix.includes('      matrix:'));
  assert.ok(matrix.includes('        os: [macos-14, windows-latest, ubuntu-latest]'));
  assert.ok(matrix.includes('    runs-on: ${{ matrix.os }}'));
});

test('every pull request runs CI while push keeps its ignored paths', () => {
  const triggers = children('on');
  const pullRequest = triggers.find(entry => entry.id === 'pull_request');
  const push = triggers.find(entry => entry.id === 'push');
  assert.ok(pullRequest, 'pull_request trigger exists');
  assert.ok(push, 'push trigger exists');
  assert.ok(!pullRequest.lines.some(line => /^    paths-ignore:/.test(line)));
  assert.ok(push.lines.includes("    paths-ignore: ['**.md', 'LICENSE*', 'NOTICE']"));
});

test('matrix preserves smoke evidence artifacts per OS', () => {
  assert.ok(job('test-os').includes('          name: smoke-evidence-${{ matrix.os }}'));
});
