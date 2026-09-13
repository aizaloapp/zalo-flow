/**
 * AIzalo Flow Companion — In-Page Dock Toolbar Component
 */

export class DockToolbar {
  constructor({ onToggleTemplates, onToggleAi, onRefresh }) {
    this.onToggleTemplates = onToggleTemplates;
    this.onToggleAi = onToggleAi;
    this.onRefresh = onRefresh;
    this.element = null;
    this.btnTemplates = null;
    this.btnAi = null;
  }

  render() {
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

    this.btnTemplates.addEventListener('click', () => {
      if (typeof this.onToggleTemplates === 'function') this.onToggleTemplates();
    });

    this.btnAi.addEventListener('click', () => {
      if (typeof this.onToggleAi === 'function') this.onToggleAi();
    });

    btnRefresh.addEventListener('click', () => {
      btnRefresh.style.transform = 'rotate(180deg)';
      setTimeout(() => { btnRefresh.style.transform = 'none'; }, 300);
      if (typeof this.onRefresh === 'function') this.onRefresh();
    });

    this.element = dock;
    return dock;
  }

  setActiveButton(activeType) {
    if (this.btnTemplates) {
      this.btnTemplates.classList.toggle('active', activeType === 'templates');
    }
    if (this.btnAi) {
      this.btnAi.classList.toggle('active', activeType === 'ai');
    }
  }
}
