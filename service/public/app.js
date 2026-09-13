const $ = (sel, root) => (root || document).querySelector(sel);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let token = '';
let state = null;
let skew = 0;               // serverTime - local clock
let editingId = null;
let draft = null;           // an unsaved new agent, kept out of server state
let socket = null;
let reconnectDelay = 1000;

// ------------------------------------------------------------------ auth

function readToken() {
  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) {
    localStorage.setItem('sheepdog.token', fromUrl);
    history.replaceState({}, '', location.pathname);
    return fromUrl;
  }
  return localStorage.getItem('sheepdog.token') || '';
}

function showGate(message) {
  $('#app').hidden = true;
  $('#gate').hidden = false;
  const err = $('#gateError');
  err.hidden = !message;
  err.textContent = message || '';
  $('#gateToken').focus();
}

$('#gateGo').addEventListener('click', () => {
  const value = $('#gateToken').value.trim();
  if (!value) return showGate('Enter the access code first.');
  localStorage.setItem('sheepdog.token', value);
  token = value;
  boot();
});
$('#gateToken').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#gateGo').click();
});

$('#forgetBtn').addEventListener('click', () => {
  localStorage.removeItem('sheepdog.token');
  location.reload();
});

// ------------------------------------------------------------------- api

async function api(path, options) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...(options && options.headers)
    }
  });
  if (res.status === 401) {
    showGate('That access code was not accepted.');
    throw new Error('unauthorised');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
}

function applyState(next) {
  state = next;
  skew = next.serverTime - Date.now();
  render();
}

function openSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(proto + '://' + location.host + '/ws?role=dashboard&token=' + encodeURIComponent(token));
  socket.onopen = () => { reconnectDelay = 1000; };
  socket.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'state') applyState(msg.state);
  };
  socket.onclose = () => {
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    setTimeout(openSocket, reconnectDelay);
  };
}

async function boot() {
  try {
    const s = await api('/state');
    $('#gate').hidden = true;
    $('#app').hidden = false;
    applyState(s);
    openSocket();
  } catch (err) {
    if (err.message !== 'unauthorised') showGate('Could not reach the service. Is it running?');
  }
}

// -------------------------------------------------------------- rendering

function now() { return Date.now() + skew; }

