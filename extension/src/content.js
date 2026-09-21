'use strict';

const bsSessionCache = new Map();
let bsGen = 0;
let bsStarted = false;

const bsCurrentVideoId = () => {
  try {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
};

const bsSendPick = (vid, lang) =>
  window.postMessage(
    { source: 'bilingual-subs-ui', type: 'SUBS_PICK', payload: { videoId: vid, lang } },
    location.origin
  );

// ====== 翻譯流程 ======
const bsTgtCode = () => {
  const s = BS_CFG.tgtLang || '';
  if (/TW|繁/i.test(s)) return 'zh-TW';
  if (/HK|港/i.test(s)) return 'zh-HK';
  if (/CN|简|簡/i.test(s)) return 'zh-CN';
  const m = s.match(/[a-z]{2}(?:-[A-Za-z]{2})?/);
  return m ? m[0] : 'zh-TW';
};

function bsBackupDoc(doc) {
  const base = (BS_CFG.companionUrl || '').trim().replace(/\/+$/, '');
  if (!base) return;
  const payload = {
    ...doc,
    tgtLang: bsTgtCode(),
    meta: { sttModel: 'native', llm: BS_CFG.model, createdAt: new Date().toISOString() }
  };
  BS_proxyFetch(base + '/v1/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: payload })
  })
    .then((r) => BS_LOG('doc backup', r?.ok ? 'ok' : 'HTTP ' + r?.status))
    .catch((e) => BS_LOG('doc backup skipped:', e.message));
}

async function bsStartTranslate(doc) {
  const myGen = bsGen;
  const total = doc.cues.length;
  BS_STORE.setStatus({ stage: 'translating', message: `翻譯中 0/${total}…`, progress: 0, action: null });
  let failed = false;
  await BS_translateDoc(doc.cues, {
    isCurrent: () => bsGen === myGen,
    onStatus: (m) => BS_STORE.setStatus({ message: m }),
    onProgress: (p) => BS_STORE.setStatus({ progress: p }),
    onChunk: (ids) => BS_STORE.notify(ids),
    onFail: (m) => {
      failed = true;
      BS_STORE.setStatus({ stage: 'error', message: m });
    }
  });
  if (bsGen !== myGen) return;
  if (!failed) {
    const n = doc.cues.filter((c) => c.trans).length;
    const ok = n === total;
    BS_STORE.setStatus({
      stage: ok ? 'done' : 'partial',
      message: ok ? '' : `完成 ${n}/${total} 行（缺行以原文顯示）`,
      progress: 1
    });
  }
  const n0 = doc.cues.filter((c) => c.trans).length;
  if (n0 > 0) {
    const key = doc.videoId + '|' + doc.srcLang;
    bsSessionCache.set(key, doc.cues);
    const okSave = await BS_IDB.set('doc|' + key, { videoId: doc.videoId, srcLang: doc.srcLang, cues: doc.cues });
    BS_LOG('cache save', key, 'trans:', n0, 'ok:', okSave);
    bsBackupDoc(doc);
  } else {
    BS_LOG('cache NOT saved (0 translated lines)');
  }
}

