let state = {
  conversations: [],
  activeThreadId: null,
  activeThread: null,
  currentFilter: 'all',
  currentTagId: '',
  searchQuery: '',
  adminToken: new URLSearchParams(window.location.search).get('token') || localStorage.getItem('zalo_admin_token') || '',
  messages: [],
  tags: [],
  quickMessages: [],
  pendingQuickAttachments: null,
  selectedTagColor: '#38bdf8'
};

// Preset 10 Colors
const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981',
  '#38bdf8', '#6366f1', '#a855f7', '#ec4899', '#94a3b8'
];

// Elements
const convListEl = document.getElementById('conversation-list');
const emptyStateEl = document.getElementById('chat-empty-state');
const chatContentEl = document.getElementById('chat-pane-content');
const messagesStreamEl = document.getElementById('messages-stream');
const chatInputEl = document.getElementById('chat-input');
const sendBtnEl = document.getElementById('send-btn');
const activeAvatarEl = document.getElementById('active-chat-avatar');
const activeNameEl = document.getElementById('active-chat-name');
const activeTagsEl = document.getElementById('active-chat-tags');
const reconnectBannerEl = document.getElementById('reconnect-banner');
const appLayoutEl = document.getElementById('app-layout');
const backBtnEl = document.getElementById('back-btn');
const tagFilterSelectEl = document.getElementById('tag-filter-select');
const quickPopupEl = document.getElementById('quick-autocomplete-popup');
const lightboxEl = document.getElementById('image-lightbox');
const lightboxImgEl = document.getElementById('lightbox-img');

// Initial Load
function initApp() {
  if (state.adminToken) {
    localStorage.setItem('zalo_admin_token', state.adminToken);
  }
  renderColorSwatches();
  loadTags();
  loadQuickMessages();
  loadConversations();
  loadZaloProfile();
  setupSSE();
  fetchMemoryHealth();
  setInterval(fetchMemoryHealth, 30000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Background sync on tab focus or visibility change
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadConversations();
    if (state.activeThreadId) {
      loadMessages(state.activeThreadId);
    }
  }
});

// Headers with Auth Token
function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (state.adminToken) {
    headers['x-admin-token'] = state.adminToken;
  }
  return headers;
}

// -----------------------------------------------------------------------------
// Modals & Navigation
// -----------------------------------------------------------------------------
function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'flex';

  if (id === 'modal-tags') renderTagsManager();
  if (id === 'modal-quick-msg') renderQuickMessagesManager();
  if (id === 'modal-ai-brain') loadAiSettings();
  if (id === 'modal-campaigns') loadCampaigns();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.style.display = 'none';
  if (id === 'modal-quick-msg') cancelQuickMsgEdit();
}

function switchMainView(view) {
  // Currently chat is primary view
}

// -----------------------------------------------------------------------------
// Tags Management (Module 2)
// -----------------------------------------------------------------------------
function renderColorSwatches() {
  const palette = document.getElementById('color-swatches-palette');
  if (!palette) return;
  palette.innerHTML = PRESET_COLORS.map(c => `
    <button class="swatch-btn ${c === state.selectedTagColor ? 'selected' : ''}" 
            style="background:${c};" 
            onclick="selectTagColor('${c}')"></button>
  `).join('');
}

function selectTagColor(color) {
  state.selectedTagColor = color;
  renderColorSwatches();
}

async function loadTags() {
  try {
    const res = await fetch('/api/tags', { headers: getHeaders() });
    const result = await res.json();
    state.tags = result.data || [];
    renderTagFilterDropdown();
  } catch (err) {
    console.error('Failed to load tags:', err);
  }
}

function renderTagFilterDropdown() {
  if (!tagFilterSelectEl) return;
  tagFilterSelectEl.innerHTML = `
    <option value="">📌 Tất cả Thẻ</option>
    ${state.tags.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.customerCount || 0})</option>`).join('')}
  `;
}

function handleTagFilterChange(tagId) {
  state.currentTagId = tagId;
  loadConversations();
}

async function createTag() {
  const input = document.getElementById('tag-name-input');
  const name = input?.value.trim();
  if (!name) return alert('Vui lòng nhập tên thẻ!');

  try {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, color: state.selectedTagColor })
    });
    if (res.ok) {
      input.value = '';
      await loadTags();
      renderTagsManager();
      loadConversations();
    }
  } catch (err) {
    alert(err.message);
  }
}

async function deleteTag(id) {
  if (!confirm('Bạn có chắc muốn xóa thẻ này?')) return;
  try {
    await fetch(`/api/tags/${id}`, { method: 'DELETE', headers: getHeaders() });
    await loadTags();
    renderTagsManager();
    loadConversations();
  } catch (err) {
    alert(err.message);
  }
}

function renderTagsManager() {
  const container = document.getElementById('tags-manager-list');
  if (!container) return;

  if (state.tags.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;">Chưa có thẻ nào. Hãy tạo thẻ đầu tiên ở trên!</div>`;
    return;
  }

  container.innerHTML = state.tags.map(t => `
    <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.3);padding:8px 12px;border-radius:10px;border:1px solid var(--border);">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:12px;height:12px;border-radius:50%;background:${t.color};"></span>
        <span style="font-weight:700;font-size:0.88rem;color:#fff;">${escapeHtml(t.name)}</span>
        <span style="font-size:0.75rem;color:var(--text-dim);">(${t.customerCount || 0} khách)</span>
      </div>
      <button class="filter-btn" style="color:var(--danger);padding:2px 8px;" onclick="deleteTag('${t.id}')">Xóa</button>
    </div>
  `).join('');
}

// Assign Tag Modal
async function openTagAssignModal() {
  if (!state.activeThreadId) return;
  openModal('modal-assign-tag');
  
  const container = document.getElementById('assign-tags-list');
  if (!container) return;

  try {
    if (state.tags.length === 0) {
      await loadTags();
    }

    const res = await fetch(`/api/conversations/${state.activeThreadId}/tags`, { headers: getHeaders() });
    const result = await res.json();
    const assignedTagIds = (result.data || []).map(t => t.id);

    if (state.tags.length === 0) {
      container.innerHTML = `
        <div style="padding: 16px; text-align: center; color: var(--text-dim); font-size: 0.85rem;">
          Chưa có thẻ nào. Nhập tên ở trên và bấm <strong>[+ Tạo & Gắn]</strong>!
        </div>
      `;
      return;
    }

    container.innerHTML = state.tags.map(t => {
      const isAssigned = assignedTagIds.includes(t.id);
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.3);padding:10px 14px;border-radius:10px;border:1px solid ${isAssigned ? t.color : 'var(--border)'};cursor:pointer;transition:all 0.15s;" onclick="toggleCustomerTag('${t.id}', ${!isAssigned})">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="width:14px;height:14px;border-radius:50%;background:${t.color};box-shadow:0 0 8px ${t.color}40;"></span>
            <span style="font-weight:700;color:#fff;font-size:0.9rem;">${escapeHtml(t.name)}</span>
          </div>
          <span style="font-weight:800;font-size:0.84rem;color:${isAssigned ? 'var(--primary)' : 'var(--text-dim)'};">${isAssigned ? '✓ Đã gắn' : '+ Gắn'}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div style="color:var(--danger);padding:10px;">Lỗi tải thẻ: ${escapeHtml(err.message)}</div>`;
  }
}

async function createQuickTagFromAssign() {
  const input = document.getElementById('quick-tag-input');
  const name = input?.value.trim();
  if (!name) return alert('Vui lòng nhập tên thẻ!');

  try {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)] })
    });
    const result = await res.json();
    if (res.ok && result.data?.id) {
      input.value = '';
      await loadTags();
      await toggleCustomerTag(result.data.id, true);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function toggleCustomerTag(tagId, shouldAdd) {
  if (!state.activeThreadId) return;
  try {
    if (shouldAdd) {
      await fetch(`/api/conversations/${state.activeThreadId}/tags`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ tagId })
      });
    } else {
      await fetch(`/api/conversations/${state.activeThreadId}/tags/${tagId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
    }
    await renderActiveChatTags();
    await openTagAssignModal();
    loadConversations();
  } catch (err) {
    alert(err.message);
  }
}

async function renderActiveChatTags() {
  if (!state.activeThreadId || !activeTagsEl) return;
  try {
    const res = await fetch(`/api/conversations/${state.activeThreadId}/tags`, { headers: getHeaders() });
    const result = await res.json();
    const tags = result.data || [];
    activeTagsEl.innerHTML = tags.map(t => `
      <span class="conv-tag-pill" style="background:${t.color};">${escapeHtml(t.name)}</span>
    `).join('');
  } catch {}
}

// -----------------------------------------------------------------------------
// Quick Messages (Module 3)
// -----------------------------------------------------------------------------
async function loadQuickMessages() {
  try {
    const res = await fetch('/api/quick-messages', { headers: getHeaders() });
    const result = await res.json();
    state.quickMessages = result.data || [];
  } catch (err) {
    console.error('Failed to load quick messages:', err);
  }
}

let mainPendingAttachments = [];
let editorPendingAttachments = [];

function getQuickMessageAttachments(qm) {
  if (!qm) return [];
  if (Array.isArray(qm.attachments)) return qm.attachments;
  if (qm.mediaUrl) {
    if (typeof qm.mediaUrl === 'string' && qm.mediaUrl.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(qm.mediaUrl);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {}
    }
    return [{
      mediaUrl: qm.mediaUrl,
      mediaType: qm.mediaType || 'file',
      mediaName: qm.mediaName || 'Đính kèm'
    }];
  }
  return [];
}

function renderAttachmentChips(scope = 'main') {
  const isMain = scope === 'main';
  const prefix = isMain ? 'qm' : 'qme';
  const list = isMain ? mainPendingAttachments : editorPendingAttachments;
  const container = document.getElementById(`${prefix}-attachments-container`);
  const hintEl = document.getElementById(`${prefix}-attachment-count-hint`);
  const clearAllBtn = document.getElementById(`${prefix}-clear-all-btn`);
  const fileBtnText = document.getElementById(`${prefix}-file-btn-text`);
  const fileBtn = document.getElementById(`${prefix}-file-btn`);

  if (hintEl) {
    hintEl.innerText = `${list.length}/5 tệp (Tối đa 10MB/tệp)`;
    hintEl.style.color = list.length >= 5 ? '#f87171' : 'var(--text-muted)';
  }

  if (clearAllBtn) {
    clearAllBtn.style.display = list.length > 0 ? 'inline-block' : 'none';
  }

  if (fileBtnText) {
    if (list.length === 0) fileBtnText.innerText = 'Thêm Ảnh / Tệp';
    else if (list.length >= 5) fileBtnText.innerText = 'Đã đủ 5/5 tệp';
    else fileBtnText.innerText = `+ Thêm (${list.length}/5)`;
  }
  if (fileBtn) {
    fileBtn.disabled = list.length >= 5;
    fileBtn.style.opacity = list.length >= 5 ? '0.5' : '1';
    fileBtn.style.cursor = list.length >= 5 ? 'not-allowed' : 'pointer';
  }

  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = list.map((att, idx) => `
    <div style="display: inline-flex; align-items: center; gap: 6px; background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3); padding: 4px 8px; border-radius: 6px; font-size: 0.78rem;">
      <span>${att.mediaType === 'image' ? '🖼️' : '📎'}</span>
      <span style="color: #38bdf8; font-weight: 500; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(att.mediaName)}">${escapeHtml(att.mediaName || 'Đính kèm')}</span>
      <button type="button" onclick="removeSingleAttachment('${scope}', ${idx})" title="Gỡ tệp này" style="background: none; border: none; color: #f87171; cursor: pointer; font-size: 0.95rem; line-height: 1; padding: 0 2px;">&times;</button>
    </div>
  `).join('');
}

function removeSingleAttachment(scope, index) {
  if (scope === 'main') {
    mainPendingAttachments.splice(index, 1);
  } else {
    editorPendingAttachments.splice(index, 1);
  }
  renderAttachmentChips(scope);
}

function clearQuickMsgAttachment(scope = 'main') {
  if (scope === 'main') {
    mainPendingAttachments = [];
  } else {
    editorPendingAttachments = [];
  }
  const prefix = scope === 'editor' ? 'qme' : 'qm';
  const urlEl = document.getElementById(`${prefix}-media-url`);
  const typeEl = document.getElementById(`${prefix}-media-type`);
  const nameEl = document.getElementById(`${prefix}-media-name`);
  const fileInputEl = document.getElementById(`${prefix}-file-input`);

  if (urlEl) urlEl.value = '';
  if (typeEl) typeEl.value = '';
  if (nameEl) nameEl.value = '';
  if (fileInputEl) fileInputEl.value = '';

  renderAttachmentChips(scope);
}

async function handleQuickMsgFileUpload(inputEl, scope = 'main') {
  const files = Array.from(inputEl.files || []);
  if (files.length === 0) return;

  const currentList = scope === 'main' ? mainPendingAttachments : editorPendingAttachments;
  const remainingSlots = 5 - currentList.length;

  if (remainingSlots <= 0) {
    alert('Đã đạt tối đa 5 hình ảnh / tài liệu đính kèm!');
    inputEl.value = '';
    return;
  }

  let filesToUpload = files;
  if (files.length > remainingSlots) {
    alert(`Bạn chỉ có thể thêm tối đa ${remainingSlots} tệp nữa (tổng cộng 5 tệp). Hệ thống sẽ lấy ${remainingSlots} tệp đầu tiên.`);
    filesToUpload = files.slice(0, remainingSlots);
  }

  const validFiles = [];
  for (const rawFile of filesToUpload) {
    let file = rawFile;
    if (rawFile.type && rawFile.type.startsWith('image/')) {
      file = await compressImageFile(rawFile);
    }
    if (file.size > 25 * 1024 * 1024) {
      alert(`Tệp "${file.name}" vượt quá giới hạn cho phép của Zalo (tối đa 25MB) và sẽ bị bỏ qua!`);
      continue;
    }
    validFiles.push(file);
  }

  if (validFiles.length === 0) {
    inputEl.value = '';
    return;
  }

  try {
    const formData = new FormData();
    for (const file of validFiles) {
      formData.append('files', file);
    }

    const res = await fetch('/api/quick-messages/upload', {
      method: 'POST',
      headers: state.adminToken ? { 'x-admin-token': state.adminToken } : {},
      body: formData
    });

    const contentType = res.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      throw new Error(`Máy chủ phản hồi không hợp lệ (${res.status}): ${text.substring(0, 120)}`);
    }

    if (!res.ok || data.error) {
      alert('Lỗi tải tệp: ' + (data.error || 'Không thể tải lên'));
    } else {
      const uploadedItems = data.items || (data.data ? (Array.isArray(data.data) ? data.data : [data.data]) : []);
      for (const item of uploadedItems) {
        if (currentList.length < 5) {
          currentList.push({
            mediaUrl: item.mediaUrl,
            mediaType: item.mediaType,
            mediaName: item.mediaName
          });
        }
      }
      renderAttachmentChips(scope);
    }
  } catch (err) {
    alert('Lỗi upload: ' + err.message);
  } finally {
    inputEl.value = '';
  }
}

