const DEFAULT_SERVICE = 'localhost:8787';

let socket = null;
let backoff = 1000;
let settings = { service: DEFAULT_SERVICE, token: '' };

// -------------------------------------------------------------- settings

async function loadSettings() {
  const stored = await chrome.storage.local.get(['service', 'token']);
  settings.service = stored.service || DEFAULT_SERVICE;
  settings.token = stored.token || '';
  return settings;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.service || changes.token) {
    loadSettings().then(() => {
      if (socket) { try { socket.close(); } catch (_) {} }
      connect();
    });
  }
});

// ------------------------------------------------------------ tab lookup

function patternToTest(pattern) {
  const p = (pattern || '').trim();
  if (!p) return () => false;
  if (p.includes('*')) {
    const rx = new RegExp('^' + p.split('*').map(escapeRx).join('.*') + '$', 'i');
    return (url) => rx.test(url);
  }
  return (url) => url === p || url.startsWith(p) || url.includes(p);
}

function escapeRx(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function scoreMatch(url, pattern) {
  if (url === pattern) return 3;
  if (url.startsWith(pattern)) return 2;
  return 1;
}

async function findTab(pattern) {
  const test = patternToTest(pattern);
  const tabs = await chrome.tabs.query({});
  const hits = tabs.filter((t) => t.url && test(t.url));
  if (!hits.length) return null;
  hits.sort((a, b) => scoreMatch(b.url, pattern) - scoreMatch(a.url, pattern));
  return hits[0];
}

async function reportTabs() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const tabs = await chrome.tabs.query({
    url: [
      'https://claude.ai/*',
      'https://*.claude.ai/*',
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://chat.openai.com/*'
    ]
  });
  socket.send(JSON.stringify({
    type: 'tabs',
    tabs: tabs.map((t) => ({
      url: t.url,
      title: t.title || '',
      platform: t.url.includes('claude.ai') ? 'claude' : 'chatgpt'
    }))
  }));
}

// ---------------------------------------------------------------- nudging

async function sendToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (_) {
    // Content script may not be present yet (fresh install, SPA route change).
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['selectors.js', 'content.js']
      });
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch (err) {
      return { ok: false, status: 'failed', detail: 'Could not reach that tab: ' + (err.message || err) };
    }
  }
}

async function handleNudge(msg) {
  const target = msg.target || {};
  let result;

  const tab = await findTab(target.match);
  if (!tab) {
    result = { ok: false, status: 'failed', detail: 'No open tab matches ' + (target.match || '(blank)') };
  } else if (tab.discarded) {
    try {
      await chrome.tabs.reload(tab.id);
      await new Promise((r) => setTimeout(r, 4000));
      result = await sendToTab(tab.id, { type: 'sheepdog-nudge', target });
    } catch (err) {
      result = { ok: false, status: 'failed', detail: 'Tab was asleep and would not wake' };
    }
  } else {
    result = await sendToTab(tab.id, { type: 'sheepdog-nudge', target });
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'result', id: msg.id, ...result }));
  }
}

// ------------------------------------------------------------- connection

function connect() {
  if (!settings.token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const url = 'ws://' + settings.service + '/ws?role=extension&token=' + encodeURIComponent(settings.token);

  try {
    socket = new WebSocket(url);
  } catch (_) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    backoff = 1000;
    chrome.action.setBadgeText({ text: '' });
    reportTabs();
  };

  socket.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (_) { return; }
    if (msg.type === 'nudge') handleNudge(msg);
  };

  socket.onclose = () => {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#C4553D' });
    scheduleReconnect();
  };

  socket.onerror = () => {
    try { socket.close(); } catch (_) {}
  };
}

function scheduleReconnect() {
  socket = null;
  backoff = Math.min(backoff * 2, 30000);
  setTimeout(connect, backoff);
}

// MV3 puts service workers to sleep. The alarm wakes us to check the socket,
// and the heartbeat keeps the socket itself from being counted as idle.
chrome.alarms.create('sheepdog-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    loadSettings().then(connect);
  } else {
    socket.send(JSON.stringify({ type: 'heartbeat' }));
    reportTabs();
  }
});

chrome.runtime.onStartup.addListener(() => loadSettings().then(connect));
chrome.runtime.onInstalled.addListener(() => loadSettings().then(connect));
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') reportTabs(); });
chrome.tabs.onRemoved.addListener(() => reportTabs());

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'sheepdog-status') {
    sendResponse({
      connected: !!socket && socket.readyState === WebSocket.OPEN,
      service: settings.service,
      hasToken: !!settings.token
    });
    return true;
  }
  if (msg && msg.type === 'sheepdog-reconnect') {
    loadSettings().then(() => {
      if (socket) { try { socket.close(); } catch (_) {} }
      socket = null;
      backoff = 1000;
      connect();
      sendResponse({ ok: true });
    });
    return true;
  }
});

loadSettings().then(connect);
