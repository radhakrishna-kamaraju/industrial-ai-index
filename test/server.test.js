// Server tests. No dependencies: `node --test`.
// A local stub stands in for the Anthropic API, so no key is needed and nothing is spent.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const AREAS = new Function(require('node:fs').readFileSync(path.join(__dirname, '../site/questions.js'), 'utf8') + '\nreturn AREAS;')();
const ids = (mode) => AREAS.flatMap((a) => a.questions[mode].map((q) => q.id));
const answers = (mode, v) => Object.fromEntries(ids(mode).map((id) => [id, v]));
const GOOD = { headline: 'H', strengths: ['s1', 's2'], gaps: ['g1', 'g2'], actions: ['a1', 'a2', 'a3'], bottomLine: 'B' };

let stub, app, base, stubMode = 'ok', lastBody = null, calls = 0;

test.before(async () => {
  stub = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      calls += 1;
      lastBody = JSON.parse(b);
      if (stubMode === 'fail') { res.writeHead(500).end('{}'); return; }
      const input = stubMode === 'bad' ? { headline: 'only this' } : { ...GOOD, headline: '**Bold** headline' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 'write_report', input }] }));
    });
  });
  await new Promise((r) => stub.listen(0, r));
  const port = 3900 + Math.floor(Math.random() * 90);
  app = spawn(process.execPath, [path.join(__dirname, '../server.js')], {
    env: { ...process.env, PORT: String(port), ANTHROPIC_API_KEY: 'test', ANTHROPIC_API_URL: `http://127.0.0.1:${stub.address().port}/`, RATE_PER_IP_PER_HOUR: '3', DAILY_CAP: '4' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await new Promise((r) => app.stdout.once('data', r));
  base = `http://127.0.0.1:${port}`;
});
test.after(() => { app.kill(); stub.close(); });

const post = (body, ip = '1.1.1.1') => fetch(base + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify(body) });

test('serves the page and the PDF files', async () => {
  for (const p of ['/', '/questions.js', '/pdf-report.js', '/vendor/pdf-fonts.js', '/og.png']) assert.equal((await fetch(base + p)).status, 200, p);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
});

test('rejects incomplete or invalid answers', async () => {
  const a = answers('quick', 3);
  delete a.plc_q2;
  assert.equal((await post({ mode: 'quick', answers: a })).status, 400);
  assert.equal((await post({ mode: 'quick', answers: { ...answers('quick', 3), plc_q1: 6 } })).status, 400);
  assert.equal((await post({ mode: 'other', answers: answers('quick', 3) })).status, 400);
  assert.equal(calls, 0);
});

test('returns a cleaned, structured report and scores from 0%', async () => {
  const r = await post({ mode: 'quick', answers: answers('quick', 1), industry: 'Automotive <script>' }, '2.2.2.2');
  assert.equal(r.status, 200);
  const { report } = await r.json();
  assert.equal(report.headline, 'Bold headline');
  assert.deepEqual(report.actions, GOOD.actions);
  const prompt = lastBody.messages[0].content;
  assert.match(prompt, /Overall score: 0% \(Foundational, 26 points to Developing\)/);
  assert.match(prompt, /Industry: Automotive script \|/);
  assert.equal(lastBody.tool_choice.name, 'write_report');

  await post({ mode: 'detailed', answers: answers('detailed', 3) }, '2.2.2.3');
  assert.match(lastBody.messages[0].content, /Overall score: 50% \(Scaling, 16 points to Advanced\)/);
  await post({ mode: 'quick', answers: answers('quick', 5) }, '2.2.2.4');
  assert.match(lastBody.messages[0].content, /Overall score: 100% \(Frontier, top level\)/);
});

test('a failed or unusable AI reply does not use up the limits', async () => {
  // three successes so far out of a daily cap of four
  stubMode = 'fail';
  for (let i = 0; i < 5; i++) assert.equal((await post({ mode: 'quick', answers: answers('quick', 2) }, '3.3.3.3')).status, 502);
  stubMode = 'bad';
  assert.equal((await post({ mode: 'quick', answers: answers('quick', 2) }, '3.3.3.3')).status, 502);
  stubMode = 'ok';
  assert.equal((await post({ mode: 'quick', answers: answers('quick', 2) }, '3.3.3.3')).status, 200);
  // the daily cap of four is now reached
  assert.equal((await post({ mode: 'quick', answers: answers('quick', 2) }, '4.4.4.4')).status, 429);
});