async function saveQuickMessageFromModal() {
  const id = document.getElementById('qm-id')?.value.trim() || undefined;
  const shortcut = document.getElementById('qm-shortcut')?.value.trim();
  const title = document.getElementById('qm-title')?.value.trim();
  const content = document.getElementById('qm-content')?.value.trim();

  if (!shortcut || !content) {
    return alert('Vui lòng điền đủ phím tắt và nội dung tin nhắn!');
  }

  try {
    const res = await fetch('/api/quick-messages', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        id,
        shortcut,
        title: title || shortcut,
        content,
        attachments: mainPendingAttachments
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return alert('Lỗi: ' + (data.error || 'Không thể lưu mẫu tin'));
    }

    cancelQuickMsgEdit();
    await loadQuickMessages();
    renderQuickMessagesManager();
    renderKnowledgeQuickMsgList();
    renderQuickMsgPopoverList();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

function createQuickMessage() {
  return saveQuickMessageFromModal();
}

function startEditQuickMessage(id) {
  const qm = state.quickMessages.find(q => q.id === id);
  if (!qm) return;

  const idEl = document.getElementById('qm-id');
  const shortcutEl = document.getElementById('qm-shortcut');
  const titleEl = document.getElementById('qm-title');
  const contentEl = document.getElementById('qm-content');
  const submitBtn = document.getElementById('qm-submit-btn');
  const cancelBtn = document.getElementById('qm-cancel-edit-btn');

  if (idEl) idEl.value = qm.id;
  if (shortcutEl) shortcutEl.value = qm.shortcut || '';
  if (titleEl) titleEl.value = qm.title || '';
  if (contentEl) contentEl.value = qm.content || '';

  mainPendingAttachments = [...getQuickMessageAttachments(qm)];
  renderAttachmentChips('main');

  if (submitBtn) {
    submitBtn.innerHTML = '💾 Cập Nhật Mẫu Tin';
    submitBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
  }
  if (cancelBtn) cancelBtn.style.display = 'inline-block';

  // Re-render list to highlight active item
  renderQuickMessagesManager();

  // Scroll to top of modal
  const modalBody = document.querySelector('#modal-quick-msg .modal-body');
  if (modalBody) modalBody.scrollTop = 0;

  if (contentEl) contentEl.focus();
}

function cancelQuickMsgEdit() {
  const idEl = document.getElementById('qm-id');
  const shortcutEl = document.getElementById('qm-shortcut');
  const titleEl = document.getElementById('qm-title');
  const contentEl = document.getElementById('qm-content');
  const submitBtn = document.getElementById('qm-submit-btn');
  const cancelBtn = document.getElementById('qm-cancel-edit-btn');

  if (idEl) idEl.value = '';
  if (shortcutEl) shortcutEl.value = '';
  if (titleEl) titleEl.value = '';
  if (contentEl) contentEl.value = '';
  clearQuickMsgAttachment('main');

  if (submitBtn) {
    submitBtn.innerHTML = '+ Thêm Mẫu Tin';
    submitBtn.style.background = '';
  }
  if (cancelBtn) cancelBtn.style.display = 'none';

  renderQuickMessagesManager();
}

async function removeSpecificMediaFromQuickMessage(id, index, event) {
  if (event) event.stopPropagation();
  const qm = state.quickMessages.find(q => q.id === id);
  if (!qm) return;

  const atts = getQuickMessageAttachments(qm);
  const target = atts[index];
  if (!target) return;

  if (!confirm(`Gỡ bỏ "${target.mediaName || 'tệp đính kèm'}" khỏi mẫu tin "${qm.shortcut}"?`)) return;

  atts.splice(index, 1);

  try {
    const res = await fetch('/api/quick-messages', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        id: qm.id,
        shortcut: qm.shortcut,
        title: qm.title,
        customerQuestion: qm.customerQuestion || '',
        content: qm.content,
        attachments: atts
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return alert('Lỗi: ' + (data.error || 'Không thể gỡ tệp đính kèm'));
    }

    if (document.getElementById('qm-id')?.value === qm.id) {
      mainPendingAttachments = [...atts];
      renderAttachmentChips('main');
    }

    await loadQuickMessages();
    renderQuickMessagesManager();
    renderKnowledgeQuickMsgList();
    renderQuickMsgPopoverList();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

async function deleteQuickMessage(id) {
  if (!confirm('Xóa tin nhắn nhanh này?')) return;
  try {
    await fetch(`/api/quick-messages/${id}`, { method: 'DELETE', headers: getHeaders() });
    if (document.getElementById('qm-id')?.value === id) {
      cancelQuickMsgEdit();
    }
    await loadQuickMessages();
    renderQuickMessagesManager();
    renderKnowledgeQuickMsgList();
    renderQuickMsgPopoverList();
  } catch (err) {
    alert(err.message);
  }
}

function renderQuickMessagesManager() {
  const container = document.getElementById('qm-manager-list');
  if (!container) return;

  if (state.quickMessages.length === 0) {
    container.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;text-align:center;padding:16px;">Chưa có mẫu nào. Hãy thêm mẫu mới ở trên!</div>`;
    return;
  }

  const currentEditingId = document.getElementById('qm-id')?.value;

  container.innerHTML = state.quickMessages.map(q => {
    const isEditing = currentEditingId === q.id;
    const atts = getQuickMessageAttachments(q);

    const attachmentsHtml = atts.map((att, idx) => `
      <span style="color:#34d399; font-size:0.72rem; font-weight:600; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.3); padding:2px 8px; border-radius:6px; display:inline-flex; align-items:center; gap:4px;">
        <span>${att.mediaType === 'image' ? '🖼️' : '📎'}</span>
        <span style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(att.mediaName)}">${escapeHtml(att.mediaName || 'Đính kèm')}</span>
        <button type="button" onclick="removeSpecificMediaFromQuickMessage('${q.id}', ${idx}, event)" title="Gỡ tệp này" style="background:none; border:none; color:#f87171; cursor:pointer; font-size:0.85rem; line-height:1; padding:0 2px; margin-left:2px;">&times;</button>
      </span>
    `).join('');

    return `
    <div style="background:${isEditing ? 'rgba(56,189,248,0.12)' : 'rgba(0,0,0,0.3)'};padding:12px 14px;border-radius:10px;border:1px solid ${isEditing ? '#38bdf8' : 'var(--border)'};display:flex;flex-direction:column;gap:8px;transition:all 0.2s ease;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-weight:700;color:var(--primary);font-size:0.88rem;">${escapeHtml(q.shortcut.startsWith('/') ? q.shortcut : '/' + q.shortcut)} — ${escapeHtml(q.title || q.shortcut)}</span>
          ${attachmentsHtml}
          ${isEditing ? `<span style="font-size:0.7rem; color:#38bdf8; font-weight:700; background:rgba(56,189,248,0.2); padding:1px 6px; border-radius:4px;">Đang chỉnh sửa</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="filter-btn" style="color:#38bdf8;padding:3px 8px;font-size:0.76rem;display:flex;align-items:center;gap:4px;" onclick="startEditQuickMessage('${q.id}')" title="Chỉnh sửa nội dung, phím tắt & ảnh">
            <span>✏️ Sửa</span>
          </button>
          <button class="filter-btn" style="color:var(--danger);padding:3px 8px;font-size:0.76rem;display:flex;align-items:center;gap:4px;" onclick="deleteQuickMessage('${q.id}')" title="Xóa mẫu câu">
            <span>🗑️ Xóa</span>
          </button>
        </div>
      </div>
      <div style="font-size:0.83rem;color:#e2e8f0;white-space:pre-wrap;line-height:1.45;background:rgba(0,0,0,0.25);padding:8px 10px;border-radius:6px;">${escapeHtml(q.content)}</div>
    </div>
  `;
  }).join('');
}

// Autocomplete / trigger in chat
function handleChatInput(val) {
  if (val.startsWith('/')) {
    const term = val.substring(1).toLowerCase();
    const matches = state.quickMessages.filter(q => q.shortcut.toLowerCase().includes(term) || q.title.toLowerCase().includes(term));
    if (matches.length > 0) {
      quickPopupEl.style.display = 'flex';
      quickPopupEl.innerHTML = matches.map(m => {
        const atts = getQuickMessageAttachments(m);
        return `
        <div class="quick-autocomplete-item" onclick="insertQuickMessage('${m.id}')">
          <span style="font-weight:700;color:var(--primary);">${escapeHtml(m.shortcut)}</span>
          <span style="color:var(--text-muted);">${escapeHtml(m.title)}</span>
          ${atts.length > 0 ? `<span style="font-size:0.7rem; color:#38bdf8;">📎 ${atts.length}</span>` : ''}
        </div>
      `;
      }).join('');
      return;
    }
  }
  quickPopupEl.style.display = 'none';
}

function insertQuickMessage(id) {
  const qm = state.quickMessages.find(q => q.id === id);
  if (qm) {
    chatInputEl.value = qm.content;
    quickPopupEl.style.display = 'none';

    const atts = getQuickMessageAttachments(qm);
    if (atts.length > 0) {
      state.pendingQuickAttachments = [...atts];
      const bar = document.getElementById('attachment-preview-bar');
      const infoEl = document.getElementById('attachment-preview-info');
      const imgEl = document.getElementById('attachment-preview-img');
      if (bar && infoEl) {
        const namesSummary = atts.map(a => a.mediaName).join(', ');
        infoEl.innerText = `📎 Kèm theo mẫu: ${atts.length} tệp (${namesSummary})`;
        const firstImg = atts.find(a => a.mediaType === 'image');
        if (firstImg && imgEl) {
          const authParam = state.adminToken ? `?token=${encodeURIComponent(state.adminToken)}` : '';
          imgEl.src = firstImg.mediaUrl + authParam;
          imgEl.style.display = 'block';
        } else if (imgEl) {
          imgEl.style.display = 'none';
        }
        bar.classList.add('active');
      }
    } else {
      cancelAttachment();
    }

    chatInputEl.focus();
  }
}

function toggleQuickMsgPopover(event) {
  if (event) event.stopPropagation();
  const popover = document.getElementById('quick-msg-popover');
  if (!popover) return;
  
  if (popover.classList.contains('active')) {
    popover.classList.remove('active');
  } else {
    renderQuickMsgPopoverList();
    popover.classList.add('active');
  }
}

function renderQuickMsgPopoverList() {
  const container = document.getElementById('quick-msg-popover-list');
  const titleEl = document.getElementById('quick-msg-popover-title');
  if (!container) return;

  if (titleEl) titleEl.innerText = `⚡ Tin nhắn nhanh (${state.quickMessages.length})`;

  if (state.quickMessages.length === 0) {
    container.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-dim); font-size: 0.8rem;">Chưa có mẫu nào. Bấm <strong>Quản lý</strong> để tạo mới!</div>`;
    return;
  }

  container.innerHTML = state.quickMessages.map(q => {
    const atts = getQuickMessageAttachments(q);
    return `
    <div class="quick-msg-pop-item" onclick="selectQuickMsgFromPopover('${q.id}')">
      <div style="font-weight: 700; color: var(--primary); font-size: 0.84rem; display:flex; justify-content:space-between; align-items:center;">
        <span>/${escapeHtml(q.shortcut.startsWith('/') ? q.shortcut.substring(1) : q.shortcut)} — ${escapeHtml(q.title || q.shortcut)}</span>
        ${atts.length > 0 ? `<span style="font-size:0.7rem; color:#38bdf8; font-weight:600;">📎 ${atts.length}</span>` : ''}
      </div>
      <div style="font-size: 0.76rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px;">${escapeHtml(q.content)}</div>
    </div>
  `;
  }).join('');
}

function selectQuickMsgFromPopover(id) {
  insertQuickMessage(id);
  const popover = document.getElementById('quick-msg-popover');
  if (popover) popover.classList.remove('active');
}

// Close popover when clicking outside
document.addEventListener('click', (e) => {
  const popover = document.getElementById('quick-msg-popover');
  const toggleBtn = document.getElementById('btn-quick-msg-toggle');
  if (popover && popover.classList.contains('active')) {
    if (!popover.contains(e.target) && e.target !== toggleBtn) {
      popover.classList.remove('active');
    }
  }
});

// -----------------------------------------------------------------------------
// Campaigns & Remarketing (Module 5)
// -----------------------------------------------------------------------------
let campaignsState = {
  list: [],
  filterStatus: 'all',
  searchQuery: '',
  editingAttachments: []
};

function insertCampSpintaxVar(varName) {
  const textarea = document.getElementById('camp-edit-message');
  if (textarea) {
    textarea.value += varName;
    textarea.focus();
  }
}

function insertCampSpintaxTemplate() {
  const textarea = document.getElementById('camp-edit-message');
  if (textarea) {
    textarea.value = `{Chào|Xin chào|Hello} {name} nhé, {chúc bạn|chúc anh/chị} {ngày mới tràn đầy năng lượng|tuần mới gặt hái nhiều thành công}! {Bên em|Shop em} đang có {ưu đãi|chương trình khuyến mãi} đặc biệt nè.`;
    textarea.focus();
  }
}

async function previewCampSpintax() {
  const message = document.getElementById('camp-edit-message')?.value.trim();
  if (!message) return alert('Vui lòng nhập nội dung tin nhắn trước!');

  try {
    const res = await fetch('/api/campaigns/preview', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ message, sampleName: 'Phan Lê Khoa' })
    });
    const result = await res.json();
    const box = document.getElementById('camp-spintax-preview-box');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = `
        <div style="color: #38bdf8; font-weight: 700; margin-bottom: 4px;">🎲 3 Mẫu Tin Nhắn Ngẫu Nhiên Sẽ Sinh Ra:</div>
        ${(result.data || []).map(s => `<div style="color: #e2e8f0; margin-top: 3px;">💬 "${escapeHtml(s)}"</div>`).join('')}
      `;
    }
  } catch (err) {
    alert('Lỗi preview: ' + err.message);
  }
}

function updateCampaignEditorTargetsUI() {
  // Can add custom validation or tag highlights if needed
}

function toggleCampScheduleModeUI() {
  const mode = document.querySelector('input[name="camp-schedule-mode-radio"]:checked')?.value || 'scheduled';
  const detailCard = document.getElementById('camp-schedule-detail-card');
  if (detailCard) {
    detailCard.style.display = mode === 'scheduled' ? 'flex' : 'none';
  }
}

function setCampSchedulePreset(presetKey) {
  const now = new Date();
  const dateInput = document.getElementById('camp-start-date');
  const timeInput = document.getElementById('camp-schedule-time');
  const recurrenceSelect = document.getElementById('camp-recurrence');

  const pad = (n) => String(n).padStart(2, '0');
  const formatYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (presetKey === '15min') {
    const future = new Date(now.getTime() + 15 * 60 * 1000);
    if (dateInput) dateInput.value = formatYMD(future);
    if (timeInput) timeInput.value = `${pad(future.getHours())}:${pad(future.getMinutes())}`;
    if (recurrenceSelect) recurrenceSelect.value = 'once';
  } else if (presetKey === 'tomorrow_morning') {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (dateInput) dateInput.value = formatYMD(tomorrow);
    if (timeInput) timeInput.value = '08:30';
  } else if (presetKey === 'tomorrow_afternoon') {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (dateInput) dateInput.value = formatYMD(tomorrow);
    if (timeInput) timeInput.value = '14:30';
  } else if (presetKey === 'next_monday') {
    const d = new Date(now);
    const day = d.getDay();
    const diff = (day === 0 ? 1 : 8 - day); // days until next Monday
    d.setDate(d.getDate() + diff);
    if (dateInput) dateInput.value = formatYMD(d);
    if (timeInput) timeInput.value = '09:00';
  } else if (presetKey === 'next_month_1st') {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    if (dateInput) dateInput.value = formatYMD(d);
    if (timeInput) timeInput.value = '08:30';
  }
}

function applyCampQuickMsgTemplate(qmId) {
  if (!qmId) return;
  const qm = (state.quickMessages || []).find(q => q.id === qmId);
  if (!qm) return;

  const msgInput = document.getElementById('camp-edit-message');
  if (msgInput) {
    msgInput.value = qm.content || '';
    msgInput.focus();
  }

  if (qm.mediaUrl) {
    const exists = campaignsState.editingAttachments.some(a => a.mediaUrl === qm.mediaUrl);
    if (!exists && campaignsState.editingAttachments.length < 5) {
      campaignsState.editingAttachments.push({
        mediaUrl: qm.mediaUrl,
        mediaType: qm.mediaType || 'image',
        mediaName: qm.mediaName || qm.title || 'Đính kèm mẫu'
      });
      renderCampAttachmentChips();
    }
  }
}

async function handleCampMediaUpload(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const currentCount = campaignsState.editingAttachments.length;
  if (currentCount + files.length > 5) {
    alert(`Bạn chỉ có thể đính kèm tối đa 5 tệp tin (Hiện đã có ${currentCount} tệp).`);
    event.target.value = '';
    return;
  }

  const formData = new FormData();
  for (const rawFile of files) {
    let file = rawFile;
    if (rawFile.type && rawFile.type.startsWith('image/')) {
      file = await compressImageFile(rawFile);
    }
    if (file.size > 25 * 1024 * 1024) {
      alert(`Tệp "${file.name}" vượt quá giới hạn cho phép của Zalo (tối đa 25MB)!`);
      event.target.value = '';
      return;
    }
    formData.append('files', file);
  }

  try {
    const res = await fetch('/api/campaigns/upload', {
      method: 'POST',
      headers: {
        ...(state.adminToken ? { 'x-admin-token': state.adminToken } : {})
      },
      body: formData
    });
    const result = await res.json();
    if (!res.ok || result.error) {
      alert('Lỗi tải tệp: ' + (result.error || 'Vui lòng thử lại'));
      return;
    }

    const newItems = result.data || [];
    campaignsState.editingAttachments = [...campaignsState.editingAttachments, ...newItems].slice(0, 5);
    renderCampAttachmentChips();
  } catch (err) {
    alert('Lỗi tải tệp: ' + err.message);
  } finally {
    event.target.value = '';
  }
}

function renderCampAttachmentChips() {
  const container = document.getElementById('camp-attachments-container');
  const countHint = document.getElementById('camp-media-count-hint');
  const count = campaignsState.editingAttachments.length;

  if (countHint) {
    countHint.innerText = `Đã đính kèm: ${count}/5 tệp`;
  }

  if (!container) return;
  if (count === 0) {
    container.innerHTML = `<div style="font-size: 0.74rem; color: var(--text-muted);">Chưa có tệp đính kèm. Bấm nút phía trên để thêm tối đa 5 hình ảnh hoặc file PDF/Docx.</div>`;
    return;
  }

  container.innerHTML = campaignsState.editingAttachments.map((att, idx) => {
    const isImg = att.mediaType === 'image' || /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(att.mediaUrl || '');
    const authParam = state.adminToken ? `?token=${encodeURIComponent(state.adminToken)}` : '';
    const fileUrl = (att.mediaUrl || '') + authParam;

    return `
      <div class="camp-media-card-item" title="${escapeHtml(att.mediaName || 'Tệp đính kèm')}">
        ${isImg ? 
          `<img src="${escapeHtml(fileUrl)}" class="camp-media-card-img" />` : 
          `<div class="camp-media-card-doc"><span class="doc-icon">📄</span><span class="doc-name">${escapeHtml(att.mediaName || 'Tệp')}</span></div>`
        }
        <div class="camp-media-remove-badge" onclick="removeCampAttachment(${idx})" title="Gỡ tệp này">&times;</div>
      </div>
    `;
  }).join('');
}

function removeCampAttachment(index) {
  campaignsState.editingAttachments.splice(index, 1);
  renderCampAttachmentChips();
}

function toggleCampTagPill(tagId) {
  if (!campaignsState.selectedTagIds) campaignsState.selectedTagIds = [];
  const idx = campaignsState.selectedTagIds.indexOf(tagId);
  if (idx > -1) {
    campaignsState.selectedTagIds.splice(idx, 1);
  } else {
    campaignsState.selectedTagIds.push(tagId);
  }
  renderCampTagPills();
}

function renderCampTagPills() {
  const container = document.getElementById('camp-target-tags-selector');
  if (!container) return;

  if (state.tags.length === 0) {
    container.innerHTML = `<span style="font-size:0.72rem; color:var(--text-muted);">(Chưa có thẻ nào được tạo trong hệ thống)</span>`;
    return;
  }

  const selected = campaignsState.selectedTagIds || [];
  container.innerHTML = state.tags.map(t => {
    const isSelected = selected.includes(t.id);
    return `
      <button type="button" class="camp-tag-pill-btn ${isSelected ? 'active' : ''}" onclick="toggleCampTagPill('${t.id}')">
        <span class="tag-dot" style="background:${t.color || '#38bdf8'};"></span>
        <span>${escapeHtml(t.name)}</span>
        ${isSelected ? '<span style="font-weight:900; color:#34d399; margin-left:2px;">✓</span>' : ''}
      </button>
    `;
  }).join('');
}

function filterCampaignsList() {
  const search = document.getElementById('camp-search-input')?.value.toLowerCase().trim() || '';
  const filter = document.getElementById('camp-filter-status')?.value || 'all';

  campaignsState.searchQuery = search;
  campaignsState.filterStatus = filter;

  renderCampaignsList();
}

async function loadCampaigns() {
  try {
    const res = await fetch('/api/campaigns', { headers: getHeaders() });
    const result = await res.json();
    campaignsState.list = result.data || [];
    renderCampaignsList();
  } catch (err) {
    console.error('Failed to load campaigns:', err);
  }
}

function renderCampaignsList() {
  const container = document.getElementById('campaigns-table-body');
  const summaryEl = document.getElementById('camp-stats-summary');
  if (!container) return;

  let filtered = [...campaignsState.list];

  if (campaignsState.searchQuery) {
    filtered = filtered.filter(c => 
      (c.name && c.name.toLowerCase().includes(campaignsState.searchQuery)) ||
      (c.description && c.description.toLowerCase().includes(campaignsState.searchQuery)) ||
      (c.message && c.message.toLowerCase().includes(campaignsState.searchQuery))
    );
  }

  if (campaignsState.filterStatus === 'enabled') {
    filtered = filtered.filter(c => c.isEnabled === 1);
  } else if (campaignsState.filterStatus === 'disabled') {
    filtered = filtered.filter(c => c.isEnabled === 0);
  } else if (campaignsState.filterStatus === 'running') {
    filtered = filtered.filter(c => c.status === 'running');
  } else if (campaignsState.filterStatus === 'completed') {
    filtered = filtered.filter(c => c.status === 'completed');
  }

  if (summaryEl) {
    const total = campaignsState.list.length;
    const running = campaignsState.list.filter(c => c.status === 'running').length;
    const enabled = campaignsState.list.filter(c => c.isEnabled === 1).length;
    summaryEl.innerHTML = `Tổng cộng: <strong>${total}</strong> chiến dịch • Đang bật: <strong style="color:#34d399;">${enabled}</strong> • Đang chạy: <strong style="color:#38bdf8;">${running}</strong>`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); font-size: 0.84rem; padding: 40px 20px; background: rgba(0,0,0,0.2); border-radius: 10px;">
        <div style="font-size: 1.6rem; margin-bottom: 6px;">📢</div>
        <div>Không tìm thấy chiến dịch nào phù hợp.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(c => {
    const isEnabled = c.isEnabled === 1;
    const isRunning = c.status === 'running';

    // 1. Column 1: Campaign details + attachments
    const mediaItems = Array.isArray(c.mediaUrls) ? c.mediaUrls : [];
    let mediaGalleryHtml = '';
    if (mediaItems.length > 0) {
      const authParam = state.adminToken ? `?token=${encodeURIComponent(state.adminToken)}` : '';
      const chipsHtml = mediaItems.map(m => {
        const isImg = m.mediaType === 'image' || /\.(png|jpg|jpeg|webp|gif|bmp)$/i.test(m.mediaUrl || '');
        const fileUrl = (m.mediaUrl || '') + authParam;
        if (isImg) {
          return `<img src="${escapeHtml(fileUrl)}" class="camp-media-thumb" onclick="openImagePreview('${escapeHtml(fileUrl)}')" title="Xem ảnh" />`;
        }
        return `<span class="camp-doc-chip" title="${escapeHtml(m.mediaName || 'Tài liệu')}">📄 ${escapeHtml(m.mediaName || 'Tài liệu')}</span>`;
      }).join('');
      mediaGalleryHtml = `
        <div class="camp-media-gallery">
          ${chipsHtml}
          <span style="font-size:0.7rem; color:var(--text-muted); font-weight:600;">(${mediaItems.length} tệp)</span>
        </div>
      `;
    }

    // 2. Column 2: Target & Tags
    let targetLabel = 'Tất cả hội thoại';
    if (c.targetType === 'direct') targetLabel = '👤 Cá nhân';
    if (c.targetType === 'group') targetLabel = '👥 Nhóm';

    let tagBadgesHtml = '';
    const tagIds = Array.isArray(c.targetTagIds) ? c.targetTagIds : [];
    if (tagIds.length > 0) {
      const tagElements = tagIds.map(tid => {
        const found = state.tags.find(t => t.id === tid);
        if (!found) return '';
        return `<span class="camp-tag-chip" style="background:${found.color}20; color:${found.color}; border-color:${found.color}40;">${escapeHtml(found.name)}</span>`;
      }).filter(Boolean);
      tagBadgesHtml = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px;">${tagElements.join('')}</div>`;
    }

    // 3. Column 3: Schedule
    const schedMode = c.scheduleMode || (c.scheduleType === 'daily' ? 'scheduled' : 'now');
    const recurrence = c.recurrence || (c.scheduleType === 'daily' ? 'daily' : 'once');
    let scheduleHtml = `<span style="color:#34d399; font-weight:700;">⚡ Gửi ngay bây giờ</span>`;

    if (schedMode === 'scheduled') {
      const timeStr = escapeHtml(c.scheduleTime || '08:30');
      if (recurrence === 'once') {
        scheduleHtml = `<span style="color:#38bdf8; font-weight:700;">📅 ${escapeHtml(c.startDate || '')} ${timeStr} (1 lần)</span>`;
      } else if (recurrence === 'daily') {
        scheduleHtml = `<span style="color:#38bdf8; font-weight:700;">🔄 ${timeStr} hàng ngày</span>`;
      } else if (recurrence === 'weekly') {
        scheduleHtml = `<span style="color:#c084fc; font-weight:700;">📅 ${timeStr} hàng tuần</span>`;
      } else if (recurrence === 'monthly') {
        scheduleHtml = `<span style="color:#f472b6; font-weight:700;">🗓️ ${timeStr} hàng tháng</span>`;
      }
    }

    // 4. Column 4: Toggle switch
    const toggleBtnHtml = `
      <button class="camp-toggle-switch ${isEnabled ? 'on' : 'off'}" onclick="toggleCampaignStatus('${c.id}')" title="Bấm để ${isEnabled ? 'Tắt' : 'Bật'}">
        ${isEnabled ? '● Bật' : '○ Tắt'}
      </button>
    `;

    // 5. Column 5: Action buttons
    const percent = c.totalCount > 0 ? Math.round(((c.sentCount || 0) / c.totalCount) * 100) : 0;
    const progressSummary = c.totalCount > 0 ? `<div style="font-size:0.7rem; color:var(--text-muted); margin-top:2px;">${c.sentCount || 0}/${c.totalCount} (${percent}%)</div>` : '';

    return `
      <div class="camp-row-card">
        <!-- COL 1: CHIẾN DỊCH -->
        <div>
          <div class="camp-title">${escapeHtml(c.name)}</div>
          ${c.description ? `<div class="camp-desc">${escapeHtml(c.description)}</div>` : ''}
          ${c.message ? `<div class="camp-quote-preview">💬 "${escapeHtml(c.message)}"</div>` : ''}
          ${mediaGalleryHtml}
        </div>

        <!-- COL 2: ĐỐI TƯỢNG -->
        <div>
          <div style="font-weight:700; font-size:0.8rem; color:#f1f5f9;">${targetLabel}</div>
          ${tagBadgesHtml}
        </div>

        <!-- COL 3: THỜI GIAN GỬI -->
        <div>
          <div style="font-size:0.8rem;">${scheduleHtml}</div>
          ${progressSummary}
        </div>

        <!-- COL 4: TRẠNG THÁI -->
        <div style="text-align: center;">
          ${toggleBtnHtml}
          ${isRunning ? '<div style="font-size:0.68rem; color:#38bdf8; margin-top:3px; font-weight:700;">⚡ Đang chạy</div>' : ''}
        </div>

        <!-- COL 5: THAO TÁC -->
        <div style="display: flex; justify-content: flex-end; gap: 6px;">
          ${isRunning ? 
            `<button class="camp-action-btn" style="color:var(--danger);" onclick="pauseCampaignNow('${c.id}')" title="Tạm dừng gửi">⏸️</button>` :
            `<button class="camp-action-btn run" onclick="runCampaignNow('${c.id}')" title="Chạy ngay">▶️ Chạy</button>`
          }
          <button class="camp-action-btn" onclick="openCampaignEditor('${c.id}')" title="Chỉnh sửa chiến dịch">✏️</button>
          <button class="camp-action-btn" onclick="viewCampaignLogs('${c.id}')" title="Xem nhật ký gửi">📜</button>
          <button class="camp-action-btn delete" onclick="deleteCampaignItem('${c.id}')" title="Xóa chiến dịch">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

function openCampaignEditor(id = null) {
  const titleEl = document.getElementById('camp-editor-title');
  const idInput = document.getElementById('camp-edit-id');
  const nameInput = document.getElementById('camp-edit-name');
  const descInput = document.getElementById('camp-edit-desc');
  const msgInput = document.getElementById('camp-edit-message');
  const startDateInput = document.getElementById('camp-start-date');
  const timeInput = document.getElementById('camp-schedule-time');
  const recurrenceSelect = document.getElementById('camp-recurrence');
  const keywordInput = document.getElementById('camp-target-keyword');
  const previewBox = document.getElementById('camp-spintax-preview-box');
  const templateSelect = document.getElementById('camp-template-select');

  if (previewBox) previewBox.style.display = 'none';

  // Populate Quick Messages Template Dropdown (/shortcut — Content...)
  if (templateSelect) {
    templateSelect.innerHTML = `
      <option value="">-- Chọn tin nhắn nhanh mẫu --</option>
      ${(state.quickMessages || []).map(q => {
        const sc = q.shortcut ? (q.shortcut.startsWith('/') ? q.shortcut : '/' + q.shortcut) : (q.title || '');
        const snippet = (q.content || '').replace(/\s+/g, ' ').trim().substring(0, 50);
        return `<option value="${q.id}">${escapeHtml(sc)} — ${escapeHtml(snippet)}...</option>`;
      }).join('')}
    `;
  }

  // Set default today's date
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const todayYMD = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  if (id) {
    const c = campaignsState.list.find(item => item.id === id);
    if (!c) return;
    if (titleEl) titleEl.innerText = '✏️ Chỉnh Sửa Chiến Dịch';
    if (idInput) idInput.value = c.id;
    if (nameInput) nameInput.value = c.name || '';
    if (descInput) descInput.value = c.description || '';
    if (msgInput) msgInput.value = c.message || '';
    if (keywordInput) keywordInput.value = c.targetKeyword || '';

    // Target type
    const targetTypeRadio = document.querySelector(`input[name="camp-target-type-radio"][value="${c.targetType || 'all'}"]`);
    if (targetTypeRadio) targetTypeRadio.checked = true;

    // Schedule mode
    const schedMode = c.scheduleMode || (c.scheduleType === 'daily' ? 'scheduled' : 'now');
    const modeRadio = document.querySelector(`input[name="camp-schedule-mode-radio"][value="${schedMode}"]`);
    if (modeRadio) modeRadio.checked = true;

    if (startDateInput) startDateInput.value = c.startDate || todayYMD;
    if (timeInput) timeInput.value = c.scheduleTime || '08:30';
    if (recurrenceSelect) recurrenceSelect.value = c.recurrence || (c.scheduleType === 'daily' ? 'daily' : 'once');

    campaignsState.selectedTagIds = Array.isArray(c.targetTagIds) ? [...c.targetTagIds] : [];
    campaignsState.editingAttachments = Array.isArray(c.mediaUrls) ? [...c.mediaUrls] : [];

    // Advanced fields
    if (document.getElementById('camp-delay-min')) document.getElementById('camp-delay-min').value = c.delayMinMs || 10000;
    if (document.getElementById('camp-delay-max')) document.getElementById('camp-delay-max').value = c.delayMaxMs || 25000;
    if (document.getElementById('camp-batch-size')) document.getElementById('camp-batch-size').value = c.batchSize || 25;
    if (document.getElementById('camp-batch-pause')) document.getElementById('camp-batch-pause').value = c.batchPauseMs || 180000;
  } else {
    if (titleEl) titleEl.innerText = '➕ Tạo Chiến Dịch Mới';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (msgInput) msgInput.value = '{Chào|Xin chào|Hello} {name} nhé, {chúc bạn|chúc anh/chị} {ngày mới tốt lành|tuần mới nhiều may mắn}!';
    if (keywordInput) keywordInput.value = '';

    const targetTypeRadio = document.querySelector('input[name="camp-target-type-radio"][value="all"]');
    if (targetTypeRadio) targetTypeRadio.checked = true;

    const modeRadio = document.querySelector('input[name="camp-schedule-mode-radio"][value="scheduled"]');
    if (modeRadio) modeRadio.checked = true;

    if (startDateInput) startDateInput.value = todayYMD;
    if (timeInput) timeInput.value = '08:30';
    if (recurrenceSelect) recurrenceSelect.value = 'once';

    campaignsState.selectedTagIds = [];
    campaignsState.editingAttachments = [];
  }

  renderCampTagPills();
  toggleCampScheduleModeUI();
  renderCampAttachmentChips();
  openModal('modal-campaign-editor');
}

function closeCampaignEditor() {
  closeModal('modal-campaign-editor');
}

async function saveCampaign() {
  const id = document.getElementById('camp-edit-id')?.value;
  const name = document.getElementById('camp-edit-name')?.value.trim();
  const description = document.getElementById('camp-edit-desc')?.value.trim();
  const message = document.getElementById('camp-edit-message')?.value.trim();
  const targetType = document.querySelector('input[name="camp-target-type-radio"]:checked')?.value || 'all';
  const targetKeyword = document.getElementById('camp-target-keyword')?.value.trim() || '';
  
  const scheduleMode = document.querySelector('input[name="camp-schedule-mode-radio"]:checked')?.value || 'scheduled';
  const startDate = document.getElementById('camp-start-date')?.value || '';
  const scheduleTime = document.getElementById('camp-schedule-time')?.value || '08:30';
  const recurrence = document.getElementById('camp-recurrence')?.value || 'once';

  const targetTagIds = campaignsState.selectedTagIds || [];

  const delayMinMs = Number(document.getElementById('camp-delay-min')?.value) || 10000;
  const delayMaxMs = Number(document.getElementById('camp-delay-max')?.value) || 25000;
  const batchSize = Number(document.getElementById('camp-batch-size')?.value) || 25;
  const batchPauseMs = Number(document.getElementById('camp-batch-pause')?.value) || 180000;

  if (!name) return alert('Vui lòng nhập tên chiến dịch!');
  if (!message && campaignsState.editingAttachments.length === 0) {
    return alert('Vui lòng nhập nội dung tin nhắn hoặc đính kèm ít nhất 1 tệp tin!');
  }

  const payload = {
    name,
    description,
    message,
    mediaUrls: campaignsState.editingAttachments,
    targetType,
    targetTagIds,
    targetKeyword,
    scheduleMode,
    startDate,
    scheduleTime,
    recurrence,
    scheduleType: scheduleMode === 'scheduled' ? (recurrence === 'daily' ? 'daily' : 'manual') : 'now',
    delayMinMs,
    delayMaxMs,
    batchSize,
    batchPauseMs
  };

  try {
    const url = id ? `/api/campaigns/${id}` : '/api/campaigns';
    const method = id ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!res.ok || result.error) {
      return alert(result.error || 'Lỗi lưu chiến dịch');
    }

    alert('✅ Đã lưu chiến dịch thành công!');
    closeCampaignEditor();
    await loadCampaigns();
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

async function toggleCampaignStatus(id) {
  try {
    const res = await fetch(`/api/campaigns/${id}/toggle`, {
      method: 'POST',
      headers: getHeaders()
    });
    const result = await res.json();
    if (!res.ok) return alert(result.error || 'Lỗi toggle');
    await loadCampaigns();
  } catch (err) {
    alert(err.message);
  }
}

async function runCampaignNow(id) {
  if (!confirm('Bạn có chắc chắn muốn bắt đầu gửi chiến dịch này ngay bây giờ?')) return;
  try {
    const res = await fetch(`/api/campaigns/${id}/start`, {
      method: 'POST',
      headers: getHeaders()
    });
    const result = await res.json();
    if (!res.ok) return alert(result.error || 'Lỗi khởi chạy');
    alert('🚀 Chiến dịch đã được kích hoạt chạy ngầm an toàn!');
    await loadCampaigns();
  } catch (err) {
    alert(err.message);
  }
}

async function pauseCampaignNow(id) {
  try {
    const res = await fetch(`/api/campaigns/${id}/pause`, {
      method: 'POST',
      headers: getHeaders()
    });
    const result = await res.json();
    if (!res.ok) return alert(result.error || 'Lỗi tạm dừng');
    await loadCampaigns();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteCampaignItem(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa chiến dịch này cùng toàn bộ lịch sử gửi?')) return;
  try {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    const result = await res.json();
    if (!res.ok) return alert(result.error || 'Lỗi xóa chiến dịch');
    await loadCampaigns();
  } catch (err) {
    alert(err.message);
  }
}

async function viewCampaignLogs(id) {
  const c = campaignsState.list.find(item => item.id === id);
  const subtitleEl = document.getElementById('camp-logs-subtitle');
  const summaryEl = document.getElementById('camp-logs-summary-bar');
  const container = document.getElementById('camp-logs-table-container');

  if (subtitleEl) subtitleEl.innerText = c ? `Chiến dịch: ${c.name}` : '';
  if (container) container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:20px;">Đang tải nhật ký...</div>`;

  openModal('modal-campaign-logs');

  try {
    const res = await fetch(`/api/campaigns/${id}/logs`, { headers: getHeaders() });
    const result = await res.json();
    const logs = result.data || [];

    const successCount = logs.filter(l => l.status === 'success').length;
    const failedCount = logs.filter(l => l.status === 'failed').length;

    if (summaryEl) {
      summaryEl.innerHTML = `
        <span>Tổng lượt gửi: <strong>${logs.length}</strong></span>
        <span style="color:#34d399;">Thành công: <strong>${successCount}</strong></span>
        <span style="color:#f87171;">Thất bại: <strong>${failedCount}</strong></span>
      `;
    }

    if (logs.length === 0) {
      container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:30px;">Chưa có nhật ký gửi tin nào cho chiến dịch này.</div>`;
      return;
    }

    container.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.76rem;">
        <thead>
          <tr style="border-bottom:1px solid var(--border); color:#94a3b8; text-align:left;">
            <th style="padding:6px 8px;">Thời gian</th>
            <th style="padding:6px 8px;">Người nhận</th>
            <th style="padding:6px 8px;">Nội dung gửi</th>
            <th style="padding:6px 8px; text-align:center;">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
              <td style="padding:6px 8px; color:var(--text-muted); white-space:nowrap;">${formatTime(l.sentAt)}</td>
              <td style="padding:6px 8px; font-weight:600; color:#fff;">${escapeHtml(l.customerName || l.threadId)}</td>
              <td style="padding:6px 8px; color:#cbd5e1; max-width:240px; word-break:break-all;">${escapeHtml(l.sentContent)}</td>
              <td style="padding:6px 8px; text-align:center;">
                <span style="padding:2px 6px; border-radius:4px; font-weight:700; background:${l.status === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color:${l.status === 'success' ? '#34d399' : '#f87171'};">
                  ${l.status === 'success' ? 'Thành công' : 'Lỗi'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    if (container) container.innerHTML = `<div style="color:var(--danger); padding:15px;">Lỗi tải logs: ${err.message}</div>`;
  }
}

function closeCampaignLogs() {
  closeModal('modal-campaign-logs');
}

// -----------------------------------------------------------------------------
// Conversation & Chat Stream (Module 1)
// -----------------------------------------------------------------------------
async function loadConversations() {
  try {
    const url = `/api/conversations?filter=${encodeURIComponent(state.currentFilter)}&search=${encodeURIComponent(state.searchQuery)}&tagId=${encodeURIComponent(state.currentTagId)}`;
    const res = await fetch(url, { headers: getHeaders() });
    if (res.status === 401) {
      promptAuthToken();
      return;
    }
    const result = await res.json();
    state.conversations = result.data || [];
    renderConversations();
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

function promptAuthToken() {
  const token = prompt('Vui lòng nhập ADMIN_API_TOKEN để truy cập:');
  if (token) {
    state.adminToken = token;
    localStorage.setItem('zalo_admin_token', token);
    window.location.reload();
  }
}

function renderConversations() {
  convListEl.innerHTML = '';

  if (state.conversations.length === 0) {
    convListEl.innerHTML = `
      <div style="padding: 30px 20px; text-align: center; color: var(--text-dim); font-size: 0.85rem;">
        Không tìm thấy hội thoại nào.
      </div>
    `;
    return;
  }

  state.conversations.forEach(conv => {
    const card = document.createElement('div');
    card.className = `conv-card ${state.activeThreadId === conv.id ? 'active' : ''}`;
    card.onclick = () => selectConversation(conv.id);

    const initials = (conv.name || conv.id).substring(0, 2).toUpperCase();
    const timeFormatted = formatTime(conv.lastTime || conv.updatedAt);

    card.innerHTML = `
      <div class="conv-avatar-box">
        ${conv.avatar ? 
          `<img class="conv-avatar" src="${conv.avatar}" alt="${escapeHtml(conv.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'conv-avatar\\'>${initials}</div>'">` : 
          `<div class="conv-avatar">${initials}</div>`
        }
        ${conv.isGroup ? `<div class="group-badge-icon">👥</div>` : ''}
      </div>
      <div class="conv-details">
        <div class="conv-header-row">
          <span class="conv-name">${escapeHtml(conv.name || conv.id)}</span>
          <span class="conv-time">${timeFormatted}</span>
        </div>
        <div class="conv-preview-row">
          <span class="conv-last-msg">${escapeHtml(conv.lastMessage || 'Chưa có tin nhắn')}</span>
          ${conv.unreadCount > 0 ? `<span class="unread-pill">${conv.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    convListEl.appendChild(card);
  });
}

async function selectConversation(threadId) {
  state.activeThreadId = threadId;
  const conv = state.conversations.find(c => c.id === threadId) || { id: threadId, name: threadId };
  state.activeThread = conv;

  renderConversations();

  emptyStateEl.style.display = 'none';
  chatContentEl.style.display = 'flex';
  
  if (window.innerWidth <= 768) {
    appLayoutEl.classList.add('in-chat');
    backBtnEl.style.display = 'block';
  }

  activeNameEl.innerText = conv.name || conv.id;
  renderActiveChatTags();
  updateAiToggleButton(conv);
  
  if (conv.avatar) {
    activeAvatarEl.outerHTML = `<img class="conv-avatar" id="active-chat-avatar" src="${conv.avatar}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=\\'conv-avatar\\' id=\\'active-chat-avatar\\'>${(conv.name || conv.id).substring(0, 2).toUpperCase()}</div>'">`;
  } else {
    activeAvatarEl.outerHTML = `<div class="conv-avatar" id="active-chat-avatar">${(conv.name || conv.id).substring(0, 2).toUpperCase()}</div>`;
  }

  // Mark read
  if (conv.unreadCount > 0) {
    conv.unreadCount = 0;
    renderConversations();
    fetch(`/api/conversations/${threadId}/read`, { method: 'POST', headers: getHeaders() }).catch(() => {});
  }

  await loadMessages(threadId);
}

function closeChatMobile() {
  appLayoutEl.classList.remove('in-chat');
  state.activeThreadId = null;
  renderConversations();
}

async function loadMessages(threadId) {
  try {
    messagesStreamEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--text-dim);">
        Đang tải lịch sử tin nhắn...
      </div>
    `;

    const res = await fetch(`/api/conversations/${threadId}/messages?limit=50`, { headers: getHeaders() });
    const result = await res.json();
    state.messages = result.data || [];
    renderMessages(state.messages);

    if (state.messages.length < 5 && state.activeThread?.isGroup) {
      triggerSilentSync(threadId);
    }
  } catch (err) {
    messagesStreamEl.innerHTML = `
      <div style="padding: 20px; text-align: center; color: var(--danger);">
        Không thể tải tin nhắn.
      </div>
    `;
  }
}

async function syncCurrentThread() {
  if (!state.activeThreadId) return;
  const btn = document.getElementById('thread-sync-btn');
  if (btn) btn.innerText = '⏳ Đang kéo...';

  try {
    const isGroup = Boolean(state.activeThread?.isGroup);
    const res = await fetch(`/api/conversations/${state.activeThreadId}/sync?isGroup=${isGroup}`, {
      method: 'POST',
      headers: getHeaders()
    });
    const data = await res.json();

    if (data.cached) {
      btn.innerText = '✅ Đã mới nhất';
    } else if (data.pending) {
      btn.innerText = '⏳ Đang đồng bộ...';
    } else {
      btn.innerText = `✅ Đã kéo ${data.synced || 0} tin`;
      await loadMessages(state.activeThreadId);
    }
  } catch (err) {
    btn.innerText = '⚠️ Lỗi';
  } finally {
    setTimeout(() => {
      if (btn) btn.innerText = '📥 Kéo Lịch Sử';
    }, 2500);
  }
}

async function triggerSilentSync(threadId) {
  try {
    const isGroup = Boolean(state.activeThread?.isGroup);
    await fetch(`/api/conversations/${threadId}/sync?isGroup=${isGroup}`, {
      method: 'POST',
      headers: getHeaders()
    });
    const res = await fetch(`/api/conversations/${threadId}/messages?limit=50`, { headers: getHeaders() });
    const result = await res.json();
    if (result.data && result.data.length > state.messages.length) {
      state.messages = result.data;
      renderMessages(state.messages);
    }
  } catch {}
}

function renderMessages(messages) {
  messagesStreamEl.innerHTML = '';

  if (messages.length === 0) {
    messagesStreamEl.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: var(--text-dim); font-size: 0.9rem;">
        Chưa có tin nhắn nào trong cuộc trò chuyện này. Hãy gửi tin nhắn đầu tiên hoặc bấm [📥 Kéo Lịch Sử]!
      </div>
    `;
    return;
  }

  let lastDateStr = '';

  messages.forEach(msg => {
    const msgDateStr = getDateSeparatorLabel(msg.timestamp);
    if (msgDateStr && msgDateStr !== lastDateStr) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.innerHTML = `<span>${escapeHtml(msgDateStr)}</span>`;
      messagesStreamEl.appendChild(divider);
      lastDateStr = msgDateStr;
    }

    appendMessageElement(msg, false);
  });

  scrollToBottom();
}

let currentQuote = null; // { msgId, senderName, text }
let forwardTargetMsg = null; // { msgId, text }

function isDocFileName(str) {
  if (!str || typeof str !== 'string') return false;
  return /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz|txt|csv|json|xml|mp3|mp4|apk)(\?.*)?$/i.test(str.trim());
}

function appendMessageElement(msg, autoScroll = true) {
  const isOutbound = Boolean(msg.isSelf || msg.isBot);
  const timeFormatted = formatTime(msg.timestamp);
  
  let senderLabel = msg.senderName || 'Khách hàng';
  if (msg.isBot) senderLabel = 'Bot AI';
  else if (msg.isSelf) senderLabel = 'Admin (Bạn)';

  const bubbleWrap = document.createElement('div');
  bubbleWrap.className = `message-bubble-wrap ${isOutbound ? 'outbound' : 'inbound'} ${msg.isBot ? 'bot' : ''}`;
  bubbleWrap.id = `msg-${msg.id}`;

  const isRecalled = Boolean(msg.isRecalled === 1 || msg.isRecalled === true);
  let contentHtml = '';

  if (isRecalled) {
    contentHtml = '<div>[Tin nhắn đã được thu hồi]</div>';
  } else if (msg.mediaType === 'call') {
    contentHtml = '<div class="call-bubble"><span>📞</span><span>Cuộc gọi thoại (Zalo Call)</span></div>';
  } else if (msg.mediaType === 'image') {
    const authParam = state.adminToken ? `?token=${encodeURIComponent(state.adminToken)}` : '';
    const imgUrl = msg.mediaUrl ? (msg.mediaUrl.startsWith('http') ? msg.mediaUrl : msg.mediaUrl + authParam) : '';
    if (imgUrl) {
      contentHtml = `
        <img src="${escapeHtml(imgUrl)}" class="media-img" loading="lazy" decoding="async" referrerpolicy="no-referrer" onclick="openImagePreview('${escapeHtml(imgUrl)}')" onerror="this.outerHTML='<div class=\\'media-file-chip\\'><span>🖼️</span><span>[Ảnh Zalo]</span></div>'" />
        ${(msg.text && msg.text !== '[Đính kèm]' && msg.text !== '[Hình ảnh]') ? `<div class="media-caption">${escapeHtml(msg.text)}</div>` : ''}
      `;
    } else {
      contentHtml = `
        <div class="media-file-chip" style="display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.25); padding:6px 12px; border-radius:8px;">
          <span style="font-size:1.3rem;">🖼️</span>
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:600; font-size:0.85rem;">${escapeHtml(msg.text && msg.text !== '[Đính kèm]' ? msg.text : 'Hình ảnh đính kèm')}</span>
            <span style="font-size:0.7rem; color:var(--text-muted);">Đã gửi qua Zalo</span>
          </div>
        </div>
      `;
    }
  } else if (msg.mediaType === 'file' || isDocFileName(msg.text)) {
    let rawFileUrl = msg.mediaUrl || '';
    if (!rawFileUrl && msg.text) {
      const cleanName = msg.text.trim();
      if (cleanName.startsWith('chat_')) {
        rawFileUrl = `/api/chat-media/${cleanName}`;
      } else if (cleanName.startsWith('qm_')) {
        rawFileUrl = `/api/quick-messages/media/${cleanName}`;
      }
    }
    const authParam = state.adminToken ? `?token=${encodeURIComponent(state.adminToken)}` : '';
    const fileUrl = rawFileUrl ? (rawFileUrl.startsWith('http') ? rawFileUrl : rawFileUrl + authParam) : '';
    contentHtml = `
      <div class="media-file-chip" style="display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:8px; border:1px solid rgba(56,189,248,0.25);">
        <span style="font-size:1.4rem;">📎</span>
        <div style="display:flex; flex-direction:column; flex:1; min-width:0;">
          <span style="font-weight:600; font-size:0.85rem; word-break:break-all; color:#f1f5f9;">${escapeHtml(msg.text && msg.text !== '[Đính kèm]' ? msg.text : 'Tập tin đính kèm')}</span>
          ${fileUrl ? `<a href="${escapeHtml(fileUrl)}" target="_blank" download="${escapeHtml(msg.text || 'tai_lieu')}" style="color:#38bdf8; font-size:0.75rem; text-decoration:none; margin-top:3px; font-weight:600; display:inline-flex; align-items:center; gap:4px;">⬇️ Tải xuống tệp</a>` : '<span style="font-size:0.7rem; color:var(--text-muted);">Tài liệu Zalo (Đã lưu trên máy/Zalo)</span>'}
        </div>
      </div>
    `;
  } else if (msg.mediaType === 'sticker' && msg.mediaUrl) {
    contentHtml = `<img src="${escapeHtml(msg.mediaUrl)}" class="sticker-img" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.outerHTML='<div>[Sticker]</div>'" />`;
  } else if (msg.quoteText) {
    contentHtml = `
      <div class="quote-block">
        <span class="quote-sender">${escapeHtml(msg.quoteSender || 'Người gửi')}</span>
        <span class="quote-text">${escapeHtml(msg.quoteText || '')}</span>
      </div>
      <div>${formatChatBubbleText(msg.text)}</div>
    `;
  } else {
    contentHtml = `<div>${formatChatBubbleText(msg.text)}</div>`;
  }

  const rawTextForAttr = encodeURIComponent(msg.text || '');
  const senderForAttr = encodeURIComponent(senderLabel);

  const msgAge = Date.now() - new Date(msg.timestamp).getTime();
  const canUndo = Boolean(msg.isSelf && !msg.isBot && !isRecalled && msgAge < 2 * 60 * 1000);

  const hoverActionsHtml = isRecalled ? '' : `
    <div class="msg-hover-actions">
      <button class="reaction-btn" onclick="reactToMessage('${msg.id}', '❤️')" title="Thả tim">❤️</button>
      <button class="reaction-btn" onclick="reactToMessage('${msg.id}', '👍')" title="Thích">👍</button>
      <button class="reaction-btn" onclick="reactToMessage('${msg.id}', '😂')" title="Cười">😂</button>
      <button class="reaction-btn" onclick="reactToMessage('${msg.id}', '😮')" title="Ngạc nhiên">😮</button>
      <button class="reaction-btn" onclick="reactToMessage('${msg.id}', '😭')" title="Buồn">😭</button>
      <button class="reaction-btn" onclick="reactToMessage('${msg.id}', '😡')" title="Phẫn nộ">😡</button>
      <button class="action-text-btn" onclick="startQuoteMessage('${msg.id}', decodeURIComponent('${senderForAttr}'), decodeURIComponent('${rawTextForAttr}'))" title="Trả lời trích dẫn">
        <span>↩️</span><span>Trả lời</span>
      </button>
      <button class="action-text-btn" onclick="openForwardModal('${msg.id}', decodeURIComponent('${rawTextForAttr}'))" title="Chuyển tiếp tin nhắn">
        <span>↪️</span><span>Chuyển tiếp</span>
      </button>
      ${canUndo ? `
        <button class="action-text-btn" onclick="undoMessage('${msg.id}')" title="Thu hồi tin nhắn (trong 2 phút)" style="color: #f87171;">
          <span>🗑️</span><span>Thu hồi</span>
        </button>
      ` : ''}
    </div>
  `;

  const reactionBadgeHtml = (!isRecalled && msg.reactions)
    ? `<div class="message-reaction-badge" title="Cảm xúc">${escapeHtml(msg.reactions)}</div>` 
    : '';

  const statusTickHtml = (msg.isSelf && !isRecalled)
    ? `<span class="msg-status-tick ${msg.status === 'delivered' ? 'delivered' : 'sent'}" id="status-tick-${msg.id}" title="${msg.status === 'delivered' ? 'Đã nhận' : 'Đã gửi'}">${msg.status === 'delivered' ? '✓✓' : '✓'}</span>`
    : '';

  bubbleWrap.innerHTML = `
    ${hoverActionsHtml}
    <div class="bubble-meta">
      <span>${escapeHtml(senderLabel)}</span>
      ${msg.isBot ? `<span style="color:#38bdf8; font-weight:700; background:rgba(56,189,248,0.15); padding:1px 6px; border-radius:6px; font-size:0.68rem;">⚡ AI Bot</span>` : ''}
      <span>•</span>
      <span>${timeFormatted}</span>
      ${statusTickHtml}
    </div>
    <div class="bubble-content ${isRecalled ? 'recalled' : ''}">
      ${contentHtml}
      ${reactionBadgeHtml}
    </div>
  `;

  messagesStreamEl.appendChild(bubbleWrap);
  if (autoScroll) scrollToBottom();
}

// -----------------------------------------------------------------------------
// Reaction & Quote Reply & Undo Handlers
// -----------------------------------------------------------------------------
let toastTimeout = null;
function showToast(text, type = 'info') {
  let toast = document.getElementById('floating-toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'floating-toast-notification';
    toast.className = 'floating-toast';
    document.body.appendChild(toast);
  }
  toast.innerText = text;
  if (type === 'error') {
    toast.style.color = '#f87171';
    toast.style.borderColor = 'rgba(248, 113, 113, 0.4)';
  } else {
    toast.style.color = '#38bdf8';
    toast.style.borderColor = 'rgba(56, 189, 248, 0.4)';
  }
  toast.classList.add('active');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('active');
  }, 2200);
}

function updateMessageReactionDOM(msgId, emoji) {
  const bubbleWrap = document.getElementById(`msg-${msgId}`);
  if (!bubbleWrap) return;
  const contentEl = bubbleWrap.querySelector('.bubble-content');
  if (!contentEl || contentEl.classList.contains('recalled')) return;
  
  let badge = contentEl.querySelector('.message-reaction-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'message-reaction-badge';
    badge.title = 'Cảm xúc';
    contentEl.appendChild(badge);
  }
  badge.innerText = emoji;
}

function updateMessageRecalledDOM(msgId) {
  const bubbleWrap = document.getElementById(`msg-${msgId}`);
  if (!bubbleWrap) return;

  const hoverActions = bubbleWrap.querySelector('.msg-hover-actions');
  if (hoverActions) hoverActions.remove();

  const tick = bubbleWrap.querySelector('.msg-status-tick');
  if (tick) tick.remove();

  const contentEl = bubbleWrap.querySelector('.bubble-content');
  if (contentEl) {
    contentEl.className = 'bubble-content recalled';
    contentEl.innerHTML = '<div>[Tin nhắn đã được thu hồi]</div>';
  }

  const badge = bubbleWrap.querySelector('.message-reaction-badge');
  if (badge) badge.remove();
}

async function undoMessage(msgId) {
  if (!state.activeThreadId) return;
  if (!confirm('Bạn có chắc chắn muốn thu hồi tin nhắn này trên cả 2 phía không?')) return;

  try {
    const isGroup = Boolean(state.activeThread?.isGroup);
    const res = await fetch(`/api/conversations/${state.activeThreadId}/messages/${msgId}/undo`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ isGroup })
    });
    const data = await res.json();
    if (!res.ok) {
      return showToast(data.error || 'Không thể thu hồi tin nhắn!', 'error');
    }
    updateMessageRecalledDOM(msgId);
    showToast('🗑️ Đã thu hồi tin nhắn thành công');
  } catch (err) {
    showToast('Lỗi thu hồi: ' + err.message, 'error');
  }
}

