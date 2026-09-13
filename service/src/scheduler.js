const hub = require('./hub');
const log = require('./log');

const TICK_MS = 10000;

function minutesOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function hhmmToMinutes(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function inQuietHours(member, now) {
  if (!member.quietStart || !member.quietEnd) return false;
  const cur = minutesOfDay(now);
  const start = hhmmToMinutes(member.quietStart);
  const end = hhmmToMinutes(member.quietEnd);
  if (start === end) return false;
  // Windows that cross midnight, e.g. 23:00 -> 07:30
  if (start > end) return cur >= start || cur < end;
  return cur >= start && cur < end;
}

/**
 * Returns a timestamp in ms, or null when nothing is scheduled.
 */
function nextRunAt(member, now) {
  if (!member.enabled) return null;

  if (member.scheduleType === 'interval') {
    if (!member.lastRunAt) return now.getTime();
    return member.lastRunAt + member.everyMinutes * 60000;
  }

  if (!member.times.length) return null;
  const sorted = [...member.times].sort();
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    if (!member.days.includes(day.getDay())) continue;
    for (const t of sorted) {
      const candidate = new Date(day);
      const [h, m] = t.split(':').map(Number);
      candidate.setHours(h, m, 0, 0);
      const ts = candidate.getTime();
      if (ts <= now.getTime()) continue;
      if (member.lastRunAt && ts <= member.lastRunAt) continue;
      return ts;
    }
  }
  return null;
}

function whyBlocked(member, cfg, now) {
  if (cfg.paused) return 'All nudges paused';
  if (!member.enabled) return 'Paused';
  if (!member.match) return 'No tab to match — add a URL';
  if (!member.days.includes(now.getDay())) return 'Not scheduled today';
  if (inQuietHours(member, now)) return 'Quiet hours until ' + member.quietEnd;
  if (log.countSince(member.id, 3600000) >= member.maxPerHour) {
    return 'Hourly limit reached (' + member.maxPerHour + ')';
  }
  if (!hub.extensionConnected) return 'Browser extension offline';
  return null;
}

function describe(member, cfg, now) {
  const blocked = whyBlocked(member, cfg, now);
  const next = nextRunAt(member, now);
  return {
    ...member,
    nextRunAt: next,
    blockedReason: blocked,
    sentThisHour: log.countSince(member.id, 3600000)
  };
}

function makeScheduler({ getConfig, saveConfig, pushState }) {
  let timer = null;
  const inflight = new Set();

  async function run(member, { manual } = {}) {
    if (inflight.has(member.id)) return { ok: false, status: 'skipped', detail: 'Already running' };
    inflight.add(member.id);
    try {
      const result = await hub.nudge({
        memberId: member.id,
        name: member.name,
        platform: member.platform,
        match: member.match,
        message: member.message,
        requireIdle: manual ? false : member.requireIdle,
        idleSeconds: member.idleSeconds
      });

      const cfg = getConfig();
      const live = cfg.flock.find((m) => m.id === member.id);
      if (live) {
        live.lastStatus = result.status;
        live.lastDetail = result.detail || '';
        // Only a real send, or a deliberate skip, resets the interval clock.
        // Failures retry on the next tick instead of silently going quiet.
        if (result.status === 'sent' || result.status === 'skipped') {
          live.lastRunAt = Date.now();
        }
        saveConfig(cfg);
      }

      log.add({
        status: result.status,
        memberId: member.id,
        name: member.name,
        detail: result.detail || (result.status === 'sent' ? 'Sent "' + member.message + '"' : '')
      });

      pushState();
      return result;
    } finally {
      inflight.delete(member.id);
    }
  }

  function tick() {
    const cfg = getConfig();
    const now = new Date();
    if (cfg.paused) return;

    for (const member of cfg.flock) {
      if (whyBlocked(member, cfg, now)) continue;
      const next = nextRunAt(member, now);
      if (next === null || next > now.getTime()) continue;
      run(member);
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, TICK_MS);
      tick();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    run,
    describe
  };
}

module.exports = { makeScheduler, describe, nextRunAt, inQuietHours };
