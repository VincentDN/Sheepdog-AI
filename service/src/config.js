const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.SHEEPDOG_DATA
  ? path.resolve(process.env.SHEEPDOG_DATA)
  : path.join(process.env.APPDATA || process.env.HOME || '.', 'Sheepdog');

const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const LOG_PATH = path.join(DATA_DIR, 'log.json');

const DEFAULTS = {
  port: 8787,
  bind: '0.0.0.0',
  token: null,
  paused: false,
  flock: []
};

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function newId() {
  return crypto.randomBytes(8).toString('hex');
}

function newToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function normaliseMember(raw) {
  return {
    id: raw.id || newId(),
    name: raw.name || 'Unnamed agent',
    platform: raw.platform === 'chatgpt' ? 'chatgpt' : 'claude',
    match: raw.match || '',
    message: raw.message || 'resume the work',
    enabled: raw.enabled !== false,

    // scheduling
    scheduleType: raw.scheduleType === 'times' ? 'times' : 'interval',
    everyMinutes: clamp(Number(raw.everyMinutes) || 20, 1, 1440),
    times: Array.isArray(raw.times) ? raw.times.filter(isHHMM) : [],
    days: Array.isArray(raw.days) && raw.days.length ? raw.days.map(Number) : [0, 1, 2, 3, 4, 5, 6],

    // restraint
    requireIdle: raw.requireIdle !== false,
    idleSeconds: clamp(Number(raw.idleSeconds) || 90, 5, 3600),
    quietStart: isHHMM(raw.quietStart) ? raw.quietStart : '',
    quietEnd: isHHMM(raw.quietEnd) ? raw.quietEnd : '',
    maxPerHour: clamp(Number(raw.maxPerHour) || 6, 1, 120),

    // runtime (persisted so restarts don't cause a stampede)
    lastRunAt: Number(raw.lastRunAt) || 0,
    lastStatus: raw.lastStatus || null,
    lastDetail: raw.lastDetail || null
  };
}

function isHHMM(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function load() {
  ensureDir();
  let raw = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
      const backup = CONFIG_PATH + '.broken-' + Date.now();
      fs.copyFileSync(CONFIG_PATH, backup);
      console.error('config.json could not be parsed. Kept a copy at ' + backup + ' and started fresh.');
      raw = {};
    }
  }
  const cfg = Object.assign({}, DEFAULTS, raw);
  if (process.env.SHEEPDOG_PORT) cfg.port = Number(process.env.SHEEPDOG_PORT) || cfg.port;
  if (!cfg.token) cfg.token = newToken();
  cfg.flock = (Array.isArray(cfg.flock) ? cfg.flock : []).map(normaliseMember);
  save(cfg);
  return cfg;
}

let saveTimer = null;
function save(cfg) {
  ensureDir();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, CONFIG_PATH);
  }, 120);
}

function saveNow(cfg) {
  ensureDir();
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,
  LOG_PATH,
  load,
  save,
  saveNow,
  normaliseMember,
  newId,
  newToken,
  clamp,
  isHHMM
};
