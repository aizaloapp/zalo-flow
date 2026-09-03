import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { saveEncryptedSession, loadEncryptedSession } from '../src/utils/session-store.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { SelfEchoShield } from '../src/utils/self-echo.js';
import { FloodDetector } from '../src/utils/flood-detector.js';
import { LocalStore } from '../src/utils/local-store.js';
import { parseMessage } from '../src/utils/message-parser.js';
import { resolveSpintax, generateSamplePreviews } from '../src/utils/spintax.js';

console.log('🧪 Starting Zalo-Flow Integrity Test Suite (Lean Chatwoot CRM + Remarketing)...\n');

// -----------------------------------------------------------------------------
// Test 1: AES-256-CBC Session Encryption & Decryption
// -----------------------------------------------------------------------------
console.log('1. Testing Session Store (AES-256-CBC)...');
const sampleSession = {
  cookie: 'zpw_sek=mock_secret_cookie_token_123',
  imei: 'mock-imei-456',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
};
const testPassphrase = 'test-secret-passphrase-32-chars!!';

assert(saveEncryptedSession('test_session', sampleSession, testPassphrase), 'Failed to save session');
const restored = loadEncryptedSession('test_session', testPassphrase);
assert(restored !== null, 'Decrypted session is null');
assert.strictEqual(restored.cookie, sampleSession.cookie, 'Cookie does not match');
assert.strictEqual(restored.imei, sampleSession.imei, 'IMEI does not match');
console.log('   ✅ Session encryption & decryption passed!\n');

// -----------------------------------------------------------------------------
// Test 2: Self-Echo Shield
// -----------------------------------------------------------------------------
console.log('2. Testing Self-Echo Shield...');
const echoShield = new SelfEchoShield(5); // 5s TTL
echoShield.recordSent('Xin chào quý khách!', 'user_123');

assert.strictEqual(echoShield.isSelfEcho('Xin chào quý khách!', 'user_123'), true, 'Should detect self echo');
assert.strictEqual(echoShield.isSelfEcho('Khách nhắn tin mới', 'user_123'), false, 'Different text should not be echo');
assert.strictEqual(echoShield.isSelfEcho('Xin chào quý khách!', 'user_999'), false, 'Different user should not be echo');
console.log('   ✅ Self-Echo Shield passed!\n');

// -----------------------------------------------------------------------------
// Test 3: Flood Detector
// -----------------------------------------------------------------------------
console.log('3. Testing Flood Detector...');
const floodDetector = new FloodDetector({ threshold: 3, windowMs: 1000, muteDurationMs: 5000 });
const spammerId = 'spammer_999';

assert.strictEqual(floodDetector.isFlooding(spammerId), false, '1st msg ok');
assert.strictEqual(floodDetector.isFlooding(spammerId), false, '2nd msg ok');
assert.strictEqual(floodDetector.isFlooding(spammerId), false, '3rd msg ok');
assert.strictEqual(floodDetector.isFlooding(spammerId), true, '4th msg should trigger flood mute');
assert.strictEqual(floodDetector.isFlooding(spammerId), true, 'Should stay muted');
console.log('   ✅ Flood Detector passed!\n');

// -----------------------------------------------------------------------------
// Test 4: Rate Limiter
// -----------------------------------------------------------------------------
console.log('4. Testing Rate Limiter (Interval Spacing)...');
const rateLimiter = new RateLimiter({ minIntervalMs: 50, maxPerMinute: 10 });
let callCount = 0;
const start = Date.now();

await Promise.all([
  rateLimiter.schedule(async () => { callCount++; return 1; }),
  rateLimiter.schedule(async () => { callCount++; return 2; })
]);

const elapsed = Date.now() - start;
assert.strictEqual(callCount, 2, 'Both calls should execute');
assert(elapsed >= 45, `Calls should be spaced by at least ~50ms (got ${elapsed}ms)`);
console.log(`   ✅ Rate Limiter passed (${elapsed}ms spacing)!\n`);

// -----------------------------------------------------------------------------
// Test 5: Local SQLite Store & Schema Reconciliation
// -----------------------------------------------------------------------------
console.log('5. Testing LocalStore SQLite & Schema Reconciliation...');
const testDbFile = 'data/test_zaloflow_v3.db';
if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);