function relative(ms) {
  if (ms <= 0) return 'now';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.round(s / 60);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

function ago(ts) {
  if (!ts) return 'never';
  return relative(now() - ts) + ' ago';
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toneFor(m) {
  if (state.paused || !m.enabled) return 'off';
  if (m.lastStatus === 'failed' || !state.extensionConnected || !m.match) return 'bad';
  if (m.nextRunAt !== null && m.nextRunAt <= now()) return 'due';
  return 'ready';
}

function stateLine(m) {
  const bits = [];
  if (state.paused) bits.push('All nudges paused');
  else if (!m.enabled) bits.push('Paused');
  else if (m.blockedReason) bits.push(m.blockedReason);
  else if (m.nextRunAt === null) bits.push('No upcoming nudge — check the schedule');
  else bits.push('Next nudge in ' + relative(m.nextRunAt - now()));

  if (m.lastRunAt) {
    const verb = m.lastStatus === 'sent' ? 'Nudged' : m.lastStatus === 'skipped' ? 'Held off' : 'Tried';
    bits.push(verb.toLowerCase() + ' ' + ago(m.lastRunAt));
  }
  if (m.lastStatus === 'failed' && m.lastDetail) bits.push(m.lastDetail);
  return bits.join(', ');
}

function tensionFraction(m) {
  if (!m.enabled || m.nextRunAt === null) return 0;
  let period;
  if (m.scheduleType === 'interval') period = m.everyMinutes * 60000;
  else period = m.lastRunAt ? Math.max(m.nextRunAt - m.lastRunAt, 60000) : 3600000;
  const remaining = Math.max(m.nextRunAt - now(), 0);
  return Math.max(0, Math.min(1, 1 - remaining / period));
}

function renderHeadline() {
  const active = state.flock.filter((m) => m.enabled).length;
  const head = $('#headline');

  if (state.paused) {
    head.textContent = 'Everything is on hold. Nothing will be sent until you start again.';
  } else if (!state.flock.length) {
    head.textContent = 'No agents yet.';
  } else {
    const upcoming = state.flock
      .filter((m) => m.enabled && !m.blockedReason && m.nextRunAt !== null)
      .sort((a, b) => a.nextRunAt - b.nextRunAt)[0];
    const flockWord = active === 1 ? '1 agent' : active + ' agents';
    head.textContent = upcoming
      ? flockWord + ' watched. Next nudge in ' + relative(upcoming.nextRunAt - now()) + '.'
      : flockWord + ' watched. Nothing due.';
  }

  const kill = $('#killSwitch');
  kill.textContent = state.paused ? 'Start watching' : 'Stop all';
  kill.dataset.paused = state.paused ? '1' : '0';

  const link = $('#linkState');
  link.dataset.bad = state.extensionConnected ? '0' : '1';
  link.textContent = state.extensionConnected
    ? state.tabs.length + ' chat ' + (state.tabs.length === 1 ? 'tab' : 'tabs') + ' in reach'
    : 'Browser extension offline — nothing can be sent until it reconnects';
}

function visibleFlock() {
  return draft ? state.flock.concat([draft]) : state.flock;
}

function renderFlock() {
  const host = $('#flock');
  const members = visibleFlock();
  $('#flockEmpty').hidden = members.length > 0;

  // Leave the row being edited alone so typing is not interrupted.
  const keep = editingId ? host.querySelector('.row[data-id="' + editingId + '"]') : null;
  host.textContent = '';

  for (const m of members) {
    if (keep && m.id === editingId) { host.appendChild(keep); updateRow(keep, m); continue; }
    host.appendChild(buildRow(m));
  }
}

function buildRow(m) {
  const node = $('#rowTpl').content.firstElementChild.cloneNode(true);
  node.dataset.id = m.id;

  $('.act-nudge', node).addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Sending…';
    try {
      const res = await api('/flock/' + m.id + '/nudge', { method: 'POST' });
      applyState(res.state);
      const fresh = $('#flock .row[data-id="' + m.id + '"]');
      if (fresh) {
        fresh.classList.add('just-nudged');
        setTimeout(() => fresh.classList.remove('just-nudged'), 900);
      }
    } catch (err) {
      e.target.textContent = 'Nudge now';
      e.target.disabled = false;
    }
  });

  $('.act-toggle', node).addEventListener('click', async () => {
    const res = await api('/flock/' + m.id, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !m.enabled })
    });
    applyState(res);
  });

  $('.act-edit', node).addEventListener('click', () => {
    editingId = editingId === m.id ? null : m.id;
    render();
  });

  updateRow(node, m);
  return node;
}

function updateRow(node, m) {
  node.dataset.tone = toneFor(m);
  $('.row-name', node).textContent = m.name;
  $('.row-platform', node).textContent = m.platform === 'claude' ? 'Claude' : 'ChatGPT';
  $('.row-state', node).textContent = stateLine(m);
  $('.tension-fill', node).style.width = (tensionFraction(m) * 100).toFixed(1) + '%';
  $('.act-toggle', node).textContent = m.enabled ? 'Pause' : 'Resume';

  const btn = $('.act-nudge', node);
  if (!btn.disabled) btn.textContent = 'Nudge now';

  const editor = $('.editor', node);
  if (editingId === m.id) {
    if (editor.hidden) { editor.hidden = false; editor.appendChild(buildEditor(m)); }
  } else {
    editor.hidden = true;
    editor.textContent = '';
  }
}

// ---------------------------------------------------------------- editor

function fieldBlock(label, control, hint, wide) {
  const wrap = document.createElement('div');
  wrap.className = 'f' + (wide ? ' wide' : '');
  const lab = document.createElement('label');
  lab.textContent = label;
  lab.htmlFor = control.id;
  wrap.append(lab, control);
  if (hint) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = hint;
    wrap.appendChild(p);
  }
  return wrap;
}

