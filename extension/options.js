const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  apiKey: '',
  model: 'gemini-flash-latest',
  tgtLang: '繁體中文（zh-TW）',
  trackLang: '',
  companionUrl: 'http://127.0.0.1:8765'
};

const load = async () => {
  const r = await chrome.storage.local.get(Object.keys(DEFAULTS));
  $('apiKey').value = r.apiKey ?? DEFAULTS.apiKey;
  $('model').value = r.model || DEFAULTS.model;
  $('tgtLang').value = r.tgtLang || DEFAULTS.tgtLang;
  $('trackLang').value = r.trackLang ?? DEFAULTS.trackLang;
  $('companionUrl').value = r.companionUrl ?? DEFAULTS.companionUrl;
};

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim() || DEFAULTS.model,
    tgtLang: $('tgtLang').value.trim() || DEFAULTS.tgtLang,
    trackLang: $('trackLang').value.trim(),
    companionUrl: $('companionUrl').value.trim()
  });
  $('msg').textContent = '已儲存';
  setTimeout(() => ($('msg').textContent = ''), 2000);
});

load();