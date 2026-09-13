(function () {
  const S = globalThis.SHEEPDOG_SELECTORS;
  const platform = globalThis.SHEEPDOG_PLATFORM_FOR_URL(location.href);
  if (!platform || !S[platform]) return;
  const conf = S[platform];

  let lastMutationAt = Date.now();
  let observer = null;

  function firstMatch(list) {
    for (const sel of list) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.offsetParent !== null || el === document.activeElement) return el;
      }
    }
    return null;
  }

  function watchConversation() {
    const root = firstMatch(conf.conversation) || document.body;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => { lastMutationAt = Date.now(); });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  }
  watchConversation();
  setInterval(watchConversation, 30000);

  function composerText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return (el.innerText || '').replace(/\u00a0/g, ' ').trim();
  }

  function isGenerating() {
    const stop = firstMatch(conf.stop);
    return !!stop;
  }

  /**
   * Returns null when it is fine to nudge, or a human-readable reason not to.
   */
  function reasonToHoldOff(target) {
    if (isGenerating()) return 'Agent is still working';

    const composer = firstMatch(conf.composer);
    if (!composer) return "Couldn't find the message box";

    const draft = composerText(composer);
    if (draft && draft !== target.message) return 'You have a draft in the box';

    if (target.requireIdle) {
      const quietFor = (Date.now() - lastMutationAt) / 1000;
      if (quietFor < target.idleSeconds) {
        return 'Page was still changing ' + Math.round(quietFor) + 's ago';
      }
    }
    return null;
  }

  function insertText(el, text) {
    el.focus();

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);

    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_) { ok = false; }

    if (!ok) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
    }
    return true;
  }

  function pressEnter(el) {
    const opts = {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true, composed: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function wait(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function deliver(target) {
    const hold = reasonToHoldOff(target);
    if (hold) return { ok: false, status: 'skipped', detail: hold };

    const composer = firstMatch(conf.composer);
    insertText(composer, target.message);

    // Give the page's editor a moment to enable its send button.
    await wait(350);

    const sendBtn = firstMatch(conf.send);
    if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
      sendBtn.click();
    } else {
      pressEnter(composer);
    }

    await wait(700);

    const leftover = composerText(firstMatch(conf.composer));
    if (leftover === target.message) {
      return { ok: false, status: 'failed', detail: 'Typed the message but it would not send' };
    }

    lastMutationAt = Date.now();
    return { ok: true, status: 'sent', detail: 'Sent "' + target.message + '"' };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'sheepdog-nudge') {
      deliver(msg.target)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, status: 'failed', detail: String(err && err.message || err) }));
      return true;
    }
    if (msg && msg.type === 'sheepdog-probe') {
      sendResponse({
        ok: true,
        platform,
        generating: isGenerating(),
        quietForSeconds: Math.round((Date.now() - lastMutationAt) / 1000),
        hasComposer: !!firstMatch(conf.composer)
      });
      return true;
    }
  });
})();
