const crypto = require('crypto');

const PENDING_TIMEOUT_MS = 20000;

class Hub {
  constructor() {
    this.extensions = new Set();
    this.dashboards = new Set();
    this.pending = new Map();
    this.knownTabs = [];
    this.onChange = () => {};
  }

  addExtension(ws) {
    this.extensions.add(ws);
    ws.on('close', () => {
      this.extensions.delete(ws);
      if (this.extensions.size === 0) this.knownTabs = [];
      this.onChange();
    });
    this.onChange();
  }

  addDashboard(ws) {
    this.dashboards.add(ws);
    ws.on('close', () => this.dashboards.delete(ws));
  }

  setTabs(tabs) {
    this.knownTabs = Array.isArray(tabs) ? tabs : [];
    this.onChange();
  }

  get extensionConnected() {
    return this.extensions.size > 0;
  }

  broadcastToDashboards(payload) {
    const text = JSON.stringify(payload);
    for (const ws of this.dashboards) {
      if (ws.readyState === 1) {
        try { ws.send(text); } catch (_) {}
      }
    }
  }

  /**
   * Ask the extension to deliver a message. Resolves with
   * { ok, status, detail }. Never rejects.
   */
  nudge(target) {
    if (!this.extensionConnected) {
      return Promise.resolve({
        ok: false,
        status: 'failed',
        detail: 'No browser extension connected'
      });
    }

    const id = crypto.randomBytes(6).toString('hex');
    const payload = JSON.stringify({ type: 'nudge', id, target });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, status: 'failed', detail: 'Browser did not answer in time' });
      }, PENDING_TIMEOUT_MS);

      this.pending.set(id, (result) => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(result);
      });

      let delivered = false;
      for (const ws of this.extensions) {
        if (ws.readyState === 1) {
          try { ws.send(payload); delivered = true; break; } catch (_) {}
        }
      }
      if (!delivered) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, status: 'failed', detail: 'Extension connection is not writable' });
      }
    });
  }

  resolveNudge(id, result) {
    const fn = this.pending.get(id);
    if (fn) fn(result);
  }
}

module.exports = new Hub();