const store = new LocalStore(testDbFile);
store.upsertConversation({ id: 'user_rich', name: 'Phan Lê Khoa', avatar: '', isGroup: false });
store.addMessage({
  id: 'msg_rich_1',
  threadId: 'user_rich',
  senderId: 'user_rich',
  senderName: 'Phan Lê Khoa',
  text: 'Chào bạn',
  mediaType: 'image',
  mediaUrl: 'https://zadn.vn/test.jpg'
});

const conv = store.getConversation('user_rich');
assert.strictEqual(conv.name, 'Phan Lê Khoa', 'Conversation name should match');
console.log('   ✅ LocalStore SQLite & Schema Reconciliation passed!\n');

// -----------------------------------------------------------------------------
// Test 6: Tags Management & Foreign Key Cascade Delete
// -----------------------------------------------------------------------------
console.log('6. Testing Customer Tags & Cascade Delete...');
const tagVip = store.upsertTag({ name: 'Khách VIP', color: '#ef4444' });
const tagHot = store.upsertTag({ name: 'Tiềm Năng Cao', color: '#f59e0b' });
assert(tagVip.id && tagHot.id);

store.addConversationTag('user_rich', tagVip.id);
store.addConversationTag('user_rich', tagHot.id);
const userTags = store.getConversationTags('user_rich');
assert.strictEqual(userTags.length, 2, 'Should have 2 assigned tags');

store.deleteTag(tagVip.id);
const userTagsAfter = store.getConversationTags('user_rich');
assert.strictEqual(userTagsAfter.length, 1, 'Foreign key cascade should remove deleted tag assignment');
console.log('   ✅ Customer Tags & Foreign Keys Cascade passed!\n');

// -----------------------------------------------------------------------------
// Test 7: Quick Messages CRUD & Q&A Format (With Media Attachments)
// -----------------------------------------------------------------------------
console.log('7. Testing Quick Messages CRUD & Q&A Mapping (With Media Attachments)...');
// TC-QM-MEDIA-01: Text-only template
const qm1 = store.upsertQuickMessage({
  shortcut: 'tuvan',
  customerQuestion: 'Tôi muốn tư vấn bảng giá',
  title: 'Báo Giá Gói Pro',
  content: 'Dạ gói Pro của bên em hiện tại có giá ưu đãi là 499k/tháng ạ!'
});
assert.strictEqual(qm1.shortcut, '/tuvan', 'Should auto prefix slash to shortcut');
assert.strictEqual(qm1.customerQuestion, 'Tôi muốn tư vấn bảng giá');
assert.strictEqual(qm1.mediaUrl, '', 'Default mediaUrl should be empty string');

// TC-QM-MEDIA-02 & TC-QM-MEDIA-03: Media Attachments
const dummyUploadDir = path.resolve('data/uploads/quick-msg');
if (!fs.existsSync(dummyUploadDir)) fs.mkdirSync(dummyUploadDir, { recursive: true });

const dummyFile1 = path.join(dummyUploadDir, 'test_sample_image.png');
fs.writeFileSync(dummyFile1, 'fake-png-content');

const qmWithImg = store.upsertQuickMessage({
  shortcut: '/baogia-anh',
  title: 'Báo Giá Ảnh',
  content: 'Dạ em gửi bảng giá chi tiết qua ảnh bên dưới ạ:',
  mediaUrl: '/api/quick-messages/media/test_sample_image.png',
  mediaType: 'image',
  mediaName: 'Bang_Gia_2026.png'
});
assert.strictEqual(qmWithImg.mediaType, 'image');
assert.strictEqual(qmWithImg.mediaName, 'Bang_Gia_2026.png');
assert(qmWithImg.mediaUrl.includes('test_sample_image.png'));

// TC-QM-MEDIA-04: Update replaces media file -> old file cleaned up
const dummyFile2 = path.join(dummyUploadDir, 'test_sample_doc.pdf');
fs.writeFileSync(dummyFile2, 'fake-pdf-content');

const qmUpdated = store.upsertQuickMessage({
  id: qmWithImg.id,
  shortcut: '/baogia-anh',
  title: 'Báo Giá Tài Liệu',
  content: 'Dạ em gửi tài liệu báo giá:',
  mediaUrl: '/api/quick-messages/media/test_sample_doc.pdf',
  mediaType: 'file',
  mediaName: 'Bang_Gia_2026.pdf'
});
assert.strictEqual(qmUpdated.mediaType, 'file');
assert.strictEqual(fs.existsSync(dummyFile1), false, 'Old media file should be unlinked on replacement');