async function reactToMessage(msgId, emoji) {
  if (!state.activeThreadId) return;

  // Optimistic UI update
  updateMessageReactionDOM(msgId, emoji);
  showToast(`✨ Đã thả ${emoji}`);

  try {
    const isGroup = Boolean(state.activeThread?.isGroup);
    const res = await fetch(`/api/conversations/${state.activeThreadId}/react`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ msgId, emoji, isGroup })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Không thể thả cảm xúc!', 'error');
    }
  } catch (err) {
    showToast('Lỗi reaction: ' + err.message, 'error');
  }
}

function startQuoteMessage(msgId, senderName, text) {
  currentQuote = { msgId, senderName, text };
  const bar = document.getElementById('quote-preview-bar');
  const senderEl = document.getElementById('quote-preview-sender');
  const textEl = document.getElementById('quote-preview-text');

  if (bar && senderEl && textEl) {
    senderEl.innerText = `Trả lời: ${senderName}`;
    textEl.innerText = text || '[Nội dung]';
    bar.classList.add('active');
  }
  chatInputEl.focus();
}

function cancelQuote() {
  currentQuote = null;
  const bar = document.getElementById('quote-preview-bar');
  if (bar) bar.classList.remove('active');
}

// -----------------------------------------------------------------------------
// Quick Like & Send Message
// -----------------------------------------------------------------------------
async function sendQuickLike() {
  if (!state.activeThreadId) return;
  try {
    await fetch('/api/send-message', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        recipientId: state.activeThreadId,
        message: '👍',
        isGroup: Boolean(state.activeThread?.isGroup)
      })
    });
  } catch (err) {
    alert('Lỗi gửi like: ' + err.message);
  }
}

