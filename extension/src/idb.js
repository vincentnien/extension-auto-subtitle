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
          r.onsuccess = () => {
            console.log('%c[subs:idb]', 'color:#3af', 'get', key, '→', r.result ? `hit(${r.result.value?.cues?.length ?? '?'} cues)` : 'miss');
            resolve(r.result?.value ?? null);
          };
          r.onerror = () => {
            console.error('[subs:idb] get error', key, r.error);
            reject(r.error);
          };
        });
      } catch (e) {
        console.error('[subs:idb] get failed', key, e);
        return null;
      }
    },
    async set(key, value) {
      try {
        const db = await open();
        return await new Promise((resolve, reject) => {
          const r = db.transaction('docs', 'readwrite').objectStore('docs').put({ key, value, savedAt: Date.now() });
          r.onsuccess = () => {
            console.log('%c[subs:idb]', 'color:#3af', 'set ok', key);
            resolve(true);
          };
          r.onerror = () => {
            console.error('[subs:idb] set error', key, r.error);
            reject(r.error);
          };
        });
      } catch (e) {
        console.error('[subs:idb] set failed', key, e);
        return false;
      }
    },
    async clear() {
      try {
        if (dbp) {
          (await dbp).close();
          dbp = null;
        }
        await new Promise((resolve) => {
          const r = indexedDB.deleteDatabase('bilingual-subs');
          r.onsuccess = r.onerror = r.onblocked = () => resolve();
        });
      } catch {}
    }
  };
})();