/**
 * AIzalo Flow Companion — Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const connectionDot = document.getElementById('connectionDot');
  const statusTitle = document.getElementById('statusTitle');
  const statusDesc = document.getElementById('statusDesc');
  const serverUrlInput = document.getElementById('serverUrlInput');
  const adminTokenInput = document.getElementById('adminTokenInput');
  const btnSaveConnect = document.getElementById('btnSaveConnect');
  const statTemplatesCount = document.getElementById('statTemplatesCount');
  const statAiStatus = document.getElementById('statAiStatus');

  // Load existing config
  chrome.runtime.sendMessage({ action: 'GET_CONFIG' }, (config) => {
    if (config) {
      serverUrlInput.value = config.serverUrl || 'http://127.0.0.1:3000';
      adminTokenInput.value = config.adminToken || '';
      if (Array.isArray(config.cachedTemplates)) {
        statTemplatesCount.textContent = config.cachedTemplates.length;
      }
    }
    // Check connection status on open
    refreshStatus();
  });

  // Check connection status
  function refreshStatus() {
    statusTitle.textContent = 'Đang kiểm tra kết nối...';
    statusDesc.textContent = 'Đang liên hệ máy chủ Zalo-Flow...';
    connectionDot.className = 'status-indicator warning';

    chrome.runtime.sendMessage({ action: 'CHECK_STATUS' }, (res) => {
      if (res && res.online) {
        connectionDot.className = 'status-indicator online';
        statusTitle.textContent = `Đã kết nối Zalo-Flow (v${res.version})`;
        statusDesc.textContent = `Trạng thái Zalo: ${res.zaloStatus === 'online' ? '🟢 Đang online' : '⚪ Đang quét QR / Offline'}`;
        statAiStatus.textContent = res.aiConfigured ? '🟢 Sẵn sàng' : '⚪ Chưa bật';
      } else {
        connectionDot.className = 'status-indicator offline';
        statusTitle.textContent = 'Chưa kết nối Zalo-Flow';
        statusDesc.textContent = 'Hãy chắc chắn Zalo-Flow máy tính đang chạy tại cổng 3000.';
        statAiStatus.textContent = '⚪ Offline';
      }

      // Refresh templates count
      chrome.runtime.sendMessage({ action: 'GET_TEMPLATES' }, (tplRes) => {
        if (tplRes && Array.isArray(tplRes.templates)) {
          statTemplatesCount.textContent = tplRes.templates.length;
        }
      });
    });
  }

  // Save config & refresh
  btnSaveConnect.addEventListener('click', () => {
    const serverUrl = (serverUrlInput.value || 'http://127.0.0.1:3000').trim().replace(/\/+$/, '');
    const adminToken = (adminTokenInput.value || '').trim();

    btnSaveConnect.disabled = true;
    btnSaveConnect.textContent = 'Đang lưu...';

    chrome.runtime.sendMessage({
      action: 'SAVE_CONFIG',
      payload: { serverUrl, adminToken }
    }, () => {
      btnSaveConnect.disabled = false;
      btnSaveConnect.innerHTML = '<span class="btn-icon">🔄</span> Lưu & Thử Kết Nối';
      refreshStatus();
    });
  });
});
