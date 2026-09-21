chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'PROXY') return;
  fetch(msg.url, msg.init)
    .then(async (r) => sendResponse({ ok: r.ok, status: r.status, text: await r.text() }))
    .catch((e) => sendResponse({ ok: false, status: 0, text: String(e) }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sse') return;
  let abort = null;
  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'open') return;
    abort = new AbortController();
    try {
      const res = await fetch(msg.url, { signal: abort.signal });
      if (!res.ok || !res.body) {
        port.postMessage({ event: 'error', message: 'HTTP ' + res.status });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = 'message';
          let data = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          let parsed = data;
          try {
            parsed = JSON.parse(data);
          } catch {}
          port.postMessage({ event, data: parsed });
        }
      }
      port.postMessage({ event: 'closed' });
    } catch (e) {
      if (!abort.signal.aborted) port.postMessage({ event: 'error', message: String(e) });
    }
  });
  port.onDisconnect.addListener(() => abort?.abort());
});