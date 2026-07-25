const STORAGE_KEY = 'fbhelper_sessions';
const SESSION_TIMEOUT = 30 * 60 * 1000;

let currentSession = null;
let sessionTimeout = null;

function generateSessionId() {
  return Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function startSession() {
  currentSession = {
    id: generateSessionId(),
    startTime: Date.now(),
    endTime: null,
    duration: 0,
    date: new Date().toISOString().split('T')[0]
  };
  
  clearTimeout(sessionTimeout);
  sessionTimeout = setTimeout(() => {
    endSession();
  }, SESSION_TIMEOUT);
}

function endSession() {
  if (!currentSession) return;
  
  currentSession.endTime = Date.now();
  currentSession.duration = currentSession.endTime - currentSession.startTime;
  
  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const sessions = result[STORAGE_KEY] || [];
    sessions.push(currentSession);
    chrome.storage.local.set({ [STORAGE_KEY]: sessions });
  });
  
  currentSession = null;
  clearTimeout(sessionTimeout);
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab && (tab.url.includes('facebook.com') || tab.url.includes('www.facebook.com'))) {
      if (!currentSession) {
        startSession();
      }
      clearTimeout(sessionTimeout);
      sessionTimeout = setTimeout(() => {
        endSession();
      }, SESSION_TIMEOUT);
    } else {
      if (currentSession) {
        endSession();
      }
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    if (tab.url && (tab.url.includes('facebook.com') || tab.url.includes('www.facebook.com'))) {
      if (!currentSession) {
        startSession();
      }
    }
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (currentSession) {
      endSession();
    }
  } else {
    chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
      if (tabs.length > 0) {
        const tab = tabs[0];
        if (tab.url && (tab.url.includes('facebook.com') || tab.url.includes('www.facebook.com'))) {
          if (!currentSession) {
            startSession();
          }
        } else {
          if (currentSession) {
            endSession();
          }
        }
      }
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStats') {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const sessions = result[STORAGE_KEY] || [];
      sendResponse({ sessions: sessions });
    });
    return true;
  }
  
  if (request.action === 'clearStats') {
    chrome.storage.local.set({ [STORAGE_KEY]: [] });
    sendResponse({ success: true });
    return true;
  }
});
