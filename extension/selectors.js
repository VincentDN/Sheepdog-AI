/**
 * Claude and ChatGPT both rewrite their markup regularly. When a nudge starts
 * reporting "couldn't find the message box", this is the only file you need to
 * fix: open the chat, inspect the composer, and add the new selector to the
 * front of the relevant list. Every list is tried in order.
 */
globalThis.SHEEPDOG_SELECTORS = {
  claude: {
    label: 'Claude',
    composer: [
      'div[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"]'
    ],
    send: [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]:not([disabled])',
      'button[type="submit"]:not([disabled])'
    ],
    stop: [
      'button[aria-label*="Stop" i]',
      'button[data-state="open"][aria-label*="stop" i]'
    ],
    conversation: ['main', 'div[role="main"]', 'body']
  },

  chatgpt: {
    label: 'ChatGPT',
    composer: [
      '#prompt-textarea',
      'div[contenteditable="true"]#prompt-textarea',
      'form div[contenteditable="true"]',
      'textarea[data-id]',
      'div[contenteditable="true"]'
    ],
    send: [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send prompt" i]',
      'button[aria-label*="Send" i]:not([disabled])'
    ],
    stop: [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop streaming" i]',
      'button[aria-label*="Stop" i]'
    ],
    conversation: ['main', 'div[role="main"]', 'body']
  }
};

globalThis.SHEEPDOG_PLATFORM_FOR_URL = function (url) {
  if (/(^|\.)claude\.ai$/.test(new URL(url).hostname)) return 'claude';
  if (/(^|\.)(chatgpt\.com|openai\.com)$/.test(new URL(url).hostname)) return 'chatgpt';
  return null;
};
