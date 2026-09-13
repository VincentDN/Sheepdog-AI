const $ = (id) => document.getElementById(id);

async function refresh() {
  const stored = await chrome.storage.local.get(['service', 'token']);
  $('service').value = stored.service || 'localhost:8787';
  $('token').value = stored.token || '';

  chrome.runtime.sendMessage({ type: 'sheepdog-status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      $('stateText').textContent = 'Service worker asleep — reopen to retry';
      return;
    }
    $('dot').classList.toggle('on', res.connected);
    if (res.connected) {
      $('stateText').textContent = 'Connected to ' + res.service;
    } else if (!res.hasToken) {
      $('stateText').textContent = 'Needs an access code';
    } else {
      $('stateText').textContent = 'Cannot reach ' + res.service;
    }
  });
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    service: $('service').value.trim().replace(/^(https?|wss?):\/\//, '').replace(/\/+$/, ''),
    token: $('token').value.trim()
  });
  $('stateText').textContent = 'Connecting…';
  chrome.runtime.sendMessage({ type: 'sheepdog-reconnect' }, () => setTimeout(refresh, 900));
});

refresh();
