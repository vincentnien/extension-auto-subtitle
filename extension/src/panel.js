'use strict';

const BS_PANEL_CSS = `
  .bs-panel { width: 100%; height: 100%; background: #111318; color: #e8eaed; pointer-events: auto;
    font: 13px/1.5 system-ui, 'Noto Sans TC', sans-serif; display: flex; flex-direction: column;
    box-shadow: -2px 0 12px rgba(0,0,0,.45); }
  .bs-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;
    border-bottom: 1px solid #2a2f3a; font-weight: 600; flex: none; }
  .bs-head .btns { display: flex; gap: 6px; }
  .bs-head button { border: 1px solid #3c4043; background: transparent; color: #9aa0a6; font: 12px/1 inherit;
    padding: 4px 8px; border-radius: 4px; cursor: pointer; }
  .bs-head button:hover { color: #fff; border-color: #5f6368; }
  .bs-status { padding: 8px 12px 0; font-size: 12px; color: #9aa0a6; min-height: 24px; flex: none; }
  .bs-bar { height: 3px; margin: 6px 12px 8px; background: #2a2f3a; border-radius: 2px; overflow: hidden; flex: none; }
  .bs-bar > div { height: 100%; width: 0%; background: #1a73e8; transition: width .3s; }
  .bs-action { margin: 0 12px 8px; border: 0; border-radius: 4px; background: #1a73e8; color: #fff;
    font: 12px/1.4 inherit; padding: 6px 12px; cursor: pointer; display: none; flex: none; }
  .bs-list { flex: 1; overflow-y: auto; }
  .bs-row { padding: 8px 12px; border-bottom: 1px solid #1e222b; cursor: pointer;
    content-visibility: auto; contain-intrinsic-size: auto 64px; border-left: 3px solid transparent; }
  .bs-row:hover { background: #1a1d24; }
  .bs-row.active { background: #1f2937; border-left-color: #1a73e8; }
  .bs-row .t { font-size: 11px; color: #5f6368; }
  .bs-row .orig { font-size: 12px; color: #9aa0a6; margin-top: 2px; }
  .bs-row .trans { font-size: 13px; color: #fff; margin-top: 2px; font-weight: 600; }
  .bs-row .row-btns { position: absolute; right: 8px; opacity: 0; transition: opacity .15s; }
  .bs-row { position: relative; }
  .bs-row:hover .row-btns { opacity: 1; }
  .row-btns button { border: 0; background: transparent; color: #9aa0a6; cursor: pointer;
    font-size: 12px; padding: 0 3px; }
  .row-btns button:hover { color: #fff; }
  .bs-empty { padding: 24px 12px; color: #5f6368; text-align: center; }
  .bs-tab { position: fixed; right: 0; top: 40%; writing-mode: vertical-rl; padding: 12px 5px;
    background: #1a73e8; color: #fff; border-radius: 6px 0 0 6px; cursor: pointer; font-size: 12px;
    letter-spacing: 2px; display: none; pointer-events: auto; }
  .bs-resizer { position: absolute; left: 0; top: 0; height: 100%; width: 7px; margin-left: -3px;
    cursor: ew-resize; pointer-events: auto; z-index: 10; }
  .bs-resizer:hover, .bs-resizer.dragging { background: rgba(26,115,232,.4); }
`;

const BS_PANEL_WIDTH = 340;
const BS_PANEL_MIN_W = 220;
const BS_PANEL_MAX_W = 640;

let bsPanelHost = null;
let bsPanelShadow = null;
let bsPanelEl = null;
let bsPanelListEl = null;
let bsPanelBarFill = null;
let bsPanelMsgEl = null;
let bsPanelBtnEl = null;
let bsPanelTab = null;
let bsPanelDocRef = null;
let bsPanelRows = new Map();
let bsPanelActiveEl = null;
let bsPanelActiveId = null;
let bsPanelVisible = false;
let bsPanelUserCollapsed = false;
let bsPanelUserScrolledAt = 0;
let bsPanelMode = localStorage.getItem('bs-panel-mode') || 'both'; // both | orig | trans
let bsPanelWidth = Number(localStorage.getItem('bs-panel-w')) || BS_PANEL_WIDTH;

function bsPanelApplyWidth() {
  if (!bsPanelHost) return;
  const w = Math.min(bsPanelWidth, Math.max(BS_PANEL_MIN_W, window.innerWidth - 80));
  bsPanelHost.style.width = w + 'px';
}