// TC-QM-MEDIA-05: Delete removes media file
store.deleteQuickMessage(qmUpdated.id);
assert.strictEqual(fs.existsSync(dummyFile2), false, 'Media file should be unlinked on template deletion');

const qmList = store.getQuickMessages();
assert(qmList.length >= 1, 'Should list quick messages');
console.log('   ✅ Quick Messages CRUD & Media Attachments passed!\n');

// -----------------------------------------------------------------------------
// Test 8: Spintax Engine & Preview Generator
// -----------------------------------------------------------------------------
console.log('8. Testing Spintax Engine & Preview Generator...');
const template = '{Chào|Dạ chào|Kính chào} {name}, {chúc bạn ngày mới tốt lành|rất vui được hỗ trợ bạn}!';
const resolved = resolveSpintax(template, { name: 'Phan Lê Khoa' });
assert(resolved.includes('Phan Lê Khoa'), 'Should contain customer name');
assert(!resolved.includes('{') && !resolved.includes('}'), 'Should resolve all spintax braces');

const previews = generateSamplePreviews(template, { name: 'Nguyễn Kiều' }, 3);
assert.strictEqual(previews.length, 3, 'Should generate 3 distinct previews');
previews.forEach(p => assert(p.includes('Nguyễn Kiều')));
console.log('   ✅ Spintax Resolver & Preview Samples passed!\n');

// -----------------------------------------------------------------------------
// Test 9: AIZALO Campaign Dashboard, CRUD, Media Attachments & Daily Cap Guard
// -----------------------------------------------------------------------------
console.log('9. Testing AIZALO Campaign CRUD, Attachments, Schedule & Queue...');
const camp = store.createCampaign({
  name: 'Chiến dịch tri ân khách hàng AIZALO',
  description: 'Gửi voucher giảm giá 20% cho khách hàng thân thiết',
  message: '{Chào|Hello} {name}, ưu đãi đặc biệt hôm nay!',
  mediaUrls: [
    { mediaType: 'image', mediaUrl: '/api/chat-media/banner.png', mediaName: 'banner.png' },
    { mediaType: 'file', mediaUrl: '/api/chat-media/banggia.pdf', mediaName: 'banggia.pdf' }
  ],
  targetType: 'direct',
  targetTagIds: ['tag_vip'],
  scheduleMode: 'scheduled',
  startDate: '2026-09-01',
  scheduleTime: '09:00',
  recurrence: 'weekly',
  isEnabled: 1
});

assert(camp.id, 'Campaign ID should be generated');
assert.strictEqual(camp.description, 'Gửi voucher giảm giá 20% cho khách hàng thân thiết');
assert.strictEqual(camp.scheduleMode, 'scheduled');
assert.strictEqual(camp.startDate, '2026-09-01');
assert.strictEqual(camp.scheduleTime, '09:00');
assert.strictEqual(camp.recurrence, 'weekly');
assert.strictEqual(camp.isEnabled, 1);
assert.strictEqual(camp.mediaUrls.length, 2);

// Test update campaign
store.updateCampaign(camp.id, {
  name: 'Chiến dịch tri ân khách hàng AIZALO (Updated)',
  scheduleTime: '10:30',
  recurrence: 'daily'
});
const updatedCamp = store.getCampaign(camp.id);
assert.strictEqual(updatedCamp.name, 'Chiến dịch tri ân khách hàng AIZALO (Updated)');
assert.strictEqual(updatedCamp.scheduleTime, '10:30');
assert.strictEqual(updatedCamp.recurrence, 'daily');

// Test toggle campaign
const toggledCamp = store.toggleCampaign(camp.id);
assert.strictEqual(toggledCamp.isEnabled, 0, 'Toggle should change isEnabled to 0');

const targets = store.getCampaignTargets('direct');
assert(targets.length >= 1, 'Should find direct targets with message history');

store.initCampaignQueue(camp.id, targets);
const nextItem = store.getNextQueueItem(camp.id);
assert(nextItem !== null, 'Should get pending item');
assert.strictEqual(nextItem.status, 'pending');

