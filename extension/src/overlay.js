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
  .bs-capsule { position: absolute; top: 10px; right: 12px; display: none; align-items: center; gap: 8px;
    max-width: 70%; font: 12px/1.4 Roboto, 'Noto Sans TC', sans-serif; color: #fff;
    background: rgba(8,8,8,.78); padding: 6px 10px; border-radius: 6px; }
  .bs-capsule button { pointer-events: auto; border: 0; border-radius: 4px; background: #1a73e8;
    color: #fff; font: inherit; padding: 3px 10px; cursor: pointer; white-space: nowrap; }
`;

let bsOvHost = null;
let bsOvShadow = null;
let bsOvBox = null;
let bsOvTrans = null;
let bsOvOrig = null;
let bsOvCapsule = null;
let bsOvMsg = null;
let bsOvBtn = null;
let bsOvRo = null;

function BS_ensureOverlay() {
  const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  if (!player) return null;
  if (!bsOvHost || !bsOvHost.isConnected || bsOvHost.parentElement !== player) {
    bsOvHost?.remove();
    bsOvRo?.disconnect();
    bsOvHost = document.createElement('div');
    bsOvHost.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:60;display:flex;align-items:flex-end;justify-content:center;';
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
    bsOvCapsule = document.createElement('div');
    bsOvCapsule.className = 'bs-capsule';
    bsOvMsg = document.createElement('span');
    bsOvBtn = document.createElement('button');
    bsOvBtn.style.display = 'none';
    bsOvCapsule.append(bsOvMsg, bsOvBtn);
    bsOvShadow.append(style, bsOvBox, bsOvCapsule);
    player.appendChild(bsOvHost);
    bsOvRo = new ResizeObserver(() => {
      const fs = Math.max(14, Math.min(64, Math.round(player.clientHeight * 0.042)));
      bsOvHost.style.setProperty('--bs-fs', fs + 'px');
    });
    bsOvRo.observe(player);
  }
  return player;
}

function BS_renderCapsule() {
  if (!bsOvShadow) return;
  const st = BS_STORE.status;
  const show = !!(st.message || st.action);
  bsOvCapsule.style.display = show ? 'flex' : 'none';
  bsOvMsg.textContent = st.message || '';
  if (st.action) {
    bsOvBtn.textContent = st.action.label;
    bsOvBtn.style.display = 'inline-block';
    bsOvBtn.onclick = () => st.action.run();
  } else {
    bsOvBtn.style.display = 'none';
    bsOvBtn.onclick = null;
  }
}
BS_STORE.subscribe(() => BS_renderCapsule());

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
    if (!bsDubOn) {
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

function BS_tick() {
  requestAnimationFrame(BS_tick);
  const player = BS_ensureOverlay();
  if (!player || !BS_STORE.doc) {
    if (bsOvBox) BS_setOverlayCue(null);
    return;
  }
  if (player.classList.contains('ad-showing')) {
    BS_setOverlayCue(null);
    return;
  }
  const video = player.querySelector('video');
  const cue = video ? BS_findCue(video.currentTime) : null;
  if (video && BS_STORE.replay) {
    if (video.currentTime >= BS_STORE.replay.end - 0.05) {
      video.pause();
      BS_STORE.replay = null;
    }
  }
  BS_setOverlayCue(cue);
  bsDubTick(cue, video || null);
}