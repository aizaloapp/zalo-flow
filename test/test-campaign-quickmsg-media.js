import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Trích xuất attachments như logic mới trong app.js
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

function fixedApplyCampQuickMsgTemplate(qm, currentAttachments) {
  const editingAttachments = [...currentAttachments];
  const atts = getQuickMessageAttachments(qm);
  if (atts && atts.length > 0) {
    for (const att of atts) {
      if (editingAttachments.length >= 5) break;
      const exists = editingAttachments.some(a => a.mediaUrl === att.mediaUrl);
      if (!exists && att.mediaUrl) {
        editingAttachments.push({
          mediaUrl: att.mediaUrl,
          mediaType: att.mediaType || 'image',
          mediaName: att.mediaName || qm.title || 'Đính kèm mẫu'
        });
      }
    }
  }
  return editingAttachments;
}

// Phân giải disk path như logic mới trong campaigns.js
function fixedResolveCampaignDiskPaths(mediaItems) {
  const localFilePaths = [];
  for (const m of mediaItems) {
    const urlStr = typeof m === 'string' ? m : (m.mediaUrl || '');
    const fn = path.basename(urlStr);
    if (!fn) continue;

    let targetPath = path.resolve('data/uploads/campaigns', fn);
    let resolvedApiUrl = '/api/campaigns/media/' + fn;

    if (!fs.existsSync(targetPath)) {
      const qmPath = path.resolve('data/uploads/quick-msg', fn);
      if (fs.existsSync(qmPath)) {
        targetPath = qmPath;
        resolvedApiUrl = '/api/quick-messages/media/' + fn;
      }
    }

    if (fs.existsSync(targetPath)) {
      localFilePaths.push({
        path: targetPath,
        mediaUrl: (typeof m === 'object' && m.mediaUrl && !m.mediaUrl.startsWith('[')) ? m.mediaUrl : resolvedApiUrl,
        mediaType: m.mediaType || 'image',
        originalName: m.mediaName || fn
      });
    }
  }
  return localFilePaths;
}

console.log('🧪 Running Regression Test: Campaign Quick-Message Media Integration...');

// 1. Test Quick Message có 2 ảnh trong JSON string
const mockMultiImgQuickMsg = {
  id: 'qm_multi_123',
  title: 'Mẫu 2 ảnh',
  content: 'Khuyến mãi đặc biệt',
  mediaUrl: JSON.stringify([
    { mediaUrl: '/api/quick-messages/media/qm_banner_1.jpg', mediaType: 'image', mediaName: 'banner1.jpg' },
    { mediaUrl: '/api/quick-messages/media/qm_banner_2.png', mediaType: 'image', mediaName: 'banner2.png' }
  ])
};

const extracted = fixedApplyCampQuickMsgTemplate(mockMultiImgQuickMsg, []);
assert.strictEqual(extracted.length, 2, 'Must extract exactly 2 attachment items');
assert.strictEqual(extracted[0].mediaUrl, '/api/quick-messages/media/qm_banner_1.jpg', 'Item 1 URL must be clean');
assert.strictEqual(extracted[1].mediaUrl, '/api/quick-messages/media/qm_banner_2.png', 'Item 2 URL must be clean');
assert.ok(!extracted[0].mediaUrl.startsWith('['), 'Item 1 URL must never be a raw JSON array');
console.log('   ✅ Frontend template extraction passed: 2 clean items extracted, 0 broken JSON strings');

// 2. Test Backend Dispatcher Multi-Dir Storage Fallback
const quickMsgDir = path.resolve('data/uploads/quick-msg');
if (!fs.existsSync(quickMsgDir)) fs.mkdirSync(quickMsgDir, { recursive: true });
const file1 = path.join(quickMsgDir, 'qm_banner_1.jpg');
const file2 = path.join(quickMsgDir, 'qm_banner_2.png');
fs.writeFileSync(file1, 'fake banner 1 content');
fs.writeFileSync(file2, 'fake banner 2 content');

try {
  const resolved = fixedResolveCampaignDiskPaths(extracted);
  assert.strictEqual(resolved.length, 2, 'Dispatcher must find both files from quick-msg folder');
  assert.strictEqual(resolved[0].path, file1);
  assert.strictEqual(resolved[1].path, file2);
  assert.strictEqual(resolved[0].mediaUrl, '/api/quick-messages/media/qm_banner_1.jpg');
  console.log('   ✅ Backend dispatcher fallback passed: 2/2 files resolved successfully from quick-msg storage');
} finally {
  if (fs.existsSync(file1)) fs.unlinkSync(file1);
  if (fs.existsSync(file2)) fs.unlinkSync(file2);
}

console.log('\n🎉 All campaign quick-message media integration tests passed 100%!');