// ====== STT（companion）======
async function bsStartStt() {
  const vid = bsCurrentVideoId();
  const base = (BS_CFG.companionUrl || '').trim().replace(/\/+$/, '');
  if (!vid || !base) {
    BS_STORE.setStatus({ stage: 'error', message: '未設定 companion URL（選項頁）' });
    return;
  }
  BS_STORE.setStatus({ stage: 'stt', message: '檢查 companion…', progress: null, action: null });
  try {
    const h = await BS_proxyFetch(base + '/health', { method: 'GET' });
    if (!h.ok) throw new Error('HTTP ' + h.status);
  } catch {
    BS_STORE.setStatus({
      stage: 'error',
      message: 'companion 未啟動（' + base + '）',
      action: { label: '重試', run: bsStartStt }
    });
    return;
  }
  try {
    const r = await BS_proxyFetch(base + '/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: vid, url: location.href, tgt_lang: BS_CFG.tgtLang })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (r.text || '').slice(0, 120));
    const { job_id } = JSON.parse(r.text);
    bsOpenJobEvents(base, job_id, vid);
  } catch (e) {
    BS_STORE.setStatus({
      stage: 'error',
      message: '建立 STT job 失敗：' + e.message,
      action: { label: '重試', run: bsStartStt }
    });
  }
}

function bsApplySttDone(doc, vid) {
  if (doc?.cues?.length) {
    const cues = BS_normalizeCues(doc.cues);
    const srcLang = doc.srcLang || '';
    BS_STORE.setDoc({ videoId: vid, srcLang, langs: '', cues });
    bsSessionCache.set(vid + '|' + srcLang, cues);
    BS_IDB.set('doc|' + vid + '|' + srcLang, { videoId: vid, srcLang, cues });
  }
  BS_STORE.setStatus({ stage: 'done', message: '', progress: 1 });
}

function bsOpenJobEvents(base, jobId, vid, attempt = 0) {
  const port = chrome.runtime.connect({ name: 'sse' });
  BS_STORE.setStatus({ stage: 'stt', message: 'STT 排程中…' });
  const stale = () => bsCurrentVideoId() !== vid;
  port.onMessage.addListener((msg) => {
    if (stale()) {
      port.disconnect();
      return;
    }
    if (msg.event === 'progress') {
      const p = msg.data?.progress ?? null;
      BS_STORE.setStatus({
        stage: 'stt',
        message: `STT ${msg.data?.stage || ''} ${p != null ? Math.round(p * 100) + '%' : ''}`.trim(),
        progress: p
      });
    } else if (msg.event === 'partial-doc') {
      const cues = BS_normalizeCues(msg.data?.cues || []);
      BS_STORE.setDoc({ videoId: vid, srcLang: msg.data?.srcLang || '', langs: '', cues });
      BS_STORE.setStatus({ stage: 'stt', message: `轉寫中…（${cues.length} 行）` });
    } else if (msg.event === 'done') {
      bsApplySttDone(msg.data?.doc, vid);
      port.disconnect();
    } else if (msg.event === 'error') {
      BS_STORE.setStatus({
        stage: 'error',
        message: 'STT 失敗：' + (msg.data?.message || msg.message || '未知錯誤'),
        action: { label: '重試', run: bsStartStt }
      });
      port.disconnect();
    } else if (msg.event === 'closed') {
      port.disconnect();
    }
  });
  // 斷線不代表 job 死了（SW 被 Chrome 殺掉、網路抖動都會斷）：
  // 先輪詢 job 狀態，還在跑就重連 SSE，真的死了才報錯
  port.onDisconnect.addListener(async () => {
    if (stale() || BS_STORE.status.stage !== 'stt') return;
    if (attempt >= 5) {
      BS_STORE.setStatus({
        stage: 'error',
        message: '與 companion 的連線中斷（重連多次失敗）',
        action: { label: '重試', run: bsStartStt }
      });
      return;
    }
    BS_STORE.setStatus({ stage: 'stt', message: '連線中斷，檢查 job 狀態…' });
    try {
      const r = await BS_proxyFetch(base + '/v1/jobs/' + jobId, { method: 'GET' });
      if (stale() || BS_STORE.status.stage !== 'stt') return;
      if (r?.ok) {
        const j = JSON.parse(r.text);
        if (j.status === 'done') {
          bsApplySttDone(j.doc, vid);
          return;
        }
        if (j.status === 'error') {
          BS_STORE.setStatus({
            stage: 'error',
            message: 'STT 失敗：' + (j.error || '未知錯誤'),
            action: { label: '重試', run: bsStartStt }
          });
          return;
        }
        setTimeout(() => {
          if (!stale() && BS_STORE.status.stage === 'stt') bsOpenJobEvents(base, jobId, vid, attempt + 1);
        }, 1500);
        return;
      }
      BS_STORE.setStatus({
        stage: 'error',
        message: 'companion 已重啟（job 遺失），請重試',
        action: { label: '重試', run: bsStartStt }
      });
    } catch {
      BS_STORE.setStatus({
        stage: 'error',
        message: '與 companion 的連線中斷',
        action: { label: '重試', run: bsStartStt }
      });
    }
  });
  port.postMessage({ type: 'open', url: `${base}/v1/jobs/${jobId}/events` });
}

// ====== 啟動控制（預設不作動，按 ▶ 字幕 才開始）======
function bsIdleStatus() {
  BS_STORE.setStatus({
    stage: 'idle',
    message: '',
    progress: null,
    action: { label: '▶ 字幕', run: bsStart }
  });
}

function bsStart() {
  const vid = bsCurrentVideoId();
  if (!vid || BS_STORE.doc?.videoId === vid) return;
  bsStarted = true;
  bsGen++;
  BS_STORE.setDoc(null);
  BS_STORE.setStatus({ stage: 'loading', message: '載入字幕…', progress: null, action: null });
  window.postMessage({ source: 'bilingual-subs-ui', type: 'SUBS_START' }, location.origin);
}

// ====== 訊息處理 ======
const bsLangMatches = (a, b) =>
  (a || '').split('-')[0].toLowerCase() === (b || '').split('-')[0].toLowerCase();

async function bsHandleCues(payload) {
  if (payload.videoId !== bsCurrentVideoId()) {
    BS_LOG('stale cues ignored', payload.videoId);
    return;
  }
  if (!bsStarted) {
    BS_LOG('cues ignored (not started)');
    return;
  }
  await BS_CFG_READY;
  const pref = (BS_CFG.trackLang || '').trim();
  const isPreferred = !pref || bsLangMatches(payload.srcLang, pref);
  const doc = BS_STORE.doc;
  const sameVideo = doc?.videoId === payload.videoId;
  if (sameVideo && doc.srcLang === payload.srcLang) return;
  if (sameVideo && !isPreferred) return;
  if (!sameVideo && !isPreferred) {
    bsGen++;
    BS_STORE.setDoc({
      videoId: payload.videoId,
      srcLang: payload.srcLang,
      langs: payload.langs || '',
      cues: BS_normalizeCues(payload.cues)
    });
    BS_STORE.setStatus({
      stage: 'waiting',
      message: `字幕軌為 ${payload.srcLang}（可用:${payload.langs || '?'}），等待 ${pref} 軌…`,
      progress: null,
      action: null
    });
    bsSendPick(payload.videoId, pref);
    return;
  }
  const key = payload.videoId + '|' + payload.srcLang;
  bsGen++;
  let cues = bsSessionCache.get(key);
  let cached = !!cues;
  if (!cues) {
    const saved = await BS_IDB.get('doc|' + key);
    if (saved?.cues?.length) {
      cues = saved.cues;
      cached = true;
    }
  }
  if (!cues && (BS_CFG.companionUrl || '').trim()) {
    try {
      const base = BS_CFG.companionUrl.trim().replace(/\/+$/, '');
      const r = await BS_proxyFetch(
        base + '/v1/docs/' + encodeURIComponent(payload.videoId) + '?tgt=' + encodeURIComponent(bsTgtCode()),
        { method: 'GET' }
      );
      if (r?.ok) {
        const d = JSON.parse(r.text);
        if (d?.cues?.length) {
          cues = d.cues;
          cached = true;
          BS_LOG('loaded from companion docs', r.text.length, 'bytes');
        }
      }
    } catch {}
  }
  BS_STORE.setDoc({
    videoId: payload.videoId,
    srcLang: payload.srcLang,
    langs: payload.langs || '',
    cues: cues || BS_normalizeCues(payload.cues)
  });
  BS_LOG('use track', payload.srcLang, 'cached:', cached);
  if (cached) {
    BS_STORE.setStatus({ stage: 'done', message: '', progress: 1 });
    return;
  }
  if (!BS_CFG.apiKey) {
    BS_STORE.setStatus({ stage: 'error', message: '未設定 API key（擴充功能圖示右鍵 → 選項），僅顯示原文' });
    return;
  }
  await bsStartTranslate(BS_STORE.doc);
}

async function bsHandleNone(payload) {
  if (payload.videoId !== bsCurrentVideoId()) return;
  if (!bsStarted) return;
  bsGen++;
  BS_STORE.setDoc(null);
  await BS_CFG_READY;
  const base = (BS_CFG.companionUrl || '').trim();
  if (base) {
    BS_STORE.setStatus({
      stage: 'idle',
      message: '此影片沒有字幕軌',
      action: { label: '🎙 跑語音辨識', run: bsStartStt }
    });
  } else {
    BS_STORE.setStatus({ stage: 'idle', message: '此影片沒有字幕軌（可於設定加入 companion URL）' });
  }
}

function bsHandleError(payload) {
  BS_STORE.setStatus({ stage: 'error', message: '字幕抓取失敗：' + payload.message });
}

async function bsHandlePickFail(payload) {
  const doc = BS_STORE.doc;
  if (doc?.videoId !== payload.videoId) return;
  if ((BS_CFG.trackLang || '').trim() !== payload.lang) return;
  if (doc.cues.some((c) => c.trans)) return;
  const key = doc.videoId + '|' + doc.srcLang;
  bsGen++;
  let cues = bsSessionCache.get(key);
  if (!cues) {
    const saved = await BS_IDB.get('doc|' + key);
    if (saved?.cues?.length) cues = saved.cues;
  }
  if (cues) {
    BS_STORE.setDoc({ videoId: doc.videoId, srcLang: doc.srcLang, langs: doc.langs, cues });
    BS_STORE.setStatus({ stage: 'done', message: '', progress: 1 });
    BS_LOG('use cached (pick fail)', key);
    return;
  }
  if (!BS_CFG.apiKey) {
    BS_STORE.setStatus({ stage: 'error', message: '沒有 ' + payload.lang + ' 軌，且未設定 API key，僅顯示原文' });
    return;
  }
  BS_STORE.setStatus({ stage: 'translating', message: `沒有 ${payload.lang} 軌，改用 ${doc.srcLang} 翻譯` });
  bsStartTranslate(doc);
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || msg.source !== 'bilingual-subs') return;
  BS_LOG('msg', msg.type, msg.payload?.videoId, 'cues:', msg.payload?.cues?.length ?? '-');
  if (msg.type === 'SUBS_CUES') bsHandleCues(msg.payload);
  else if (msg.type === 'SUBS_NONE') bsHandleNone(msg.payload);
  else if (msg.type === 'SUBS_ERROR') bsHandleError(msg.payload);
  else if (msg.type === 'SUBS_PICK_FAIL') bsHandlePickFail(msg.payload);
});

window.addEventListener(
  'yt-navigate-finish',
  () => {
    const vid = bsCurrentVideoId();
    bsStarted = false;
    bsGen++;
    BS_STORE.setDoc(null);
    if (vid) bsIdleStatus();
    else BS_STORE.setStatus({ stage: 'idle', message: '', progress: null, action: null });
  },
  true
);

if (bsCurrentVideoId()) bsIdleStatus();

try {
  navigator.storage?.persist?.()?.catch?.(() => {});
} catch {}

if (document.body) BS_ensurePanel();
else document.addEventListener('DOMContentLoaded', BS_ensurePanel, { once: true });
requestAnimationFrame(BS_tick);