function input(id, value, opts) {
  const el = document.createElement('input');
  el.id = id;
  el.className = 'field' + (opts && opts.mono ? ' mono' : '');
  el.value = value == null ? '' : value;
  if (opts && opts.type) el.type = opts.type;
  if (opts && opts.placeholder) el.placeholder = opts.placeholder;
  if (opts && opts.min != null) el.min = opts.min;
  if (opts && opts.max != null) el.max = opts.max;
  el.spellcheck = false;
  return el;
}

function select(id, value, options) {
  const el = document.createElement('select');
  el.id = id;
  el.className = 'field';
  for (const [val, label] of options) {
    const o = document.createElement('option');
    o.value = val;
    o.textContent = label;
    if (val === value) o.selected = true;
    el.appendChild(o);
  }
  return el;
}

function buildEditor(m) {
  const isNew = m.id === '__new__';
  const box = document.createElement('div');

  const name = input('f-name-' + m.id, m.name);
  const platform = select('f-plat-' + m.id, m.platform, [['claude', 'Claude'], ['chatgpt', 'ChatGPT']]);
  const match = input('f-match-' + m.id, m.match, { mono: true, placeholder: 'https://claude.ai/chat/…' });
  const message = input('f-msg-' + m.id, m.message, { mono: true });
  const schedType = select('f-sched-' + m.id, m.scheduleType, [
    ['interval', 'Every so often'],
    ['times', 'At set times of day']
  ]);
  const every = input('f-every-' + m.id, m.everyMinutes, { type: 'number', min: 1, max: 1440 });
  const times = input('f-times-' + m.id, m.times.join(', '), { mono: true, placeholder: '09:00, 13:30, 17:00' });
  const idleSec = input('f-idle-' + m.id, m.idleSeconds, { type: 'number', min: 5, max: 3600 });
  const cap = input('f-cap-' + m.id, m.maxPerHour, { type: 'number', min: 1, max: 120 });
  const qStart = input('f-qs-' + m.id, m.quietStart, { type: 'time' });
  const qEnd = input('f-qe-' + m.id, m.quietEnd, { type: 'time' });

  // Quick-fill from the tabs the extension can currently see.
  const tabPicker = select('f-tab-' + m.id, '', [
    ['', state.tabs.length ? 'Pick from open tabs…' : 'No chat tabs open right now'],
    ...state.tabs.map((t) => [t.url, (t.title || t.url).slice(0, 70)])
  ]);
  tabPicker.addEventListener('change', () => {
    if (!tabPicker.value) return;
    match.value = tabPicker.value;
    platform.value = tabPicker.value.includes('claude.ai') ? 'claude' : 'chatgpt';
    if (!name.value || name.value === 'Unnamed agent') {
      const t = state.tabs.find((x) => x.url === tabPicker.value);
      if (t && t.title) name.value = t.title.slice(0, 60);
    }
  });

  const idleWrap = document.createElement('label');
  idleWrap.className = 'check';
  const idleBox = document.createElement('input');
  idleBox.type = 'checkbox';
  idleBox.checked = m.requireIdle;
  idleWrap.append(idleBox, document.createTextNode('Only nudge when the agent has gone quiet'));

  const days = document.createElement('div');
  days.className = 'days';
  const chosen = new Set(m.days);
  DAY_NAMES.forEach((label, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day';
    b.textContent = label;
    b.dataset.on = chosen.has(idx) ? '1' : '0';
    b.addEventListener('click', () => {
      if (chosen.has(idx)) chosen.delete(idx); else chosen.add(idx);
      b.dataset.on = chosen.has(idx) ? '1' : '0';
    });
    days.appendChild(b);
  });

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.append(
    fieldBlock('Name', name),
    fieldBlock('Which chat', platform),
    fieldBlock('Tab address', match, 'The conversation URL. A * stands in for anything.', true),
    fieldBlock('Or grab an open tab', tabPicker, null, true),
    fieldBlock('What to type', message, null, true),
    fieldBlock('When', schedType),
    fieldBlock('Minutes between nudges', every),
    fieldBlock('Times of day', times, 'Used when "At set times of day" is chosen.', true),
    fieldBlock('Quiet from', qStart),
    fieldBlock('Quiet until', qEnd),
    fieldBlock('Quiet for at least (seconds)', idleSec, 'How long the page must sit still before a nudge counts as safe.'),
    fieldBlock('Most nudges per hour', cap)
  );

  const daysWrap = document.createElement('div');
  daysWrap.className = 'f wide';
  const daysLabel = document.createElement('label');
  daysLabel.textContent = 'Days';
  daysWrap.append(daysLabel, days);

  const idleField = document.createElement('div');
  idleField.className = 'f wide';
  idleField.appendChild(idleWrap);

  grid.append(daysWrap, idleField);

  const actions = document.createElement('div');
  actions.className = 'editor-actions';

  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.style.width = 'auto';
  save.style.padding = '10px 20px';
  save.textContent = isNew ? 'Add to the flock' : 'Save changes';

  const cancel = document.createElement('button');
  cancel.className = 'btn btn-quiet';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    if (isNew) draft = null;
    editingId = null;
    render();
  });

  actions.append(save, cancel);

  if (!isNew) {
    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.textContent = 'Remove';
    del.addEventListener('click', async () => {
      if (!confirm('Remove ' + m.name + ' from the flock?')) return;
      const res = await api('/flock/' + m.id, { method: 'DELETE' });
      editingId = null;
      applyState(res);
    });
    actions.appendChild(del);
  }

  save.addEventListener('click', async () => {
    const payload = {
      name: name.value.trim() || 'Unnamed agent',
      platform: platform.value,
      match: match.value.trim(),
      message: message.value || 'resume the work',
      scheduleType: schedType.value,
      everyMinutes: Number(every.value),
      times: times.value.split(',').map((s) => s.trim()).filter(Boolean),
      days: [...chosen].sort(),
      requireIdle: idleBox.checked,
      idleSeconds: Number(idleSec.value),
      maxPerHour: Number(cap.value),
      quietStart: qStart.value,
      quietEnd: qEnd.value
    };
    save.disabled = true;
    try {
      const res = isNew
        ? await api('/flock', { method: 'POST', body: JSON.stringify(payload) })
        : await api('/flock/' + m.id, { method: 'PUT', body: JSON.stringify(payload) });
      draft = null;
      editingId = null;
      applyState(res);
    } catch (err) {
      save.disabled = false;
      alert(err.message);
    }
  });

  box.append(grid, actions);
  return box;
}

