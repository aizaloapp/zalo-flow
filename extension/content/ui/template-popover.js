/**
 * AIzalo Flow Companion — Template Popover Component
 */

import { injectTextToZalo } from '../text-injector.js';

export class TemplatePopover {
  constructor(onClose) {
    this.onClose = onClose;
    this.element = null;
    this.templates = [];
    this.customerName = '';
  }

  render(templates, customerName = '') {
    this.templates = templates || [];
    this.customerName = customerName || '';

    const popover = document.createElement('div');
    popover.className = 'aizalo-popover';

    popover.innerHTML = `
      <div class="popover-header">
        <h3>⚡ Tin Nhắn Mẫu (${this.templates.length})</h3>
        <button class="popover-close" id="btnCloseTemplates">✕</button>
      </div>
      <div class="search-wrapper">
        <input type="text" class="search-input" id="searchTemplateInput" placeholder="Tìm theo phím tắt hoặc nội dung...">
      </div>
      <div class="template-list" id="templateListContainer"></div>
    `;

    // Bind Close
    popover.querySelector('#btnCloseTemplates').addEventListener('click', () => {
      if (typeof this.onClose === 'function') this.onClose();
    });

    // Bind Search
    const searchInput = popover.querySelector('#searchTemplateInput');
    const listContainer = popover.querySelector('#templateListContainer');

    searchInput.addEventListener('input', (e) => {
      this.renderList(listContainer, e.target.value.toLowerCase().trim());
    });

    this.renderList(listContainer, '');
    this.element = popover;
    return popover;
  }

  renderList(container, filterTerm) {
    container.innerHTML = '';

    const filtered = this.templates.filter(t => {
      if (!filterTerm) return true;
      const shortcut = (t.shortcut || '').toLowerCase();
      const title = (t.title || '').toLowerCase();
      const content = (t.content || '').toLowerCase();
      return shortcut.includes(filterTerm) || title.includes(filterTerm) || content.includes(filterTerm);
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="padding: 16px; text-align: center; color: #94a3b8; font-size: 11px;">
          ${filterTerm ? 'Không tìm thấy mẫu tin phù hợp.' : 'Chưa có mẫu tin nào. Hãy thêm trong Zalo-Flow Dashboard.'}
        </div>
      `;
      return;
    }

    for (const item of filtered) {
      const el = document.createElement('div');
      el.className = 'template-item';

      // Replace {name} placeholder
      const personalizedContent = (item.content || '').replace(/\{name\}/gi, this.customerName || 'anh/chị');

      el.innerHTML = `
        <div class="template-shortcut">/${item.shortcut || 'mau'} — ${item.title || item.shortcut}</div>
        <div class="template-content">${escapeHtml(personalizedContent)}</div>
      `;

      el.addEventListener('click', () => {
        injectTextToZalo(personalizedContent);
        if (typeof this.onClose === 'function') this.onClose();
      });

      container.appendChild(el);
    }
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
