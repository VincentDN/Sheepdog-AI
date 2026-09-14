const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const ROADMAP_DIR = path.join(DATA_DIR, 'roadmaps');
const NAME_RE = /^Sheepdog-Roadmap-(\d{4}-\d{2}-\d{2})\.md$/;

function ensureDir() {
  fs.mkdirSync(ROADMAP_DIR, { recursive: true });
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
 * Appends one task line to today's roadmap file, creating it with a
 * heading first if this is the day's first entry. Task lines are a
 * markdown checkbox so an agent working the roadmap can tick them off
 * in place instead of needing a separate "done" list.
 */
function addEntry({ text, imageUrl, author, when }) {
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
  if (imageUrl) line += '\n  ![attachment](' + imageUrl + ')';
  fs.appendFileSync(file, line + '\n');

  return { file: name, path: file, line };
}

module.exports = {
  ROADMAP_DIR,
  dateName,
  fileNameFor,
  isRoadmapFile,
  listFiles,
  latestFile,
  readFile,
  addEntry
};