// ------------------------------------------------------------------- log

function renderLog() {
  const host = $('#log');
  host.textContent = '';
  for (const e of state.log) {
    const li = document.createElement('li');
    li.dataset.status = e.status;
    const t = document.createElement('time');
    t.textContent = clockTime(e.at);
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = e.name;
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = e.detail;
    li.append(t, who, what);
    host.appendChild(li);
  }
}

function render() {
  if (!state) return;
  renderHeadline();
  renderFlock();
  renderLog();
}

// ------------------------------------------------------------- interaction

$('#killSwitch').addEventListener('click', async () => {
  const res = await api('/pause', {
    method: 'POST',
    body: JSON.stringify({ paused: !state.paused })
  });
  applyState(res);
});

$('#addBtn').addEventListener('click', () => {
  if (draft) { editingId = '__new__'; return render(); }
  draft = {
    id: '__new__',
    name: '',
    platform: 'claude',
    match: '',
    message: 'resume the work',
    enabled: true,
    scheduleType: 'interval',
    everyMinutes: 20,
    times: [],
    days: [0, 1, 2, 3, 4, 5, 6],
    requireIdle: true,
    idleSeconds: 90,
    quietStart: '',
    quietEnd: '',
    maxPerHour: 6,
    lastRunAt: 0,
    lastStatus: null,
    lastDetail: null,
    nextRunAt: null,
    blockedReason: null
  };
  editingId = '__new__';
  render();
});

// Countdowns tick locally so the panel stays lively between server pushes.
setInterval(() => {
  if (!state || $('#app').hidden) return;
  renderHeadline();
  for (const m of state.flock) {
    const node = $('#flock .row[data-id="' + m.id + '"]');
    if (!node) continue;
    $('.row-state', node).textContent = stateLine(m);
    $('.tension-fill', node).style.width = (tensionFraction(m) * 100).toFixed(1) + '%';
    node.dataset.tone = toneFor(m);
  }
}, 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

token = readToken();
if (token) boot(); else showGate();