function bsPanelSetupResizer(handle) {
  let dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    bsPanelWidth = Math.max(BS_PANEL_MIN_W, Math.min(BS_PANEL_MAX_W, window.innerWidth - e.clientX));
    bsPanelApplyWidth();
  });
  const done = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    localStorage.setItem('bs-panel-w', String(bsPanelWidth));
  };
  handle.addEventListener('pointerup', done);
  handle.addEventListener('pointercancel', done);
  handle.addEventListener('dblclick', () => {
    bsPanelWidth = BS_PANEL_WIDTH;
    bsPanelApplyWidth();
    localStorage.setItem('bs-panel-w', String(bsPanelWidth));
  });
}

function BS_panelSpeak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = BS_STORE.doc?.srcLang || 'en';
    speechSynthesis.speak(u);
  } catch {}
}

function BS_panelSeek(t) {
  const player =
    document.getElementById('movie_player') || document.getElementById('shorts-player');
  const video = player?.querySelector('video');
  if (!video || player?.classList.contains('ad-showing')) return;
  video.currentTime = t + 0.01;
}

function BS_panelApplyVisibility() {
  const show = bsPanelVisible && !document.fullscreenElement;
  const panelShow = show ? 'flex' : 'none';
  const tabShow = show ? 'none' : 'flex';
  if (bsPanelEl) bsPanelEl.style.display = panelShow;
  if (bsPanelTab) bsPanelTab.style.display = tabShow;
}

function BS_setPanelVisible(visible, byUser) {
  if (byUser) bsPanelUserCollapsed = !visible;
  bsPanelVisible = visible;
  BS_panelApplyVisibility();
}