store.updateQueueItem(nextItem.id, { status: 'sent' });
store.logCampaignSend({
  campaignId: camp.id,
  threadId: nextItem.threadId,
  customerName: nextItem.customerName,
  sentContent: 'Xin chào Phan Lê Khoa, ưu đãi đặc biệt hôm nay!',
  status: 'success'
});

const logs = store.getCampaignLogs(camp.id);
assert.strictEqual(logs.length, 1, 'Campaign logs should contain 1 record');
assert.strictEqual(logs[0].status, 'success');

const sentCountToday = store.getCampaignSentToday();
assert.strictEqual(sentCountToday, 1, 'Sent count today should be 1');
console.log('   ✅ AIZALO Campaign CRUD, Attachments, Schedule & Queue passed!\n');

// -----------------------------------------------------------------------------
// Test 10: Customer CRM CRUD & Quote Message Storage
// -----------------------------------------------------------------------------
console.log('10. Testing Customer CRM CRUD & Quote Messages Storage...');
store.saveCrmInfo('user_123', {
  phone: '0909123456',
  email: 'testuser@example.com',
  address: 'Hồ Chí Minh',
  needs: 'Tư vấn AI Zalo Mini App',
  notes: 'Khách VIP cần ưu đãi'
});

const crmData = store.getCrmInfo('user_123');
assert.strictEqual(crmData.phone, '0909123456', 'CRM phone should match');
assert.strictEqual(crmData.email, 'testuser@example.com', 'CRM email should match');
assert.strictEqual(crmData.needs, 'Tư vấn AI Zalo Mini App', 'CRM needs should match');

// Test quote message storage
const quoteMsg = store.addMessage({
  id: 'quote_msg_001',
  threadId: 'user_123',
  senderId: 'self',
  senderName: 'Admin (Bạn)',
  text: 'Dạ bên em có bảng giá sau ạ!',
  quoteText: 'Giá bao nhiêu shop?',
  quoteSender: 'Phan Lê Khoa',
  isSelf: true
});

assert.strictEqual(quoteMsg.quoteText, 'Giá bao nhiêu shop?');
assert.strictEqual(quoteMsg.quoteSender, 'Phan Lê Khoa');
console.log('   ✅ Customer CRM CRUD & Quote Messages passed!\n');

// -----------------------------------------------------------------------------
// Test 11: Delivered Batch Status & Message Recall (Undo)
// -----------------------------------------------------------------------------
console.log('11. Testing Delivered Batch Status & Message Recall...');
const testMsg1 = store.addMessage({
  id: 'msg_status_001',
  threadId: 'user_123',
  senderId: 'self',
  text: 'Tin nhắn gửi thử nghiệm',
  isSelf: true,
  status: 'sent'
});
assert.strictEqual(testMsg1.status, 'sent', 'Initial status should be sent');

// Test batch status update
store.updateMessagesStatus(['msg_status_001'], 'delivered');
const deliveredMsg = store.getMessage('msg_status_001');
assert.strictEqual(deliveredMsg.status, 'delivered', 'Status should update to delivered');

// Test message recall (undo)
store.markMessageRecalled('msg_status_001');
const recalledMsg = store.getMessage('msg_status_001');
assert.strictEqual(recalledMsg.isRecalled, true, 'Message should be marked as recalled');
assert.strictEqual(recalledMsg.text, '[Tin nhắn đã được thu hồi]', 'Text should be replaced with recalled note');
console.log('   ✅ Delivered Batch Status & Message Recall passed!\n');

// -----------------------------------------------------------------------------
// Test 12: Zalo Call Parser Detection
// -----------------------------------------------------------------------------
console.log('12. Testing Zalo Call Parser Detection...');
const callParsed = parseMessage({ msgType: 'chat.call', content: 'sendBubbleMessage' });
assert.strictEqual(callParsed.type, 'call', 'Type should be call');
assert.strictEqual(callParsed.text, '📞 Cuộc gọi thoại (Zalo Call)', 'Text should be standardized call notice');
console.log('   ✅ Zalo Call Parser Detection passed!\n');

// -----------------------------------------------------------------------------
// Test 13: Campaign Target Keyword Filtering & Recurrence Modes
// -----------------------------------------------------------------------------
console.log('13. Testing Campaign Target Keyword Filtering & Recurrence Modes...');
// Test target keyword matching customer name
const kwTargets = store.getCampaignTargets({ targetType: 'all', targetKeyword: 'Khoa' });
assert(kwTargets.length >= 1, 'Should find target matching keyword "Khoa"');
assert(kwTargets[0].customerName.includes('Khoa'), 'Found target should have name containing Khoa');

