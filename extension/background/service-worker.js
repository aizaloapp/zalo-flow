/**
 * AIzalo Flow Companion — Background Service Worker (Manifest V3)
 * Handles networking to Zalo-Flow backend (127.0.0.1:3000), bypasses Mixed Content,
 * and maintains offline template cache.
 */

const DEFAULT_SERVER_URL = 'http://127.0.0.1:3000';

// Retrieve configuration from chrome.storage.local
async function getConfig() {
  const data = await chrome.storage.local.get(['serverUrl', 'adminToken', 'cachedTemplates']);
  return {
    serverUrl: (data.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, ''),
    adminToken: data.adminToken || '',
    cachedTemplates: data.cachedTemplates || []
  };
}

// Build standard headers for Zalo-Flow requests
function buildHeaders(adminToken) {
  const headers = {
    'Content-Type': 'application/json',
    'X-ZaloFlow-Client': '1'
  };
  if (adminToken) {
    headers['X-Admin-Token'] = adminToken;
  }
  return headers;
}

// Check server status
async function checkStatus() {
  const { serverUrl, adminToken } = await getConfig();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${serverUrl}/health`, {
      method: 'GET',
      headers: buildHeaders(adminToken),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return {
        online: true,
        zaloStatus: data.zalo || 'unknown',
        version: data.version || '1.0.0',
        aiConfigured: Boolean(data.adapters?.aiAgent),
        profile: data.profile || null
      };
    }
    return { online: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

// Fetch quick reply templates with offline cache fallback
async function getTemplates() {
  const { serverUrl, adminToken, cachedTemplates } = await getConfig();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`${serverUrl}/api/quick-messages`, {
      method: 'GET',
      headers: buildHeaders(adminToken),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      const list = Array.isArray(json.data) ? json.data : [];
      // Update offline cache
      await chrome.storage.local.set({ cachedTemplates: list });
      return { success: true, templates: list, source: 'live' };
    }
  } catch (err) {
    // Fallback to offline cache
  }

  return {
    success: true,
    templates: cachedTemplates,
    source: 'cache',
    warning: 'Đang hiển thị mẫu tin từ bộ nhớ đệm (máy chủ Zalo-Flow chưa bật hoặc không kết nối được).'
  };
}

// Request AI reply suggestion from Zalo-Flow backend
async function getAiSuggestions({ lastMessage, customerName = '', context = '' }) {
  const { serverUrl, adminToken } = await getConfig();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(`${serverUrl}/api/ai/suggest`, {
      method: 'POST',
      headers: buildHeaders(adminToken),
      body: JSON.stringify({ lastMessage, customerName, context }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errData.error || `Lỗi máy chủ (${res.status})`
      };
    }

    const json = await res.json();
    return {
      success: true,
      suggestions: json.data?.suggestions || []
    };
  } catch (err) {
    return {
      success: false,
      error: `Không thể kết nối Zalo-Flow: ${err.message}`
    };
  }
}

// Handle messages from Content Script and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message || {};

  if (action === 'CHECK_STATUS') {
    checkStatus().then(sendResponse);
    return true; // Keep sendResponse open for async
  }

  if (action === 'GET_TEMPLATES') {
    getTemplates().then(sendResponse);
    return true;
  }

  if (action === 'GET_AI_SUGGEST') {
    getAiSuggestions(payload || {}).then(sendResponse);
    return true;
  }

  if (action === 'GET_CONFIG') {
    getConfig().then(sendResponse);
    return true;
  }

  if (action === 'SAVE_CONFIG') {
    chrome.storage.local.set(payload || {}).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  return false;
});