async function sendMessage() {
  const text = chatInputEl.value.trim();
  if (!text || !state.activeThreadId) return;

  const quoteToUse = currentQuote ? { ...currentQuote } : null;
  cancelQuote();

  // Capture pending quick message attachments and clear preview bar immediately
  const pendingAtts = state.pendingQuickAttachments ? [...state.pendingQuickAttachments] : null;
  state.pendingQuickAttachments = null;
  cancelAttachment();

  chatInputEl.value = '';
  sendBtnEl.disabled = true;

  // 1. Optimistic UI insertion for instant feedback
  const tempId = 'temp_' + Date.now();
  const optimisticMsg = {
    id: tempId,
    threadId: state.activeThreadId,
    senderId: 'self',
    senderName: 'Admin (Bạn)',
    text,
    mediaType: 'text',
    quoteText: quoteToUse ? quoteToUse.text : '',
    quoteSender: quoteToUse ? quoteToUse.senderName : '',
    isGroup: Boolean(state.activeThread?.isGroup),
    isSelf: true,
    isBot: false,
    status: 'sent',
    isRecalled: false,
    timestamp: new Date().toISOString()
  };

  appendMessageElement(optimisticMsg, true);
  state.messages.push(optimisticMsg);

  // Update conversation card preview immediately
  let conv = state.conversations.find(c => c.id === state.activeThreadId);
  if (conv) {
    conv.lastMessage = text;
    conv.lastTime = optimisticMsg.timestamp;
    state.conversations = [conv, ...state.conversations.filter(c => c.id !== state.activeThreadId)];
    renderConversations();
  }

  try {
    let res;
    if (quoteToUse) {
      // Send Quote Reply
      res = await fetch(`/api/conversations/${state.activeThreadId}/reply-quote`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          text,
          quoteData: {
            content: quoteToUse.text,
            text: quoteToUse.text,
            senderName: quoteToUse.senderName,
            msgId: quoteToUse.msgId
          },
          isGroup: Boolean(state.activeThread?.isGroup)
        })
      });
    } else {
      // Send Normal Message
      res = await fetch('/api/send-message', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          recipientId: state.activeThreadId,
          message: text,
          isGroup: Boolean(state.activeThread?.isGroup)
        })
      });
    }

    const data = await res.json();
    if (!res.ok || data.error) {
      const failedBubble = document.getElementById(`msg-${tempId}`);
      if (failedBubble) failedBubble.style.opacity = '0.5';
      alert('Lỗi gửi tin: ' + (data.error || 'Vui lòng kiểm tra lại kết nối Zalo.'));
      return;
    }

    // 2. Dispatch Pending Quick Message Attachments (Up to 5)
    if (pendingAtts && pendingAtts.length > 0 && state.activeThreadId) {
      setTimeout(async () => {
        try {
          const sendRes = await fetch(`/api/conversations/${state.activeThreadId}/upload-media`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              mediaUrls: pendingAtts,
              isGroup: Boolean(state.activeThread?.isGroup)
            })
          });
          const sendData = await sendRes.json();
          if (!sendRes.ok || sendData.error) {
            alert(`⚠️ Tin nhắn văn bản đã gửi thành công, nhưng tệp đính kèm gửi thất bại: ${sendData.error || 'Lỗi gửi tệp'}`);
          }
        } catch (mediaErr) {
          alert(`⚠️ Tin nhắn văn bản đã gửi thành công, nhưng không thể gửi tệp đính kèm: ${mediaErr.message}`);
        }
      }, 500);
    }
  } catch (err) {
    const failedBubble = document.getElementById(`msg-${tempId}`);
    if (failedBubble) failedBubble.style.opacity = '0.5';
    alert('Không thể gửi tin nhắn: ' + err.message);
  } finally {
    sendBtnEl.disabled = false;
    chatInputEl.focus();
  }
}

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Attachment & File Upload Handling (With Smart Canvas Compression)
// -----------------------------------------------------------------------------