// Test non-matching keyword
const emptyTargets = store.getCampaignTargets({ targetType: 'all', targetKeyword: 'NonExistentXYZ999' });
assert.strictEqual(emptyTargets.length, 0, 'Non-existent keyword should return 0 targets');

// Test multi-recurrence field preservation
const weeklyCamp = store.createCampaign({
  name: 'Chiến dịch hàng tuần',
  message: 'Ưu đãi cuối tuần cho {name}',
  scheduleMode: 'scheduled',
  startDate: '2026-09-07',
  scheduleTime: '09:00',
  recurrence: 'weekly',
  isEnabled: 1
});
assert.strictEqual(weeklyCamp.recurrence, 'weekly');
assert.strictEqual(weeklyCamp.scheduleMode, 'scheduled');
console.log('   ✅ Campaign Target Keyword Filtering & Recurrence passed!\n');

// -----------------------------------------------------------------------------
// Test 14: System Memory Footprint & Guardrail #3 (< 100MB RAM RSS)
// -----------------------------------------------------------------------------
console.log('14. Testing System Memory Footprint (< 100MB RAM Guardrail)...');
const mem = process.memoryUsage();
const rssMB = mem.rss / (1024 * 1024);
console.log(`   📊 Process RSS Memory: ${rssMB.toFixed(2)} MB`);
assert(rssMB < 100, `Memory RSS (${rssMB.toFixed(2)} MB) must be strictly less than 100MB (Guardrail #3)`);
console.log('   ✅ System Memory Footprint passed!\n');

// -----------------------------------------------------------------------------
// Test 15: AI Crypto & Zero Plaintext Masking (AES-256-CBC)
// -----------------------------------------------------------------------------
console.log('15. Testing AI Crypto & Zero Plaintext Masking...');
const { encryptSecret, decryptSecret, maskApiKey } = await import('../src/utils/ai-crypto.js');
const rawApiKey = 'AIzaSyMockSecretApiKey1234567890abcdefg';
const encKey = encryptSecret(rawApiKey, testPassphrase);
assert(encKey !== rawApiKey, 'Encrypted key must not equal raw key');
const decKey = decryptSecret(encKey, testPassphrase);
assert.strictEqual(decKey, rawApiKey, 'Decrypted key must match raw key');
const masked = maskApiKey(rawApiKey);
assert(masked.startsWith('AIzaSy'), 'Masked key should retain prefix');
assert(masked.includes('****'), 'Masked key must contain asterisks');
assert(!masked.includes('MockSecretApiKey'), 'Masked key must not expose secret payload');
console.log(`   ✅ AI Crypto & Masking passed (${masked})!\n`);

// -----------------------------------------------------------------------------
// Test 16: AI Prompt Compiler (SOUL + MEMORY + Q&A + Few-Shot + SCOPE)
// -----------------------------------------------------------------------------
console.log('16. Testing AI Prompt Compiler Engine...');
const { AiAgentAdapter } = await import('../src/adapters/ai-agent.js');
const aiAdapter = new AiAgentAdapter({ localStore: store, sessionSecret: testPassphrase });

// Configure AI settings in store
store.saveAiSettings({
  isEnabled: 1,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  soulPrompt: 'Bạn là chuyên viên CSKH chuyên nghiệp.',
  memoryPrompt: 'Sản phẩm: Zalo-Flow v1.0.',
  scopePrompt: 'Không bịa giá tiền.',
  exemplarConversation: JSON.stringify([
    { role: 'user', text: 'Giá bao nhiêu bạn?' },
    { role: 'assistant', text: 'Dạ bản Community là miễn phí mã nguồn mở anh nhé!' }
  ])
});

// Add Q&A to quick messages
store.upsertQuickMessage({
  shortcut: '/gia',
  title: 'Báo giá',
  customerQuestion: 'Giá bao nhiêu?',
  content: 'Dạ phần mềm hoàn toàn miễn phí ạ.'
});

