import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Helper for SVGs
const svgLock = `<svg width="12" height="12" viewBox="0 0 24 24" fill="#10b981"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;
const svgSearch = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
const svgPhone = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`;
const svgVideo = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`;
const svgInfo = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
const svgSend = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
const svgRefresh = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;

// Common CSS
const commonStyles = `
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  body {
    width: 1280px;
    height: 800px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #0f172a;
    display: flex;
    flex-direction: column;
  }

  /* Browser Header Bar */
  .window-header {
    height: 42px;
    background: #1e293b;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 16px;
    border-bottom: 1px solid #334155;
    user-select: none;
    flex-shrink: 0;
  }
  .window-controls {
    display: flex;
    gap: 8px;
  }
  .control-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .dot-red { background: #ef4444; }
  .dot-yellow { background: #f59e0b; }
  .dot-green { background: #10b981; }

  .address-bar {
    flex: 1;
    max-width: 640px;
    margin: 0 auto;
    height: 28px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 14px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 12px;
    color: #94a3b8;
    gap: 8px;
  }
  .address-text {
    color: #e2e8f0;
    font-weight: 500;
  }
  .address-text span {
    color: #64748b;
  }

  /* Top Right Extension Status Pill */
  .extension-badge-top {
    display: flex;
    align-items: center;
    gap: 7px;
    background: rgba(0, 104, 255, 0.2);
    border: 1px solid rgba(0, 104, 255, 0.5);
    padding: 5px 14px;
    border-radius: 14px;
    color: #60a5fa;
    font-size: 11.5px;
    font-weight: 700;
  }
  .active-pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #38bdf8;
    box-shadow: 0 0 8px #38bdf8;
  }

  /* Main Viewport */
  .app-viewport {
    flex: 1;
    display: flex;
    background: #f1f5f9;
    position: relative;
    overflow: hidden;
  }

  /* 1. Zalo Navigation Rail */
  .zalo-nav-rail {
    width: 64px;
    background: #0068ff;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px 0;
    gap: 18px;
    flex-shrink: 0;
  }
  .zalo-logo {
    width: 40px;
    height: 40px;
    background: #ffffff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 20px;
    color: #0068ff;
    letter-spacing: -1px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
  }
  .rail-icon-btn {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.75);
    font-size: 20px;
  }
  .rail-icon-btn.active {
    background: rgba(255, 255, 255, 0.22);
    color: #ffffff;
  }
  .rail-spacer {
    flex: 1;
  }
  .rail-user-avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: linear-gradient(135deg, #38bdf8, #818cf8);
    color: #ffffff;
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #ffffff;
  }

  /* 2. Conversation List */
  .conversation-sidebar {
    width: 310px;
    background: #ffffff;
    border-right: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .search-box-wrap {
    padding: 12px 14px;
    border-bottom: 1px solid #f1f5f9;
    position: relative;
  }
  .zalo-search-input {
    width: 100%;
    height: 34px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 17px;
    padding: 0 14px 0 34px;
    font-size: 12px;
    color: #334155;
    outline: none;
  }
  .search-icon-pos {
    position: absolute;
    left: 26px;
    top: 21px;
    color: #94a3b8;
    display: flex;
  }

  .conv-list {
    flex: 1;
    overflow: hidden;
  }
  .conv-card {
    display: flex;
    align-items: center;
    padding: 12px 14px;
    gap: 12px;
    border-bottom: 1px solid #f8fafc;
  }
  .conv-card.active {
    background: #e0f2fe;
  }
  .conv-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    color: #ffffff;
    position: relative;
    flex-shrink: 0;
  }
  .av-blue { background: linear-gradient(135deg, #0284c7, #2563eb); }
  .av-purple { background: linear-gradient(135deg, #8b5cf6, #6d28d9); }
  .av-emerald { background: linear-gradient(135deg, #059669, #10b981); }
  .av-amber { background: linear-gradient(135deg, #d97706, #f59e0b); }
  .av-rose { background: linear-gradient(135deg, #e11d48, #f43f5e); }

  .online-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #10b981;
    border: 2px solid #ffffff;
    position: absolute;
    bottom: 0;
    right: 0;
  }
  .conv-info {
    flex: 1;
    min-width: 0;
  }
  .conv-title-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  .conv-name {
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conv-time {
    font-size: 11px;
    color: #94a3b8;
    flex-shrink: 0;
  }
  .conv-preview {
    font-size: 12px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  /* 3. Main Chat Viewport */
  .chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #eef2f6;
    position: relative;
    overflow: hidden;
  }

  .chat-header {
    height: 56px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    flex-shrink: 0;
  }
  .header-user {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header-name {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
  }
  .header-status {
    font-size: 11.5px;
    color: #10b981;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .header-status::before {
    content: "";
    width: 7px;
    height: 7px;
    background: #10b981;
    border-radius: 50%;
    display: inline-block;
  }
  .header-actions {
    display: flex;
    gap: 8px;
    color: #64748b;
  }
  .header-act-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    color: #475569;
  }

  /* Chat Messages Stream */
  .messages-stream {
    flex: 1;
    padding: 20px 26px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
  }
  .msg-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .msg-group.inbound {
    align-items: flex-start;
  }
  .msg-group.outbound {
    align-items: flex-end;
  }

  .msg-bubble {
    max-width: 480px;
    padding: 10px 15px;
    border-radius: 14px;
    font-size: 13px;
    line-height: 1.45;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .msg-bubble.inbound {
    background: #ffffff;
    color: #0f172a;
    border-top-left-radius: 4px;
    border: 1px solid #e2e8f0;
  }
  .msg-bubble.outbound {
    background: #e0f2fe;
    color: #0369a1;
    border-top-right-radius: 4px;
    border: 1px solid #bae6fd;
  }
  .msg-time {
    font-size: 10.5px;
    color: #94a3b8;
  }

  /* Bottom Chat Input */
  .chat-footer {
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    padding: 10px 20px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }
  .toolbar-icons {
    display: flex;
    gap: 16px;
    color: #64748b;
    font-size: 16px;
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .fake-input {
    flex: 1;
    height: 40px;
    padding: 0 14px;
    background: #f8fafc;
    border: 1.5px solid #0068ff;
    border-radius: 10px;
    font-size: 12.5px;
    color: #0f172a;
    display: flex;
    align-items: center;
    box-shadow: 0 0 0 3px rgba(0, 104, 255, 0.12);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .typing-caret {
    display: inline-block;
    width: 2px;
    height: 15px;
    background: #0068ff;
    margin-left: 3px;
    flex-shrink: 0;
  }
  .btn-send-zalo {
    width: 42px;
    height: 40px;
    background: #0068ff;
    color: #ffffff;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 10px rgba(0, 104, 255, 0.3);
    flex-shrink: 0;
  }

  /* Floating Companion Dock and Popover */
  .aizalo-floating-companion {
    position: absolute;
    right: 28px;
    bottom: 74px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 100;
  }

  .aizalo-popover-card {
    width: 375px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 16px;
    box-shadow: 0 20px 40px -8px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(0, 104, 255, 0.15);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .popover-head {
    background: linear-gradient(135deg, #0068ff, #0284c7);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #ffffff;
  }
  .popover-head-title {
    font-size: 13.5px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .popover-head-close {
    font-size: 16px;
    color: rgba(255, 255, 255, 0.85);
    cursor: pointer;
  }

  .popover-context-bar {
    background: #f8fafc;
    padding: 7px 14px;
    font-size: 11px;
    color: #64748b;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .popover-context-bar strong {
    color: #0f172a;
    font-weight: 600;
  }

  .popover-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ai-suggestion-item {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1.5px solid #e2e8f0;
    background: #ffffff;
    position: relative;
  }
  .ai-suggestion-item.highlighted {
    background: #f0f7ff;
    border-color: #0068ff;
    box-shadow: 0 4px 12px rgba(0, 104, 255, 0.12);
  }
  .ai-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 5px;
    margin-bottom: 4px;
  }
  .badge-primary {
    background: #0068ff;
    color: #ffffff;
  }
  .badge-soft {
    background: #e0f2fe;
    color: #0284c7;
  }
  .badge-purple {
    background: #f3e8ff;
    color: #7e22ce;
  }
  .ai-text {
    font-size: 11.8px;
    color: #334155;
    line-height: 1.45;
  }
  .ai-click-hint {
    margin-top: 5px;
    font-size: 10.5px;
    font-weight: 700;
    color: #0068ff;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Dock Toolbar */
  .aizalo-dock-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 30px;
    padding: 4px 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    white-space: nowrap;
  }
  .dock-logo-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 9px;
    background: #f0f7ff;
    border: 1px solid #bae6fd;
    border-radius: 16px;
    color: #0068ff;
    font-weight: 800;
    font-size: 11.5px;
    white-space: nowrap;
  }
  .dock-pill-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: 16px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    color: #334155;
    background: transparent;
    white-space: nowrap;
  }
  .dock-pill-btn.active {
    background: #0068ff;
    color: #ffffff;
    box-shadow: 0 3px 10px rgba(0, 104, 255, 0.35);
  }
  .dock-icon-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: #f1f5f9;
    color: #475569;
    cursor: pointer;
  }

  /* Top Right Feature Banner */
  .top-promo-banner {
    position: absolute;
    top: 14px;
    right: 20px;
    background: rgba(15, 23, 42, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    color: #ffffff;
    box-shadow: 0 10px 25px rgba(0,0,0,0.3);
    z-index: 50;
  }
  .banner-badge {
    background: linear-gradient(135deg, #0068ff, #06b6d4);
    padding: 4px 9px;
    border-radius: 6px;
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }
  .banner-title {
    font-size: 13px;
    font-weight: 700;
  }
  .banner-subtitle {
    font-size: 11px;
    color: #94a3b8;
  }

  /* Template View Styles for Screenshot 2 */
  .template-search-wrap {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
  }
  .template-search-input {
    width: 100%;
    height: 30px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 0 10px;
    font-size: 11.5px;
    outline: none;
  }
  .template-list-scroll {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
  }
  .template-card-box {
    padding: 9px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    cursor: pointer;
  }
  .template-card-box.highlight {
    background: #f0f7ff;
    border-color: #0068ff;
  }
  .template-tag {
    display: inline-block;
    background: #e0f2fe;
    color: #0284c7;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    margin-bottom: 3px;
  }
  .template-text-body {
    font-size: 11.8px;
    color: #334155;
    line-height: 1.4;
  }
`;

// HTML Generator 1 (Smart AI Reply)
function getHtmlScreenshot1() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>AIzalo Flow Companion - AI Reply Mockup</title>
  <style>${commonStyles}</style>
</head>
<body>
  <div class="window-header">
    <div class="window-controls">
      <div class="control-dot dot-red"></div>
      <div class="control-dot dot-yellow"></div>
      <div class="control-dot dot-green"></div>
    </div>
    <div class="address-bar">
      ${svgLock}
      <span class="address-text">https://chat.zalo.me<span>/conversation/demo-customer</span></span>
    </div>
    <div class="extension-badge-top">
      <div class="active-pulse"></div>
      <span>AIzalo Flow Companion Active</span>
    </div>
  </div>

  <div class="app-viewport">
    <div class="zalo-nav-rail">
      <div class="zalo-logo">Z</div>
      <div class="rail-icon-btn active">💬</div>
      <div class="rail-icon-btn">👥</div>
      <div class="rail-icon-btn">📌</div>
      <div class="rail-spacer"></div>
      <div class="rail-icon-btn">⚙️</div>
      <div class="rail-user-avatar">CS</div>
    </div>

    <div class="conversation-sidebar">
      <div class="search-box-wrap">
        <span class="search-icon-pos">${svgSearch}</span>
        <input type="text" class="zalo-search-input" placeholder="Tìm kiếm tin nhắn, liên hệ...">
      </div>
      <div class="conv-list">
        <div class="conv-card active">
          <div class="conv-avatar av-blue">
            NVH
            <div class="online-indicator"></div>
          </div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Nguyễn Văn Hùng</div>
              <div class="conv-time">10:18</div>
            </div>
            <div class="conv-preview">Tuyệt vời, shop gửi giúp mình thông tin...</div>
          </div>
        </div>

        <div class="conv-card">
          <div class="conv-avatar av-purple">
            AD
            <div class="online-indicator"></div>
          </div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Công ty TNHH Ánh Dương</div>
              <div class="conv-time">09:45</div>
            </div>
            <div class="conv-preview">Báo giá chi tiết bên mình đã nhận được...</div>
          </div>
        </div>

        <div class="conv-card">
          <div class="conv-avatar av-emerald">TML</div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Trần Mai Lan</div>
              <div class="conv-time">Hôm qua</div>
            </div>
            <div class="conv-preview">Cảm ơn shop nhiều nhé! Dịch vụ rất tốt ❤️</div>
          </div>
        </div>

        <div class="conv-card">
          <div class="conv-avatar av-amber">PQT</div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Phạm Quốc Tuấn</div>
              <div class="conv-time">15/09</div>
            </div>
            <div class="conv-preview">Cho mình xin số tài khoản thanh toán nhé</div>
          </div>
        </div>

        <div class="conv-card">
          <div class="conv-avatar av-rose">MKT</div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Nhóm Hỗ Trợ Zalo-Flow</div>
              <div class="conv-time">14/09</div>
            </div>
            <div class="conv-preview">[Nhóm] Đã cấu hình xong Chatwoot webhook</div>
          </div>
        </div>
      </div>
    </div>

    <div class="chat-main">
      <div class="chat-header">
        <div class="header-user">
          <div class="conv-avatar av-blue" style="width: 36px; height: 36px; font-size: 13px;">NVH</div>
          <div>
            <div class="header-name">Nguyễn Văn Hùng</div>
            <div class="header-status">Đang trực tuyến</div>
          </div>
        </div>
        <div class="header-actions">
          <div class="header-act-btn">${svgSearch}</div>
          <div class="header-act-btn">${svgPhone}</div>
          <div class="header-act-btn">${svgVideo}</div>
          <div class="header-act-btn">${svgInfo}</div>
        </div>
      </div>

      <div class="messages-stream">
        <div class="msg-group inbound">
          <div class="msg-bubble inbound">
            Chào shop, mình đang tìm hiểu giải pháp tự động hóa tin nhắn Zalo cho team CSKH 5 người. Bên bạn có bản demo trải nghiệm không?
          </div>
          <span class="msg-time">10:15</span>
        </div>

        <div class="msg-group outbound">
          <div class="msg-bubble outbound">
            Dạ em chào anh Hùng ạ! Bên em có sẵn bản trải nghiệm và hỗ trợ thiết lập kết nối nhanh chóng cho đội ngũ CSKH của anh ạ.
          </div>
          <span class="msg-time">10:16</span>
        </div>

        <div class="msg-group inbound">
          <div class="msg-bubble inbound">
            Tuyệt vời, shop gửi giúp mình thông tin chi tiết và chính sách hỗ trợ nhé.
          </div>
          <span class="msg-time">10:18</span>
        </div>
      </div>

      <div class="chat-footer">
        <div class="toolbar-icons">
          <span>😊</span>
          <span>📷</span>
          <span>📎</span>
          <span>🕒</span>
          <span>🏷️</span>
        </div>
        <div class="input-row">
          <div class="fake-input">
            <span>Dạ em gửi anh Hùng tài liệu giới thiệu giải pháp AIzalo Flow và bảng so sánh tính năng qua file đính kèm ạ 🚀</span>
            <span class="typing-caret"></span>
          </div>
          <div class="btn-send-zalo">${svgSend}</div>
        </div>
      </div>

      <!-- Extension UI Overlay -->
      <div class="aizalo-floating-companion">
        <div class="aizalo-popover-card">
          <div class="popover-head">
            <div class="popover-head-title">
              <span>✨ Gợi Ý Phản Hồi AI</span>
            </div>
            <div class="popover-head-close">✕</div>
          </div>
          
          <div class="popover-context-bar">
            <span>Khách hỏi:</span>
            <strong>"Tuyệt vời, shop gửi giúp mình thông tin..."</strong>
          </div>

          <div class="popover-body">
            <div class="ai-suggestion-item highlighted">
              <div class="ai-badge badge-primary">⭐ Tư vấn nhiệt tình • Khuyên dùng</div>
              <div class="ai-text">
                "Dạ em gửi anh Hùng tài liệu giới thiệu giải pháp AIzalo Flow và bảng so sánh tính năng ạ. Anh có muốn em hỗ trợ tạo tài khoản dùng thử 14 ngày luôn không ạ? 🚀"
              </div>
              <div class="ai-click-hint">✓ 1-Click: Đã tự động chèn vào khung chat</div>
            </div>

            <div class="ai-suggestion-item">
              <div class="ai-badge badge-soft">⚡ Báo giá & Chi tiết nhanh</div>
              <div class="ai-text">
                "Dạ vâng anh Hùng, em xin gửi bảng giá các gói qua file đính kèm. Anh xem qua nếu cần giải đáp thêm em hỗ trợ ngay nhé!"
              </div>
            </div>

            <div class="ai-suggestion-item">
              <div class="ai-badge badge-purple">📅 Hẹn Demo Trực Tiếp</div>
              <div class="ai-text">
                "Dạ bên em sẵn sàng hỗ trợ 1 buổi demo trực tiếp 15 phút qua Google Meet để hướng dẫn đội ngũ của anh kết nối nhanh nhất ạ!"
              </div>
            </div>
          </div>
        </div>

        <div class="aizalo-dock-bar">
          <div class="dock-logo-tag">
            <span>⚡</span> AIzalo
          </div>
          <button class="dock-pill-btn">
            <span>💬</span> Mẫu tin
          </button>
          <button class="dock-pill-btn active">
            <span>✨</span> Gợi ý AI
          </button>
          <div class="dock-icon-btn">
            ${svgRefresh}
          </div>
        </div>
      </div>

    </div>
  </div>
</body>
</html>`;
}

// HTML Generator 2 (Quick Message Templates)
function getHtmlScreenshot2() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>AIzalo Flow Companion - Templates Mockup</title>
  <style>${commonStyles}</style>
</head>
<body>
  <div class="window-header">
    <div class="window-controls">
      <div class="control-dot dot-red"></div>
      <div class="control-dot dot-yellow"></div>
      <div class="control-dot dot-green"></div>
    </div>
    <div class="address-bar">
      ${svgLock}
      <span class="address-text">https://chat.zalo.me<span>/conversation/demo-customer</span></span>
    </div>
    <div class="extension-badge-top">
      <div class="active-pulse"></div>
      <span>AIzalo Flow Companion Active</span>
    </div>
  </div>

  <div class="app-viewport">
    <div class="zalo-nav-rail">
      <div class="zalo-logo">Z</div>
      <div class="rail-icon-btn active">💬</div>
      <div class="rail-icon-btn">👥</div>
      <div class="rail-icon-btn">📌</div>
      <div class="rail-spacer"></div>
      <div class="rail-icon-btn">⚙️</div>
      <div class="rail-user-avatar">CS</div>
    </div>

    <div class="conversation-sidebar">
      <div class="search-box-wrap">
        <span class="search-icon-pos">${svgSearch}</span>
        <input type="text" class="zalo-search-input" placeholder="Tìm kiếm tin nhắn, liên hệ...">
      </div>
      <div class="conv-list">
        <div class="conv-card active">
          <div class="conv-avatar av-purple">
            AD
            <div class="online-indicator"></div>
          </div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Công ty TNHH Ánh Dương</div>
              <div class="conv-time">10:22</div>
            </div>
            <div class="conv-preview">Shop cho mình xin thông tin chuyển khoản...</div>
          </div>
        </div>

        <div class="conv-card">
          <div class="conv-avatar av-blue">
            NVH
            <div class="online-indicator"></div>
          </div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Nguyễn Văn Hùng</div>
              <div class="conv-time">10:18</div>
            </div>
            <div class="conv-preview">Tuyệt vời, shop gửi giúp mình thông tin...</div>
          </div>
        </div>

        <div class="conv-card">
          <div class="conv-avatar av-emerald">TML</div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Trần Mai Lan</div>
              <div class="conv-time">Hôm qua</div>
            </div>
            <div class="conv-preview">Cảm ơn shop nhiều nhé! Dịch vụ rất tốt ❤️</div>
          </div>
        </div>

        <div class="conv-card">
          <div class="conv-avatar av-amber">PQT</div>
          <div class="conv-info">
            <div class="conv-title-row">
              <div class="conv-name">Phạm Quốc Tuấn</div>
              <div class="conv-time">15/09</div>
            </div>
            <div class="conv-preview">Cho mình xin số tài khoản thanh toán nhé</div>
          </div>
        </div>
      </div>
    </div>

    <div class="chat-main">
      <div class="chat-header">
        <div class="header-user">
          <div class="conv-avatar av-purple" style="width: 36px; height: 36px; font-size: 13px;">AD</div>
          <div>
            <div class="header-name">Công ty TNHH Ánh Dương</div>
            <div class="header-status">Đang trực tuyến</div>
          </div>
        </div>
        <div class="header-actions">
          <div class="header-act-btn">${svgSearch}</div>
          <div class="header-act-btn">${svgPhone}</div>
          <div class="header-act-btn">${svgVideo}</div>
          <div class="header-act-btn">${svgInfo}</div>
        </div>
      </div>

      <div class="messages-stream">
        <div class="msg-group inbound">
          <div class="msg-bubble inbound">
            Chào shop, bên mình đã chốt hợp đồng dịch vụ. Shop gửi giúp mình số tài khoản ngân hàng để kế toán tiến hành thanh toán nhé!
          </div>
          <span class="msg-time">10:20</span>
        </div>

        <div class="msg-group outbound">
          <div class="msg-bubble outbound">
            Dạ vâng ạ, em gửi anh/chị thông tin thanh toán chính thức của công ty ngay đây ạ.
          </div>
          <span class="msg-time">10:21</span>
        </div>
      </div>

      <div class="chat-footer">
        <div class="toolbar-icons">
          <span>😊</span>
          <span>📷</span>
          <span>📎</span>
          <span>🕒</span>
          <span>🏷️</span>
        </div>
        <div class="input-row">
          <div class="fake-input">
            <span>STK: 1903... | Techcombank | CTK: CÔNG TY TNHH AIZALO FLOW | Nội dung: [Tên cty] thanh toán HĐ</span>
            <span class="typing-caret"></span>
          </div>
          <div class="btn-send-zalo">${svgSend}</div>
        </div>
      </div>

      <!-- Extension UI Overlay: Templates Picker -->
      <div class="aizalo-floating-companion">
        <div class="aizalo-popover-card">
          <div class="popover-head">
            <div class="popover-head-title">
              <span>💬 Kho Tin Nhắn Mẫu Nhanh</span>
            </div>
            <div class="popover-head-close">✕</div>
          </div>
          
          <div class="template-search-wrap">
            <input type="text" class="template-search-input" placeholder="Tìm kiếm mẫu tin (gõ /stk, /chao, /gia)..." value="stk">
          </div>

          <div class="template-list-scroll">
            <div class="template-card-box highlight">
              <span class="template-tag">/stk • Tài khoản thanh toán</span>
              <div class="template-text-body">
                Dạ em gửi anh/chị thông tin tài khoản: Techcombank - 1903... - CÔNG TY TNHH AIZALO FLOW. Nội dung: [Tên khách] thanh toán.
              </div>
              <div class="ai-click-hint">✓ 1-Click: Đã điền vào ô chat</div>
            </div>

            <div class="template-card-box">
              <span class="template-tag">/chao • Lời chào khách mới</span>
              <div class="template-text-body">
                Dạ em chào anh/chị ạ! Rất vui được hỗ trợ anh/chị. Em có thể giải đáp thông tin gì cho mình hôm nay ạ?
              </div>
            </div>

            <div class="template-card-box">
              <span class="template-tag">/banggia • Bảng giá giải pháp</span>
              <div class="template-text-body">
                Dạ em xin gửi bảng giá chi tiết các gói triển khai Zalo-Flow Community và Enterprise kèm chính sách bảo hành ạ.
              </div>
            </div>

            <div class="template-card-box">
              <span class="template-tag">/diachi • Địa chỉ & Hotline</span>
              <div class="template-text-body">
                Văn phòng: Tầng 5, Tòa nhà AIzalo Tech, TP. Hồ Chí Minh. Hotline hỗ trợ 24/7: 1900 xxxx.
              </div>
            </div>
          </div>
        </div>

        <div class="aizalo-dock-bar">
          <div class="dock-logo-tag">
            <span>⚡</span> AIzalo
          </div>
          <button class="dock-pill-btn active">
            <span>💬</span> Mẫu tin
          </button>
          <button class="dock-pill-btn">
            <span>✨</span> Gợi ý AI
          </button>
          <div class="dock-icon-btn">
            ${svgRefresh}
          </div>
        </div>
      </div>

    </div>
  </div>
</body>
</html>`;
}

// 1. Build and capture Screenshot 1
const html1 = getHtmlScreenshot1();
const html1Path = path.resolve('extension/store-assets/mockup-screenshot-1.html');
fs.writeFileSync(html1Path, html1, 'utf-8');

const shot1Png = path.resolve('extension/store-assets/screenshot-1280x800.png');
const file1Url = 'file:///' + html1Path.replace(/\\/g, '/');
const cmd1 = `"${chromePath}" --headless=new --screenshot="${shot1Png}" --window-size=1280,800 --hide-scrollbars --force-device-scale-factor=1 "${file1Url}"`;
console.log('📸 Capturing Screenshot 1 (AI Smart Reply)...');
execSync(cmd1, { stdio: 'inherit' });

// 2. Build and capture Screenshot 2
const html2 = getHtmlScreenshot2();
const html2Path = path.resolve('extension/store-assets/mockup-screenshot-2.html');
fs.writeFileSync(html2Path, html2, 'utf-8');

const shot2Png = path.resolve('extension/store-assets/screenshot-templates-1280x800.png');
const file2Url = 'file:///' + html2Path.replace(/\\/g, '/');
const cmd2 = `"${chromePath}" --headless=new --screenshot="${shot2Png}" --window-size=1280,800 --hide-scrollbars --force-device-scale-factor=1 "${file2Url}"`;
console.log('📸 Capturing Screenshot 2 (Templates & Shortcuts)...');
execSync(cmd2, { stdio: 'inherit' });

console.log('🎉 Successfully created both 1280x800 Chrome Web Store screenshots!');