/**
 * Tự động nén ảnh thông minh trên trình duyệt bằng HTML5 Canvas (Client-Side Smart Compression)
 * - Tự động tối ưu độ phân giải về chuẩn Zalo HD (max dimension 2560px, quality 0.90)
 * - Giảm dung lượng từ 15-50MB xuống còn ~1-2MB trong < 0.2 giây mà vẫn nét căng
 */
async function compressImageFile(file, { maxWidth = 2560, maxHeight = 2560, quality = 0.90, thresholdSize = 2 * 1024 * 1024 } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return file;
  }

  // Bỏ qua ảnh động GIF để giữ animation
  if (file.type === 'image/gif') {
    return file;
  }

  // Nếu file đã nhỏ hơn 2MB thì giữ nguyên
  if (file.size <= thresholdSize) {
    return file;
  }

  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            let width = img.width;
            let height = img.height;

            if (width > maxWidth || height > maxHeight) {
              if (width / height > maxWidth / maxHeight) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              } else {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const outputFormat = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
            canvas.toBlob((blob) => {
              if (blob && blob.size < file.size) {
                const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, outputFormat === 'image/png' ? '.png' : '.jpg'), {
                  type: outputFormat,
                  lastModified: Date.now()
                });
                console.log(`🖼️ [Smart Image Compression] ${(file.size / 1024 / 1024).toFixed(2)}MB ➔ ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB (${width}x${height})`);
                resolve(compressedFile);
              } else {
                resolve(file);
              }
            }, outputFormat, quality);
          } catch (err) {
            console.warn('[Image Compression Fallback]:', err);
            resolve(file);
          }
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    } catch {
      resolve(file);
    }
  });
}

async function handleFileInputChange(event, type) {
  const files = event.target.files;
  if (!files || files.length === 0 || !state.activeThreadId) return;

  for (const file of files) {
    await uploadAndSendAttachment(file);
  }
  event.target.value = '';
}

async function uploadAndSendAttachment(rawFile) {
  if (!state.activeThreadId || !rawFile) return;

  // 1. Tự động nén ảnh nếu là file ảnh chụp dung lượng cao
  let file = rawFile;
  if (rawFile.type && rawFile.type.startsWith('image/')) {
    file = await compressImageFile(rawFile);
  }

  // 2. Kiểm tra trần dung lượng 25MB (Chuẩn Zalo)
  if (file.size > 25 * 1024 * 1024) {
    return alert('Tệp tin vượt quá dung lượng cho phép của Zalo (tối đa 25MB)!');
  }

  const bar = document.getElementById('attachment-preview-bar');
  const infoEl = document.getElementById('attachment-preview-info');
  const imgEl = document.getElementById('attachment-preview-img');

  if (bar && infoEl) {
    infoEl.innerText = `⏳ Đang tải lên và gửi: ${file.name || 'hình ảnh'}...`;
    if (file.type && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      if (imgEl) {
        imgEl.src = url;
        imgEl.style.display = 'block';
      }
    } else if (imgEl) {
      imgEl.style.display = 'none';
    }
    bar.classList.add('active');
  }

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('isGroup', Boolean(state.activeThread?.isGroup));

    const res = await fetch(`/api/conversations/${state.activeThreadId}/upload-media`, {
      method: 'POST',
      headers: state.adminToken ? { 'x-admin-token': state.adminToken } : {},
      body: formData
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      alert('Lỗi gửi tệp: ' + (data.error || 'Không thể gửi tệp tin này.'));
    }
  } catch (err) {
    alert('Lỗi upload: ' + err.message);
  } finally {
    cancelAttachment();
  }
}

function cancelAttachment() {
  const bar = document.getElementById('attachment-preview-bar');
  if (bar) bar.classList.remove('active');
}

// Global Clipboard Paste (Ctrl + V)
window.addEventListener('paste', async (e) => {
  if (!state.activeThreadId) return;
  const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const blob = item.getAsFile();
      if (blob) {
        e.preventDefault();
        await uploadAndSendAttachment(blob);
        break;
      }
    }
  }
});

// -----------------------------------------------------------------------------
// Customer Info CRM Drawer
// -----------------------------------------------------------------------------
function toggleCustomerInfoPanel() {
  const drawer = document.getElementById('customer-info-pane');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!drawer) return;

  if (drawer.classList.contains('active')) {
    closeCustomerInfoDrawer();
  } else {
    drawer.classList.add('active');
    if (backdrop) backdrop.classList.add('active');
    loadCustomerCrmInfo();
  }
}

function closeCustomerInfoDrawer() {
  const drawer = document.getElementById('customer-info-pane');
  const backdrop = document.getElementById('drawer-backdrop');
  if (drawer) drawer.classList.remove('active');
  if (backdrop) backdrop.classList.remove('active');
}

async function loadCustomerCrmInfo() {
  if (!state.activeThreadId) return;
  const uidInput = document.getElementById('crm-uid-input');
  const phoneInput = document.getElementById('crm-phone-input');
  const emailInput = document.getElementById('crm-email-input');
  const addrInput = document.getElementById('crm-address-input');
  const needsInput = document.getElementById('crm-needs-input');
  const notesInput = document.getElementById('crm-notes-input');

  if (uidInput) uidInput.value = state.activeThreadId;

  try {
    const res = await fetch(`/api/conversations/${state.activeThreadId}/crm`, { headers: getHeaders() });
    const result = await res.json();
    const data = result.data || {};

    if (phoneInput) phoneInput.value = data.phone || '';
    if (emailInput) emailInput.value = data.email || '';
    if (addrInput) addrInput.value = data.address || '';
    if (needsInput) needsInput.value = data.needs || '';
    if (notesInput) notesInput.value = data.notes || '';
  } catch (err) {
    console.warn('Could not load CRM info:', err);
  }
}

async function saveCurrentCrmInfo() {
  if (!state.activeThreadId) return;
  const phone = document.getElementById('crm-phone-input')?.value.trim();
  const email = document.getElementById('crm-email-input')?.value.trim();
  const address = document.getElementById('crm-address-input')?.value.trim();
  const needs = document.getElementById('crm-needs-input')?.value.trim();
  const notes = document.getElementById('crm-notes-input')?.value.trim();

  try {
    const res = await fetch(`/api/conversations/${state.activeThreadId}/crm`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ phone, email, address, needs, notes })
    });
    const data = await res.json();
    if (res.ok) {
      alert('✅ Đã lưu thông tin khách hàng thành công!');
    } else {
      alert('Lỗi lưu CRM: ' + (data.error || 'Vui lòng thử lại.'));
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

function copyUidToClipboard() {
  const uidInput = document.getElementById('crm-uid-input');
  if (!uidInput || !uidInput.value) return;
  navigator.clipboard.writeText(uidInput.value);
  alert('📋 Đã sao chép Zalo UID vào bộ nhớ tạm: ' + uidInput.value);
}

// -----------------------------------------------------------------------------
// Forward Message Modal
// -----------------------------------------------------------------------------
function openForwardModal(msgId, text) {
  forwardTargetMsg = { msgId, text };
  const previewEl = document.getElementById('forward-preview-text');
  const targetsListEl = document.getElementById('forward-targets-list');

  if (previewEl) previewEl.innerText = text || '[Nội dung]';

  if (targetsListEl) {
    const availableConvs = state.conversations.filter(c => c.id !== state.activeThreadId);
    if (availableConvs.length === 0) {
      targetsListEl.innerHTML = `<div style="color:var(--text-dim);font-size:0.8rem;padding:8px;">Chưa có cuộc trò chuyện nào khác để chuyển tiếp.</div>`;
    } else {
      targetsListEl.innerHTML = availableConvs.map(c => `
        <label style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;background:rgba(255,255,255,0.04);">
          <input type="checkbox" class="forward-target-checkbox" value="${c.id}" data-isgroup="${Boolean(c.isGroup)}">
          <span style="font-weight:700;font-size:0.85rem;color:#fff;">${escapeHtml(c.name || c.id)}</span>
          ${c.isGroup ? `<span style="font-size:0.7rem;color:var(--text-dim);">👥 Nhóm</span>` : ''}
        </label>
      `).join('');
    }
  }

  openModal('modal-forward-msg');
}

async function submitForwardMessage() {
  if (!forwardTargetMsg || !state.activeThreadId) return;

  const checkedBoxes = Array.from(document.querySelectorAll('.forward-target-checkbox:checked'));
  if (checkedBoxes.length === 0) {
    return alert('Vui lòng chọn ít nhất 1 người nhận!');
  }

  const targetThreadIds = checkedBoxes.map(cb => cb.value);
  const btn = document.getElementById('btn-submit-forward');
  if (btn) btn.innerText = '⏳ Đang chuyển tiếp...';

  try {
    const res = await fetch(`/api/conversations/${state.activeThreadId}/forward`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        msgPayload: { msg: forwardTargetMsg.text },
        targetThreadIds,
        isGroup: false
      })
    });

    const data = await res.json();
    if (res.ok) {
      closeModal('modal-forward-msg');
      alert(`✅ ${data.message || 'Đã chuyển tiếp tin nhắn thành công!'}`);
    } else {
      alert('Lỗi chuyển tiếp: ' + (data.error || 'Vui lòng kiểm tra lại.'));
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  } finally {
    if (btn) btn.innerText = '↪️ Gửi Chuyển Tiếp';
  }
}

function handleInputKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

let streamAbortController = null;

function setupSSE() {
  setupRealtimeStream();
}

function handleStreamEvent(eventType, rawData) {
  try {
    const data = JSON.parse(rawData);

    if (eventType === 'new_message') {
      const msg = data;
      if (state.activeThreadId && String(msg.threadId) === String(state.activeThreadId)) {
        const existingBubble = document.getElementById(`msg-${msg.id}`);
        if (!existingBubble) {
          // If this message was sent by self, check if we can update the optimistic bubble
          const tempMsg = state.messages.find(m => String(m.id).startsWith('temp_') && m.text === msg.text);
          if (tempMsg && msg.isSelf) {
            const tempEl = document.getElementById(`msg-${tempMsg.id}`);
            if (tempEl) {
              tempEl.id = `msg-${msg.id}`;
              const tick = tempEl.querySelector('.msg-status-tick');
              if (tick) tick.id = `status-tick-${msg.id}`;
            }
            tempMsg.id = msg.id;
            tempMsg.cliMsgId = msg.cliMsgId || '';
          } else {
            appendMessageElement(msg, true);
            state.messages.push(msg);
          }
        }
      }

      let conv = state.conversations.find(c => String(c.id) === String(msg.threadId));
      if (conv) {
        conv.lastMessage = msg.text || (msg.mediaType === 'image' ? '[Hình ảnh]' : '[Tin nhắn]');
        conv.lastTime = msg.timestamp;
        if (String(state.activeThreadId) !== String(msg.threadId) && !msg.isSelf && !msg.isBot) {
          conv.unreadCount = (conv.unreadCount || 0) + 1;
        }
        state.conversations = [conv, ...state.conversations.filter(c => String(c.id) !== String(msg.threadId))];
      } else {
        const newConv = {
          id: msg.threadId,
          name: msg.senderName || msg.threadId,
          isGroup: Boolean(msg.isGroup),
          lastMessage: msg.text || '[Tin nhắn]',
          lastTime: msg.timestamp,
          unreadCount: (String(state.activeThreadId) === String(msg.threadId)) ? 0 : 1
        };
        state.conversations.unshift(newConv);
      }
      renderConversations();
    } else if (eventType === 'message_reaction') {
      if (data.msgId && data.reaction) {
        updateMessageReactionDOM(data.msgId, data.reaction);
      }
    } else if (eventType === 'message_status') {
      if (data.msgIds && Array.isArray(data.msgIds)) {
        for (const id of data.msgIds) {
          const tick = document.getElementById(`status-tick-${id}`);
          if (tick) {
            tick.className = 'msg-status-tick delivered';
            tick.innerText = '✓✓';
            tick.title = 'Đã nhận';
          }
        }
      }
    } else if (eventType === 'message_recalled') {
      if (data.msgId) {
        updateMessageRecalledDOM(data.msgId);
      }
    } else if (eventType === 'sync_progress') {
      updateSyncProgressUI(data);
    } else if (eventType === 'sync_complete') {
      onSyncCompleted(data);
    } else if (eventType === 'zalo_profile') {
      renderZaloLoginModalState(data);
      updateZaloHeaderStatus(data);
    } else if (eventType === 'zalo_qr') {
      onZaloQrReceived(data);
    } else if (eventType === 'memory_restart') {
      showToast('🚨 ' + (data.message || 'Hệ thống đang tự khởi động lại êm ái để giải phóng bộ nhớ...'), 'warning');
      const ramText = document.getElementById('ram-usage-text');
      const ramPill = document.getElementById('ram-status-pill');
      if (ramText) ramText.innerText = `RAM: ${data.rssMb || 150}MB (Restarting...)`;
      if (ramPill) {
        ramPill.className = 'status-pill ram-pill critical';
      }
    }
  } catch (err) {
    console.error('Error handling stream event:', err);
  }
}

async function setupRealtimeStream() {
  if (streamAbortController) {
    try { streamAbortController.abort(); } catch (_) {}
  }
  streamAbortController = new AbortController();

  const sseUrl = '/api/events' + (state.adminToken ? `?token=${encodeURIComponent(state.adminToken)}` : '');

  try {
    const response = await fetch(sseUrl, {
      signal: streamAbortController.signal,
      headers: { 'Accept': 'text/event-stream' }
    });

    if (!response.ok) throw new Error('HTTP ' + response.status);

    reconnectBannerEl.style.display = 'none';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || ''; // keep last incomplete chunk

      for (const part of parts) {
        if (!part.trim() || part.startsWith(':')) continue; // skip comments / pings
        const lines = part.split('\n');
        let eventType = 'message';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);
          }
        }

        if (eventData) {
          handleStreamEvent(eventType, eventData);
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      reconnectBannerEl.style.display = 'block';
      setTimeout(setupRealtimeStream, 3000);
    }
  }
}

// -----------------------------------------------------------------------------
// Phone Lookup Modal Logic (Audit C1 Guardrail #7 Safe)
// -----------------------------------------------------------------------------
let currentLookupResult = null;

function openPhoneLookupModal() {
  const modal = document.getElementById('modal-phone-lookup');
  const input = document.getElementById('lookup-phone-input');
  const resCard = document.getElementById('phone-lookup-result');
  const errBox = document.getElementById('phone-lookup-error');
  const loading = document.getElementById('phone-lookup-loading');

  if (modal) modal.classList.add('active');
  if (resCard) resCard.classList.remove('active');
  if (errBox) errBox.style.display = 'none';
  if (loading) loading.style.display = 'none';
  if (input) {
    input.value = '';
    input.focus();
  }
}

function closePhoneLookupModal() {
  const modal = document.getElementById('modal-phone-lookup');
  if (modal) modal.classList.remove('active');
}

async function executePhoneLookup() {
  const input = document.getElementById('lookup-phone-input');
  const btn = document.getElementById('btn-do-lookup');
  const resCard = document.getElementById('phone-lookup-result');
  const errBox = document.getElementById('phone-lookup-error');
  const loading = document.getElementById('phone-lookup-loading');

  const phone = input?.value.trim();
  if (!phone || phone.length < 9) {
    if (errBox) {
      errBox.innerText = 'Vui lòng nhập số điện thoại hợp lệ (tối thiểu 9 số)!';
      errBox.style.display = 'block';
    }
    return;
  }

  if (errBox) errBox.style.display = 'none';
  if (resCard) resCard.classList.remove('active');
  if (loading) loading.style.display = 'block';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/phone-lookup', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ phone })
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Không tìm thấy người dùng này trên Zalo.');
    }

    const user = json.data;
    currentLookupResult = user;

    const avatarEl = document.getElementById('lookup-res-avatar');
    const nameEl = document.getElementById('lookup-res-name');
    const uidEl = document.getElementById('lookup-res-uid');
    const badgeEl = document.getElementById('lookup-res-badge');
    const noteEl = document.getElementById('lookup-res-note');
    const actBtn = document.getElementById('lookup-res-btn');

    if (avatarEl) avatarEl.src = user.avatar || 'https://chat.zalo.me/assets/default-avatar.png';
    if (nameEl) nameEl.innerText = user.displayName;
    if (uidEl) uidEl.innerText = `UID: ${user.uid}`;
    
    if (badgeEl) {
      badgeEl.className = `phone-lookup-status-badge ${user.isFriend ? 'friend' : 'stranger'}`;
      badgeEl.innerText = user.isFriend ? '✓ Bạn Bè' : 'Người Lạ';
    }

    if (user.isFriend) {
      if (noteEl) noteEl.style.display = 'none';
      if (actBtn) {
        actBtn.className = 'phone-lookup-action-btn primary';
        actBtn.disabled = false;
        actBtn.innerText = '💬 Mở Cuộc Trò Chuyện';
      }
    } else {
      if (noteEl) {
        noteEl.innerText = user.guardNote || '⚠️ Chưa là bạn bè — không thể nhắn tin trực tiếp (Quy tắc Anti-Spam: In-Thread Reply Only)';
        noteEl.style.display = 'block';
      }
      if (actBtn) {
        actBtn.className = 'phone-lookup-action-btn disabled';
        actBtn.disabled = true;
        actBtn.innerText = '🔒 Không thể nhắn tin trực tiếp';
      }
    }

    if (resCard) resCard.classList.add('active');
  } catch (err) {
    if (errBox) {
      errBox.innerText = err.message;
      errBox.style.display = 'block';
    }
  } finally {
    if (loading) loading.style.display = 'none';
    if (btn) btn.disabled = false;
  }
}

function startChatWithLookupUser() {
  if (!currentLookupResult || !currentLookupResult.canMessage) return;
  closePhoneLookupModal();
  selectConversation(currentLookupResult.uid);
}

async function syncContacts() {
  const btn = document.getElementById('sync-all-btn');
  if (btn) btn.innerText = '⏳ Đang đồng bộ...';
  try {
    await fetch('/api/sync-contacts', { method: 'POST', headers: getHeaders() });
    await loadConversations();
  } catch (err) {
    console.error(err);
  } finally {
    if (btn) btn.innerText = '🔄 Đồng Bộ';
  }
}

function openImagePreview(url) {
  if (!url) return;
  lightboxImgEl.src = url;
  lightboxEl.style.display = 'flex';
}

function closeImagePreview() {
  lightboxEl.style.display = 'none';
  lightboxImgEl.src = '';
}

function setFilter(filter) {
  state.currentFilter = filter;
  document.querySelectorAll('.segmented-tab[data-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
  });
  loadConversations();
}

let searchDebounce = null;
function handleSearch(val) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.searchQuery = val;
    loadConversations();
  }, 250);
}

function scrollToBottom() {
  if (!messagesStreamEl) return;
  requestAnimationFrame(() => {
    messagesStreamEl.scrollTop = messagesStreamEl.scrollHeight;
    setTimeout(() => {
      if (messagesStreamEl) messagesStreamEl.scrollTop = messagesStreamEl.scrollHeight;
    }, 60);
  });
}

function formatTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');

    if (isToday) return `${hours}:${mins}`;
    return `${d.getDate()}/${d.getMonth() + 1} ${hours}:${mins}`;
  } catch {
    return '';
  }
}