function BS_ensurePanel() {
  if (bsPanelHost?.isConnected) return;
  bsPanelHost?.remove();
  bsPanelTab?.remove();
  bsPanelHost = document.createElement('div');
  bsPanelHost.style.cssText = `position:fixed;top:0;right:0;width:${BS_PANEL_WIDTH}px;height:100vh;z-index:2147483000;pointer-events:none;`;  bsPanelShadow = bsPanelHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BS_PANEL_CSS;
  const panel = document.createElement('div');
  panel.className = 'bs-panel';
  const head = document.createElement('div');
  head.className = 'bs-head';
  const title = document.createElement('span');
  title.textContent = '雙語字幕';
  const btns = document.createElement('div');
  btns.className = 'btns';
  const modeBtn = document.createElement('button');
  const modeLabel = { both: '雙語', orig: '原文', trans: '譯文' };
  const setModeLabel = () => (modeBtn.textContent = modeLabel[bsPanelMode]);
  modeBtn.addEventListener('click', () => {
    bsPanelMode = bsPanelMode === 'both' ? 'orig' : bsPanelMode === 'orig' ? 'trans' : 'both';
    localStorage.setItem('bs-panel-mode', bsPanelMode);
    setModeLabel();
    BS_panelApplyMode();
  });
  setModeLabel();
  const dubBtn = document.createElement('button');
  const setDubLabel = () => (dubBtn.textContent = bsDubOn ? '配音:開' : '配音:關');
  dubBtn.addEventListener('click', () => {
    BS_setDub(!bsDubOn);
    setDubLabel();
  });
  setDubLabel();
  const cacheBtn = document.createElement('button');
  cacheBtn.textContent = '清快取';
  cacheBtn.title = '刪除本機快取的字幕翻譯';
  cacheBtn.addEventListener('click', async () => {
    await BS_IDB.clear();
    location.reload();
  });
  const exportBtn = document.createElement('button');
  exportBtn.textContent = '匯出 SRT';
  exportBtn.addEventListener('click', () => {
    const doc = BS_STORE.doc;
    if (!doc?.cues?.length) return;
    const blob = new Blob([BS_toSrt(doc.cues)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${doc.videoId}.srt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  const collapseBtn = document.createElement('button');
  collapseBtn.textContent = '收合';
  collapseBtn.addEventListener('click', () => BS_setPanelVisible(false, true));
  btns.append(modeBtn, dubBtn, cacheBtn, exportBtn, collapseBtn);
  head.append(title, btns);
  const bar = document.createElement('div');
  bar.className = 'bs-bar';
  bsPanelBarFill = document.createElement('div');
  bar.appendChild(bsPanelBarFill);
  bsPanelMsgEl = document.createElement('div');
  bsPanelMsgEl.className = 'bs-status';
  bsPanelBtnEl = document.createElement('button');
  bsPanelBtnEl.className = 'bs-action';
  bsPanelListEl = document.createElement('div');
  bsPanelListEl.className = 'bs-list';
  bsPanelListEl.addEventListener('scroll', () => (bsPanelUserScrolledAt = Date.now()), { passive: true });
  panel.append(head, bsPanelMsgEl, bar, bsPanelBtnEl, bsPanelListEl);
  bsPanelShadow.append(style, panel);
  document.body.appendChild(bsPanelHost);
  bsPanelEl = panel;
  bsPanelApplyWidth();
  const resizer = document.createElement('div');
  resizer.className = 'bs-resizer';
  bsPanelSetupResizer(resizer);
  bsPanelShadow.appendChild(resizer);
  bsPanelTab = document.createElement('div');
  bsPanelTab.className = 'bs-tab';
  bsPanelTab.textContent = '雙語字幕';
  bsPanelTab.addEventListener('click', () => BS_setPanelVisible(true, true));
  bsPanelShadow.appendChild(bsPanelTab);
  document.addEventListener('fullscreenchange', BS_panelApplyVisibility);
  BS_setPanelVisible(false, false);
}

function BS_panelBuildList() {
  bsPanelRows.clear();
  bsPanelActiveEl = null;
  bsPanelListEl.textContent = '';
  const doc = BS_STORE.doc;
  if (!doc) {
    const empty = document.createElement('div');
    empty.className = 'bs-empty';
    empty.textContent = '沒有字幕資料';
    bsPanelListEl.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const cue of doc.cues) {
    const row = document.createElement('div');
    row.className = 'bs-row';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = BS_fmtTime(cue.start);
    const orig = document.createElement('div');
    orig.className = 'orig';
    orig.textContent = cue.text;
    const trans = document.createElement('div');
    trans.className = 'trans';
    trans.textContent = cue.trans || '';
    if (!cue.trans) trans.style.display = 'none';
    const rowBtns = document.createElement('span');
    rowBtns.className = 'row-btns';
    const play = document.createElement('button');
    play.textContent = '▶';
    play.title = '重播此句';
    play.addEventListener('click', (e) => {
      e.stopPropagation();
      BS_STORE.replay = { start: cue.start, end: cue.end };
      BS_panelSeek(cue.start);
      const video = document.getElementById('movie_player')?.querySelector('video');
      video?.play()?.catch?.(() => {});
    });
    const speak = document.createElement('button');
    speak.textContent = '🔊';
    speak.title = '朗讀原文';
    speak.addEventListener('click', (e) => {
      e.stopPropagation();
      BS_panelSpeak(cue.text);
    });
    rowBtns.append(play, speak);
    row.append(t, rowBtns, orig, trans);
    row.addEventListener('click', () => BS_panelSeek(cue.start));
    frag.appendChild(row);
    bsPanelRows.set(cue.id, { row, transEl: trans, origEl: orig });
  }
  bsPanelListEl.appendChild(frag);
  BS_panelApplyMode();
}

function BS_panelApplyMode() {
  for (const r of bsPanelRows.values()) {
    r.origEl.style.display = bsPanelMode === 'trans' ? 'none' : 'block';
    r.transEl.style.display = bsPanelMode !== 'orig' && r.transEl.textContent ? 'block' : 'none';
  }
}

function BS_panelSetActive(id) {
  const entry = id != null ? bsPanelRows.get(id) : null;
  if (bsPanelActiveEl === (entry?.row || null)) return;
  bsPanelActiveEl?.classList.remove('active');
  bsPanelActiveEl = entry?.row || null;
  bsPanelActiveEl?.classList.add('active');
  if (bsPanelActiveEl && Date.now() - bsPanelUserScrolledAt > 4000) {
    bsPanelActiveEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

BS_STORE.subscribe((changedIds) => {
  if (!bsPanelShadow) return;
  const doc = BS_STORE.doc;
  if (doc !== bsPanelDocRef) {
    bsPanelDocRef = doc;
    bsPanelActiveId = null;
    BS_panelBuildList();
    if (doc && !bsPanelUserCollapsed) BS_setPanelVisible(true, false);
  } else if (changedIds?.length) {
    for (const id of changedIds) {
      const r = bsPanelRows.get(id);
      const cue = doc?.cues[id];
      if (r && cue) {
        r.transEl.textContent = cue.trans || '';
        r.transEl.style.display = cue.trans && bsPanelMode !== 'orig' ? 'block' : 'none';
      }
    }
  }
  const st = BS_STORE.status;
  bsPanelMsgEl.textContent = st.message || (doc ? `${doc.cues.length} 行` : '');
  bsPanelBarFill.style.width = st.progress != null ? Math.round(st.progress * 100) + '%' : '0%';
  if (st.action) {
    bsPanelBtnEl.textContent = st.action.label;
    bsPanelBtnEl.style.display = 'block';
    bsPanelBtnEl.onclick = () => st.action.run();
  } else {
    bsPanelBtnEl.style.display = 'none';
    bsPanelBtnEl.onclick = null;
  }
  if (BS_STORE.activeId !== bsPanelActiveId) {
    bsPanelActiveId = BS_STORE.activeId;
    BS_panelSetActive(bsPanelActiveId);
  }
});