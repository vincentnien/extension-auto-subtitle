(() => {
  'use strict';

  const DEBUG = true;
  const log = (...a) => DEBUG && console.log('%c[bs-bridge]', 'color:#3af', ...a);

  const currentVideoId = () => {
    try {
      const u = new URL(location.href);
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]+)/);
      return m ? m[2] : null;
    } catch {
      return null;
    }
  };

  const getPlayerResponse = () => {
    const candidates = [
      document.getElementById('movie_player'),
      document.getElementById('shorts-player'),
      ...document.querySelectorAll('.html5-video-player')
    ];
    for (const p of candidates) {
      try {
        const r = p?.getPlayerResponse?.();
        if (r?.videoDetails) return r;
      } catch {}
    }
    const r2 = window.ytInitialPlayerResponse;
    return r2?.videoDetails ? r2 : null;
  };

  const waitFor = (fn, timeoutMs, intervalMs) =>
    new Promise((resolve, reject) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        const v = fn();
        if (v) {
          clearInterval(timer);
          resolve(v);
        } else if (Date.now() - t0 > timeoutMs) {
          clearInterval(timer);
          reject(new Error(timeoutMs / 1000 + ' 秒內拿不到 player response（movie_player / ytInitialPlayerResponse 皆無）'));
        }
      }, intervalMs);
    });

  const flattenJson3 = (data) => {
    const cues = [];
    for (const ev of data?.events || []) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const start = (ev.tStartMs || 0) / 1000;
      cues.push({ start, end: start + (ev.dDurationMs || 0) / 1000, text });
    }
    cues.sort((a, b) => a.start - b.start);
    return cues;
  };

  const dedupeRolling = (cues) => {
    const out = [];
    for (const c of cues) {
      const prev = out[out.length - 1];
      if (!prev || c.start >= prev.end - 0.01) {
        out.push({ ...c });
        continue;
      }
      const cap = Math.min(40, prev.text.length, c.text.length);
      let ov = 0;
      for (let k = cap; k > 0; k--) {
        if (prev.text.slice(-k) === c.text.slice(0, k)) {
          ov = k;
          break;
        }
      }
      const rest = c.text.slice(ov).trim();
      if (rest) out.push({ start: Math.max(c.start, prev.end), end: c.end, text: rest });
      else prev.end = Math.max(prev.end, c.end);
    }
    return out;
  };

  const send = (type, payload) =>
    window.postMessage({ source: 'bilingual-subs', type, payload }, location.origin);

  const pickTrack = (tracklist) => {
    const tracks = tracklist?.captionTracks || [];
    const pool = tracks.filter((t) => t.kind !== 'asr');
    if (!pool.length) pool.push(...tracks);
    const at = (tracklist?.audioTracks || []).find((t) => t.hasDefaultTrack || t.isDefault);
    const defLang = at?.vssId?.match(/\.([a-z]{2,}(?:-[a-z0-9-]+)?)$/i)?.[1];
    log('audio default lang =', defLang || '(unknown)');
    if (defLang) {
      const m = pool.find((t) => t.languageCode === defLang);
      if (m) return m;
    }
    return pool[0];
  };

  const fetchAndSend = async (track, vid, langs) => {
    const res = await fetch(track.baseUrl + '&fmt=json3', { credentials: 'include' });
    const body = await res.text();
    if (!res.ok || !body.length) {
      throw new Error('timedtext 拒絕（HTTP ' + res.status + '，' + body.length + ' bytes）');
    }
    let cues = flattenJson3(JSON.parse(body));
    if (track.kind === 'asr') cues = dedupeRolling(cues);
    cues = cues.filter((c) => c.end > c.start && c.text).map((c, i) => ({ id: i, ...c }));
    log('cues =', cues.length, 'srcLang =', track.languageCode);
    if (!cues.length) {
      send('SUBS_NONE', { videoId: vid });
      return;
    }
    send('SUBS_CUES', { videoId: vid, srcLang: track.languageCode || 'auto', langs, cues });
  };

  let inFlightVid = null;

  const capture = async () => {
    const vid = currentVideoId();
    if (!vid) return;
    if (inFlightVid === vid) return;
    inFlightVid = vid;
    log('capture start', vid);
    try {
      const pr = await waitFor(getPlayerResponse, 20000, 300);
      const videoId = pr.videoDetails?.videoId || vid;
      const tracklist = pr.captions?.playerCaptionsTracklistRenderer;
      const tracks = tracklist?.captionTracks || [];
      log('player response ok, tracks =', tracks.length, tracks.map((t) => t.languageCode + (t.kind === 'asr' ? '(asr)' : '')));
      if (!videoId || !tracks.length) {
        log('no usable tracks → SUBS_NONE');
        send('SUBS_NONE', { videoId: vid });
        return;
      }
      const track = pickTrack(tracklist);
      log('picked track:', track.languageCode, track.kind === 'asr' ? '(asr)' : '(manual)');
      const langs = tracks.map((t) => t.languageCode).join(',');
      const order = [track, ...tracks.filter((t) => t !== track)].slice(0, 4);
      let lastErr = null;
      for (const t of order) {
        try {
          await fetchAndSend(t, vid, langs);
          return;
        } catch (e) {
          lastErr = e;
          log('track failed:', t.languageCode, String(e?.message || e));
        }
      }
      log('all tracks failed → fall back to STT route:', lastErr?.message);
      send('SUBS_NONE', { videoId: vid });
    } catch (e) {
      console.error('[bs-bridge] capture failed:', e);
      send('SUBS_ERROR', { message: String(e?.message || e) });
    } finally {
      if (inFlightVid === vid) inFlightVid = null;
    }
  };

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const msg = e.data;
    if (!msg || msg.source !== 'bilingual-subs-ui') return;
    if (msg.type === 'SUBS_START') capture();
    else if (msg.type === 'SUBS_PICK') {
      const { videoId, lang } = msg.payload || {};
      if (!videoId || videoId !== currentVideoId() || !lang) return;
      const tracklist = getPlayerResponse()?.captions?.playerCaptionsTracklistRenderer;
      const tracks = tracklist?.captionTracks || [];
      const langMatch = (code) =>
        (code || '').split('-')[0].toLowerCase() === lang.split('-')[0].toLowerCase();
      const track =
        tracks.find((t) => t.kind !== 'asr' && langMatch(t.languageCode)) ||
        tracks.find((t) => langMatch(t.languageCode));
      log('pick', lang, '→', track ? track.languageCode : 'not found');
      if (!track) {
        send('SUBS_PICK_FAIL', { videoId, lang });
        return;
      }
      fetchAndSend(track, videoId, tracks.map((t) => t.languageCode).join(',')).catch((err) => {
        console.error('[bs-bridge] pick fetch failed:', err);
        send('SUBS_ERROR', { message: String(err?.message || err) });
      });
    }
  });
})();