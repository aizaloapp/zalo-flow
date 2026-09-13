/**
 * AIzalo Flow Companion — Shadow DOM Host
 * Encapsulates all In-Page toolbar, popover, and suggestion UI inside Open Shadow DOM.
 */

export function createShadowHost() {
  // Check if already exists
  let host = document.getElementById('aizalo-flow-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'aizalo-flow-host';
    document.body.appendChild(host);
  }

  // Attach shadow root if not already attached
  let shadowRoot = host.shadowRoot;
  if (!shadowRoot) {
    shadowRoot = host.attachShadow({ mode: 'open' });
  }

  // Inject Styles into Shadow Root
  const styleEl = document.createElement('style');
  styleEl.textContent = getShadowStyles();
  shadowRoot.innerHTML = '';
  shadowRoot.appendChild(styleEl);

  const container = document.createElement('div');
  container.className = 'aizalo-companion-wrapper';
  shadowRoot.appendChild(container);

  return { host, shadowRoot, container };
}

function getShadowStyles() {
  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: #0f172a;
      z-index: 999999;
      position: fixed;
      bottom: 85px;
      right: 24px;
      pointer-events: none;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .aizalo-companion-wrapper {
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    /* Floating Mini Toolbar */
    .aizalo-dock {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      border-radius: 24px;
      padding: 4px 8px;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .aizalo-dock:hover {
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
    }

    .dock-brand {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      background: #f0f7ff;
      border-radius: 12px;
      color: #0068ff;
      font-weight: 700;
      font-size: 11px;
      user-select: none;
    }

    .dock-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 10px;
      background: transparent;
      border: none;
      border-radius: 16px;
      color: #334155;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 0.15s, color 0.15s;
    }

    .dock-btn:hover {
      background: #f1f5f9;
      color: #0068ff;
    }

    .dock-btn.active {
      background: #0068ff;
      color: #ffffff;
    }

    .dock-btn .icon {
      font-size: 14px;
    }

    /* Popover Container */
    .aizalo-popover {
      width: 340px;
      max-height: 460px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      margin-bottom: 4px;
      animation: popoverFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes popoverFadeIn {
      from { opacity: 0; transform: translateY(8px); }
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
      padding: 2px;
    }

    .popover-close:hover {
      color: #ef4444;
    }

    /* Search Box */
    .search-wrapper {
      padding: 8px 12px;
      border-bottom: 1px solid #f1f5f9;
    }

    .search-input {
      width: 100%;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 12px;
      outline: none;
    }

    .search-input:focus {
      border-color: #0068ff;
    }

    /* Template List */
    .template-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .template-item {
      padding: 8px 10px;
      background: #f8fafc;
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .template-item:hover {
      background: #f0f7ff;
      border-color: #bae6fd;
    }

    .template-shortcut {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      color: #0068ff;
      background: #e0f2fe;
      padding: 1px 5px;
      border-radius: 4px;
      margin-bottom: 2px;
    }

    .template-content {
      font-size: 12px;
      color: #334155;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.35;
    }

    /* AI Suggest Cards */
    .ai-suggest-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 380px;
      overflow-y: auto;
    }

    .ai-card {
      padding: 10px;
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
      line-height: 1.4;
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

    /* Dark Mode Overrides */
    @media (prefers-color-scheme: dark) {
      .aizalo-dock, .aizalo-popover {
        background: #1e293b;
        border-color: #334155;
        color: #f8fafc;
      }
      .popover-header {
        background: #0f172a;
        border-color: #334155;
      }
      .popover-header h3 {
        color: #f8fafc;
      }
      .search-wrapper {
        border-color: #334155;
      }
      .search-input {
        background: #0f172a;
        border-color: #334155;
        color: #f8fafc;
      }
      .template-item, .ai-card {
        background: #0f172a;
        border-color: #334155;
      }
      .template-content, .ai-card-text {
        color: #cbd5e1;
      }
      .dock-btn {
        color: #94a3b8;
      }
      .dock-btn:hover {
        background: #334155;
        color: #38bdf8;
      }
    }
  `;
}
