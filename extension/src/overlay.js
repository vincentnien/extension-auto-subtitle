'use strict';

const BS_OVERLAY_CSS = `
  .bs-box { margin: 0 4% 6%; max-width: 92%; text-align: center; visibility: hidden;
    font-family: Roboto, 'Noto Sans TC', Arial, sans-serif; font-size: var(--bs-fs, 24px); line-height: 1.4; }
  .bs-line { display: inline-block; border-radius: .35em; padding: .08em .45em;
    box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .bs-trans { color: #fff; font-weight: 600; background: rgba(8,8,8,.62); text-shadow: 0 1px 2px rgba(0,0,0,.8); }
  .bs-orig { color: rgba(255,255,255,.92); font-size: .72em; margin-top: .18em; display: block;
    background: rgba(8,8,8,.5); text-shadow: 0 1px 2px rgba(0,0,0,.8); }
  .bs-orig-only .bs-orig { font-size: 1em; font-weight: 600; color: #fff; }
`;

let bsOvHost = null;
let bsOvShadow = null;
let bsOvBox = null;
let bsOvTrans = null;
let bsOvOrig = null;
let bsOvRo = null;

// ====== 狀態膠囊（body 層，不受 player DOM 重建影響）======
const BS_CAP_CSS = `
  .bs-cap { position: fixed; display: none; align-items: center; gap: 8px;
    font: 12px/1.4 Roboto, 'Noto Sans TC', sans-serif; color: #fff;
    background: rgba(8,8,8,.78); padding: 6px 10px; border-radius: 6px;
    pointer-events: auto; white-space: nowrap; }
  .bs-cap button { border: 0; border-radius: 4px; background: #1a73e8; color: #fff;
    font: inherit; padding: 3px 10px; cursor: pointer; white-space: nowrap; }
`;

let bsCapHost = null;
let bsCapEl = null;
let bsCapMsg = null;
let bsCapBtn = null;

function BS_ensureCapsule() {
  if (bsCapHost?.isConnected) return;
  bsCapHost?.remove();
  bsCapHost = document.createElement('div');
  bsCapHost.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;';
  const shadow = bsCapHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BS_CAP_CSS;
  bsCapEl = document.createElement('div');
  bsCapEl.className = 'bs-cap';
  bsCapMsg = document.createElement('span');
  bsCapBtn = document.createElement('button');
  bsCapBtn.style.display = 'none';
  bsCapEl.append(bsCapMsg, bsCapBtn);
  shadow.append(style, bsCapEl);
  document.body.appendChild(bsCapHost);
}

function BS_renderCapsule() {
  if (!document.body) return;
  BS_ensureCapsule();
  const st = BS_STORE.status;
  const show = !!(st.message || st.action);
  bsCapEl.style.display = show ? 'flex' : 'none';
  bsCapMsg.textContent = st.message || '';
  if (st.action) {
    bsCapBtn.textContent = st.action.label;
    bsCapBtn.style.display = 'inline-block';
    bsCapBtn.onclick = () => st.action.run();
  } else {
    bsCapBtn.style.display = 'none';
    bsCapBtn.onclick = null;
  }
}
BS_STORE.subscribe(() => BS_renderCapsule());

function BS_positionCapsule(player) {
  if (!bsCapEl || bsCapEl.style.display !== 'flex') return;
  if (!player) {
    bsCapEl.style.display = 'none';
    return;
  }
  const r = player.getBoundingClientRect();
  if (r.width < 10 || r.bottom < 0 || r.top > window.innerHeight) {
    bsCapEl.style.display = 'none';
    return;
  }
  bsCapEl.style.display = 'flex';
  if (player.id === 'shorts-player') {
    bsCapEl.style.left = Math.round(r.left + r.width / 2) + 'px';
    bsCapEl.style.right = 'auto';
    bsCapEl.style.top = Math.round(r.top + 10) + 'px';
    bsCapEl.style.transform = 'translateX(-50%)';
  } else {
    bsCapEl.style.right = Math.round(window.innerWidth - r.right + 12) + 'px';
    bsCapEl.style.left = 'auto';
    bsCapEl.style.top = Math.round(r.top + 10) + 'px';
    bsCapEl.style.transform = 'none';
  }
}

// ====== 播放器字幕（player 層）======
function BS_playerVisible(p) {
  const r = p.getBoundingClientRect();
  return r.width > 50 && r.height > 50 && r.bottom > 0 && r.top < window.innerHeight;
}

function BS_activePlayer() {
  const isShorts = location.pathname.startsWith('/shorts');
  const candidates = [];
  if (isShorts) {
    const a =
      document.querySelector('ytd-reel-video-renderer[is-active] #shorts-player') ||
      document.querySelector('ytd-reel-video-renderer[is-active] .html5-video-player');
    if (a) candidates.push(a);
    candidates.push(...document.querySelectorAll('#shorts-player'));
  } else {
    candidates.push(document.getElementById('movie_player'));
    candidates.push(...document.querySelectorAll('.html5-video-player'));
  }
  const visible = candidates.filter((p) => p && BS_playerVisible(p));
  if (!visible.length) return null;
  const mid = window.innerHeight / 2;
  const dist = (p) => {
    const r = p.getBoundingClientRect();
    return Math.abs((r.top + r.bottom) / 2 - mid);
  };
  visible.sort((a, b) => dist(a) - dist(b));
  return visible[0];
}

