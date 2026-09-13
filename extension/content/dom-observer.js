/**
 * AIzalo Flow Companion — DOM Observer
 * Observes chat view changes on chat.zalo.me and extracts customer context safely.
 */

export class ZaloDomObserver {
  constructor(onChatStateChange) {
    this.onChatStateChange = onChatStateChange;
    this.observer = null;
    this.debounceTimer = null;
    this.currentChatName = '';
  }

  start() {
    this.stop();

    // Listen for DOM changes with debounce to avoid CPU load
    this.observer = new MutationObserver(() => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.checkState();
      }, 250);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial check
    this.checkState();
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  checkState() {
    const chatName = this.getCurrentCustomerName();
    const hasInput = !!document.querySelector('div[contenteditable="true"]');

    if (chatName !== this.currentChatName || hasInput) {
      this.currentChatName = chatName;
      if (typeof this.onChatStateChange === 'function') {
        this.onChatStateChange({
          hasActiveChat: hasInput && !!chatName,
          customerName: chatName,
          lastMessage: this.getLastCustomerMessage()
        });
      }
    }
  }

  /**
   * Extract current customer / conversation name from chat header
   */
  getCurrentCustomerName() {
    const titleSelectors = [
      '.chat-title .name',
      '.header-title .name',
      'header .header-title',
      '.conv-item.active .conv-item-title__name',
      '[data-translate-inner="chat_title"]'
    ];

    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.trim()) {
        return el.innerText.trim().replace(/\s+/g, ' ');
      }
    }

    // Fallback: active conversation item in left sidebar
    const activeItem = document.querySelector('.conv-item.active') || document.querySelector('[class*="conv-item"][class*="active"]');
    if (activeItem) {
      const nameEl = activeItem.querySelector('.name') || activeItem.querySelector('[class*="name"]');
      if (nameEl && nameEl.innerText) {
        return nameEl.innerText.trim();
      }
    }

    return '';
  }

  /**
   * Extract the last inbound customer message for AI contextual suggestions
   */
  getLastCustomerMessage() {
    // Find message bubbles in chat stream
    const messageBubbles = document.querySelectorAll('.chat-message, .msg-item, [class*="chat-message"], [class*="bubble"]');
    if (!messageBubbles || messageBubbles.length === 0) return '';

    // Walk backwards to find the last message sent by customer (not self/admin)
    for (let i = messageBubbles.length - 1; i >= 0; i--) {
      const bubble = messageBubbles[i];
      const isSelf = bubble.classList.contains('me') || 
                     bubble.classList.contains('self') || 
                     bubble.getAttribute('data-sender') === 'self' ||
                     bubble.closest('.me, .self, [class*="msg-me"]');

      if (!isSelf) {
        const textEl = bubble.querySelector('.text, .bubble-content, .msg-text, [class*="content"]');
        if (textEl && textEl.innerText && textEl.innerText.trim()) {
          return textEl.innerText.trim();
        }
        if (bubble.innerText && bubble.innerText.trim()) {
          return bubble.innerText.trim();
        }
      }
    }

    return '';
  }
}
