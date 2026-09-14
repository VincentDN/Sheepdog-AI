const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');

// Independent of SHEEPDOG_DATA on purpose: config.json holds the access
// token and shouldn't have to live in a synced folder just because you
// want the roadmap itself to. Point this at a folder Dropbox (or any
// other sync client) is already watching and the roadmap — and its
// re-hosted images — show up on every device that folder syncs to.
const ROADMAP_DIR = process.env.SHEEPDOG_ROADMAP_DIR
  ? path.resolve(process.env.SHEEPDOG_ROADMAP_DIR)
  : path.join(DATA_DIR, 'roadmaps');
const IMAGES_DIR = path.join(ROADMAP_DIR, 'images');

const NAME_RE = /^Sheepdog-Roadmap-(\d{4}-\d{2}-\d{2})\.md$/;
const IMAGE_EXT_BY_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

function ensureDir() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

function dateName(d) {
  return d.toISOString().slice(0, 10);
}

function fileNameFor(d) {
  return 'Sheepdog-Roadmap-' + dateName(d) + '.md';
}

function isRoadmapFile(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

function listFiles() {
  ensureDir();
  return fs.readdirSync(ROADMAP_DIR).filter(isRoadmapFile).sort();
}

function latestFile() {
  const files = listFiles();
  return files.length ? files[files.length - 1] : null;
}

function readFile(name) {
  if (!isRoadmapFile(name)) return null;
  const file = path.join(ROADMAP_DIR, name);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

/**
 * Resolves an image file name to a path under IMAGES_DIR, or null if it
 * doesn't exist or the name tries to escape the folder.
 */
function imagePath(name) {
  if (typeof name !== 'string') return null;
  const base = path.basename(name);
  if (base !== name) return null;
  const file = path.join(IMAGES_DIR, base);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

function extFromUrl(url) {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]{2,4})$/i);
    return match ? match[1].toLowerCase() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Downloads an image and saves it under IMAGES_DIR so the roadmap stops
 * depending on Discord's CDN link, which carries a signed expiry and goes
 * dead after a while. Returns the saved file's bare name. Throws on any
 * download failure — the caller decides what to do about it.
 */
async function saveImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = extFromUrl(url) || IMAGE_EXT_BY_TYPE[res.headers.get('content-type')] || 'bin';
  ensureDir();
  const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(IMAGES_DIR, name), buf);
  return name;
}

/**
 * Appends one task line to today's roadmap file, creating it with a
 * heading first if this is the day's first entry. Task lines are a
 * markdown checkbox so an agent working the roadmap can tick them off
 * in place instead of needing a separate "done" list. An attached image
 * is re-hosted alongside the roadmap file; if that download fails for
 * any reason, the original (expiring) link is kept as a fallback rather
 * than losing the image reference entirely.
 */
async function addEntry({ text, imageUrl, author, when }) {
  ensureDir();
  const now = when || new Date();
  const name = fileNameFor(now);
  const file = path.join(ROADMAP_DIR, name);

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '# Sheepdog Roadmap — ' + dateName(now) + '\n\n');
  }

  const stamp = now.toISOString().slice(11, 16);
  const who = (author ? author + ', ' : '') + stamp + ' UTC';
  let line = '- [ ] ' + text + ' _(' + who + ')_';

  if (imageUrl) {
    try {
      const savedName = await saveImage(imageUrl);
      line += '\n  ![attachment](images/' + savedName + ')';
    } catch (err) {
      line += '\n  ![attachment](' + imageUrl + ') _(could not re-host — ' + err.message + ', this link may expire)_';
    }
  }

  fs.appendFileSync(file, line + '\n');
  return { file: name, path: file, line };
}

module.exports = {
  ROADMAP_DIR,
  IMAGES_DIR,
  dateName,
  fileNameFor,
  isRoadmapFile,
  listFiles,
  latestFile,
  readFile,
  imagePath,
  addEntry
};