function getDateSeparatorLabel(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (msgDate.getTime() === today.getTime()) return 'Hôm nay';
    if (msgDate.getTime() === yesterday.getTime()) return 'Hôm qua';
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  } catch {
    return '';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatChatBubbleText(str) {
  if (!str) return '';
  let text = escapeHtml(str);
  // Parse **bold** into <strong>bold</strong>
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Parse *italic* into <em>italic</em>
  text = text.replace(/(^|[^*])\*(?!\s)([^*]+?)(?<!\s)\*([^*]|$)/g, '$1<em>$2</em>$3');
  // Parse URLs into clickable links
  text = text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; font-weight: 600;">$1</a>');
  return text;
}

// =============================================================================
// AI SUITE 5 TABS: SOUL, MEMORY, BRAIN, SCOPE, SIMULATOR (Module 6)
// =============================================================================

const CURATED_MODELS_CLIENT = {
  gemini: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Khuyên dùng - Siêu nhanh, Tiết kiệm)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Tư duy sâu, Bán hàng phức tạp)' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' }
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3 (Chat) — Thông minh & Rẻ' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Lập luận sâu)' }
  ],
  zai: [
    { id: 'glm-5.3-flash', name: 'Z.AI GLM-5.3 Flash (Khuyên dùng - Siêu nhanh)' },
    { id: 'glm-4-flash', name: 'Z.AI GLM-4 Flash (Miễn phí & Siêu nhanh)' },
    { id: 'glm-4-plus', name: 'Z.AI GLM-4 Plus (Bán hàng nâng cao)' },
    { id: 'glm-4-air', name: 'Z.AI GLM-4 Air' },
    { id: 'glm-4-long', name: 'Z.AI GLM-4 Long' }
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B (Groq)' }
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Nhanh & Ổn định)' },
    { id: 'gpt-4o', name: 'GPT-4o (Toàn năng)' }
  ],
  openrouter: [
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash via OpenRouter' },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 via OpenRouter' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B via OpenRouter' }
  ],
  ollama: [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B (Tiếng Việt xuất sắc - Chạy Offline)' },
    { id: 'llama3.2:3b', name: 'Llama 3.2 3B (Offline)' }
  ]
};

let aiSettingsState = {
  isEnabled: 0,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  baseUrl: '',
  hasApiKey: false,
  maskedApiKey: '',
  timeoutMs: 35000,
  fallbackEnabled: 0,
  fallbackProvider: 'deepseek',
  fallbackModel: 'deepseek-chat',
  fallbackBaseUrl: '',
  hasFallbackApiKey: false,
  maskedFallbackApiKey: '',
  fallbackTimeoutMs: 30000,
  soulPrompt: '',
  memoryPrompt: '',
  fewShotPrompt: '',
  scopePrompt: '',
  exemplarConversation: '',
  allowGroups: 0,
  autoTagNewLead: 0,
  defaultLeadTagId: '',
  targetMode: 'all',
  excludedTagIds: [],
  allowedTagIds: [],
  adminCooldownMinutes: 15,
  debounceSeconds: 3
};

let simChatHistory = [];
let pendingExemplarDialogue = [];

function switchKnowledgeTab(tabKey) {
  const tabs = ['soul', 'memory', 'brain', 'scope', 'sim'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const pane = document.getElementById(`pane-${t}`);
    if (btn) btn.classList.toggle('active', t === tabKey);
    if (pane) pane.style.display = (t === tabKey ? 'block' : 'none');
  });

  if (tabKey === 'memory') renderKnowledgeQnaSummary();
  if (tabKey === 'scope') {
    populateLeadTagsSelect();
    updateAiTagFilterUI();
  }
  if (tabKey === 'sim') {
    renderSimChat();
    setTimeout(() => document.getElementById('sim-chat-input')?.focus(), 100);
  }
}

async function loadAiSettings() {
  try {
    const res = await fetch('/api/ai/settings', { headers: getHeaders() });
    const result = await res.json();
    if (result.data) {
      aiSettingsState = { ...aiSettingsState, ...result.data };
      
      // Parse tags arrays if string
      try {
        if (typeof aiSettingsState.excludedTagIds === 'string') {
          aiSettingsState.excludedTagIds = JSON.parse(aiSettingsState.excludedTagIds || '[]');
        }
        if (typeof aiSettingsState.allowedTagIds === 'string') {
          aiSettingsState.allowedTagIds = JSON.parse(aiSettingsState.allowedTagIds || '[]');
        }
      } catch {}

      renderAiSettingsUI();
    }
  } catch (err) {
    console.error('Failed to load AI settings:', err);
  }
}

function renderAiSettingsUI() {
  // Global Toggle
  updateGlobalAiButtonUI();

  // Tab 1: SOUL & Exemplar
  const soulInput = document.getElementById('ai-soul-input');
  if (soulInput) soulInput.value = aiSettingsState.soulPrompt || '';
  renderAiExemplarPreview();

  // Tab 2: MEMORY
  const memoryInput = document.getElementById('ai-memory-input');
  if (memoryInput) memoryInput.value = aiSettingsState.memoryPrompt || '';
  renderKnowledgeQnaSummary();

  // Tab 3: Model Primary
  const providerSelect = document.getElementById('ai-provider-select');
  if (providerSelect) providerSelect.value = aiSettingsState.provider || 'gemini';
  populateModelOptions(document.getElementById('ai-model-select'), aiSettingsState.provider || 'gemini', aiSettingsState.model);

  const keyInput = document.getElementById('ai-apikey-input');
  if (keyInput) keyInput.value = '';
  const keyLabel = document.getElementById('ai-key-status-label');
  if (keyLabel) {
    keyLabel.innerText = aiSettingsState.hasApiKey ? `Đã lưu key: ${aiSettingsState.maskedApiKey}` : 'Chưa nhập key (Đang dùng .env)';
    keyLabel.style.color = aiSettingsState.hasApiKey ? '#34d399' : '#94a3b8';
  }

  const baseUrlInput = document.getElementById('ai-baseurl-input');
  if (baseUrlInput) baseUrlInput.value = aiSettingsState.baseUrl || '';

  // Tab 3: Fallback Shield
  const fallbackCheck = document.getElementById('ai-fallback-enabled');
  if (fallbackCheck) fallbackCheck.checked = Boolean(aiSettingsState.fallbackEnabled);
  toggleFallbackFieldsUI();

  const fallbackProviderSelect = document.getElementById('ai-fallback-provider-select');
  if (fallbackProviderSelect) fallbackProviderSelect.value = aiSettingsState.fallbackProvider || 'deepseek';
  populateModelOptions(document.getElementById('ai-fallback-model-select'), aiSettingsState.fallbackProvider || 'deepseek', aiSettingsState.fallbackModel);

  const fallbackKeyInput = document.getElementById('ai-fallback-apikey-input');
  if (fallbackKeyInput) fallbackKeyInput.value = '';

  // Tab 4: Scope & Rules
  const adminCooldown = document.getElementById('ai-admin-cooldown');
  if (adminCooldown) adminCooldown.value = aiSettingsState.adminCooldownMinutes ?? 15;

  const debounceSec = document.getElementById('ai-debounce-sec');
  if (debounceSec) debounceSec.value = aiSettingsState.debounceSeconds ?? 3;

  const allowGroupsCheck = document.getElementById('ai-allow-groups');
  if (allowGroupsCheck) allowGroupsCheck.checked = Boolean(aiSettingsState.allowGroups);

  const autoTagCheck = document.getElementById('ai-auto-tag-lead');
  if (autoTagCheck) autoTagCheck.checked = Boolean(aiSettingsState.autoTagNewLead);

  populateLeadTagsSelect();
  const leadTagSelect = document.getElementById('ai-default-lead-tag-select');
  if (leadTagSelect) leadTagSelect.value = aiSettingsState.defaultLeadTagId || '';

  const targetModeRadios = document.querySelectorAll('input[name="ai-target-mode"]');
  targetModeRadios.forEach(r => {
    r.checked = (r.value === (aiSettingsState.targetMode || 'all'));
  });
  updateAiTagFilterUI();

  const scopeInput = document.getElementById('ai-scope-input');
  if (scopeInput) scopeInput.value = aiSettingsState.scopePrompt || '';
}

function updateGlobalAiButtonUI() {
  const btn = document.getElementById('btn-global-ai-toggle');
  if (!btn) return;
  const isEnabled = Boolean(aiSettingsState.isEnabled);
  btn.innerText = isEnabled ? '⚡ Bot AI: ĐANG BẬT' : '⚡ Bot AI: ĐANG TẮT';
  btn.style.color = isEnabled ? '#34d399' : '#f87171';
  btn.style.borderColor = isEnabled ? 'rgba(52, 211, 153, 0.4)' : 'rgba(248, 113, 113, 0.4)';
  btn.style.background = isEnabled ? 'rgba(52, 211, 153, 0.15)' : 'rgba(248, 113, 113, 0.15)';

  const railBtn = document.getElementById('rail-btn-ai');
  if (railBtn) {
    railBtn.style.color = isEnabled ? '#34d399' : '';
  }
}

async function toggleAiAutoReply() {
  aiSettingsState.isEnabled = aiSettingsState.isEnabled ? 0 : 1;
  updateGlobalAiButtonUI();
  try {
    await fetch('/api/ai/settings', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ isEnabled: aiSettingsState.isEnabled })
    });
    showToast(aiSettingsState.isEnabled ? '✅ Đã bật Bot AI toàn cục' : '⏸️ Đã tắt Bot AI toàn cục', 'info');
  } catch (err) {
    alert('Lỗi cập nhật: ' + err.message);
  }
}

function updateAiToggleButton(conv) {
  const btn = document.getElementById('btn-toggle-ai');
  if (!btn) return;
  if (!conv) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  const isEnabled = conv.aiEnabled !== 0;
  btn.innerText = isEnabled ? '⚡ Bot AI: BẬT' : '⚡ Bot AI: TẮT';
  btn.classList.toggle('off', !isEnabled);
}

async function toggleActiveThreadAi() {
  if (!state.activeThreadId) return;
  const conv = state.activeThread || { id: state.activeThreadId, aiEnabled: 1 };
  const targetVal = conv.aiEnabled === 0 ? true : false;
  try {
    const res = await fetch(`/api/conversations/${state.activeThreadId}/toggle-ai`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ enabled: targetVal })
    });
    const result = await res.json();
    if (result.data) {
      if (state.activeThread) state.activeThread.aiEnabled = result.data.aiEnabled;
      const c = state.conversations.find(item => item.id === state.activeThreadId);
      if (c) c.aiEnabled = result.data.aiEnabled;
      updateAiToggleButton(state.activeThread);
      showToast(targetVal ? '✅ Đã bật Bot AI cho cuộc trò chuyện này' : '⏸️ Đã tắt Bot AI cho cuộc trò chuyện này', 'info');
    }
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// -----------------------------------------------------------------------------
// Few-Shot Exemplar Methods
// -----------------------------------------------------------------------------
function renderAiExemplarPreview() {
  const box = document.getElementById('ai-exemplar-preview-box');
  if (!box) return;

  let dialogue = [];
  if (aiSettingsState.exemplarConversation) {
    try {
      dialogue = typeof aiSettingsState.exemplarConversation === 'string'
        ? JSON.parse(aiSettingsState.exemplarConversation)
        : aiSettingsState.exemplarConversation;
    } catch {}
  }

  if (Array.isArray(dialogue) && dialogue.length > 0) {
    box.innerHTML = dialogue.map(m => `
      <div style="margin-bottom: 4px;">
        <strong style="color: ${m.role === 'user' ? '#38bdf8' : '#34d399'};">${m.role === 'user' ? 'Khách' : 'Tư vấn viên'}:</strong>
        <span>${escapeHtml(m.text)}</span>
      </div>
    `).join('');
  } else if (typeof aiSettingsState.exemplarConversation === 'string' && aiSettingsState.exemplarConversation.trim()) {
    box.innerHTML = `<pre style="white-space:pre-wrap; margin:0;">${escapeHtml(aiSettingsState.exemplarConversation)}</pre>`;
  } else {
    box.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">Chưa có hội thoại mẫu. Bấm "Chọn từ khách hàng" hoặc bấm ⭐ trên thanh chat để trích xuất 1-click.</span>`;
  }
}

function openExemplarPickerModal() {
  openModal('ai-exemplar-picker-modal');
  filterExemplarUsersList('');
}

function closeExemplarPickerModal() {
  closeModal('ai-exemplar-picker-modal');
}

function filterExemplarUsersList(query = '') {
  const container = document.getElementById('exemplar-users-list');
  if (!container) return;

  const q = query.trim().toLowerCase();
  const list = state.conversations.filter(c => {
    if (c.isGroup) return false;
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q) || (c.id || '').includes(q);
  });

  if (list.length === 0) {
    container.innerHTML = `<div style="text-align:center; color:var(--text-muted); padding:16px; font-size:0.8rem;">Không tìm thấy khách hàng nào.</div>`;
    return;
  }

  container.innerHTML = list.map(c => `
    <div class="exemplar-user-item" onclick="selectUserForExemplar('${c.id}')">
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="conv-avatar" style="width:28px; height:28px; font-size:0.75rem;">${(c.name || c.id).substring(0, 2).toUpperCase()}</div>
        <div>
          <div style="font-weight:700; font-size:0.82rem; color:#fff;">${escapeHtml(c.name || c.id)}</div>
          <div style="font-size:0.7rem; color:var(--text-muted);">${escapeHtml(c.lastMessage || 'Xem lịch sử')}</div>
        </div>
      </div>
      <button class="filter-btn" style="padding:3px 8px; font-size:0.72rem; color:#38bdf8;">Chọn ⭐</button>
    </div>
  `).join('');
}

async function selectUserForExemplar(threadId) {
  closeExemplarPickerModal();
  try {
    const res = await fetch('/api/ai/extract-exemplar', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ threadId, limit: 15 })
    });
    const result = await res.json();
    if (result.data && result.data.length > 0) {
      openAiExemplarConfirmModal(result.data);
    } else {
      alert('Cuộc trò chuyện này chưa có đủ tin nhắn văn bản để làm mẫu.');
    }
  } catch (err) {
    alert('Lỗi trích xuất: ' + err.message);
  }
}

function promptSetCurrentChatAsExemplar() {
  if (!state.activeThreadId) return alert('Vui lòng chọn một cuộc trò chuyện trước!');
  selectUserForExemplar(state.activeThreadId);
}

function openAiExemplarConfirmModal(dialogue) {
  pendingExemplarDialogue = dialogue;
  const textarea = document.getElementById('ai-exemplar-edit-textarea');
  if (textarea) {
    textarea.value = dialogue.map(m => `${m.role === 'user' ? 'Khách' : 'Tư vấn viên'}: ${m.text}`).join('\n');
  }
  openModal('ai-exemplar-confirm-modal');
}

function closeAiExemplarConfirmModal() {
  closeModal('ai-exemplar-confirm-modal');
}

async function saveExemplarDialogue() {
  const textarea = document.getElementById('ai-exemplar-edit-textarea');
  const rawText = textarea ? textarea.value.trim() : '';
  if (!rawText) return alert('Nội dung mẫu không được để trống!');

  const lines = rawText.split('\n');
  const structured = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.toLowerCase().startsWith('khách:') || line.toLowerCase().startsWith('user:')) {
      structured.push({ role: 'user', text: line.replace(/^(khách|user):\s*/i, '').trim() });
    } else {
      structured.push({ role: 'assistant', text: line.replace(/^(tư vấn viên|admin|bot|assistant):\s*/i, '').trim() });
    }
  }

  aiSettingsState.exemplarConversation = JSON.stringify(structured);
  closeAiExemplarConfirmModal();
  renderAiExemplarPreview();
  showToast('⭐ Đã nạp hội thoại mẫu Few-Shot thành công!', 'info');
}

function editCurrentExemplarDialogue() {
  let dialogue = [];
  if (aiSettingsState.exemplarConversation) {
    try {
      dialogue = typeof aiSettingsState.exemplarConversation === 'string'
        ? JSON.parse(aiSettingsState.exemplarConversation)
        : aiSettingsState.exemplarConversation;
    } catch {}
  }
  openAiExemplarConfirmModal(Array.isArray(dialogue) ? dialogue : []);
}

async function deleteAiExemplar() {
  if (!confirm('Xóa hội thoại mẫu này?')) return;
  aiSettingsState.exemplarConversation = '';
  renderAiExemplarPreview();
  try {
    await fetch('/api/ai/exemplar', { method: 'DELETE', headers: getHeaders() });
    showToast('🗑️ Đã xóa hội thoại mẫu', 'info');
  } catch (err) {
    alert(err.message);
  }
}

// -----------------------------------------------------------------------------
// Presets & Q&A Helpers
// -----------------------------------------------------------------------------
function applyAiPreset(presetKey) {
  const input = document.getElementById('ai-soul-input');
  if (!input) return;

  if (presetKey === 'friendly') {
    input.value = `Bạn là trợ lý chăm sóc khách hàng trực tuyến qua Zalo. Phong cách thân thiện, nhiệt tình, sử dụng ngôn ngữ tự nhiên, xưng "Em" và gọi khách là "Anh/Chị" kèm icon nhẹ nhàng (dạ, vâng, ạ). Luôn lắng nghe nhu cầu và hỗ trợ chu đáo.`;
  } else if (presetKey === 'b2b') {
    input.value = `Bạn là chuyên viên tư vấn giải pháp phần mềm B2B chuyên nghiệp. Phong cách lịch thiệp, gãy gọn, tập trung vào hiệu quả kinh doanh, giải quyết trực tiếp bài toán của khách hàng và đề xuất lịch hẹn trao đổi sâu hơn.`;
  } else if (presetKey === 'support') {
    input.value = `Bạn là chuyên viên hỗ trợ kỹ thuật Zalo. Phong cách rõ ràng, chuẩn xác, hướng dẫn khách từng bước từng bước giải quyết vấn đề, kiên nhẫn và đảm bảo khách thao tác thành công.`;
  }
}

function renderKnowledgeQnaSummary() {
  const el = document.getElementById('ai-memory-qna-count');
  if (!el) return;
  const qnaList = state.quickMessages.filter(q => q.customerQuestion && q.customerQuestion.trim());
  el.innerHTML = `Đã đồng bộ <strong>${qnaList.length} cặp Hỏi - Đáp</strong> từ phân hệ Tin Nhắn Nhanh vào bộ nhớ AI.`;
}

