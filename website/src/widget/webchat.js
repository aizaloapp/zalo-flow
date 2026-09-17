/**
 * ZaloFlow Web Chat Widget (Vanilla JS Embedded — Copilot Drawer Edition)
 * Lấy cảm hứng từ giao diện Cloudflare Ask AI (Full-Height Side Drawer).
 * Hỗ trợ: Zero Dependencies, CSS 3D Glowing Orb, Quick Prompt Cards, SSE Streaming, XSS Sanitization, Mobile 100dvh.
 */
(function () {
  if (window.ZaloFlowWebChat) return;

  // Trích xuất cấu hình an toàn (hỗ trợ async, defer, GTM loader)
  const currentScript = document.currentScript || 
    document.querySelector('script[src*="webchat.js"]') || 
    document.querySelector('script[data-server]');
  const ds = currentScript ? currentScript.dataset : {};

  const CONFIG = {
    apiBase: ds.server || window.ZALOWEBCHAT_API_BASE || window.location.origin,
    botName: ds.title || window.ZALOWEBCHAT_BOT_NAME || 'Hỗ trợ Zalo-Flow',
    botSubtitle: ds.subtitle || window.ZALOWEBCHAT_BOT_SUBTITLE || 'Tư vấn & Trợ lý AI 24/7',
    botAvatar: ds.avatar || window.ZALOWEBCHAT_AVATAR || '✨',
    welcomeMessage: ds.greeting || window.ZALOWEBCHAT_WELCOME || 'Xin chào! Tôi là trợ lý AI của Zalo-Flow. Tôi có thể hỗ trợ gì cho bạn hôm nay?',
    primaryColor: ds.primaryColor || '#0068ff',
    requirePhone: ds.requirePhone !== undefined ? (ds.requirePhone === 'true' || ds.requirePhone === '') : (window.ZALOWEBCHAT_REQUIRE_PHONE !== false),
    layout: ds.layout || 'drawer', // 'drawer' (chuẩn Cloudflare Ask AI) hoặc 'bubble'
    hideLauncher: ds.hideLauncher === 'true' || ds.hideLauncher === '',
    supportUrl: ds.supportUrl || 'https://zalo.me/0373315784',
    placeholder: ds.placeholder || 'Hỏi bất kỳ điều gì về Zalo-Flow...',
    position: ds.position || 'bottom-right'
  };

  // Quản lý Session ID duy nhất trong LocalStorage
  let sessionId = localStorage.getItem('zaloflow_webchat_session');
  if (!sessionId) {
    sessionId = 'web_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem('zaloflow_webchat_session', sessionId);
  }

  let savedPhone = localStorage.getItem('zaloflow_webchat_phone') || '';
  let savedName = localStorage.getItem('zaloflow_webchat_name') || '';
  let pendingPrompt = null; // Hàng đợi câu hỏi khi chưa nhập SĐT

  // Lời chào thời gian thực
  function getRealtimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Chào buổi sáng.';
    if (hour < 18) return 'Chào buổi chiều.';
    return 'Chào buổi tối.';
  }

  // Chống tấn công XSS
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Format Markdown nhẹ nhàng và an toàn
  function formatMarkdown(rawText) {
    const safe = escapeHtml(rawText);
    return safe
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="zf-code-inline">$1</code>');
  }

  // Tự động tiêm CSS vào trang mẹ
  const style = document.createElement('style');
  style.id = 'zaloflow-webchat-copilot-style';
  style.textContent = `
    /* CSS Isolation cho Widget */
    .zf-copilot-drawer, .zf-copilot-drawer * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* Floating Launcher Button */
    .zf-launcher-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      height: 48px;
      padding: 0 18px;
      border-radius: 24px;
      background: linear-gradient(135deg, ${CONFIG.primaryColor} 0%, #1d4ed8 100%);
      box-shadow: 0 8px 24px rgba(0, 104, 255, 0.4);
      cursor: pointer;
      display: ${CONFIG.hideLauncher ? 'none' : 'flex'};
      align-items: center;
      gap: 8px;
      z-index: 999990;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      font-size: 14px;
      font-weight: 600;
      user-select: none;
    }
    .zf-launcher-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 28px rgba(0, 104, 255, 0.55);
    }
    .zf-launcher-btn svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }
    .zf-launcher-pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }

    /* Backdrop Mờ */
    .zf-copilot-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 999998;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .zf-copilot-backdrop.active {
      opacity: 1;
      pointer-events: auto;
    }

    /* Copilot Side Drawer */
    .zf-copilot-drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 440px;
      max-width: 100vw;
      height: 100%;
      height: 100dvh;
      background: #090d16;
      color: #f8fafc;
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5), -1px 0 0 rgba(255, 255, 255, 0.08);
      z-index: 999999;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
      overflow: hidden;
    }
    .zf-copilot-drawer.open {
      transform: translateX(0);
    }

    /* Drawer Header */
    .zf-drawer-header {
      padding: 14px 20px;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .zf-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .zf-new-chat-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 6px 10px;
      color: #cbd5e1;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .zf-new-chat-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
    }
    .zf-header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .zf-support-link {
      color: #94a3b8;
      font-size: 12.5px;
      text-decoration: none;
      transition: color 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .zf-support-link:hover {
      color: #38bdf8;
    }
    .zf-close-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
      padding: 4px 6px;
      border-radius: 6px;
      transition: all 0.2s;
    }
    .zf-close-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    /* Drawer Body */
    .zf-drawer-body {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      position: relative;
      background: radial-gradient(circle at 50% 15%, rgba(0, 104, 255, 0.08) 0%, transparent 60%), #090d16;
    }

    /* Empty State Hero (Cloudflare Style) */
    .zf-empty-state {
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .zf-orb-wrapper {
      margin: 18px 0 16px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .zf-glowing-orb {
      width: 76px;
      height: 76px;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, #93c5fd 0%, #3b82f6 40%, #1d4ed8 75%, #0f172a 100%);
      box-shadow: 0 0 32px rgba(59, 130, 246, 0.5), inset 0 -6px 14px rgba(0,0,0,0.4);
      animation: zfOrbFloat 3.5s ease-in-out infinite alternate;
      position: relative;
    }
    .zf-glowing-orb::after {
      content: "";
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(96, 165, 250, 0.35) 0%, transparent 70%);
      filter: blur(8px);
      z-index: -1;
    }
    @keyframes zfOrbFloat {
      0% { transform: translateY(0) scale(1); }
      100% { transform: translateY(-6px) scale(1.04); }
    }

    .zf-hero-greeting {
      font-size: 20px;
      font-weight: 700;
      color: #f8fafc;
      margin-bottom: 6px;
    }
    .zf-hero-sub {
      font-size: 13.5px;
      color: #94a3b8;
      max-width: 320px;
      line-height: 1.45;
      margin-bottom: 24px;
    }

    /* Quick Action Prompt Cards */
    .zf-prompt-cards {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 9px;
      margin-bottom: 16px;
    }
    .zf-prompt-card {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 12px 14px;
      text-align: left;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 12px;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      color: #cbd5e1;
    }
    .zf-prompt-card:hover {
      background: rgba(0, 104, 255, 0.12);
      border-color: rgba(56, 189, 248, 0.35);
      transform: translateY(-1px);
      color: #ffffff;
    }
    .zf-prompt-icon {
      font-size: 17px;
      flex-shrink: 0;
    }
    .zf-prompt-title {
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      flex: 1;
    }

    /* Pre-chat Form Card */
    .zf-lead-card {
      width: 100%;
      background: #111827;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      padding: 18px 16px;
      margin: 12px 0;
      text-align: left;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
    }
    .zf-lead-card h4 {
      font-size: 14px;
      color: #f8fafc;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .zf-lead-card p {
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .zf-lead-field {
      margin-bottom: 10px;
    }
    .zf-lead-field label {
      display: block;
      font-size: 11.5px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 4px;
    }
    .zf-lead-field input {
      width: 100%;
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 10px 12px;
      color: #fff;
      font-size: 16px; /* Chống auto-zoom trên iOS */
      outline: none;
      transition: border-color 0.2s;
    }
    .zf-lead-field input:focus {
      border-color: #38bdf8;
    }
    .zf-lead-error {
      color: #f87171;
      font-size: 11.5px;
      margin-top: 4px;
      display: none;
    }
    .zf-lead-btn {
      width: 100%;
      background: linear-gradient(135deg, ${CONFIG.primaryColor} 0%, #1d4ed8 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 11px;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 6px;
      transition: opacity 0.2s;
    }
    .zf-lead-btn:hover {
      opacity: 0.92;
    }

    /* Messages Area */
    .zf-messages-list {
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .zf-msg-item {
      max-width: 86%;
      padding: 11px 15px;
      border-radius: 14px;
      font-size: 13.5px;
      line-height: 1.5;
      word-break: break-word;
    }
    .zf-msg-item.bot {
      align-self: flex-start;
      background: #1e293b;
      color: #f1f5f9;
      border-bottom-left-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.07);
    }
    .zf-msg-item.user {
      align-self: flex-end;
      background: linear-gradient(135deg, ${CONFIG.primaryColor} 0%, #1d4ed8 100%);
      color: #ffffff;
      border-bottom-right-radius: 4px;
    }
    .zf-msg-time {
      font-size: 10.5px;
      opacity: 0.6;
      margin-top: 5px;
      text-align: right;
    }
    .zf-code-inline {
      background: rgba(255, 255, 255, 0.12);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }

    /* Typing Indicator */
    .zf-typing-indicator {
      display: none;
      align-self: flex-start;
      margin: 0 20px 12px;
      padding: 8px 14px;
      background: #1e293b;
      border-radius: 12px;
      gap: 5px;
      align-items: center;
      border: 1px solid rgba(255, 255, 255, 0.07);
    }
    .zf-typing-indicator span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #94a3b8;
      animation: zfBounce 1.4s infinite ease-in-out both;
    }
    .zf-typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
    .zf-typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes zfBounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    /* Footer Input Area */
    .zf-drawer-footer {
      padding: 14px 18px;
      background: #090d16;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      flex-shrink: 0;
    }
    .zf-input-pill {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 24px;
      padding: 4px 6px 4px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .zf-input-pill:focus-within {
      border-color: #38bdf8;
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2);
    }
    .zf-chat-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #ffffff;
      font-size: 16px; /* Tránh zoom iOS Safari */
      min-height: 38px;
    }
    .zf-chat-input::placeholder {
      color: #64748b;
      font-size: 13.5px;
    }
    .zf-send-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: ${CONFIG.primaryColor};
      border: none;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, transform 0.1s;
    }
    .zf-send-btn:hover {
      background: #0284c7;
      transform: scale(1.05);
    }
    .zf-send-btn svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }

    /* Responsive cho màn hình di động */
    @media (max-width: 640px) {
      .zf-copilot-drawer {
        width: 100vw;
      }
      .zf-launcher-btn {
        bottom: 16px;
        right: 16px;
      }
    }
  `;
  document.head.appendChild(style);

  // Tạo DOM Elements
  // 1. Floating Launcher Button
  const launcher = document.createElement('div');
  launcher.className = 'zf-launcher-btn';
  launcher.innerHTML = `
    <span class="zf-launcher-pulse"></span>
    <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.08L2 22l5.08-1.38C8.58 21.5 10.31 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>
    <span>${CONFIG.botName}</span>
  `;

  // 2. Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'zf-copilot-backdrop';

  // 3. Side Drawer Container
  const drawer = document.createElement('div');
  drawer.className = 'zf-copilot-drawer';
  drawer.innerHTML = `
    <div class="zf-drawer-header">
      <div class="zf-header-left">
        <button class="zf-new-chat-btn" id="zf-btn-reset" title="Tạo cuộc trò chuyện mới">
          <span>Cuộc trò chuyện mới</span>
          <span style="font-size:10px;">▾</span>
        </button>
      </div>
      <div class="zf-header-right">
        <a href="${CONFIG.supportUrl}" target="_blank" rel="noopener" class="zf-support-link" title="Kết nối chuyên viên qua Zalo">
          <span>Hỗ trợ</span>
        </a>
        <button class="zf-close-btn" id="zf-btn-close" title="Đóng">&times;</button>
      </div>
    </div>

    <div class="zf-drawer-body" id="zf-drawer-body">
      <!-- Empty State (Hiển thị đầu phiên) -->
      <div class="zf-empty-state" id="zf-empty-state">
        <div class="zf-orb-wrapper">
          <div class="zf-glowing-orb"></div>
        </div>
        <h3 class="zf-hero-greeting" id="zf-greeting-title">${getRealtimeGreeting()}</h3>
        <p class="zf-hero-sub">Tôi có thể giúp gì cho bạn về Zalo-Flow hôm nay?</p>

        <!-- Pre-chat Lead Form (Nếu chưa có SĐT) -->
        <div class="zf-lead-card" id="zf-lead-box" style="display: none;">
          <h4 id="zf-lead-title">📱 Kết nối với Zalo-Flow</h4>
          <p id="zf-lead-desc">Để lại số Zalo để nhận tư vấn và giải đáp chi tiết nhất.</p>
          <form id="zf-lead-form">
            <div class="zf-lead-field">
              <label for="zf-phone">Số điện thoại Zalo *</label>
              <input type="tel" id="zf-phone" placeholder="Ví dụ: 0912345678" required autocomplete="tel" />
              <div class="zf-lead-error" id="zf-phone-err"></div>
            </div>
            <div class="zf-lead-field">
              <label for="zf-name">Họ và tên (Tùy chọn)</label>
              <input type="text" id="zf-name" placeholder="Ví dụ: Anh Tuấn" autocomplete="name" />
            </div>
            <button type="submit" class="zf-lead-btn">
              <span>Bắt đầu trò chuyện</span>
            </button>
          </form>
        </div>

        <!-- Bộ thẻ Quick Prompt Cards -->
        <div class="zf-prompt-cards" id="zf-prompt-cards">
          <div class="zf-prompt-card" data-prompt="Hướng dẫn cài đặt Zalo-Flow bằng bộ cài 1-Click trên Windows?">
            <span class="zf-prompt-icon">🚀</span>
            <span class="zf-prompt-title">Hướng dẫn cài đặt Zalo-Flow 1-Click trên Windows</span>
          </div>
          <div class="zf-prompt-card" data-prompt="Cơ chế Anti-Ban & Rate Limit bảo vệ tài khoản Zalo hoạt động ra sao?">
            <span class="zf-prompt-icon">🛡️</span>
            <span class="zf-prompt-title">Cơ chế Anti-Ban & Rate Limit bảo vệ nick Zalo</span>
          </div>
          <div class="zf-prompt-card" data-prompt="Làm thế nào để kết nối Zalo cá nhân với Chatwoot CRM miễn phí?">
            <span class="zf-prompt-icon">🤖</span>
            <span class="zf-prompt-title">Cách kết nối Zalo với Chatwoot CRM miễn phí</span>
          </div>
          <div class="zf-prompt-card" data-prompt="Hướng dẫn tích hợp AI Gemini và DeepSeek tự động trả lời tin nhắn Zalo?">
            <span class="zf-prompt-icon">💬</span>
            <span class="zf-prompt-title">Tích hợp AI Gemini / DeepSeek tự động CSKH</span>
          </div>
          <div class="zf-prompt-card" data-prompt="Cách sử dụng Chrome Extension để nhận thông báo và quản lý tin nhắn Zalo?">
            <span class="zf-prompt-icon">🔔</span>
            <span class="zf-prompt-title">Cài đặt Chrome Extension quản lý tin nhắn Zalo</span>
          </div>
        </div>
      </div>

      <!-- Messages List -->
      <div class="zf-messages-list" id="zf-messages-list">
        <div class="zf-msg-item bot">
          ${formatMarkdown(CONFIG.welcomeMessage)}
          <div class="zf-msg-time">Vừa xong</div>
        </div>
      </div>

      <div class="zf-typing-indicator" id="zf-typing">
        <span></span><span></span><span></span>
      </div>
    </div>

    <div class="zf-drawer-footer">
      <form class="zf-input-pill" id="zf-chat-form">
        <input type="text" class="zf-chat-input" id="zf-input" placeholder="${escapeHtml(CONFIG.placeholder)}" autocomplete="off" />
        <button type="submit" class="zf-send-btn" title="Gửi câu hỏi">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </form>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  // Tham chiếu các phần tử
  const drawerBody = drawer.querySelector('#zf-drawer-body');
  const emptyState = drawer.querySelector('#zf-empty-state');
  const leadBox = drawer.querySelector('#zf-lead-box');
  const leadForm = drawer.querySelector('#zf-lead-form');
  const leadTitle = drawer.querySelector('#zf-lead-title');
  const leadDesc = drawer.querySelector('#zf-lead-desc');
  const phoneInput = drawer.querySelector('#zf-phone');
  const nameInput = drawer.querySelector('#zf-name');
  const phoneErr = drawer.querySelector('#zf-phone-err');
  const promptCards = drawer.querySelector('#zf-prompt-cards');
  const messagesList = drawer.querySelector('#zf-messages-list');
  const chatForm = drawer.querySelector('#zf-chat-form');
  const inputEl = drawer.querySelector('#zf-input');
  const typingEl = drawer.querySelector('#zf-typing');
  const closeBtn = drawer.querySelector('#zf-btn-close');
  const resetBtn = drawer.querySelector('#zf-btn-reset');

  let isOpen = false;
  let eventSource = null;
  let messageCount = 0;

  // Cập nhật trạng thái hiển thị của Form SĐT
  function checkPhoneStatus() {
    savedPhone = localStorage.getItem('zaloflow_webchat_phone') || '';
    savedName = localStorage.getItem('zaloflow_webchat_name') || '';

    const needsPhone = Boolean(CONFIG.requirePhone && !savedPhone);
    if (needsPhone) {
      leadBox.style.display = 'block';
    } else {
      leadBox.style.display = 'none';
    }
    return needsPhone;
  }

  // Khởi tạo SSE Stream để nhận tin phản hồi từ AI Hub
  function initSSE() {
    if (eventSource) return;
    try {
      eventSource = new EventSource(`${CONFIG.apiBase}/api/webchat/stream/${sessionId}`);
      eventSource.addEventListener('message', e => {
        try {
          const data = JSON.parse(e.data);
          typingEl.style.display = 'none';
          if (data && data.text) {
            appendMessage(data.text, false, new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }));
          }
        } catch {}
      });
      eventSource.onerror = () => {};
    } catch {}
  }

  // Thêm tin nhắn vào danh sách
  function appendMessage(text, isUser = false, timeStr = 'Vừa xong') {
    messageCount++;
    // Nếu có tin nhắn chat của user -> ẩn bớt khối gợi ý để tập trung hội thoại
    if (messageCount > 0 && promptCards) {
      promptCards.style.display = 'none';
    }

    const item = document.createElement('div');
    item.className = `zf-msg-item ${isUser ? 'user' : 'bot'}`;
    item.innerHTML = `
      ${formatMarkdown(text)}
      <div class="zf-msg-time">${timeStr}</div>
    `;
    messagesList.appendChild(item);
    drawerBody.scrollTop = drawerBody.scrollHeight;
  }

  // Gửi tin nhắn lên backend
  async function dispatchMessage(text) {
    if (!text) return;
    const now = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    appendMessage(text, true, now);
    typingEl.style.display = 'flex';
    drawerBody.scrollTop = drawerBody.scrollHeight;

    try {
      const payload = {
        sessionId,
        text,
        name: savedName || 'Khách Website'
      };
      if (savedPhone) payload.phone = savedPhone;

      const res = await fetch(`${CONFIG.apiBase}/api/webchat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        typingEl.style.display = 'none';
        appendMessage(data.message || data.error || 'Có lỗi xảy ra khi gửi tin nhắn.', false, now);
      }
    } catch (err) {
      typingEl.style.display = 'none';
      appendMessage('Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại mạng.', false, now);
    }
  }

  // Tải lại lịch sử tin nhắn
  async function loadHistory() {
    try {
      const res = await fetch(`${CONFIG.apiBase}/api/webchat/messages/${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && Array.isArray(data.messages) && data.messages.length > 0) {
        messagesList.innerHTML = '';
        messageCount = 0;
        data.messages.forEach(m => {
          const time = new Date(m.timestamp || Date.now()).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
          appendMessage(m.text, Boolean(m.isSelf === 0), time);
        });
      }
    } catch {}
  }

  // Đóng / Mở Drawer
  function openDrawer() {
    if (isOpen) return;
    isOpen = true;
    drawer.classList.add('open');
    backdrop.classList.add('active');
    document.body.style.overflow = 'hidden'; // Chống cuộn nền trang mẹ

    const needsPhone = checkPhoneStatus();
    if (needsPhone) {
      phoneInput.focus();
    } else {
      inputEl.focus();
      initSSE();
      loadHistory();
    }
  }

  function closeDrawer() {
    if (!isOpen) return;
    isOpen = false;
    drawer.classList.remove('open');
    backdrop.classList.remove('active');
    document.body.style.overflow = ''; // Phục hồi cuộn nền
  }

  function toggleDrawer() {
    if (isOpen) closeDrawer();
    else openDrawer();
  }

  // Xử lý nộp Form SĐT
  leadForm.addEventListener('submit', e => {
    e.preventDefault();
    phoneErr.style.display = 'none';

    let raw = phoneInput.value.trim().replace(/[\s.-]+/g, '');
    if (raw.startsWith('+84')) raw = '0' + raw.slice(3);

    const phoneRegex = /^(0)(3|5|7|8|9)[0-9]{8}$/;
    if (!phoneRegex.test(raw)) {
      phoneErr.textContent = 'Vui lòng nhập đúng 10 số di động VN (đầu 03, 05, 07, 08, 09).';
      phoneErr.style.display = 'block';
      phoneInput.focus();
      return;
    }

    const rawName = nameInput.value.trim();
    localStorage.setItem('zaloflow_webchat_phone', raw);
    if (rawName) localStorage.setItem('zaloflow_webchat_name', rawName);
    savedPhone = raw;
    savedName = rawName;

    checkPhoneStatus();
    initSSE();
    inputEl.focus();

    // Nếu có câu hỏi đang chờ trong hàng đợi -> tự động gửi ngay!
    if (pendingPrompt) {
      const p = pendingPrompt;
      pendingPrompt = null;
      dispatchMessage(p);
    }
  });

  // Xử lý click thẻ Quick Prompt Cards
  promptCards.addEventListener('click', e => {
    const card = e.target.closest('.zf-prompt-card');
    if (!card) return;
    const promptText = card.getAttribute('data-prompt');
    if (!promptText) return;

    // Nếu chưa có SĐT mà bắt buộc -> chuyển hướng nhẹ nhàng vào Form
    if (CONFIG.requirePhone && !savedPhone) {
      pendingPrompt = promptText;
      leadTitle.textContent = '📱 Để lại số Zalo để nhận câu trả lời';
      leadDesc.textContent = `Bạn đang hỏi: "${promptText}". Vui lòng xác nhận số Zalo để AI phản hồi ngay nhé!`;
      leadBox.style.display = 'block';
      phoneInput.focus();
      return;
    }

    // Đã có SĐT -> bắn câu hỏi ngay
    dispatchMessage(promptText);
  });

  // Xử lý nộp Form Chat thông thường
  chatForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;

    if (CONFIG.requirePhone && !savedPhone) {
      pendingPrompt = text;
      leadTitle.textContent = '📱 Để lại số Zalo để tiếp tục';
      leadDesc.textContent = 'Vui lòng xác nhận số Zalo để bắt đầu nhận phản hồi từ AI nhé!';
      leadBox.style.display = 'block';
      phoneInput.focus();
      return;
    }

    inputEl.value = '';
    dispatchMessage(text);
  });

  // Lắng nghe nút Đóng và Backdrop
  closeBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);
  launcher.addEventListener('click', toggleDrawer);

  // Tạo cuộc trò chuyện mới (Reset)
  resetBtn.addEventListener('click', () => {
    if (confirm('Bạn có muốn bắt đầu một cuộc trò chuyện mới không?')) {
      window.ZaloFlowWebChat.reset();
    }
  });

  // Ủy quyền sự kiện mở Drawer từ bất kỳ phần tử nào trên website mẹ có [data-zf-open]
  document.addEventListener('click', e => {
    const trigger = e.target.closest('[data-zf-open]');
    if (trigger) {
      e.preventDefault();
      openDrawer();
    }
  });

  // Phím Escape để đóng nhanh Drawer khi đang mở
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) {
      closeDrawer();
    }
  });

  // Expose API toàn cục
  window.ZaloFlowWebChat = {
    open: openDrawer,
    close: closeDrawer,
    toggle: toggleDrawer,
    getSessionId: () => sessionId,
    sendPrompt: (text) => {
      openDrawer();
      if (CONFIG.requirePhone && !savedPhone) {
        pendingPrompt = text;
        checkPhoneStatus();
      } else {
        dispatchMessage(text);
      }
    },
    reset: () => {
      // 1. Đóng kết nối SSE cũ chống rò rỉ
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      // 2. Xóa session
      localStorage.removeItem('zaloflow_webchat_session');
      localStorage.removeItem('zaloflow_webchat_phone');
      localStorage.removeItem('zaloflow_webchat_name');
      sessionId = 'web_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('zaloflow_webchat_session', sessionId);
      savedPhone = '';
      savedName = '';
      pendingPrompt = null;
      messageCount = 0;

      if (phoneInput) phoneInput.value = '';
      if (nameInput) nameInput.value = '';
      if (phoneErr) phoneErr.style.display = 'none';

      checkPhoneStatus();
      if (promptCards) promptCards.style.display = 'flex';

      messagesList.innerHTML = `
        <div class="zf-msg-item bot">
          ${formatMarkdown(CONFIG.welcomeMessage)}
          <div class="zf-msg-time">Vừa xong</div>
        </div>
      `;
    }
  };
})();