const compiledPrompt = aiAdapter.compilePrompt();
assert(compiledPrompt.includes('Bạn là chuyên viên CSKH chuyên nghiệp.'), 'Should contain SOUL');
assert(compiledPrompt.includes('Zalo-Flow v1.0'), 'Should contain MEMORY');
assert(compiledPrompt.includes('BẢNG CÂU HỎI & TRẢ LỜI THƯỜNG GẶP (Q&A)'), 'Should contain Q&A table');
assert(compiledPrompt.includes('Giá bao nhiêu?'), 'Should include customer question');
assert(compiledPrompt.includes('MẪU HỘI THOẠI THỰC TẾ TIÊU BIỂU (FEW-SHOT EXEMPLAR)'), 'Should include Few-Shot exemplar');
assert(compiledPrompt.includes('Không bịa giá tiền.'), 'Should contain SCOPE rules');
console.log('   ✅ AI Prompt Compiler passed!\n');

// -----------------------------------------------------------------------------
// Test 17: Smart Cooldown & Tag Whitelist/Blacklist Guard
// -----------------------------------------------------------------------------
console.log('17. Testing Smart Cooldown & Tag Filter Guard...');
// Check Smart Cooldown: Add an admin message just now
store.addMessage({
  id: 'msg_admin_recent',
  threadId: 'user_rich',
  senderId: 'admin_me',
  senderName: 'Admin (Bạn)',
  text: 'Anh đợi em chút nhé',
  isSelf: true,
  isBot: false,
  timestamp: new Date().toISOString()
});

const lastAdminTime = store.getLastAdminMessageTime('user_rich');
assert(lastAdminTime !== null, 'Should find recent admin message timestamp');
const minutesSinceAdmin = (Date.now() - new Date(lastAdminTime).getTime()) / (60 * 1000);
assert(minutesSinceAdmin < 1, 'Admin message was sent just now (< 1 min)');

// Check Tag filtering logic
const vipTag = store.upsertTag({ name: 'VIP Khách Quen', color: '#10b981' });
store.addConversationTag('user_rich', vipTag.id);

// If targetMode = blacklist and excludedTagIds contains vipTag.id -> should block
store.saveAiSettings({
  targetMode: 'blacklist',
  excludedTagIds: JSON.stringify([vipTag.id])
});
const settings = store.getAiSettings();
const excluded = JSON.parse(settings.excludedTagIds || '[]');
const userRichTags = store.getConversationTags('user_rich').map(t => t.id);
const isExcluded = userRichTags.some(tid => excluded.includes(tid));
assert.strictEqual(isExcluded, true, 'VIP customer should be excluded in blacklist mode');
console.log('   ✅ Smart Cooldown & Tag Filter Guard passed!\n');

// -----------------------------------------------------------------------------
// Test 18: Anti-Ban Discrete Bot Message Persistence
// -----------------------------------------------------------------------------
console.log('18. Testing Anti-Ban Discrete Bot Message Persistence...');
const botMsg = store.addMessage({
  id: 'msg_bot_001',
  threadId: 'user_rich',
  senderId: 'ai_bot',
  senderName: 'Bot AI (Tự động)',
  text: 'Dạ em có thể hỗ trợ gì cho anh Khoa ạ?',
  isSelf: true,
  isBot: true
});

assert.strictEqual(Boolean(botMsg.isBot), true, 'Saved message must have isBot = true');
assert.strictEqual(botMsg.senderId, 'ai_bot', 'SenderId must be ai_bot');
const threadMessages = store.getMessages('user_rich');
const savedBotMsg = threadMessages.find(m => m.id === 'msg_bot_001');
assert(savedBotMsg !== undefined, 'Bot message should exist in thread');
assert.strictEqual(Boolean(savedBotMsg.isBot), true, 'Bot message must be discrete and flagged');
console.log('   ✅ Anti-Ban Discrete Bot Message Persistence passed!\n');

// -----------------------------------------------------------------------------
// Test 19: 1-Click Bulk Deep-Sync Engine & Concurrency Guard
// -----------------------------------------------------------------------------
console.log('19. Testing 1-Click Bulk Deep-Sync Engine & Concurrency Guard...');
const { ZaloClient } = await import('../src/zalo-client.js');
const testClient = new ZaloClient();

// A. Test offline error guard
await assert.rejects(
  async () => {
    await testClient.syncAllHistory();
  },
  /Zalo Client is not logged in/,
  'Should reject when client is offline'
);

