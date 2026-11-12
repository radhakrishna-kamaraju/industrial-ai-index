// Industrial AI Index: serves the static page and one API route.
// The browser sends only the answers. The prompt is built here, so the
// API key cannot be used for anything except this report.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const WORKSPACE_ID = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const PER_IP_PER_HOUR = Number(process.env.RATE_PER_IP_PER_HOUR || 5);
const DAILY_CAP = Number(process.env.DAILY_CAP || 200);
const SITE_DIR = path.join(__dirname, 'site');

// ---- question bank (same file the page loads) ----
const AREAS = new Function(
  fs.readFileSync(path.join(SITE_DIR, 'questions.js'), 'utf8') + '\nreturn AREAS;'
)();
const SIZES = ['Under 500 employees', '500–5,000 employees', '5,000–25,000 employees', '25,000+ employees'];
const MATURITY = [
  { max: 25, label: 'Foundational' },
  { max: 45, label: 'Developing' },
  { max: 65, label: 'Scaling' },
  { max: 80, label: 'Advanced' },
  { max: 100, label: 'Frontier' },
];

function buildFlat(mode) {
  const flat = [];
  for (const area of AREAS) {
    for (const q of area.questions[mode]) flat.push({ ...q, areaId: area.id, areaTitle: area.title });
  }
  return flat;
}
const pct = (qs, ans) => (qs.length ? Math.round((qs.reduce((s, q) => s + ans[q.id], 0) / (qs.length * 5)) * 100) : 0);

// Returns a validated request, or null if anything is off.
function parseRequest(body) {
  if (!body || typeof body !== 'object') return null;
  const mode = body.mode;
  if (mode !== 'quick' && mode !== 'detailed') return null;
  const flat = buildFlat(mode);
  const raw = body.answers;
  if (!raw || typeof raw !== 'object') return null;
  const answers = {};
  for (const q of flat) {
    const v = raw[q.id];
    if (!Number.isInteger(v) || v < 1 || v > 5) return null;
    answers[q.id] = v;
  }
  // Free text goes into the prompt, so keep it short and plain.
  const industry = String(body.industry || '')
    .replace(/[^\p{L}\p{N} &,\/\-]/gu, '')
    .trim()
    .slice(0, 60);
  const companySize = SIZES.includes(body.companySize) ? body.companySize : '';
  return { mode, flat, answers, industry, companySize };
}

function buildPrompt({ mode, flat, answers, industry, companySize }) {
  const score = pct(flat, answers);
  const level = MATURITY.find((m) => score <= m.max).label;
  const areaLines = AREAS.map((a) => `${a.title}: ${pct(flat.filter((q) => q.areaId === a.id), answers)}%`).join('\n');
  const layers = ['Capability', 'Impact', 'Readiness'];
  const layerBlock =
    mode === 'detailed'
      ? '\nLayer Breakdown:\n' +
        AREAS.map(
          (a) =>
            a.title +
            ':\n' +
            layers
              .map((l) => {
                const qs = flat.filter((q) => q.areaId === a.id && q.layer === l);
                const avg = qs.length ? Math.round((qs.reduce((s, q) => s + answers[q.id], 0) / qs.length) * 20) : 0;
                return `  ${l}: ${avg}%`;
              })
              .join('\n')
        ).join('\n\n')
      : '';
  const answerBlock = flat
    .map((q) => `[${q.areaTitle} | ${q.layer}] ${q.text}\n→ ${q.options.find((o) => o.v === answers[q.id]).l}`)
    .join('\n\n');

  return `You are an expert in industrial AI transformation. A manufacturer completed the Industrial AI Index (${
    mode === 'quick' ? 'High-Level, 12 questions' : 'Detailed, 32 questions'
  } mode).

Industry: ${industry || 'Manufacturing'} | Size: ${companySize || 'Not specified'}
Overall Score: ${score}% — ${level}

Area Scores:
${areaLines}
${layerBlock}

Answers:
${answerBlock}

Provide a sharp strategic assessment:

**HEADLINE INSIGHT**
(1 punchy sentence)

**STRENGTHS**
- (strength 1)
- (strength 2)

**CRITICAL GAPS**
- (gap 1)
- (gap 2)
${mode === 'detailed' ? '- (gap 3 if readiness/impact data reveals a pattern)' : ''}

**TOP 3 PRIORITY ACTIONS**
1. (90-day action)
2. (90-day action)
3. (quick win)

**THE BOTTOM LINE**
(2 sentences max)

Be direct. Reference actual scores. No generic consulting language.`;
}

// ---- rate limiting (in memory; resets when the container restarts) ----
const hits = new Map(); // ip -> timestamps within the last hour
let day = '';
let dayCount = 0;

function allow(ip) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (today !== day) {
    day = today;
    dayCount = 0;
  }
  if (dayCount >= DAILY_CAP) return false;
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  dayCount += 1;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of hits) if (!ts.some((t) => now - t < 3600_000)) hits.delete(ip);
}, 600_000).unref();

// ---- http helpers ----
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handleReport(req, res) {
  let parsed;
  try {
    parsed = parseRequest(await readJson(req));
  } catch {
    parsed = null;
  }
  if (!parsed) return sendJson(res, 400, { error: 'invalid_request' });
  if (!API_KEY) return sendJson(res, 503, { error: 'not_configured' });

  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!allow(ip)) return sendJson(res, 429, { error: 'rate_limited' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(WORKSPACE_ID ? { 'anthropic-workspace-id': WORKSPACE_ID } : {}) },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: buildPrompt(parsed) }] }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!r.ok) {
      console.error('anthropic status', r.status);
      return sendJson(res, 502, { error: 'upstream_error' });
    }
    const data = await r.json();
    const text = Array.isArray(data.content) ? data.content.map((c) => c.text || '').join('') : '';
    return sendJson(res, 200, { text });
  } catch (e) {
    console.error('anthropic call failed:', e.name);
    return sendJson(res, 502, { error: 'upstream_error' });
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(SITE_DIR, rel);
  if (file !== SITE_DIR && !file.startsWith(SITE_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

http
  .createServer((req, res) => {
    if (req.url === '/api/report') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
      return void handleReport(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    serveStatic(req, res);
  })
  .listen(PORT, () => console.log(`Industrial AI Index listening on ${PORT} (AI reports ${API_KEY ? 'on' : 'off: no API key'})`));
