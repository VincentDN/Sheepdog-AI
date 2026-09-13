const fs = require('fs');
const { LOG_PATH } = require('./config');

const MAX = 400;
let entries = [];
let listeners = [];
let flushTimer = null;

function init() {
  try {
    if (fs.existsSync(LOG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
      if (Array.isArray(parsed)) entries = parsed.slice(-MAX);
    }
  } catch (_) {
    entries = [];
  }
}

function flush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    try {
      fs.writeFileSync(LOG_PATH, JSON.stringify(entries.slice(-MAX)));
    } catch (_) {}
  }, 500);
}

/**
 * status: sent | skipped | failed | info
 */
function add(entry) {
  const row = {
    at: Date.now(),
    status: entry.status || 'info',
    memberId: entry.memberId || null,
    name: entry.name || 'Sheepdog',
    detail: entry.detail || ''
  };
  entries.push(row);
  if (entries.length > MAX) entries = entries.slice(-MAX);
  flush();
  listeners.forEach((fn) => {
    try { fn(row); } catch (_) {}
  });
  return row;
}

function recent(n) {
  return entries.slice(-(n || 80)).reverse();
}

function countSince(memberId, sinceMs) {
  const cutoff = Date.now() - sinceMs;
  return entries.filter((e) => e.memberId === memberId && e.status === 'sent' && e.at >= cutoff).length;
}

function onEntry(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((f) => f !== fn); };
}

module.exports = { init, add, recent, countSince, onEntry };