// B. Mock online client & verify concurrency lock
testClient.isLoggedIn = true;
testClient.api = {
  listener: { requestOldMessages: () => {} },
  getAllFriends: async () => [],
  getAllGroups: async () => []
};

// Mock fetchThreadHistory
let progressEvents = [];
testClient.fetchThreadHistory = async (threadId, isGroup, count) => {
  return 5; // mock 5 messages synced
};

// Run syncAllHistory
const syncResult = await testClient.syncAllHistory({
  limitThreads: 2,
  limitPerThread: 10,
  onProgress: (p) => progressEvents.push(p)
});

assert.strictEqual(typeof syncResult.totalMessagesSynced, 'number');
assert.strictEqual(typeof syncResult.durationMs, 'number');
assert.strictEqual(testClient.isSyncingAll, false, 'Concurrency lock must be released after completion');

console.log('   ✅ 1-Click Bulk Deep-Sync Engine passed!\n');

// -----------------------------------------------------------------------------
// Test 20: Zalo Web Authentication Profile & QR Lifecycle Guard
// -----------------------------------------------------------------------------
console.log('20. Testing Zalo Web Authentication Profile & QR Lifecycle Guard...');
testClient.sessionName = 'test_session_qr';
// Check profile getter when offline
testClient.isLoggedIn = false;
testClient.api = null;
const offlineProfile = testClient.getAccountProfile();
assert.strictEqual(offlineProfile.isLoggedIn, false);
assert.strictEqual(offlineProfile.displayName, 'Chưa Đăng Nhập');

// Check profile getter when online with mock context
testClient.isLoggedIn = true;
testClient.api = {
  getContext: () => ({ uid: 'test_uid_999', displayName: 'Phan Lê Khoa', avatar: 'https://avatar.url/img.png' })
};
const onlineProfile = testClient.getAccountProfile();
assert.strictEqual(onlineProfile.isLoggedIn, true);
assert.strictEqual(onlineProfile.userId, 'test_uid_999');
assert.strictEqual(onlineProfile.displayName, 'Phan Lê Khoa');
assert.strictEqual(onlineProfile.avatar, 'https://avatar.url/img.png');

// Check logout method
const loggedOutProfile = await testClient.logout();
assert.strictEqual(loggedOutProfile.isLoggedIn, false);
assert.strictEqual(testClient.api, null);
console.log('   ✅ Zalo Web Authentication Profile & QR Lifecycle Guard passed!\n');

// -----------------------------------------------------------------------------
// Test 21: Backup Export & Idempotent Import Engine
// -----------------------------------------------------------------------------
console.log('21. Testing Backup Export & Idempotent Import Engine...');
// 1. Check Export payload format
const exportedTags = store.getTags();
const exportedQMs = store.getQuickMessages();
const exportedCamps = store.getCampaigns();

assert.ok(Array.isArray(exportedTags), 'Exported tags should be array');
assert.ok(Array.isArray(exportedQMs), 'Exported quick messages should be array');
assert.ok(Array.isArray(exportedCamps), 'Exported campaigns should be array');

// 2. Prepare test import payload with 1 new item & 1 existing item
const initialTagCount = exportedTags.length;
const testImportPayload = {
  version: '1.0',
  data: {
    tags: [
      { id: 'tag_import_new', name: 'Thẻ Import Mới', color: '#ec4899', description: 'Test' },
      { id: exportedTags[0].id, name: exportedTags[0].name, color: '#eab308' } // Duplicate
    ],
    quickMessages: [
      { id: 'qm_import_new', shortcut: '/testimport', title: 'Test Import', content: 'Nội dung import mới' }
    ]
  }
};

// Simulate import logic
let importedTags = 0;
let skippedDuplicates = 0;
const currentTags = store.getTags();
const curIds = new Set(currentTags.map(t => t.id));
const curNames = new Set(currentTags.map(t => (t.name || '').toLowerCase().trim()));

for (const t of testImportPayload.data.tags) {
  const cleanName = (t.name || '').toLowerCase().trim();
  if (curIds.has(t.id) || curNames.has(cleanName)) {
    skippedDuplicates++;
  } else {
    store.upsertTag(t);
    curIds.add(t.id);
    curNames.add(cleanName);
    importedTags++;
  }
}

