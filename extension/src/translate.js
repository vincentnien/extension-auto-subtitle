'use strict';

const BS_CHUNK_LINES = 40;
const BS_CHUNK_CHARS = 3800;
const BS_CONCURRENCY = 3;

function BS_buildChunks(cues) {
  const chunks = [];
  let cur = [];
  let chars = 0;
  for (const c of cues) {
    if (cur.length >= BS_CHUNK_LINES || (cur.length && chars + c.text.length > BS_CHUNK_CHARS)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(c);
    chars += c.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const BS_SYS = () => `你是影片字幕翻譯器，把輸入 JSON 的每個 value 翻成${BS_CFG.tgtLang}。
規則：
1) 只翻 value，key 原樣保留；回傳單一 JSON 物件 {"id":"譯文"}，key 集合必須與輸入完全一致。
2) 專有名詞前後一致；口語自然、簡潔，像字幕。
3) 原文可能含語音辨識錯字，依上下文校正後再翻。
4) 不可合併、拆分或增刪行。`;

function BS_parseIdMap(text, wantIds) {
  let m = null;
  try {
    m = JSON.parse(text);
  } catch {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        m = JSON.parse(text.slice(s, e + 1));
      } catch {}
    }
  }
  if (!m || typeof m !== 'object') return {};
  const out = {};
  for (const id of wantIds) {
    const v = m[String(id)] ?? m[id];
    if (typeof v === 'string' && v.trim()) out[id] = v.trim();
  }
  return out;
}

async function BS_geminiCall(sys, user) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${BS_CFG.model}:generateContent?key=${BS_CFG.apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
  };
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  for (let n = 0; ; n++) {
    const r = await BS_proxyFetch(url, init);
    if (r?.ok) return r.text;
    const transient = r?.status === 429 || r?.status === 500 || r?.status === 503;
    if (n >= 3 || !transient) {
      throw new Error('Gemini HTTP ' + r?.status + ' ' + (r?.text || '').slice(0, 120));
    }
    const delay = 3000 * 2 ** n;
    BS_STORE.setStatus({ message: `Gemini 忙碌中（HTTP ${r.status}），${Math.round(delay / 1000)} 秒後重試…` });
    await new Promise((res) => setTimeout(res, delay));
  }
}

async function BS_translateChunkRetry(chunk, ctxLines) {
  const ask = async (sub) => {
    const items = {};
    for (const c of sub) items[c.id] = c.text;
    const pre = ctxLines.length ? `（前文僅供理解，勿翻譯：${ctxLines.join(' / ')}）\n` : '';
    const raw = await BS_geminiCall(BS_SYS(), pre + JSON.stringify(items));
    return BS_parseIdMap(raw, sub.map((c) => c.id));
  };
  let map = await ask(chunk);
  let missing = chunk.filter((c) => map[c.id] == null);
  for (let i = 0; i < 2 && missing.length; i++) {
    const m2 = await ask(missing);
    for (const c of missing) if (m2[c.id]) map[c.id] = m2[c.id];
    missing = chunk.filter((c) => map[c.id] == null);
  }
  return map;
}

async function BS_translateDoc(cues, cb) {
  const chunks = BS_buildChunks(cues);
  const total = cues.length;
  let done = 0;
  let next = 0;
  cb.onStatus?.(`翻譯中 0/${total}…`);
  const runOne = async () => {
    while (cb.isCurrent() && next < chunks.length) {
      const chunk = chunks[next++];
      if (!chunk) return;
      const ctx = cues.slice(Math.max(0, chunk[0].id - 2), chunk[0].id).map((c) => c.text);
      try {
        const map = await BS_translateChunkRetry(chunk, ctx);
        if (!cb.isCurrent()) return;
        const ids = [];
        for (const c of chunk) {
          if (map[c.id]) {
            c.trans = map[c.id];
            ids.push(c.id);
          }
        }
        cb.onChunk?.(ids);
      } catch (e) {
        cb.onFail?.('翻譯失敗：' + e.message + '（顯示原文）');
        return;
      }
      done += chunk.length;
      cb.onStatus?.(`翻譯中 ${done}/${total}…`);
      cb.onProgress?.(done / total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BS_CONCURRENCY, chunks.length) }, runOne));
}