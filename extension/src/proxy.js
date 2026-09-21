'use strict';

function BS_proxyFetch(url, init) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'PROXY', url, init }, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp);
    });
  });
}