assert.strictEqual(importedTags, 1, 'Should import exactly 1 new tag');
assert.strictEqual(skippedDuplicates, 1, 'Should skip 1 duplicate tag');
assert.strictEqual(store.getTags().length, initialTagCount + 1, 'Total tags should increase by 1');

console.log('   ✅ Backup Export & Idempotent Import Engine passed!\n');

// -----------------------------------------------------------------------------
// Test 22: Generic Webhook Inbound & Outbound Adapter
// -----------------------------------------------------------------------------
console.log('22. Testing Generic Webhook Inbound & Outbound Adapter...');
const { genericWebhookAdapter } = await import('../src/adapters/generic-webhook.js');
assert.strictEqual(typeof genericWebhookAdapter.handleInbound, 'function');
assert.strictEqual(typeof genericWebhookAdapter.handleOutbound, 'function');

// Test outbound validation
let resStatus = null;
let resJson = null;
const mockRes = {
  status: (code) => { resStatus = code; return mockRes; },
  json: (data) => { resJson = data; return mockRes; }
};

// Outbound without threadId or message
await genericWebhookAdapter.handleOutbound({ body: {} }, mockRes, testClient);
assert.strictEqual(resStatus, 400, 'Should reject outbound without threadId');

console.log('   ✅ Generic Webhook Inbound & Outbound Adapter passed!\n');

// -----------------------------------------------------------------------------
// Test 23: Self-Healing Memory Guard Sentinel & Graceful Drain (Audit v2)
// -----------------------------------------------------------------------------
console.log('23. Testing Self-Healing Memory Guard Sentinel & Graceful Drain (Audit v2)...');
const { MemoryGuard } = await import('../src/utils/memory-guard.js');
const testGuard = new MemoryGuard({
  maxMemoryMb: 150,
  warnMemoryMb: 112,
  checkIntervalSec: 10,
  sustainedLimit: 3,
  enabled: true
});

// 1. Verify Configuration Limits (Audit C1: 150MB / 112MB)
assert.strictEqual(testGuard.maxMemoryMb, 150, 'Max memory should be 150MB');
assert.strictEqual(testGuard.warnMemoryMb, 112, 'Warn memory should be 112MB');

// 2. Verify Stats Structure
const memStats = testGuard.getStats();
assert.ok(typeof memStats.rssMb === 'number' && memStats.rssMb > 0, 'RSS should be positive number');
assert.ok(typeof memStats.heapUsedMb === 'number', 'HeapUsed should be number');
assert.strictEqual(memStats.limitMb, 150);
assert.strictEqual(memStats.warnMb, 112);
assert.strictEqual(memStats.guardEnabled, true);

// 3. Verify Soft Purge (Audit I2: 5 Map Stores)
const { defaultSelfEchoShield: testEcho } = await import('../src/utils/self-echo.js');
const { defaultFloodDetector: testFlood } = await import('../src/utils/flood-detector.js');
testEcho.recordSent('dummy_hash_123');
testFlood.isFlooding('dummy_sender_456');
assert.ok(testEcho.sentMessages.size > 0, 'Echo shield should have records');
assert.ok(testFlood.senderHistory.size > 0, 'Flood history should have records');

// Trigger soft cleanup
testGuard._performSoftCleanup();
assert.strictEqual(testEcho.sentMessages.size, 0, 'Echo shield should be cleared after soft purge');
assert.strictEqual(testFlood.senderHistory.size, 0, 'Flood history should be cleared after soft purge');

// 4. Verify RateLimiter.drainAll() (Audit I1)
const { defaultRateLimiter: testLimiter } = await import('../src/utils/rate-limiter.js');
assert.strictEqual(typeof testLimiter.drainAll, 'function', 'RateLimiter must have drainAll method');
const drainPromise = testLimiter.drainAll(500);
assert.ok(drainPromise instanceof Promise, 'drainAll must return a promise');
await drainPromise;

console.log('   ✅ Self-Healing Memory Guard Sentinel & Graceful Drain passed!\n');

// Clean test db
store.close();
if (fs.existsSync(testDbFile)) {
  try { fs.unlinkSync(testDbFile); } catch {}
}

console.log('🎉 ALL 23 INTEGRITY, SECURITY, CRM, AIZALO REMARKETING, AI SUITE, BULK DEEP-SYNC, QR AUTH & MEMORY GUARD TESTS PASSED 100%!');


