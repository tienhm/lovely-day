// Background script — A Lovely Day
// Nhận timer từ content scripts (đặc biệt incognito) và ghi vào chrome.storage.local
// để tránh mất dữ liệu khi renderer/tab incognito bị kill hoặc hibernate.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'getTimer') {
    const { key, host } = request;
    chrome.storage.local.get([key], result => {
      const data = result[key] || {};
      sendResponse({
        seconds: Math.round(data[host] || 0),
        dayCache: data
      });
    });
    return true; // async
  }

  if (request.type === 'saveTimer') {
    const { key, host, seconds } = request;
    if (!key || !host || typeof seconds !== 'number') {
      sendResponse({ ok: false });
      return;
    }
    chrome.storage.local.get([key], result => {
      const data = result[key] || {};
      const stored = Math.round(data[host] || 0);
      data[host] = Math.max(stored, Math.round(seconds));
      chrome.storage.local.set({ [key]: data }, () => {
        sendResponse({ ok: true, seconds: data[host], dayCache: data });
      });
    });
    return true; // async
  }

  if (request.type === 'getIncognito') {
    // sender.tab.incognito hoạt động cả MV2/MV3, cả Chrome và Firefox
    sendResponse({ incognito: !!(sender.tab && sender.tab.incognito) });
    return;
  }

  sendResponse({ ok: false });
});
