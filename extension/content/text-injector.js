/**
 * AIzalo Flow Companion — Text Injector
 * Injects text into Zalo Web's React/Draft.js Rich Text Editor safely
 * without causing React state desynchronization.
 */

export function injectTextToZalo(text) {
  if (!text || typeof text !== 'string') return false;

  // 1. Locate Zalo Web's active message input box
  const inputEl = findZaloInput();
  if (!inputEl) {
    console.warn('[AIzalo Companion] Không tìm thấy khung soạn thảo tin nhắn Zalo.');
    return false;
  }

  inputEl.focus();

  // 2. Primary Method: Dispatch simulated ClipboardEvent('paste')
  // This triggers Draft.js/Slate native handlePastedText handler, updating React EditorState cleanly.
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true
    });
    const dispatched = inputEl.dispatchEvent(pasteEvent);
    if (dispatched) {
      // If paste was accepted, check if text was injected
      if (inputEl.innerText && inputEl.innerText.includes(text.substring(0, 10))) {
        return true;
      }
    }
  } catch (err) {
    console.warn('[AIzalo Companion] Paste event dispatch notice:', err.message);
  }

  // 3. Fallback Method: document.execCommand('insertText')
  try {
    const success = document.execCommand('insertText', false, text);
    if (success) {
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  } catch (err) {
    console.warn('[AIzalo Companion] execCommand notice:', err.message);
  }

  // 4. Secondary Fallback: Direct text insertion + InputEvent
  try {
    inputEl.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.selectNodeContents(textNode);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return true;
    }
  } catch (err) {
    console.error('[AIzalo Companion] Text injection fallback error:', err.message);
  }

  return false;
}

/**
 * Robust selector for Zalo Web's Rich Text Input
 */
export function findZaloInput() {
  // Selector list covering different Zalo Web builds
  const selectors = [
    '#input_chat [contenteditable="true"]',
    '#richInput [contenteditable="true"]',
    'div[contenteditable="true"][data-translate-inner="input_placeholder"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    '#input_chat',
    '#richInput'
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) {
      return el;
    }
  }
  return null;
}

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}
