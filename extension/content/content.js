/**
 * AIzalo Flow Companion — Content Script (Standalone Bundle for Chrome MV3)
 * Injected into https://chat.zalo.me/*
 * Self-contained without ES module import errors.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__AIZALO_COMPANION_LOADED__) return;
  window.__AIZALO_COMPANION_LOADED__ = true;

  console.log('⚡ [AIzalo Flow Companion] Injected successfully into chat.zalo.me');

  /* ==========================================================================
     1. Text Injector (React / Draft.js State Safe)
     ========================================================================== */
  function findZaloInput() {
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
      if (el && isElementVisible(el)) {
        return el;
      }
    }
    return null;
  }

  function isElementVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function injectTextToZalo(text) {
    if (!text || typeof text !== 'string') return false;

    const inputEl = findZaloInput();
    if (!inputEl) {
      console.warn('[AIzalo Companion] Không tìm thấy khung soạn thảo tin nhắn Zalo.');
      return false;
    }

    inputEl.focus();

    // Primary: Simulated ClipboardEvent('paste')
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true
      });
      inputEl.dispatchEvent(pasteEvent);
      if (inputEl.innerText && inputEl.innerText.includes(text.substring(0, 8))) {
        return true;
      }
    } catch (err) {
      console.warn('[AIzalo Companion] Paste event notice:', err);
    }

    // Fallback: document.execCommand('insertText')
    try {
      const success = document.execCommand('insertText', false, text);
      if (success) {
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    } catch (err) {}

    // Fallback: Range insertion + InputEvent
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
    } catch (err) {}

    return false;
  }

  /* ==========================================================================
     2. DOM Observer (Customer context & last message)
     ========================================================================== */
  function getCurrentCustomerName() {
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

    const activeItem = document.querySelector('.conv-item.active') || document.querySelector('[class*="conv-item"][class*="active"]');
    if (activeItem) {
      const nameEl = activeItem.querySelector('.name') || activeItem.querySelector('[class*="name"]');
      if (nameEl && nameEl.innerText) {
        return nameEl.innerText.trim();
      }
    }
    return '';
  }

  function getLastCustomerMessage() {
    const bubbles = document.querySelectorAll('.chat-message, .msg-item, [class*="chat-message"], [class*="bubble"]');
    if (!bubbles || bubbles.length === 0) return '';

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      const isSelf = b.classList.contains('me') || 
                     b.classList.contains('self') || 
                     b.getAttribute('data-sender') === 'self' ||
                     b.closest('.me, .self, [class*="msg-me"]');

      if (!isSelf) {
        const textEl = b.querySelector('.text, .bubble-content, .msg-text, [class*="content"]');
        if (textEl && textEl.innerText && textEl.innerText.trim()) {
          return textEl.innerText.trim();
        }
        if (b.innerText && b.innerText.trim()) {
          return b.innerText.trim();
        }
      }
    }
    return '';
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ==========================================================================
     3. Shadow DOM Styles & Structure
     ========================================================================== */
  const SHADOW_CSS = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    .aizalo-companion-wrapper {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      pointer-events: auto;
    }

    /* Floating Dock */
    .aizalo-dock {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.18);
      border-radius: 24px;
      padding: 5px 10px;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }

    .aizalo-dock:hover {
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
      border-color: #94a3b8;
    }

    .dock-brand {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: linear-gradient(135deg, #eff6ff, #dbeafe);
      border: 1px solid #bfdbfe;
      border-radius: 12px;
      color: #0068ff;
      font-weight: 700;
      font-size: 11px;
    }

    .dock-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      color: #1e293b;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .dock-btn:hover {
      background: #f1f5f9;
      color: #0068ff;
      border-color: #0068ff;
    }

    .dock-btn.active {
      background: #0068ff;
      color: #ffffff;
      border-color: #0068ff;
    }

    .dock-btn .icon {
      font-size: 14px;
    }

    /* Popover */
    .aizalo-popover {
      width: 350px;
      max-height: 460px;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      margin-bottom: 4px;
      animation: popoverFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes popoverFadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .popover-header {
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fafafa;
    }

    .popover-header h3 {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .popover-close {
      background: transparent;
      border: none;
      font-size: 16px;
      color: #94a3b8;
      cursor: pointer;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .popover-close:hover {
      color: #ef4444;
      background: #fee2e2;
    }

    /* Search */
    .search-wrapper {
      padding: 8px 12px;
      border-bottom: 1px solid #f1f5f9;
      background: #ffffff;
    }

    .search-input {
      width: 100%;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 12px;
      outline: none;
      color: #0f172a;
      background: #f8fafc;
    }

    .search-input:focus {
      border-color: #0068ff;
      background: #ffffff;
    }

    /* Template List */
    .template-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 340px;
    }

    .template-item {
      padding: 9px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .template-item:hover {
      background: #eff6ff;
      border-color: #93c5fd;
    }

    .template-shortcut {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      color: #0068ff;
      background: #e0f2fe;
      padding: 1px 6px;
      border-radius: 4px;
      margin-bottom: 3px;
    }

    .template-content {
      font-size: 12px;
      color: #334155;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.4;
    }

    /* AI Suggest */
    .ai-suggest-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 380px;
      overflow-y: auto;
    }

    .ai-card {
      padding: 10px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .ai-card:hover {
      background: #f0fdf4;
      border-color: #86efac;
    }

    .ai-card-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      margin-bottom: 4px;
      background: #dcfce7;
      color: #166534;
    }

    .ai-card-text {
      font-size: 12px;
      color: #1e293b;
      line-height: 1.45;
    }

    .loading-spinner {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #64748b;
      font-size: 12px;
      gap: 8px;
    }

    /* Dark Mode */
    @media (prefers-color-scheme: dark) {
      .aizalo-dock, .aizalo-popover {
        background: #1e293b;
        border-color: #475569;
        color: #f8fafc;
      }
      .dock-brand {
        background: #0f172a;
        border-color: #334155;
        color: #38bdf8;
      }
      .dock-btn {
        background: #334155;
        border-color: #475569;
        color: #cbd5e1;
      }
      .dock-btn:hover {
        background: #475569;
        color: #38bdf8;
      }
      .popover-header {
        background: #0f172a;
        border-color: #334155;
      }
      .popover-header h3 {
        color: #f8fafc;
      }
      .search-wrapper {
        background: #1e293b;
        border-color: #334155;
      }
      .search-input {
        background: #0f172a;
        border-color: #475569;
        color: #f8fafc;
      }
      .template-item, .ai-card {
        background: #0f172a;
        border-color: #334155;
      }
      .template-content, .ai-card-text {
        color: #cbd5e1;
      }
    }
  `;

  /* ==========================================================================
     4. Main In-Page Controller
     ========================================================================== */
  class AIzaloInPageApp {
    constructor() {
      this.host = null;
      this.shadowRoot = null;
      this.wrapper = null;

      this.btnTemplates = null;
      this.btnAi = null;
      this.popoverContainer = null;

      this.activeTab = null; // null | 'templates' | 'ai'
      this.templates = [];
      this.customerName = '';
      this.lastMessage = '';

      this.observer = null;
    }

    init() {
      // 1. Create or get host element
      let host = document.getElementById('aizalo-flow-host');
      if (!host) {
        host = document.createElement('div');
        host.id = 'aizalo-flow-host';
        host.style.cssText = 'position: fixed; bottom: 85px; right: 24px; z-index: 2147483647; pointer-events: none;';
        document.body.appendChild(host);
      }
      this.host = host;

      if (!host.shadowRoot) {
        this.shadowRoot = host.attachShadow({ mode: 'open' });
      } else {
        this.shadowRoot = host.shadowRoot;
      }

      this.shadowRoot.innerHTML = '';

      const styleEl = document.createElement('style');
      styleEl.textContent = SHADOW_CSS;
      this.shadowRoot.appendChild(styleEl);

      this.wrapper = document.createElement('div');
      this.wrapper.className = 'aizalo-companion-wrapper';
      this.shadowRoot.appendChild(this.wrapper);

      // 2. Render Dock
      this.renderDock();

      // 3. Preload templates
      this.fetchTemplates();

      // 4. Start DOM observer
      this.startObserver();

      // 5. Click outside auto-close
      document.addEventListener('click', (e) => {
        if (!this.host.contains(e.target) && this.activeTab) {
          this.closePopover();
        }
      }, true);
    }

    renderDock() {
      const dock = document.createElement('div');
      dock.className = 'aizalo-dock';

      dock.innerHTML = `
        <div class="dock-brand" title="AIzalo Flow Companion">
          <span>⚡</span> AIzalo
        </div>
        <button class="dock-btn" id="btnDockTemplates" title="Xem danh sách tin nhắn mẫu (Click để mở)">
          <span class="icon">💬</span> Mẫu tin
        </button>
        <button class="dock-btn" id="btnDockAi" title="Gợi ý câu trả lời AI từ tin nhắn của khách">
          <span class="icon">✨</span> Gợi ý AI
        </button>
        <button class="dock-btn" id="btnDockRefresh" title="Làm mới dữ liệu từ Zalo-Flow">
          <span class="icon">🔄</span>
        </button>
      `;

      this.btnTemplates = dock.querySelector('#btnDockTemplates');
      this.btnAi = dock.querySelector('#btnDockAi');
      const btnRefresh = dock.querySelector('#btnDockRefresh');

      this.btnTemplates.addEventListener('click', () => this.toggleTemplates());
      this.btnAi.addEventListener('click', () => this.toggleAi());
      btnRefresh.addEventListener('click', () => {
        btnRefresh.style.transform = 'rotate(180deg)';
        setTimeout(() => { btnRefresh.style.transform = 'none'; }, 300);
        this.fetchTemplates();
      });

      this.wrapper.appendChild(dock);
    }

    fetchTemplates() {
      chrome.runtime.sendMessage({ action: 'GET_TEMPLATES' }, (res) => {
        if (res && Array.isArray(res.templates)) {
          this.templates = res.templates;
        }
      });
    }

    startObserver() {
      let debounce = null;
      this.observer = new MutationObserver(() => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          this.customerName = getCurrentCustomerName();
          this.lastMessage = getLastCustomerMessage();
        }, 300);
      });

      this.observer.observe(document.body, { childList: true, subtree: true });
      this.customerName = getCurrentCustomerName();
      this.lastMessage = getLastCustomerMessage();
    }

    toggleTemplates() {
      if (this.activeTab === 'templates') {
        this.closePopover();
        return;
      }
      this.closePopover();
      this.activeTab = 'templates';
      this.btnTemplates.classList.add('active');

      const popover = document.createElement('div');
      popover.className = 'aizalo-popover';
      popover.innerHTML = `
        <div class="popover-header">
          <h3>⚡ Tin Nhắn Mẫu (${this.templates.length})</h3>
          <button class="popover-close" id="btnClose">✕</button>
        </div>
        <div class="search-wrapper">
          <input type="text" class="search-input" id="searchTpl" placeholder="Tìm theo phím tắt hoặc nội dung...">
        </div>
        <div class="template-list" id="tplList"></div>
      `;

      popover.querySelector('#btnClose').addEventListener('click', () => this.closePopover());
      const searchInput = popover.querySelector('#searchTpl');
      const listContainer = popover.querySelector('#tplList');

      const renderList = (filter) => {
        listContainer.innerHTML = '';
        const items = this.templates.filter(t => {
          if (!filter) return true;
          return (t.shortcut || '').toLowerCase().includes(filter) ||
                 (t.title || '').toLowerCase().includes(filter) ||
                 (t.content || '').toLowerCase().includes(filter);
        });

        if (items.length === 0) {
          listContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 11px;">Không tìm thấy mẫu tin phù hợp.</div>`;
          return;
        }

        for (const item of items) {
          const el = document.createElement('div');
          el.className = 'template-item';
          const personalized = (item.content || '').replace(/\{name\}/gi, this.customerName || 'anh/chị');

          el.innerHTML = `
            <div class="template-shortcut">/${item.shortcut || 'mau'} — ${escapeHtml(item.title || item.shortcut)}</div>
            <div class="template-content">${escapeHtml(personalized)}</div>
          `;

          el.addEventListener('click', () => {
            injectTextToZalo(personalized);
            this.closePopover();
          });

          listContainer.appendChild(el);
        }
      };

      searchInput.addEventListener('input', (e) => renderList(e.target.value.toLowerCase().trim()));
      renderList('');

      this.popoverContainer = popover;
      this.wrapper.insertBefore(popover, this.wrapper.firstChild);
    }

    toggleAi() {
      if (this.activeTab === 'ai') {
        this.closePopover();
        return;
      }
      this.closePopover();
      this.activeTab = 'ai';
      this.btnAi.classList.add('active');

      const popover = document.createElement('div');
      popover.className = 'aizalo-popover';
      popover.innerHTML = `
        <div class="popover-header">
          <h3>✨ Gợi Ý Phản Hồi AI</h3>
          <button class="popover-close" id="btnClose">✕</button>
        </div>
        <div class="ai-suggest-body" id="aiBody">
          <div class="loading-spinner">
            <span>🧠 Đang đọc tin nhắn và tạo gợi ý...</span>
          </div>
        </div>
      `;

      popover.querySelector('#btnClose').addEventListener('click', () => this.closePopover());
      const bodyEl = popover.querySelector('#aiBody');

      chrome.runtime.sendMessage({
        action: 'GET_AI_SUGGEST',
        payload: {
          lastMessage: this.lastMessage || 'Chào shop',
          customerName: this.customerName || ''
        }
      }, (res) => {
        bodyEl.innerHTML = '';
        if (!res || !res.success || !Array.isArray(res.suggestions) || res.suggestions.length === 0) {
          bodyEl.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #ef4444; font-size: 11px;">
              ${escapeHtml(res?.error || 'Không thể tạo gợi ý. Hãy kiểm tra cài đặt AI trong Zalo-Flow.')}
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
            this.closePopover();
          });

          bodyEl.appendChild(card);
        }
      });

      this.popoverContainer = popover;
      this.wrapper.insertBefore(popover, this.wrapper.firstChild);
    }

    closePopover() {
      if (this.popoverContainer && this.popoverContainer.parentNode) {
        this.popoverContainer.parentNode.removeChild(this.popoverContainer);
      }
      this.popoverContainer = null;
      this.activeTab = null;
      if (this.btnTemplates) this.btnTemplates.classList.remove('active');
      if (this.btnAi) this.btnAi.classList.remove('active');
    }
  }

  // Start app
  function start() {
    new AIzaloInPageApp().init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
