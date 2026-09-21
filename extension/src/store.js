'use strict';

const BS_DEFAULTS = {
  apiKey: '',
  model: 'gemini-flash-latest',
  tgtLang: '繁體中文（zh-TW）',
  trackLang: '',
  companionUrl: 'http://127.0.0.1:8765'
};

const BS_CFG = { ...BS_DEFAULTS };
const BS_CFG_READY = chrome.storage?.local
  ? chrome.storage.local.get(Object.keys(BS_DEFAULTS)).then((r) => Object.assign(BS_CFG, r))
  : Promise.resolve();
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, v] of Object.entries(changes)) BS_CFG[k] = v.newValue ?? BS_DEFAULTS[k];
});

const BS_LOG = (...a) => console.log('%c[subs]', 'color:#a3f', ...a);

const BS_STORE = {
  doc: null,
  status: { stage: 'idle', message: '', progress: null, action: null },
  activeId: null,
  replay: null,
  _subs: new Set(),
  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  },
  notify(changedIds) {
    for (const fn of this._subs) fn(changedIds);
  },
  setStatus(partial) {
    this.status = { ...this.status, ...partial };
    this.notify();
  },
  setDoc(doc) {
    this.doc = doc;
    this.activeId = null;
    this.notify();
  },
  setActive(id) {
    if (this.activeId === id) return;
    this.activeId = id;
    this.notify();
  }
};