async function showSecondBrainWikiPreview() {
  try {
    const res = await fetch('/api/ai/wiki-preview', { headers: getHeaders() });
    const result = await res.json();
    const pre = document.getElementById('wiki-preview-content');
    if (pre) pre.innerText = result.data || 'Chưa có dữ liệu.';
    openModal('modal-second-brain-wiki');
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

// -----------------------------------------------------------------------------
// Hub & Model Selector Handlers
// -----------------------------------------------------------------------------
function populateModelOptions(selectEl, provider, selectedModel) {
  if (!selectEl) return;
  const list = CURATED_MODELS_CLIENT[provider] || CURATED_MODELS_CLIENT.gemini;
  selectEl.innerHTML = list.map(m => `
    <option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${escapeHtml(m.name)}</option>
  `).join('');
}

function handleProviderTypeChange(provider) {
  const modelSelect = document.getElementById('ai-model-select');
  populateModelOptions(modelSelect, provider);

  const baseUrlInput = document.getElementById('ai-baseurl-input');
  if (baseUrlInput) {
    if (provider === 'ollama') baseUrlInput.value = 'http://localhost:11434/v1';
    else if (provider === 'deepseek') baseUrlInput.value = 'https://api.deepseek.com/v1';
    else if (provider === 'zai') baseUrlInput.value = 'https://api.z.ai/api/coding/paas/v4';
    else if (provider === 'groq') baseUrlInput.value = 'https://api.groq.com/openai/v1';
    else if (provider === 'openrouter') baseUrlInput.value = 'https://openrouter.ai/api/v1';
    else baseUrlInput.value = '';
  }
}

function handleFallbackProviderChange(provider) {
  const modelSelect = document.getElementById('ai-fallback-model-select');
  populateModelOptions(modelSelect, provider);
}

function toggleFallbackFieldsUI() {
  const isChecked = document.getElementById('ai-fallback-enabled')?.checked;
  const card = document.getElementById('fallback-settings-card');
  const badge = document.getElementById('fallback-status-badge');
  if (card) card.style.display = isChecked ? 'flex' : 'none';
  if (badge) {
    badge.innerText = isChecked ? 'Đã bật' : 'Tắt';
    badge.className = `ai-hub-badge ${isChecked ? 'success' : ''}`;
  }
}

function toggleAiKeyVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = (input.type === 'password' ? 'text' : 'password');
}

async function testAiHubConnection(isFallback = false) {
  const badgeId = isFallback ? 'fallback-status-badge' : 'primary-status-badge';
  const btnId = isFallback ? 'btn-ping-fallback' : 'btn-ping-primary';
  const badge = document.getElementById(badgeId);
  const btn = document.getElementById(btnId);

  const provider = isFallback 
    ? document.getElementById('ai-fallback-provider-select')?.value 
    : document.getElementById('ai-provider-select')?.value;
  const model = isFallback 
    ? document.getElementById('ai-fallback-model-select')?.value 
    : document.getElementById('ai-model-select')?.value;
  const apiKey = isFallback 
    ? document.getElementById('ai-fallback-apikey-input')?.value 
    : document.getElementById('ai-apikey-input')?.value;
  const baseUrl = isFallback 
    ? '' 
    : document.getElementById('ai-baseurl-input')?.value;

  if (badge) {
    badge.innerText = '⏳ Đang kiểm tra...';
    badge.className = 'ai-hub-badge loading';
  }
  if (btn) btn.innerText = '⏳ Đang Ping...';

  try {
    const res = await fetch('/api/ai/test-connection', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ provider, model, apiKey, baseUrl, isFallback })
    });
    const result = await res.json();

    if (res.ok && result.status === 'success') {
      if (badge) {
        badge.innerText = `✅ Hoạt động (${result.latencyMs}ms)`;
        badge.className = 'ai-hub-badge success';
      }
      showToast(`⚡ Kết nối ${provider}:${model} thành công! Độ trễ: ${result.latencyMs}ms`, 'info');
    } else {
      if (badge) {
        badge.innerText = '❌ Lỗi kết nối';
        badge.className = 'ai-hub-badge error';
      }
      alert('Lỗi kiểm tra kết nối: ' + (result.error || 'Không phản hồi'));
    }
  } catch (err) {
    if (badge) {
      badge.innerText = '❌ Lỗi mạng';
      badge.className = 'ai-hub-badge error';
    }
    alert('Lỗi mạng: ' + err.message);
  } finally {
    if (btn) btn.innerText = isFallback ? '⚡ Test Kết Nối Model Dự Phòng' : '⚡ Test Kết Nối Trực Tiếp (Live Ping)';
  }
}

async function scanAvailableModels(isFallback = false) {
  const provider = isFallback 
    ? document.getElementById('ai-fallback-provider-select')?.value 
    : document.getElementById('ai-provider-select')?.value;
  const modelSelect = isFallback 
    ? document.getElementById('ai-fallback-model-select') 
    : document.getElementById('ai-model-select');

  try {
    const res = await fetch('/api/ai/scan-models', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ provider })
    });
    const result = await res.json();
    if (result.data && Array.isArray(result.data)) {
      modelSelect.innerHTML = result.data.map(m => `
        <option value="${m.id}">${escapeHtml(m.name)}</option>
      `).join('');
      showToast(`🔄 Đã cập nhật danh sách model cho ${provider}`, 'info');
    }
  } catch (err) {
    alert('Lỗi quét model: ' + err.message);
  }
}

// -----------------------------------------------------------------------------
// Scope & Tag Filter Handlers
// -----------------------------------------------------------------------------
function populateLeadTagsSelect() {
  const select = document.getElementById('ai-default-lead-tag-select');
  if (!select) return;
  select.innerHTML = `
    <option value="">-- Chọn thẻ khách mới --</option>
    ${state.tags.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')}
  `;
}

function updateAiTagFilterUI() {
  const mode = document.querySelector('input[name="ai-target-mode"]:checked')?.value || 'all';
  const wrap = document.getElementById('ai-tags-selector-wrap');
  if (wrap) wrap.style.display = (mode === 'all' ? 'none' : 'flex');
  renderAiTagsSelector();
}

function renderAiTagsSelector() {
  const container = document.getElementById('ai-tags-selector-box');
  if (!container) return;
  const mode = document.querySelector('input[name="ai-target-mode"]:checked')?.value || 'all';
  const activeArray = mode === 'blacklist' ? aiSettingsState.excludedTagIds : aiSettingsState.allowedTagIds;

  container.innerHTML = state.tags.map(t => {
    const isSelected = activeArray.includes(t.id);
    return `
      <button type="button" class="camp-tag-pill-btn ${isSelected ? 'active' : ''}" onclick="toggleAiTargetTag('${t.id}')">
        <span class="tag-dot" style="background:${t.color};"></span>
        <span>${escapeHtml(t.name)}</span>
        ${isSelected ? '<span>✓</span>' : ''}
      </button>
    `;
  }).join('');
}

function toggleAiTargetTag(tagId) {
  const mode = document.querySelector('input[name="ai-target-mode"]:checked')?.value || 'all';
  if (mode === 'blacklist') {
    if (aiSettingsState.excludedTagIds.includes(tagId)) {
      aiSettingsState.excludedTagIds = aiSettingsState.excludedTagIds.filter(id => id !== tagId);
    } else {
      aiSettingsState.excludedTagIds.push(tagId);
    }
  } else if (mode === 'whitelist') {
    if (aiSettingsState.allowedTagIds.includes(tagId)) {
      aiSettingsState.allowedTagIds = aiSettingsState.allowedTagIds.filter(id => id !== tagId);
    } else {
      aiSettingsState.allowedTagIds.push(tagId);
    }
  }
  renderAiTagsSelector();
}

// -----------------------------------------------------------------------------
// Save & Reset AI Suite Settings
// -----------------------------------------------------------------------------
async function saveKnowledgeSettings() {
  const btn = document.getElementById('btn-save-ai-settings');
  if (btn) btn.innerText = '💾 Đang lưu...';

  const payload = {
    soulPrompt: document.getElementById('ai-soul-input')?.value.trim() || '',
    memoryPrompt: document.getElementById('ai-memory-input')?.value.trim() || '',
    scopePrompt: document.getElementById('ai-scope-input')?.value.trim() || '',
    provider: document.getElementById('ai-provider-select')?.value || 'gemini',
    model: document.getElementById('ai-model-select')?.value || 'gemini-2.5-flash',
    baseUrl: document.getElementById('ai-baseurl-input')?.value.trim() || '',
    fallbackEnabled: document.getElementById('ai-fallback-enabled')?.checked ? 1 : 0,
    fallbackProvider: document.getElementById('ai-fallback-provider-select')?.value || 'deepseek',
    fallbackModel: document.getElementById('ai-fallback-model-select')?.value || 'deepseek-chat',
    adminCooldownMinutes: Number(document.getElementById('ai-admin-cooldown')?.value || 15),
    debounceSeconds: Number(document.getElementById('ai-debounce-sec')?.value || 3),
    allowGroups: document.getElementById('ai-allow-groups')?.checked ? 1 : 0,
    autoTagNewLead: document.getElementById('ai-auto-tag-lead')?.checked ? 1 : 0,
    defaultLeadTagId: document.getElementById('ai-default-lead-tag-select')?.value || '',
    targetMode: document.querySelector('input[name="ai-target-mode"]:checked')?.value || 'all',
    excludedTagIds: aiSettingsState.excludedTagIds,
    allowedTagIds: aiSettingsState.allowedTagIds,
    exemplarConversation: aiSettingsState.exemplarConversation
  };

  const newKey = document.getElementById('ai-apikey-input')?.value.trim();
  if (newKey) payload.apiKey = newKey;

  const newFallbackKey = document.getElementById('ai-fallback-apikey-input')?.value.trim();
  if (newFallbackKey) payload.fallbackApiKey = newFallbackKey;

  try {
    const res = await fetch('/api/ai/settings', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (res.ok && result.data) {
      aiSettingsState = { ...aiSettingsState, ...result.data };
      renderAiSettingsUI();
      showToast('🎉 Đã lưu cấu hình Trung Tâm AI 5 Tabs thành công!', 'info');
      closeModal('modal-ai-brain');
    } else {
      alert('Lỗi lưu cấu hình: ' + (result.error || 'Không rõ nguyên nhân'));
    }
  } catch (err) {
    alert('Lỗi mạng: ' + err.message);
  } finally {
    if (btn) btn.innerText = '💾 Lưu Cấu Hình AI Suite';
  }
}

function resetAiDefaults() {
  if (!confirm('Khôi phục Giọng điệu và Phạm vi về mặc định?')) return;
  applyAiPreset('friendly');
  const scopeInput = document.getElementById('ai-scope-input');
  if (scopeInput) {
    scopeInput.value = `QUY TẮC PHẠM VI (SCOPE):
1. Tuyệt đối không bịa đặt số tài khoản ngân hàng hoặc giá tiền chưa có trong TRI THỨC.
2. Nếu không rõ thông tin, lịch sự hẹn nhờ nhân viên liên hệ lại hỗ trợ.
3. Luôn giữ câu trả lời ngắn gọn (1-3 câu), lịch thiệp và đúng trọng tâm.`;
  }
}

// -----------------------------------------------------------------------------
// Simulator Playground (Tab 5)
// -----------------------------------------------------------------------------
function renderSimChat() {
  const container = document.getElementById('sim-chat-stream');
  if (!container) return;

  if (simChatHistory.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); font-size: 0.78rem; padding: 30px 20px;">
        👋 Hãy gõ câu hỏi thử nghiệm để kiểm tra phản xạ và giọng điệu của Bot AI...
      </div>
    `;
    return;
  }

  container.innerHTML = simChatHistory.map(m => `
    <div class="sim-msg-wrap ${m.role === 'user' ? 'user' : 'bot'}">
      <span class="sim-sender-label">${m.role === 'user' ? '👤 Bạn (Giả lập khách)' : '🤖 Bot AI (Phản hồi)'}</span>
      <div class="sim-bubble ${m.role === 'user' ? 'user' : 'bot'}">${escapeHtml(m.text)}</div>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;
}

async function sendSimMessage() {
  const input = document.getElementById('sim-chat-input');
  const btn = document.getElementById('btn-send-sim');
  const message = input?.value.trim();
  if (!message) return;

  simChatHistory.push({ role: 'user', text: message });
  input.value = '';
  renderSimChat();

  if (btn) {
    btn.innerText = '⏳ Đang suy nghĩ...';
    btn.disabled = true;
  }

  try {
    const historyPayload = simChatHistory.slice(-6).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      text: m.text
    }));

    const res = await fetch('/api/ai/simulate', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ message, history: historyPayload })
    });
    const result = await res.json();

    if (res.ok && result.reply) {
      simChatHistory.push({ role: 'bot', text: result.reply });
      renderSimChat();
    } else {
      simChatHistory.push({ role: 'bot', text: '⚠️ Lỗi: ' + (result.error || 'AI không phản hồi') });
      renderSimChat();
    }
  } catch (err) {
    simChatHistory.push({ role: 'bot', text: '⚠️ Lỗi mạng: ' + err.message });
    renderSimChat();
  } finally {
    if (btn) {
      btn.innerText = 'Gửi Test 🚀';
      btn.disabled = false;
    }
    input?.focus();
  }
}

function clearSimChatHistory() {
  simChatHistory = [];
  renderSimChat();
}

// =============================================================================
// 1-CLICK BULK DEEP-SYNC (All History & Contacts)
// =============================================================================

let isSyncingHistory = false;

function openSyncProgressModal() {
  openModal('modal-sync-progress');
  const icon = document.getElementById('sync-icon-display');
  const title = document.getElementById('sync-status-title');
  const detail = document.getElementById('sync-status-detail');
  const fill = document.getElementById('sync-progress-bar-fill');
  const counter = document.getElementById('sync-progress-counter');
  const percent = document.getElementById('sync-progress-percent');
  const doneBtn = document.getElementById('btn-sync-done');
  const closeBtn = document.getElementById('btn-close-sync-modal');

  if (icon) icon.innerText = '⚡';
  if (title) title.innerText = 'Đang đồng bộ danh bạ & lịch sử tin nhắn...';
  if (detail) detail.innerText = 'Hệ thống đang tải tin nhắn gốc từ máy chủ Zalo với khoảng nghỉ an toàn chống khoá tài khoản.';
  if (fill) fill.style.width = '0%';
  if (counter) counter.innerText = '0 / 0 hội thoại';
  if (percent) percent.innerText = '0%';
  if (doneBtn) doneBtn.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'inline-block';
}

function updateSyncProgressUI(data) {
  if (!data) return;
  const fill = document.getElementById('sync-progress-bar-fill');
  const counter = document.getElementById('sync-progress-counter');
  const percent = document.getElementById('sync-progress-percent');
  const detail = document.getElementById('sync-status-detail');

  const p = Math.min(100, Math.max(0, data.percent || 0));
  if (fill) fill.style.width = `${p}%`;
  if (percent) percent.innerText = `${p}%`;
  if (counter) counter.innerText = `${data.current || 0} / ${data.total || 0} hội thoại (${data.messagesSynced || 0} tin nhắn)`;
  if (detail && data.threadName) {
    detail.innerText = `Đang đồng bộ: "${data.threadName}"...`;
  }
}

function onSyncCompleted(result) {
  const icon = document.getElementById('sync-icon-display');
  const title = document.getElementById('sync-status-title');
  const detail = document.getElementById('sync-status-detail');
  const fill = document.getElementById('sync-progress-bar-fill');
  const percent = document.getElementById('sync-progress-percent');
  const doneBtn = document.getElementById('btn-sync-done');

  if (fill) fill.style.width = '100%';
  if (percent) percent.innerText = '100%';
  if (icon) icon.innerText = '🎉';
  if (title) title.innerText = 'Đồng Bộ Lịch Sử Hoàn Tất!';
  if (detail) {
    const totalMsgs = result?.totalMessagesSynced ?? result?.messagesCount ?? 0;
    const totalThreads = result?.syncedThreads ?? result?.totalThreads ?? 0;
    const duration = result?.durationMs ? ` trong ${Math.round(result.durationMs / 1000)}s` : '';
    detail.innerHTML = `Đã đồng bộ thành công <b>${totalThreads}</b> cuộc trò chuyện (<b>${totalMsgs}</b> tin nhắn)${duration}.`;
  }
  if (doneBtn) doneBtn.style.display = 'inline-block';

  // Reload conversations & active chat
  loadConversations();
  if (state.activeThreadId) {
    loadMessages(state.activeThreadId);
  }
}

async function syncAllHistoryWithProgress() {
  if (isSyncingHistory) {
    alert('Đang có tiến trình đồng bộ lịch sử đang chạy, vui lòng chờ trong giây lát...');
    return;
  }

  const syncBtn = document.getElementById('sync-all-btn');
  isSyncingHistory = true;
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerText = '⏳ Đang đồng bộ...';
  }

  openSyncProgressModal();

  try {
    const res = await fetch('/api/sync-all-history', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ limitThreads: 30, limitPerThread: 50 })
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      const title = document.getElementById('sync-status-title');
      const detail = document.getElementById('sync-status-detail');
      if (title) title.innerText = '❌ Đồng bộ gặp sự cố';
      if (detail) detail.innerText = data.error || 'Vui lòng kiểm tra lại kết nối Zalo.';
      const doneBtn = document.getElementById('btn-sync-done');
      if (doneBtn) doneBtn.style.display = 'inline-block';
    } else {
      onSyncCompleted(data.result);
    }
  } catch (err) {
    const title = document.getElementById('sync-status-title');
    const detail = document.getElementById('sync-status-detail');
    if (title) title.innerText = '❌ Lỗi kết nối máy chủ';
    if (detail) detail.innerText = err.message;
    const doneBtn = document.getElementById('btn-sync-done');
    if (doneBtn) doneBtn.style.display = 'inline-block';
  } finally {
    isSyncingHistory = false;
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerText = '🔄 Đồng Bộ Lịch Sử';
    }
  }
}

// -----------------------------------------------------------------------------
// 📱 ZALO WEB AUTHENTICATION & QR LOGIN MANAGER
// -----------------------------------------------------------------------------
let currentZaloProfile = null;

async function loadZaloProfile() {
  try {
    const res = await fetch('/api/zalo/profile', { headers: getHeaders() });
    const json = await res.json();
    if (json.data) {
      currentZaloProfile = json.data;
      updateZaloHeaderStatus(json.data);
      if (document.getElementById('modal-zalo-login')?.style.display === 'flex') {
        renderZaloLoginModalState(json.data);
      }
    }
  } catch (e) {
    console.warn('Could not load Zalo profile:', e);
  }
}

function updateZaloHeaderStatus(profile) {
  if (!profile) return;
  const nameEl = document.getElementById('zalo-account-name');
  const dotEl = document.getElementById('zalo-header-dot');
  if (nameEl) {
    if (profile.isLoggedIn) {
      nameEl.innerText = profile.displayName || 'Đã Kết Nối (Online)';
      nameEl.title = `Zalo User: ${profile.displayName} (${profile.userId || 'Online'})`;
    } else {
      nameEl.innerText = 'Chưa Kết Nối (Offline)';
      nameEl.title = 'Bấm để quét mã QR kết nối Zalo';
    }
  }
  if (dotEl) {
    dotEl.style.background = profile.isLoggedIn ? '#10b981' : '#94a3b8';
    dotEl.style.boxShadow = profile.isLoggedIn ? '0 0 10px rgba(16,185,129,0.5)' : 'none';
  }
}

function openZaloLoginModal() {
  openModal('modal-zalo-login');
  if (currentZaloProfile) {
    renderZaloLoginModalState(currentZaloProfile);
  }
  loadZaloProfile();
}

function renderZaloLoginModalState(profile) {
  if (!profile) return;
  currentZaloProfile = profile;
  updateZaloHeaderStatus(profile);

  const stateIdle = document.getElementById('zalo-login-state-idle');
  const stateQr = document.getElementById('zalo-login-state-qr');
  const stateConnected = document.getElementById('zalo-login-state-connected');

  const botDot = document.getElementById('zalo-modal-bot-dot');
  const botText = document.getElementById('zalo-modal-bot-text');

  if (profile.isLoggedIn) {
    // 🟢 Connected
    if (stateIdle) stateIdle.style.display = 'none';
    if (stateQr) stateQr.style.display = 'none';
    if (stateConnected) stateConnected.style.display = 'flex';

    const avatarEl = document.getElementById('zalo-connected-avatar');
    const nameEl = document.getElementById('zalo-connected-name');
    const idEl = document.getElementById('zalo-connected-id');

    if (avatarEl) avatarEl.src = profile.avatar || 'https://via.placeholder.com/68?text=Zalo';
    if (nameEl) nameEl.innerText = profile.displayName || 'Tài Khoản Zalo';
    if (idEl) idEl.innerText = profile.userId ? `ID: ${profile.userId}` : '';

    if (botDot) botDot.style.background = '#10b981';
    if (botText) botText.innerText = 'Đang kết nối Zalo Bot (Online)';
  } else if (profile.qrDataUrl || profile.hasQrWaiting) {
    // 📱 QR Waiting
    if (stateIdle) stateIdle.style.display = 'none';
    if (stateConnected) stateConnected.style.display = 'none';
    if (stateQr) stateQr.style.display = 'flex';

    const qrImg = document.getElementById('zalo-qr-img');
    const qrMsg = document.getElementById('zalo-qr-msg');

    if (qrImg && profile.qrDataUrl) qrImg.src = profile.qrDataUrl;
    if (qrMsg) qrMsg.innerText = profile.qrStatusText || 'Mở app Zalo trên điện thoại quét mã bên dưới:';

    if (botDot) botDot.style.background = '#38bdf8';
    if (botText) botText.innerText = 'Đang chờ quét mã QR...';
  } else {
    // ⚪ Idle / Offline
    if (stateConnected) stateConnected.style.display = 'none';
    if (stateQr) stateQr.style.display = 'none';
    if (stateIdle) stateIdle.style.display = 'flex';

    if (botDot) botDot.style.background = '#94a3b8';
    if (botText) botText.innerText = 'Chưa kết nối Zalo Bot';
  }
}

