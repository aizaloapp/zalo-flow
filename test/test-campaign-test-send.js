import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { resolveCampaignAttachments, dispatchSmartCampaignMessage } from '../src/routes/campaigns.js';
import { localStore } from '../src/utils/local-store.js';

console.log('🧪 Running Test Suite: Campaign Test Dispatch Protocol (test-send)...');

// =============================================================================
// 1. Test resolveCampaignAttachments Multi-Directory Fallback
// =============================================================================
console.log('   Testing resolveCampaignAttachments multi-directory scanning...');

const testDir = path.resolve('data/uploads/campaigns');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir, { recursive: true });
}

const dummyImageName = `test_img_${Date.now()}.png`;
const dummyImagePath = path.resolve(testDir, dummyImageName);
fs.writeFileSync(dummyImagePath, Buffer.from([0x89, 0x50, 0x4E, 0x47]));

try {
  const resolved = resolveCampaignAttachments([`/api/campaigns/media/${dummyImageName}`]);
  assert.strictEqual(resolved.length, 1, 'Should resolve 1 valid image');
  assert.strictEqual(resolved[0].mediaType, 'image');
  assert.strictEqual(resolved[0].path, dummyImagePath);
  console.log('   ✅ Passed: Valid image resolved successfully');

  const nonExistentResolved = resolveCampaignAttachments(['/api/campaigns/media/ghost_file_12345.jpg']);
  assert.strictEqual(nonExistentResolved.length, 0, 'Non-existent file must not be resolved');
  console.log('   ✅ Passed: Missing disk file ignored by resolver');

  const stringifiedJson = JSON.stringify([{ mediaUrl: `/api/campaigns/media/${dummyImageName}`, mediaType: 'image' }]);
  const jsonResolved = resolveCampaignAttachments(stringifiedJson);
  assert.strictEqual(jsonResolved.length, 1, 'Stringified array should parse and resolve');
  console.log('   ✅ Passed: Stringified JSON array handled properly');
} finally {
  if (fs.existsSync(dummyImagePath)) {
    fs.unlinkSync(dummyImagePath);
  }
}

// =============================================================================
// 2. Test dispatchSmartCampaignMessage (Single Image Merged Caption Protocol)
// =============================================================================
console.log('\n   Testing dispatchSmartCampaignMessage smart caption & variable resolution...');

import { zaloClient } from '../src/zalo-client.js';
const originalUpload = zaloClient.uploadAttachment;
const originalSend = zaloClient.sendMessage;

let uploadCalls = [];
let sendCalls = [];

zaloClient.uploadAttachment = async (threadId, paths, isGroup, options) => {
  uploadCalls.push({ threadId, paths, isGroup, options });
  return { status: 'ok' };
};

zaloClient.sendMessage = async (threadId, text, isGroup) => {
  sendCalls.push({ threadId, text, isGroup });
  return { status: 'ok' };
};

try {
  // Scenario 1: 1 Image + Text (<= 1000 char) -> Single-Image Caption Merged
  uploadCalls = [];
  sendCalls = [];

  const res1 = await dispatchSmartCampaignMessage({
    threadId: 'test_thread_1',
    customerName: 'Anh Nam',
    rawMessage: '{Chào|Hello} {name} nhé, đây là ưu đãi!',
    localFilePaths: [{ path: '/tmp/banner.png', mediaUrl: '/media/banner.png', mediaType: 'image', originalName: 'banner.png' }],
    isGroup: false
  });

  assert.strictEqual(res1.isCaptionMerged, true, 'Scenario 1: isCaptionMerged must be true');
  assert.strictEqual(uploadCalls.length, 1, 'Scenario 1: uploadAttachment must be called once');
  assert.strictEqual(sendCalls.length, 0, 'Scenario 1: sendMessage must NOT be called');
  assert.ok(uploadCalls[0].options.caption.includes('Anh Nam'), 'Caption must contain personalized name');
  console.log('   ✅ Passed Scenario 1: Single image + text merged into 1 attachment call with caption');

  // Scenario 2: Multiple images (2 images) -> Fallback split
  uploadCalls = [];
  sendCalls = [];

  const res2 = await dispatchSmartCampaignMessage({
    threadId: 'test_thread_2',
    customerName: 'Chị Mai',
    rawMessage: 'Album ảnh mới cho {name}',
    localFilePaths: [
      { path: '/tmp/img1.png', mediaUrl: '/media/img1.png', mediaType: 'image', originalName: 'img1.png' },
      { path: '/tmp/img2.png', mediaUrl: '/media/img2.png', mediaType: 'image', originalName: 'img2.png' }
    ],
    isGroup: false
  });

  assert.strictEqual(res2.isCaptionMerged, false, 'Scenario 2: isCaptionMerged must be false for album');
  assert.strictEqual(sendCalls.length, 1, 'Scenario 2: sendMessage must be called for text');
  assert.strictEqual(uploadCalls.length, 1, 'Scenario 2: uploadAttachment must be called for images');
  assert.strictEqual(uploadCalls[0].paths.length, 2, 'Scenario 2: both images sent');
  console.log('   ✅ Passed Scenario 2: Multi-image gracefully separates text and media');

  // Scenario 3: Text > 1000 chars with 1 image -> Fallback split (anti-truncate)
  uploadCalls = [];
  sendCalls = [];
  const superLongMessage = 'B'.repeat(1050);

  const res3 = await dispatchSmartCampaignMessage({
    threadId: 'test_thread_3',
    customerName: 'Khách VIP',
    rawMessage: superLongMessage,
    localFilePaths: [{ path: '/tmp/banner.png', mediaUrl: '/media/banner.png', mediaType: 'image', originalName: 'banner.png' }],
    isGroup: false
  });

  assert.strictEqual(res3.isCaptionMerged, false, 'Scenario 3: isCaptionMerged must be false for long text > 1000');
  assert.strictEqual(sendCalls.length, 1, 'Scenario 3: sendMessage called for long text');
  assert.strictEqual(uploadCalls.length, 1, 'Scenario 3: uploadAttachment called for image');
  console.log('   ✅ Passed Scenario 3: Long text > 1000 chars gracefully separates without truncation');

} finally {
  zaloClient.uploadAttachment = originalUpload;
  zaloClient.sendMessage = originalSend;
}

// =============================================================================
// 3. Test Cold Outbound Shield & Zero-Contamination Boundary
// =============================================================================
console.log('\n   Testing Cold Outbound Shield & Zero Contamination Invariants...');

const testConvId = `test_conv_${Date.now()}`;
localStore.upsertConversation({
  id: testConvId,
  name: 'Hội Thoại Test',
  isGroup: 0,
  lastTime: new Date().toISOString()
});

const foundConv = localStore.getConversation(testConvId);
assert.ok(foundConv, 'Conversation must exist in localStore');
assert.strictEqual(foundConv.name, 'Hội Thoại Test');

const nonexistentConv = localStore.getConversation('nonexistent_uid_9999999');
assert.strictEqual(nonexistentConv, null, 'Unknown UID must return null in localStore');
console.log('   ✅ Passed: Cold Outbound verification correctly differentiates valid and invalid UIDs');

console.log('\n🎉 ALL CAMPAIGN TEST SEND SUITE TESTS PASSED 100%!\n');
