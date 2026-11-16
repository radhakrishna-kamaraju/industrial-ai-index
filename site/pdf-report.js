// Benchmark report PDF. Loaded only when a visitor asks for the download.
// Needs vendor/jspdf.umd.min.js and vendor/pdf-fonts.js first. Returns a jsPDF document.
function buildBenchmarkPDF(d) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 16, CW = W - 2 * M;

  // ---- fonts ----
  const F = window.PDF_FONTS;
  [['SG400', 'SpaceGrotesk', 'normal'], ['SG700', 'SpaceGrotesk', 'bold'], ['PM500', 'PlexMono', 'normal']].forEach(([k, fam, style]) => {
    doc.addFileToVFS(k + '.ttf', F[k]);
    doc.addFont(k + '.ttf', fam, style);
  });

  // ---- colours ----
  const NAVY = [15, 27, 45], INK = [15, 27, 45], MUTED = [84, 98, 120], SOFT = [169, 180, 196];
  const LINE = [222, 226, 233], TINT = [246, 244, 239], AMBER = [242, 163, 58], AMBER_INK = [158, 94, 6], WHITE = [255, 255, 255];
  const rgb = (h) => { const c = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
  const fill = (c) => doc.setFillColor(c[0], c[1], c[2]);
  const ink = (c) => doc.setTextColor(c[0], c[1], c[2]);

  // The embedded fonts cover Latin text. Swap the few symbols they lack and drop anything else.
  const clean = (t) => String(t == null ? '' : t)
    .replace(/\*\*/g, '')
    .replace(/[→⇒➜➔]/g, '->').replace(/←/g, '<-')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-').replace(/ /g, ' ')
    .replace(/[^ -~¡-ÿ–—‘’“”•…]/g, '')
    .replace(/ {2,}/g, ' ').trim();

  const sans = (size, bold) => { doc.setFont('SpaceGrotesk', bold ? 'bold' : 'normal'); doc.setFontSize(size); };
  const mono = (size) => { doc.setFont('PlexMono', 'normal'); doc.setFontSize(size); };
  const label = (t, x, y, c, opts) => { mono(7.5); ink(c || AMBER_INK); doc.text(clean(t).toUpperCase(), x, y, Object.assign({ charSpace: 0.35 }, opts || {})); };
  // Draws wrapped text and returns the y position after it.
  const para = (t, x, y, width, size, lh, c, bold) => {
    sans(size, bold); ink(c || INK);
    const lines = doc.splitTextToSize(clean(t), width);
    doc.text(lines, x, y);
    return y + lines.length * lh;
  };
  const height = (t, width, size, lh, bold) => { sans(size, bold); return doc.splitTextToSize(clean(t), width).length * lh; };

  const a = d.analysis, r = d.report, levels = d.levels;
  const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const nextText = (x) => (x.next ? x.next.gap + (x.next.gap === 1 ? ' point' : ' points') + ' to ' + x.next.label : 'Top level of the scale');
  const bandW = (l) => l.max - l.min + (l.min ? 1 : 0); // widths add up to 101 units, 0 to 100 inclusive
  const TOTAL = 101;

  // A track divided into the five levels, filled up to `score`.
  function track(x, y, w, h, score, color) {
    let cx = x;
    levels.forEach((l) => {
      const bw = (w * bandW(l)) / TOTAL;
      fill([233, 236, 241]); doc.rect(cx, y, bw - 0.6, h, 'F');
      cx += bw;
    });
    fill(color);
    const fw = (w * (score + 0.5)) / TOTAL;
    cx = x;
    levels.forEach((l) => {
      const bw = (w * bandW(l)) / TOTAL;
      const part = Math.min(bw - 0.6, x + fw - cx);
      if (part > 0) doc.rect(cx, y, part, h, 'F');
      cx += bw;
    });
  }
  function levelNames(x, y, w, active) {
    let cx = x;
    levels.forEach((l) => {
      const bw = (w * bandW(l)) / TOTAL;
      mono(6.5); ink(active === l.label ? INK : MUTED);
      doc.text(l.label, cx, y);
      ink(MUTED); doc.text(l.min + '–' + l.max, cx, y + 3.2);
      cx += bw;
    });
  }

  let y = 0;
  function pageHeader(title, sub) {
    doc.addPage();
    fill(NAVY); doc.rect(0, 0, W, 9, 'F');
    fill(AMBER); doc.rect(0, 9, W, 0.8, 'F');
    sans(22, true); ink(INK); doc.text(title, M, 30);
    y = para(sub, M, 38, CW, 10, 5, MUTED) + 6;
  }
  function room(h) { if (y + h > H - 22) { doc.addPage(); fill(NAVY); doc.rect(0, 0, W, 9, 'F'); fill(AMBER); doc.rect(0, 9, W, 0.8, 'F'); y = 26; } }

  // ───────────── Page 1: cover and verdict ─────────────
  const lc = rgb(a.level.color);
  fill(NAVY); doc.rect(0, 0, W, 150, 'F');
  fill(AMBER); doc.rect(M, 22, 10, 0.9, 'F');
  label('Industrial AI Index · Benchmark report', M + 13, 23.2, AMBER);
  sans(32, true); ink(WHITE);
  doc.text('Where you stand', M, 46);
  doc.text('on industrial AI', M, 59);

  const meta = [
    ['Sector', clean(d.industry) || 'Manufacturing'],
    ['Company size', clean(d.companySize) || 'Not specified'],
    ['Assessment', (d.mode === 'detailed' ? 'Detailed' : 'High-level') + ', ' + d.questionCount + ' questions'],
    ['Date', date],
  ];
  const colW = [44, 50, 48, 36];
  let mx = M;
  meta.forEach(([k, v], i) => {
    label(k, mx, 76, SOFT);
    sans(9.5); ink(WHITE);
    doc.text(doc.splitTextToSize(v, colW[i] - 4).slice(0, 2), mx, 81.5);
    mx += colW[i];
  });

  fill([23, 40, 63]); doc.roundedRect(M, 96, CW, 42, 2, 2, 'F');
  label('Overall maturity score', M + 8, 106, SOFT);
  sans(46, true); ink(lc);
  const scoreStr = String(a.score);
  doc.text(scoreStr, M + 8, 129);
  const sw = doc.getTextWidth(scoreStr);
  sans(18, true); doc.text('%', M + 9.5 + sw, 129);
  const rx = M + 62;
  sans(17, true); ink(WHITE); doc.text(a.level.label, rx, 111);
  mono(8.5); ink(lc); doc.text(nextText(a).toUpperCase(), rx, 117.5, { charSpace: 0.3 });
  para(a.level.description, rx, 124.5, CW - 62 - 8, 9.5, 4.6, SOFT);

  y = 166;
  label('The maturity scale', M, y);
  y += 6;
  track(M, y, CW, 5, a.score, lc);
  // marker
  const markX = M + (CW * (a.score + 0.5)) / TOTAL;
  fill(INK); doc.triangle(markX - 1.8, y - 3.4, markX + 1.8, y - 3.4, markX, y - 0.6, 'F');
  levelNames(M, y + 9.5, CW, a.level.label);
  y += 26;

  const hh = height(r.headline, CW - 16, 14, 6.6, true);
  fill(TINT); doc.roundedRect(M, y, CW, hh + 17, 2, 2, 'F');
  fill(AMBER); doc.rect(M, y, 1.4, hh + 17, 'F');
  label('Headline', M + 8, y + 8);
  para(r.headline, M + 8, y + 15.5, CW - 16, 14, 6.6, INK, true);
  y += hh + 27;

  label('In this report', M, y); y += 6;
  [['2', 'Where you stand', 'Each of the four areas on the five-level scale'],
   ['3', 'What is holding you back', 'Your lowest answers and the next step up, with strengths and gaps'],
   ['4', 'The 90-day plan', 'Three priority actions, the bottom line and how the score works']].forEach(([n, t, s]) => {
    mono(9); ink(AMBER_INK); doc.text(n, M, y);
    sans(10.5, true); ink(INK); doc.text(t, M + 8, y);
    const tw = doc.getTextWidth(t);
    sans(9.5); ink(MUTED); doc.text(s, M + 8 + tw + 3, y);
    y += 6.6;
  });

  // ───────────── Page 2: where you stand ─────────────
  pageHeader('Where you stand', 'Each area is placed on the same five-level scale as your overall score. This is a benchmark against the scale, not against other organisations.');
  levelNames(M, y, CW, null);
  y += 11;
  a.areas.forEach((x) => {
    const c = rgb(x.color);
    const blockH = x.layers.length ? 47 : 33;
    room(blockH);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.25); doc.line(M, y, W - M, y);
    y += 9;
    fill(c); doc.circle(M + 1.6, y - 1.6, 1.6, 'F');
    sans(13, true); ink(INK); doc.text(x.title, M + 6, y);
    sans(19, true); doc.text(x.score + '%', W - M, y + 0.6, { align: 'right' });
    y += 5;
    track(M, y, CW, 4.2, x.score, c);
    y += 10.5;
    sans(10, true); ink(INK); doc.text(x.level.label, M, y);
    const lw0 = doc.getTextWidth(x.level.label);
    sans(10); ink(MUTED); doc.text(nextText(x), M + lw0 + 3, y);
    if (x.layers.length) {
      y += 7;
      const lw = (CW - 12) / 3;
      x.layers.forEach((l, i) => {
        const lx = M + i * (lw + 6);
        label(l.name, lx, y, MUTED);
        mono(8.5); ink(INK); doc.text(l.score + '%', lx + lw, y, { align: 'right' });
        fill([233, 236, 241]); doc.rect(lx, y + 2, lw, 1.8, 'F');
        fill(c); doc.rect(lx, y + 2, (lw * l.score) / 100, 1.8, 'F');
      });
      y += 7;
    }
    y += 8.5;
  });
  if (d.mode !== 'detailed') {
    room(14);
    y = para('The high-level assessment has two capability questions and one impact question per area. The detailed assessment adds readiness and scores all three layers on eight questions per area.', M, y + 2, CW, 9, 4.5, MUTED);
  }

  // ───────────── Page 3: what is holding you back ─────────────
  pageHeader('What is holding you back', a.blockers.length
    ? 'These are your lowest answers, starting with your weakest area. For each one, the next step up is the answer one level higher on the same question.'
    : 'You chose the highest level on every question, so there is no next step up to show.');
  a.blockers.forEach((b) => {
    const c = rgb(b.areaColor);
    const tw = CW - 12, vw = tw - 30;
    const qh = height(b.question, tw, 11, 5.2, true);
    const th = height(b.today, vw, 9.5, 4.7), nh = height(b.nextStep, vw, 9.5, 4.7, true);
    const bh = 9 + qh + 2.5 + th + 2 + nh + 5;
    room(bh + 5);
    fill(TINT); doc.roundedRect(M, y, CW, bh, 1.5, 1.5, 'F');
    fill(c); doc.rect(M, y, 1.4, bh, 'F');
    label(b.areaTitle + ' · ' + b.layer + ' · level ' + b.level + ' of 5', M + 6, y + 6.5, MUTED);
    let by = para(b.question, M + 6, y + 13, tw, 11, 5.2, INK, true) + 2.5;
    label('Today', M + 6, by, MUTED);
    by = para(b.today, M + 36, by, vw, 9.5, 4.7, MUTED) + 2;
    label('Next step up', M + 6, by, AMBER_INK);
    para(b.nextStep, M + 36, by, vw, 9.5, 4.7, INK, true);
    y += bh + 5;
  });
  y += 3;
  [['Strengths', r.strengths], ['Critical gaps', r.gaps]].forEach(([title, items]) => {
    room(12 + height(items[0], CW - 6, 10, 5));
    label(title, M, y); y += 2.2;
    doc.setDrawColor(AMBER[0], AMBER[1], AMBER[2]); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
    y += 6.5;
    items.forEach((t) => {
      room(height(t, CW - 6, 10, 5) + 3);
      fill(AMBER); doc.circle(M + 1, y - 1.3, 0.8, 'F');
      y = para(t, M + 6, y, CW - 6, 10, 5, INK) + 2.2;
    });
    y += 5;
  });

  // ───────────── Page 4: the 90-day plan ─────────────
  pageHeader('The 90-day plan', 'Three actions to start in the next quarter. The third is a quick win.');
  r.actions.forEach((t, i) => {
    const ah = height(t, CW - 26, 11, 5.4) + 12;
    room(ah + 5);
    fill(TINT); doc.roundedRect(M, y, CW, ah, 1.5, 1.5, 'F');
    sans(22, true); ink(AMBER_INK); doc.text(String(i + 1), M + 7, y + 13.5);
    para(t, M + 20, y + 9.5, CW - 26, 11, 5.4, INK);
    y += ah + 5;
  });
  y += 5;
  const bl = height(r.bottomLine, CW - 16, 12, 5.9, true);
  room(bl + 20);
  fill(NAVY); doc.roundedRect(M, y, CW, bl + 17, 2, 2, 'F');
  label('The bottom line', M + 8, y + 8, AMBER);
  para(r.bottomLine, M + 8, y + 15, CW - 16, 12, 5.9, WHITE, true);
  y += bl + 28;

  const notes = [
    ['How the score works', 'Each answer is a level from 1 to 5. Level 1 counts as 0% and level 5 as 100%. An area score is the average of its answers, and the overall score is the average of all ' + d.questionCount + ' answers. Levels: ' + levels.map((l) => l.label + ' ' + l.min + '–' + l.max).join(', ') + '.'],
    ['What this benchmark is', 'A comparison with the maturity scale, based only on the answers given. It is a self-assessment, not an audit. The Industrial AI Index stores no answers, so it holds no peer data and makes no comparison with other organisations.'],
    ['How the text was written', d.aiUsed
      ? 'The headline, strengths, gaps, actions and bottom line were written by an AI model (Claude, by Anthropic) from the answers. Scores, levels and next steps are calculated, not generated.'
      : 'The AI report was not available when this report was made, so the headline, strengths, gaps, actions and bottom line were written from the scores by fixed rules. Scores, levels and next steps are calculated.'],
  ];
  notes.forEach(([t, s]) => {
    room(height(s, CW, 8.5, 4.2) + 9);
    label(t, M, y, MUTED);
    y = para(s, M, y + 4.6, CW, 8.5, 4.2, MUTED) + 4;
  });

  // ---- footers ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.25); doc.line(M, H - 14, W - M, H - 14);
    mono(7); ink(MUTED);
    doc.text('INDUSTRIAL AI INDEX', M, H - 9, { charSpace: 0.3 });
    doc.text('industrial-ai.radhakrishnakamaraju.com', W / 2, H - 9, { align: 'center' });
    doc.text(date + '  ·  ' + p + ' / ' + pages, W - M, H - 9, { align: 'right' });
  }
  doc.setProperties({ title: 'Industrial AI Index: benchmark report', subject: 'AI maturity benchmark for manufacturers', creator: 'Industrial AI Index' });
  return doc;
}
