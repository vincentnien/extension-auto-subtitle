'use strict';

const BS_GAP_FILL_MAX = 3;
const BS_MIN_DURATION = 0.9;

function BS_normalizeCues(cues) {
  const sorted = (cues || [])
    .filter((c) => c && c.end > c.start && typeof c.text === 'string' && c.text.trim())
    .map((c) => ({ start: c.start, end: c.end, text: c.text.trim(), trans: c.trans ?? null }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.start < prev.end - 0.01) {
      if (c.end - c.start > prev.end - prev.start) out[out.length - 1] = c;
      continue;
    }
    out.push(c);
  }
  out.forEach((c, i) => {
    const next = out[i + 1];
    const base = Math.max(c.end, c.start + BS_MIN_DURATION);
    c.end = next
      ? Math.min(next.start, Math.max(base, Math.min(next.start, c.end + BS_GAP_FILL_MAX)))
      : base;
    c.id = i;
  });
  return out;
}

function BS_fmtTime(t) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function BS_toSrt(cues) {
  const fmt = (t) => new Date(Math.max(0, t) * 1000).toISOString().substring(11, 23).replace('.', ',');
  return cues
    .map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.trans ? c.trans + '\n' : ''}${c.text}\n`)
    .join('\n');
}