const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');
const { WebSocketServer } = require('ws');

const configStore = require('./config');
const log = require('./log');
const hub = require('./hub');
const { makeScheduler, describe } = require('./scheduler');
const roadmap = require('./roadmap');
const discordBot = require('./discordBot');

let cfg = configStore.load();
log.init();

if (process.argv.includes('--print-token')) {
  console.log(cfg.token);
  process.exit(0);
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const getConfig = () => cfg;
const saveConfig = (next) => { cfg = next; configStore.save(cfg); };

function buildState() {
  const now = new Date();
  return {
    paused: cfg.paused,
    extensionConnected: hub.extensionConnected,
    tabs: hub.knownTabs,
    serverTime: Date.now(),
    flock: cfg.flock.map((m) => describe(m, cfg, now)),
    log: log.recent(60)
  };
}

let pushTimer = null;
function pushState() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    hub.broadcastToDashboards({ type: 'state', state: buildState() });
  }, 40);
}

hub.onChange = pushState;
log.onEntry(() => pushState());

const scheduler = makeScheduler({ getConfig, saveConfig, pushState });

// ---------------------------------------------------------------- http

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); }
    });
  });
}

function authed(req, url) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const supplied = bearer || url.searchParams.get('token');
  return supplied === cfg.token;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  if (!authed(req, url)) return send(res, 401, { error: 'Wrong or missing access code' });

  try {
    if (pathname === '/api/state' && req.method === 'GET') {
      return send(res, 200, buildState());
    }

    if (pathname === '/api/pause' && req.method === 'POST') {
      const body = await readBody(req);
      cfg.paused = !!body.paused;
      configStore.save(cfg);
      log.add({ status: 'info', detail: cfg.paused ? 'All nudges paused' : 'Watching again' });
      pushState();
      return send(res, 200, buildState());
    }

    if (pathname === '/api/flock' && req.method === 'POST') {
      const body = await readBody(req);
      const member = configStore.normaliseMember({ ...body, id: undefined, lastRunAt: 0 });
      cfg.flock.push(member);
      configStore.save(cfg);
      log.add({ status: 'info', memberId: member.id, name: member.name, detail: 'Added to the flock' });
      pushState();
      return send(res, 200, buildState());
    }

    const memberMatch = pathname.match(/^\/api\/flock\/([a-z0-9]+)(\/nudge)?$/i);
    if (memberMatch) {
      const id = memberMatch[1];
      const isNudge = !!memberMatch[2];
      const idx = cfg.flock.findIndex((m) => m.id === id);
      if (idx === -1) return send(res, 404, { error: 'That agent is no longer in the flock' });

      if (isNudge && req.method === 'POST') {
        const result = await scheduler.run(cfg.flock[idx], { manual: true });
        return send(res, 200, { result, state: buildState() });
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const prev = cfg.flock[idx];
        cfg.flock[idx] = configStore.normaliseMember({
          ...prev,
          ...body,
          id: prev.id,
          lastRunAt: prev.lastRunAt
        });
        configStore.save(cfg);
        pushState();
        return send(res, 200, buildState());
      }

      if (req.method === 'DELETE') {
        const [removed] = cfg.flock.splice(idx, 1);
        configStore.save(cfg);
        log.add({ status: 'info', name: removed.name, detail: 'Removed from the flock' });
        pushState();
        return send(res, 200, buildState());
      }
    }

    if (pathname === '/api/roadmap' && req.method === 'GET') {
      return send(res, 200, { files: roadmap.listFiles(), latest: roadmap.latestFile() });
    }

    const roadmapMatch = pathname.match(/^\/api\/roadmap\/([^/]+)$/);
    if (roadmapMatch && req.method === 'GET') {
      const name = roadmapMatch[1] === 'latest' ? roadmap.latestFile() : roadmapMatch[1];
      const content = name ? roadmap.readFile(name) : null;
      if (content === null) return send(res, 404, { error: 'No such roadmap file' });
      return send(res, 200, content, 'text/markdown; charset=utf-8');
    }

    return send(res, 404, { error: 'Unknown endpoint' });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: 'Something broke on the service side: ' + err.message });
  }
});

// ------------------------------------------------------------ websocket

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws' || url.searchParams.get('token') !== cfg.token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const role = url.searchParams.get('role') === 'extension' ? 'extension' : 'dashboard';
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.role = role;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  if (ws.role === 'extension') {
    hub.addExtension(ws);
    log.add({ status: 'info', detail: 'Browser extension connected' });
  } else {
    hub.addDashboard(ws);
    ws.send(JSON.stringify({ type: 'state', state: buildState() }));
  }

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (_) { return; }

    if (ws.role === 'extension') {
      if (msg.type === 'tabs') hub.setTabs(msg.tabs);
      if (msg.type === 'result') hub.resolveNudge(msg.id, {
        ok: !!msg.ok,
        status: msg.status || (msg.ok ? 'sent' : 'failed'),
        detail: msg.detail || ''
      });
    }

    if (ws.role === 'dashboard' && msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', () => {
    if (ws.role === 'extension' && !hub.extensionConnected) {
      log.add({ status: 'info', detail: 'Browser extension disconnected' });
    }
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, 25000);

// ----------------------------------------------------------------- boot

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error('  Port ' + cfg.port + ' is already taken.');
    console.error('  Sheepdog is probably already running — check for it before starting another copy.');
    console.error('  To use a different port instead: set SHEEPDOG_PORT=8788 and start again.');
    console.error('');
  } else if (err.code === 'EACCES') {
    console.error('');
    console.error('  Not allowed to listen on port ' + cfg.port + '. Pick a port above 1024.');
    console.error('');
  } else {
    console.error('  Sheepdog could not start: ' + err.message);
  }
  process.exit(1);
});

server.listen(cfg.port, cfg.bind, () => {
  const addrs = ['localhost', ...lanAddresses()];
  console.log('');
  console.log('  Sheepdog is watching.');
  console.log('  Settings and logs: ' + configStore.DATA_DIR);
  console.log('');
  console.log('  Open the control panel at:');
  addrs.forEach((a) => console.log('    http://' + a + ':' + cfg.port + '/?token=' + cfg.token));
  console.log('');
  console.log('  Paste this access code into the browser extension:');
  console.log('    ' + cfg.token);
  console.log('');
  scheduler.start();
  discordBot.start(process.env.SHEEPDOG_DISCORD_TOKEN);
});

process.on('SIGINT', () => {
  configStore.saveNow(cfg);
  console.log('\n  Sheepdog stood down.');
  process.exit(0);
});