function BS_ensureOverlay() {
  const player = BS_activePlayer();
  if (!player) return null;
  if (!bsOvHost || !bsOvHost.isConnected || bsOvHost.parentElement !== player) {
    bsOvHost?.remove();
    bsOvRo?.disconnect();
    bsOvHost = document.createElement('div');
    bsOvHost.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:200;display:flex;align-items:flex-end;justify-content:center;';
    bsOvShadow = bsOvHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BS_OVERLAY_CSS;
    bsOvBox = document.createElement('div');
    bsOvBox.className = 'bs-box';
    bsOvTrans = document.createElement('span');
    bsOvTrans.className = 'bs-line bs-trans';
    bsOvOrig = document.createElement('span');
    bsOvOrig.className = 'bs-line bs-orig';
    bsOvBox.append(bsOvTrans, bsOvOrig);
    bsOvShadow.append(style, bsOvBox);
    player.appendChild(bsOvHost);
    bsOvRo = new ResizeObserver(() => {
      const fs = Math.max(14, Math.min(64, Math.round(player.clientHeight * 0.042)));
      bsOvHost.style.setProperty('--bs-fs', fs + 'px');
    });
    bsOvRo.observe(player);
  }
  return player;
}

function BS_findCue(t) {
  const cues = BS_STORE.doc?.cues;
  if (!cues?.length) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const c = ans >= 0 ? cues[ans] : null;
  return c && t < c.end ? c : null;
}

function BS_setOverlayCue(cue) {
  if (!bsOvShadow) return;
  const id = cue ? cue.id : null;
  BS_STORE.setActive(id);
  if (!cue) {
    bsOvBox.style.visibility = 'hidden';
    return;
  }
  bsOvBox.style.visibility = 'visible';
  const hasT = !!cue.trans;
  bsOvTrans.textContent = cue.trans || '';
  bsOvTrans.style.display = hasT ? 'inline-block' : 'none';
  bsOvOrig.textContent = cue.text;
  bsOvBox.classList.toggle('bs-orig-only', !hasT);
}

// ====== 配音模式（Phase 1：瀏覽器 TTS + 原音壓低）======
let bsDubOn = localStorage.getItem('bs-dub') === '1';
let bsDubLastId = null;
let bsDubVideoEl = null;
let bsDubSavedVolume = null;

function bsDubPickVoice() {
  const vs = speechSynthesis.getVoices();
  return (
    vs.find((v) => /zh[-_](tw|hant)/i.test(v.lang)) ||
    vs.find((v) => /^zh/i.test(v.lang)) ||
    null
  );
}

function BS_setDub(on) {
  bsDubOn = on;
  localStorage.setItem('bs-dub', on ? '1' : '0');
  if (!on) {
    speechSynthesis?.cancel();
    if (bsDubVideoEl && bsDubSavedVolume != null) bsDubVideoEl.volume = bsDubSavedVolume;
    bsDubVideoEl = null;
    bsDubSavedVolume = null;
    bsDubLastId = null;
  }
}

function bsDubTick(cue, video) {
  if (!bsDubOn || !video) {
    bsDubLastId = null;
    return;
  }
  if (video.paused) {
    speechSynthesis?.cancel();
    bsDubLastId = null;
    return;
  }
  if (bsDubVideoEl !== video) {
    if (bsDubVideoEl && bsDubSavedVolume != null) bsDubVideoEl.volume = bsDubSavedVolume;
    bsDubVideoEl = video;
    bsDubSavedVolume = video.volume;
  }
  if (video.volume > 0.15) video.volume = 0.15;
  if (!cue || cue.id === bsDubLastId) return;
  bsDubLastId = cue.id;
  if (!cue.trans) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(cue.trans);
  const v = bsDubPickVoice();
  if (v) u.voice = v;
  u.lang = 'zh-TW';
  u.rate = 1.15;
  speechSynthesis.speak(u);
}

try {
  speechSynthesis?.getVoices();
  speechSynthesis?.addEventListener?.('voiceschanged', () => {});
} catch {}

function BS_tick() {
  requestAnimationFrame(BS_tick);
  const player = BS_ensureOverlay();
  let cue = null;
  let video = null;
  if (player && BS_STORE.doc && !player.classList.contains('ad-showing')) {
    video = player.querySelector('video');
    cue = video ? BS_findCue(video.currentTime) : null;
  }
  if (video && BS_STORE.replay) {
    if (video.currentTime >= BS_STORE.replay.end - 0.05) {
      video.pause();
      BS_STORE.replay = null;
    }
  }
  BS_setOverlayCue(player && BS_STORE.doc ? cue : null);
  bsDubTick(cue, video);
  BS_positionCapsule(player);
}