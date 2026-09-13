/**
 * AIzalo Flow Companion — AI Suggest Card Component
 */

import { injectTextToZalo } from '../text-injector.js';

export class AiSuggestCard {
  constructor(onClose) {
    this.onClose = onClose;
    this.element = null;
  }

  render(lastMessage, customerName = '') {
    const popover = document.createElement('div');
    popover.className = 'aizalo-popover';

    popover.innerHTML = `
      <div class="popover-header">
        <h3>✨ Gợi Ý Phản Hồi AI</h3>
        <button class="popover-close" id="btnCloseAi">✕</button>
      </div>
      <div class="ai-suggest-body" id="aiCardBody">
        <div class="loading-spinner">
          <span>🧠 Đang phân tích tin nhắn và tạo gợi ý...</span>
        </div>
      </div>
    `;

    // Bind Close
    popover.querySelector('#btnCloseAi').addEventListener('click', () => {
      if (typeof this.onClose === 'function') this.onClose();
    });

    const bodyEl = popover.querySelector('#aiCardBody');

    // Request AI suggestions via Background Service Worker
    chrome.runtime.sendMessage({
      action: 'GET_AI_SUGGEST',
      payload: {
        lastMessage: lastMessage || 'Xin chào shop',
        customerName: customerName || ''
      }
    }, (res) => {
      bodyEl.innerHTML = '';

      if (!res || !res.success || !Array.isArray(res.suggestions) || res.suggestions.length === 0) {
        bodyEl.innerHTML = `
          <div style="padding: 16px; text-align: center; color: #ef4444; font-size: 11px;">
            ${res?.error || 'Không thể tạo gợi ý. Hãy kiểm tra cài đặt AI trong Zalo-Flow.'}
          </div>
        `;
        return;
      }

      for (const item of res.suggestions) {
        const card = document.createElement('div');
        card.className = 'ai-card';
        card.innerHTML = `
          <div class="ai-card-badge">${escapeHtml(item.style || 'Gợi ý')}</div>
          <div class="ai-card-text">${escapeHtml(item.text || '')}</div>
        `;

        card.addEventListener('click', () => {
          injectTextToZalo(item.text || '');
          if (typeof this.onClose === 'function') this.onClose();
        });

        bodyEl.appendChild(card);
      }
    });

    this.element = popover;
    return popover;
  }

  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
