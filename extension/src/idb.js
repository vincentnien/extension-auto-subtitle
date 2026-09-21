'use strict';

const BS_IDB = (() => {
  let dbp = null;
  const open = () =>
    (dbp ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('bilingual-subs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('docs', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  return {
    async get(key) {
      try {
        const db = await open();
        return await new Promise((resolve, reject) => {
          const r = db.transaction('docs').objectStore('docs').get(key);
          r.onsuccess = () => resolve(r.result || null);
          r.onerror = () => reject(r.error);
        });
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        const db = await open();
        await new Promise((resolve, reject) => {
          const r = db.transaction('docs', 'readwrite').objectStore('docs').put({ key, value, savedAt: Date.now() });
          r.onsuccess = resolve;
          r.onerror = () => reject(r.error);
        });
      } catch {}
    }
  };
})();