function onZaloQrReceived(data) {
  if (!data) return;
  if (currentZaloProfile) {
    currentZaloProfile.hasQrWaiting = true;
    currentZaloProfile.qrDataUrl = data.qrDataUrl;
    currentZaloProfile.qrStatusText = data.statusText;
    currentZaloProfile.scannedUser = data.scannedUser;
  }
  renderZaloLoginModalState(currentZaloProfile || {
    isLoggedIn: false,
    hasQrWaiting: true,
    qrDataUrl: data.qrDataUrl,
    qrStatusText: data.statusText,
    scannedUser: data.scannedUser
  });
}

async function generateZaloLoginQr() {
  const btn = document.getElementById('btn-generate-qr');
  if (btn) {
    btn.disabled = true;
    btn.innerText = '⏳ Đang tạo mã QR...';
  }

  const stateIdle = document.getElementById('zalo-login-state-idle');
  const stateConnected = document.getElementById('zalo-login-state-connected');
  const stateQr = document.getElementById('zalo-login-state-qr');
  const qrMsg = document.getElementById('zalo-qr-msg');

  if (stateIdle) stateIdle.style.display = 'none';
  if (stateConnected) stateConnected.style.display = 'none';
  if (stateQr) stateQr.style.display = 'flex';
  if (qrMsg) qrMsg.innerText = 'Đang yêu cầu Zalo tạo mã QR kết nối mới...';

  try {
    const res = await fetch('/api/zalo/qr/generate', {
      method: 'POST',
      headers: getHeaders()
    });
    const json = await res.json();
    if (json.data) {
      renderZaloLoginModalState(json.data);
    }
  } catch (e) {
    alert('Lỗi tạo mã QR: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = '⚡ Tạo Mã QR Kết Nối';
    }
  }
}

async function confirmLogoutZalo() {
  if (!confirm('Bạn có chắc chắn muốn đăng xuất tài khoản Zalo này không?\n(Hệ thống sẽ xóa phiên đăng nhập cũ và bạn có thể quét QR để đăng nhập tài khoản khác)')) {
    return;
  }

  try {
    const res = await fetch('/api/zalo/logout', {
      method: 'POST',
      headers: getHeaders()
    });
    const json = await res.json();
    if (json.data) {
      renderZaloLoginModalState(json.data);
    }
    alert('Đã đăng xuất tài khoản Zalo thành công.');
  } catch (e) {
    alert('Lỗi đăng xuất: ' + e.message);
  }
}

// -----------------------------------------------------------------------------
// 💾 BACKUP & RESTORE DATA MANAGER (JSON EXPORT / IMPORT)
// -----------------------------------------------------------------------------
let selectedBackupFile = null;

async function exportBackupData() {
  try {
    const res = await fetch('/api/backup/export', { headers: getHeaders() });
    if (!res.ok) throw new Error('Không thể xuất dữ liệu backup');
    const json = await res.json();
    
    const dateStr = new Date().toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zaloflow-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Lỗi xuất dữ liệu: ' + err.message);
  }
}

async function copyBackupJsonToClipboard() {
  try {
    const res = await fetch('/api/backup/export', { headers: getHeaders() });
    if (!res.ok) throw new Error('Không thể xuất dữ liệu backup');
    const json = await res.json();
    await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
    alert('✅ Đã sao chép toàn bộ JSON Backup vào Clipboard!');
  } catch (err) {
    alert('Lỗi sao chép JSON: ' + err.message);
  }
}

function handleBackupFileSelected(event) {
  const file = event.target.files?.[0];
  const nameLabel = document.getElementById('backup-selected-filename');
  const importBtn = document.getElementById('btn-do-import');
  const resultBox = document.getElementById('backup-import-result-box');

  if (resultBox) resultBox.style.display = 'none';

  if (!file) {
    selectedBackupFile = null;
    if (nameLabel) nameLabel.innerText = 'Chưa chọn tệp nào';
    if (importBtn) importBtn.style.display = 'none';
    return;
  }

  if (!file.name.endsWith('.json')) {
    alert('Vui lòng chọn tệp định dạng .json');
    event.target.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert('Dung lượng tệp vượt quá 5MB');
    event.target.value = '';
    return;
  }

  selectedBackupFile = file;
  if (nameLabel) nameLabel.innerText = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  if (importBtn) importBtn.style.display = 'inline-flex';
}

async function executeBackupImport() {
  if (!selectedBackupFile) {
    alert('Vui lòng chọn tệp JSON trước.');
    return;
  }

  const importBtn = document.getElementById('btn-do-import');
  const resultBox = document.getElementById('backup-import-result-box');

  try {
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.innerText = '⏳ Đang nạp dữ liệu...';
    }

    const formData = new FormData();
    formData.append('file', selectedBackupFile);

    const res = await fetch('/api/backup/import', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getApiToken()}`
      },
      body: formData
    });

    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(json.error || 'Nạp dữ liệu thất bại');
    }

    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = `
        <div style="color: #34d399; font-weight: 700; margin-bottom: 4px;">🎉 Nạp dữ liệu hoàn tất thành công!</div>
        <div style="color: #cbd5e1;">
          • <b>Thêm mới:</b> ${json.imported?.quickMessages || 0} tin nhắn mẫu, ${json.imported?.tags || 0} thẻ tag, ${json.imported?.campaigns || 0} chiến dịch.<br>
          • <b>Bỏ qua trùng lặp:</b> ${json.skipped?.duplicates || 0} mục đã có sẵn.
        </div>
      `;
    }

    // Refresh application states
    if (typeof loadTags === 'function') loadTags();
    if (typeof loadQuickMessages === 'function') loadQuickMessages();
    if (typeof loadCampaigns === 'function') loadCampaigns();

  } catch (err) {
    if (resultBox) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = `<div style="color: #f87171; font-weight: 700;">❌ Lỗi: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.innerText = '⚡ Tiến Hành Nạp Dữ Liệu Vào Hệ Thống';
    }
  }
}

// =============================================================================
// MINI SECOND BRAIN WIKI CONTROLLER (Audit Review v2)
// =============================================================================

let currentWikiData = null;
let currentWikiViewMode = 'formatted';

async function openSecondBrainWikiModal() {
  const btn = document.getElementById('btn-open-second-brain-wiki');
  if (btn) btn.innerText = '⏳ Đang tổng hợp...';

  const draftSettings = {
    soulPrompt: document.getElementById('ai-soul-input')?.value.trim() || '',
    memoryPrompt: document.getElementById('ai-memory-input')?.value.trim() || '',
    scopePrompt: document.getElementById('ai-scope-input')?.value.trim() || '',
    provider: document.getElementById('ai-provider-select')?.value || 'gemini',
    model: document.getElementById('ai-model-select')?.value || 'gemini-2.5-flash',
    fallbackEnabled: document.getElementById('ai-fallback-enabled')?.checked ? 1 : 0,
    fallbackProvider: document.getElementById('ai-fallback-provider-select')?.value || 'deepseek',
    fallbackModel: document.getElementById('ai-fallback-model-select')?.value || 'deepseek-chat',
    exemplarConversation: aiSettingsState.exemplarConversation || ''
  };

  try {
    const res = await fetch('/api/ai/wiki-preview', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(draftSettings)
    });

    const json = await res.json();
    if (!res.ok || !json.data) {
      throw new Error(json.error || 'Không thể tổng hợp Second Brain Wiki');
    }

    currentWikiData = json.data;
    const { stats, wikiMarkdown } = json.data;

    // Update Stats Badges
    const badgeTokens = document.getElementById('wiki-badge-tokens');
    if (badgeTokens) {
      badgeTokens.innerText = `📏 ~${(stats.estimatedTokens || 0).toLocaleString()} Tokens (${(stats.charCount || 0).toLocaleString()} ký tự)`;
    }

    const badgeQna = document.getElementById('wiki-badge-qna');
    if (badgeQna) {
      badgeQna.innerText = `❓ ${stats.qnaCount || 0} Câu Q&A`;
    }

    const badgeFewshot = document.getElementById('wiki-badge-fewshot');
    if (badgeFewshot) {
      badgeFewshot.innerText = stats.hasFewShot ? '💬 Đã có mẫu Chat' : '💬 Chưa có mẫu Chat';
      badgeFewshot.style.color = stats.hasFewShot ? '#a78bfa' : 'var(--text-muted)';
    }

    const badgeModel = document.getElementById('wiki-badge-model');
    if (badgeModel) {
      badgeModel.innerText = `⚡ ${stats.provider}:${stats.model}`;
    }

    // Handle Empty State (Audit Fix I5)
    const emptyState = document.getElementById('wiki-empty-state');
    const formattedView = document.getElementById('wiki-formatted-view');
    const rawView = document.getElementById('wiki-raw-view');

    if (stats.isEmpty) {
      if (emptyState) emptyState.style.display = 'block';
      if (formattedView) formattedView.style.display = 'none';
      if (rawView) rawView.style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      if (formattedView) formattedView.style.display = currentWikiViewMode === 'formatted' ? 'flex' : 'none';
      if (rawView) rawView.style.display = currentWikiViewMode === 'raw' ? 'block' : 'none';

      // Set raw content
      const rawEditor = document.getElementById('wiki-raw-editor');
      if (rawEditor) rawEditor.value = wikiMarkdown;
      const rawPre = document.getElementById('wiki-preview-content');
      if (rawPre) rawPre.textContent = wikiMarkdown;
      const charHint = document.getElementById('wiki-editor-char-hint');
      if (charHint) charHint.innerText = `${(wikiMarkdown.length || 0).toLocaleString()} ký tự`;

      // Render formatted sections
      renderFormattedWiki(wikiMarkdown);
    }

    // Reset Search input
    const searchInput = document.getElementById('wiki-search-input');
    if (searchInput) searchInput.value = '';

    openModal('modal-second-brain-wiki');
  } catch (err) {
    alert('Lỗi tải Second Brain Wiki: ' + err.message);
  } finally {
    if (btn) btn.innerHTML = '👁️ Xem Second Brain Wiki';
  }
}

function closeSecondBrainWikiModal() {
  closeModal('modal-second-brain-wiki');
}

function switchWikiViewMode(mode) {
  currentWikiViewMode = mode;
  const formattedView = document.getElementById('wiki-formatted-view');
  const rawView = document.getElementById('wiki-raw-view');
  const btnFormatted = document.getElementById('wiki-tab-btn-formatted');
  const btnRaw = document.getElementById('wiki-tab-btn-raw');
  const emptyState = document.getElementById('wiki-empty-state');

  if (emptyState && emptyState.style.display === 'block') return;

  if (mode === 'formatted') {
    if (formattedView) formattedView.style.display = 'flex';
    if (rawView) rawView.style.display = 'none';
    if (btnFormatted) btnFormatted.classList.add('active');
    if (btnRaw) btnRaw.classList.remove('active');
  } else {
    if (formattedView) formattedView.style.display = 'none';
    if (rawView) rawView.style.display = 'block';
    if (btnFormatted) btnFormatted.classList.remove('active');
    if (btnRaw) btnRaw.classList.add('active');
  }
}

function recompileWiki() {
  openSecondBrainWikiModal();
}

async function copyWikiMarkdown() {
  const editorText = document.getElementById('wiki-raw-editor')?.value;
  const content = editorText !== undefined ? editorText : currentWikiData?.wikiMarkdown;
  if (!content) {
    showToast('Chưa có nội dung Wiki để sao chép', 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(content);
    showToast('📋 Đã sao chép Mini Second Brain Wiki vào Clipboard!', 'info');
  } catch {
    showToast('Không thể sao chép tự động', 'error');
  }
}

function downloadWikiMarkdown() {
  const editorText = document.getElementById('wiki-raw-editor')?.value;
  const content = editorText !== undefined ? editorText : currentWikiData?.wikiMarkdown;
  if (!content) {
    showToast('Chưa có nội dung Wiki để tải xuống', 'warning');
    return;
  }
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mini-second-brain-wiki.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('📥 Đã tải xuống file mini-second-brain-wiki.md', 'info');
}

// -----------------------------------------------------------------------------
// Live Editor & Raw Markdown 2-Way Sync Handlers
// -----------------------------------------------------------------------------
function handleWikiEditorInput(text) {
  const rawText = text || '';
  const charCount = rawText.length;
  const estimatedTokens = Math.round(charCount / 3.0);

  const charHint = document.getElementById('wiki-editor-char-hint');
  if (charHint) charHint.innerText = `${charCount.toLocaleString()} ký tự`;

  const badgeTokens = document.getElementById('wiki-badge-tokens');
  if (badgeTokens) {
    badgeTokens.innerText = `📏 ~${estimatedTokens.toLocaleString()} Tokens (${charCount.toLocaleString()} ký tự)`;
  }
}

function triggerWikiFileUpload() {
  const fileInput = document.getElementById('wiki-file-import-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
}

function handleWikiFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target?.result;
    if (typeof content !== 'string') return;

    const rawEditor = document.getElementById('wiki-raw-editor');
    if (rawEditor) {
      rawEditor.value = content;
      // Switch view to raw mode so user inspects the uploaded markdown
      switchWikiViewMode('raw');
      handleWikiEditorInput(content);
      showToast(`📂 Đã nạp "${file.name}" (${content.length.toLocaleString()} ký tự). Bấm "Lưu & Áp Dụng" để đồng bộ!`, 'info');
    }
  };
  reader.onerror = function() {
    showToast('Không thể đọc tệp tin Markdown', 'error');
  };
  reader.readAsText(file, 'utf-8');
}

async function saveRawWikiMarkdown() {
  const rawEditor = document.getElementById('wiki-raw-editor');
  const content = rawEditor?.value?.trim();
  if (!content) {
    showToast('Nội dung Markdown đang trống!', 'warning');
    return;
  }

  const btnSave = document.getElementById('btn-wiki-save-apply');
  if (btnSave) btnSave.innerText = '⏳ Đang phân tích...';

  try {
    const res = await fetch('/api/ai/wiki-apply', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ markdown: content })
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.error || 'Không thể áp dụng Markdown');
    }

    showToast(json.message || '✅ Đã lưu và đồng bộ tri thức thành công!', 'success');

    // Update parent settings inputs in dashboard form
    if (json.data?.savedSettings) {
      const { soulPrompt, memoryPrompt, scopePrompt, exemplarConversation } = json.data.savedSettings;
      const soulInput = document.getElementById('ai-soul-input');
      if (soulInput && soulPrompt !== undefined) soulInput.value = soulPrompt;

      const memoryInput = document.getElementById('ai-memory-input');
      if (memoryInput && memoryPrompt !== undefined) memoryInput.value = memoryPrompt;

      const scopeInput = document.getElementById('ai-scope-input');
      if (scopeInput && scopePrompt !== undefined) scopeInput.value = scopePrompt;

      if (typeof aiSettingsState !== 'undefined' && aiSettingsState) {
        aiSettingsState.soulPrompt = soulPrompt;
        aiSettingsState.memoryPrompt = memoryPrompt;
        aiSettingsState.scopePrompt = scopePrompt;
        if (exemplarConversation) aiSettingsState.exemplarConversation = exemplarConversation;
      }
    }

    // If Q&As were synced and loadQuickMessages exists, reload Q&A list
    if (json.data?.qnaSyncedCount && typeof loadQuickMessages === 'function') {
      loadQuickMessages();
    }

    // Refresh formatted view and stats
    if (json.data?.wikiMarkdown) {
      currentWikiData = json.data;
      renderFormattedWiki(json.data.wikiMarkdown);
      if (json.data.stats) {
        const badgeTokens = document.getElementById('wiki-badge-tokens');
        if (badgeTokens) {
          badgeTokens.innerText = `📏 ~${(json.data.stats.estimatedTokens || 0).toLocaleString()} Tokens (${(json.data.stats.charCount || 0).toLocaleString()} ký tự)`;
        }
        const badgeQna = document.getElementById('wiki-badge-qna');
        if (badgeQna) {
          badgeQna.innerText = `❓ ${json.data.stats.qnaCount || 0} Câu Q&A`;
        }
      }
    }

    // Switch view back to formatted mode for visual inspection
    switchWikiViewMode('formatted');
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  } finally {
    if (btnSave) btnSave.innerText = '💾 Lưu & Áp Dụng';
  }
}

function filterWikiContent(keyword) {
  if (!currentWikiData || !currentWikiData.wikiMarkdown) return;
  renderFormattedWiki(currentWikiData.wikiMarkdown, keyword.trim());
}

function renderFormattedWiki(markdown, keyword = '') {
  const container = document.getElementById('wiki-formatted-view');
  if (!container) return;

  // Split markdown by sections starting with ##
  const parts = markdown.split(/^## /m);
  let html = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    if (i === 0 && part.startsWith('# 🧠')) {
      continue; // Skip the main document title as it is already in modal header
    }

    const firstLineEnd = part.indexOf('\n');
    const title = firstLineEnd !== -1 ? part.substring(0, firstLineEnd).trim() : part;
    let body = firstLineEnd !== -1 ? part.substring(firstLineEnd).trim() : '';

    // Remove horizontal rule dividers at start or end
    body = body.replace(/^---\s*/g, '').replace(/---\s*$/g, '').trim();

    // Escape HTML for safety
    let safeBody = escapeHtml(body);

    // Convert **bold** to <strong>bold</strong>
    safeBody = safeBody.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Highlight search keyword if provided
    let isMatched = true;
    if (keyword) {
      try {
        const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        if (regex.test(title) || regex.test(body)) {
          safeBody = safeBody.replace(regex, '<mark class="wiki-highlight">$1</mark>');
        } else {
          isMatched = false;
        }
      } catch {}
    }

    if (!isMatched) continue;

    html += `
      <div class="wiki-section-card">
        <div class="wiki-section-title">## ${escapeHtml(title)}</div>
        <div class="wiki-section-body">${safeBody}</div>
      </div>
    `;
  }

  if (!html && keyword) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        🔍 Không tìm thấy nội dung khớp với từ khóa "<b>${escapeHtml(keyword)}</b>".
      </div>
    `;
  } else {
    container.innerHTML = html;
  }
}

// -----------------------------------------------------------------------------
// Memory Watchdog Frontend Pill Synchronization (Audit v2)
// -----------------------------------------------------------------------------
async function fetchMemoryHealth() {
  try {
    const res = await fetch('/health');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.memory) {
      updateMemoryPillUI(data.memory);
    }
  } catch (err) {
    // Silently ignore if server restarting or temporary network blip
  }
}

function updateMemoryPillUI(mem) {
  const pill = document.getElementById('ram-status-pill');
  const text = document.getElementById('ram-usage-text');
  const dot = document.getElementById('ram-header-dot');
  if (!pill || !text) return;

  text.innerText = `RAM: ${mem.rssMb}MB`;
  pill.title = `Mức tiêu thụ RAM thực tế: ${mem.rssMb}MB / Giới hạn: ${mem.limitMb}MB (Heap: ${mem.heapUsedMb}MB)`;

  pill.classList.remove('normal', 'warning', 'critical');
  if (mem.status === 'critical') {
    pill.classList.add('critical');
    if (dot) {
      dot.style.background = '#f87171';
      dot.style.boxShadow = '0 0 10px #f87171';
    }
  } else if (mem.status === 'warning') {
    pill.classList.add('warning');
    if (dot) {
      dot.style.background = '#fbbf24';
      dot.style.boxShadow = '0 0 8px #fbbf24';
    }
  } else {
    pill.classList.add('normal');
    if (dot) {
      dot.style.background = '#34d399';
      dot.style.boxShadow = '0 0 8px #34d399';
    }
  }
}
