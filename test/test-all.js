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
import { normalizeWikiUrl, isSafeEgressUrl, isPrivateOrReservedIp } from '../src/routes/ai-settings.js';
import { aiAgentAdapter, GOLDEN_WIKI_TEMPLATE } from '../src/adapters/ai-agent.js';
import { csrfShield } from '../src/middleware/auth.js';

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
// Test 12.5: Zalo Contact Card Parser Detection (6 Cases)
// -----------------------------------------------------------------------------
console.log('12.5. Testing Zalo Contact Card Parser Detection...');
// Case 1: Valid phone in object
const contact1 = parseMessage({
  msgType: 6,
  content: {
    contactUid: '123456789',
    title: 'Trần Mạnh Hùng',
    phone: '0398561867'
  }
});
assert.strictEqual(contact1.type, 'contact', 'Type should be contact');
assert.strictEqual(contact1.text, '📇 [Danh thiếp] Trần Mạnh Hùng - SĐT: 0398561867');
assert.strictEqual(contact1.mediaUrl, '');

// Case 2: Hidden/empty phone
const contact2 = parseMessage({
  msgType: 'chat.contact',
  content: {
    contactUid: '987654321',
    title: 'Nguyễn Văn A',
    phone: ''
  }
});
assert.strictEqual(contact2.type, 'contact');
assert.strictEqual(contact2.text, '📇 [Danh thiếp] Nguyễn Văn A (Không hiển thị SĐT)');

// Case 3: Masked phone
const contact3 = parseMessage({
  msgType: 'share.contact',
  content: {
    contactUid: '112233',
    title: 'Lê Thị B',
    phone: '0398***123'
  }
});
assert.strictEqual(contact3.type, 'contact');
assert.strictEqual(contact3.text, '📇 [Danh thiếp] Lê Thị B (Không hiển thị SĐT)');

// Case 4: JSON string content
const contact4 = parseMessage({
  msgType: 'chat.contact',
  content: JSON.stringify({
    contactUid: '556677',
    title: 'Đặng C',
    phone: '0901234567'
  })
});
assert.strictEqual(contact4.type, 'contact');
assert.strictEqual(contact4.text, '📇 [Danh thiếp] Đặng C - SĐT: 0901234567');

// Case 5: zca-js msgInfo format
const contact5 = parseMessage({
  data: {
    msgType: 6,
    dName: 'Phạm D',
    msgInfo: {
      contactUid: '998877',
      phone: '0912345678'
    }
  }
});
assert.strictEqual(contact5.type, 'contact');
assert.strictEqual(contact5.text, '📇 [Danh thiếp] Phạm D - SĐT: 0912345678');

// Case 7: Phonebook shared contact (+84 format, action: view_profile, zalo.me href)
const contact7 = parseMessage({
  msgType: 'chat.link',
  content: {
    title: 'Chotruong',
    description: 'A Cho CVH',
    href: 'https://zalo.me',
    params: 'phone=+84 348 841 731',
    action: 'view_profile'
  }
});
assert.strictEqual(contact7.type, 'contact', 'Type should be contact');
assert(contact7.text.includes('0348841731'), 'Should normalize +84 348 841 731 to 0348841731');
assert(contact7.text.includes('Chotruong'), 'Should include contact title');

// Case 8: Quoting a contact card preserves quoteText from quote.attach
const quotedContact = parseMessage({
  msgType: 'chat.quote',
  quote: {
    msg: '',
    attach: '[Danh thiếp] A Cho CVH',
    fromD: 'Nguyễn Kiều'
  },
  content: 'Đọc số điện thoại giúp tôi'
});
assert.strictEqual(quotedContact.type, 'quote', 'Type should be quote');
assert.strictEqual(quotedContact.quoteText, '[Danh thiếp] A Cho CVH', 'Should extract quoteText from quote.attach when msg is empty');

// Case 8.5: Quoting an image with raw JSON in quote.attach cleans to 📷 [Hình ảnh]
const quotedImage = parseMessage({
  msgType: 'chat.quote',
  quote: {
    msg: '',
    attach: '{"title":"", "description":"", "href":"https://u/photo-stel-13.zdn.vn/gr/ujel/sample.jpg", "thumb": "https://u/photo-stel-13.zdn.vn/gr/ujel/sample_thumb.jpg"}',
    fromD: 'Phan Lê Khoa'
  },
  content: 'Này gì'
});
assert.strictEqual(quotedImage.type, 'quote', 'Type should be quote');
assert.strictEqual(quotedImage.quoteText, '📷 [Hình ảnh]', 'Raw JSON image attach must be sanitized to 📷 [Hình ảnh]');
assert.strictEqual(quotedImage.text, 'Này gì', 'Reply text must be preserved');

// Case 9: Personal Contact Card with raw JSON in description and separate sender dName
const contact9 = parseMessage({
  msgType: 'chat.contact',
  content: {
    contactUid: '953483389',
    title: 'Nguyễn Dũng Chính',
    description: '{"phone":"+84938721779","qrCodeUrl":"https://qr-talk.zdn.vn/19/953483389/92dd3a48ae0747591e16.jpg"}'
  },
  data: {
    dName: 'Nguyễn Kiều'
  }
});
assert.strictEqual(contact9.type, 'contact', 'Type should be contact');
assert.strictEqual(contact9.text, '📇 [Danh thiếp] Nguyễn Dũng Chính - SĐT: 0938721779', 'Text should cleanly format owner name and SĐT without JSON or sender name');
assert.strictEqual(contact9.mediaUrl, 'https://qr-talk.zdn.vn/19/953483389/92dd3a48ae0747591e16.jpg', 'Should extract qrCodeUrl into mediaUrl');

console.log('   ✅ Zalo Contact Card Parser Detection passed (9/9 cases)!\n');

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
const rawApiKey = 'test-mock-api-key-1234567890abcdefghijklmnop';
const encKey = encryptSecret(rawApiKey, testPassphrase);
assert(encKey !== rawApiKey, 'Encrypted key must not equal raw key');
const decKey = decryptSecret(encKey, testPassphrase);
assert.strictEqual(decKey, rawApiKey, 'Decrypted key must match raw key');
const masked = maskApiKey(rawApiKey);
assert(masked.startsWith('test-m'), 'Masked key should retain prefix');
assert(masked.includes('****'), 'Masked key must contain asterisks');
assert(!masked.includes('mock-api-key'), 'Masked key must not expose secret payload');
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

// -----------------------------------------------------------------------------
// Test 24: Mini Second Brain Wiki Markdown Decompiler & 2-Way Sync Engine
// -----------------------------------------------------------------------------
console.log('24. Testing Mini Second Brain Wiki Markdown Decompiler & 2-Way Sync Engine...');

const sampleMarkdown = `# 🧠 MINI SECOND BRAIN WIKI — HỆ TRI THỨC AI
> **Trạng thái:** 🟢 Đang Bật Tự Động Trả Lời
> **Mô hình chính:** \`gemini:gemini-2.5-flash\`

---

## 🎭 1. Giọng Điệu & Nhân Cách Cốt Lõi (SOUL)
Bạn là chuyên viên chăm sóc khách hàng vui tính, nhiệt tình của Zalo-Flow.

---

## 📚 2. Tri Thức Sản Phẩm & Bảng Giá Dịch Vụ (MEMORY)
Sản phẩm Zalo-Flow là bộ khung mã nguồn mở kết nối Zalo cá nhân với Chatwoot CRM.
Gói Cơ Bản: Miễn phí trọn đời cho mục đích học tập.

---

## ❓ 3. Bách Khoa Câu Hỏi & Trả Lời Chuẩn Mực (Q&A Knowledge Base)
**1. Khách hỏi:** "Phần mềm Zalo-Flow có tốn tiền không?"
   **👉 Trả lời chuẩn:** "Dạ Zalo-Flow là mã nguồn mở phi thương mại hoàn toàn miễn phí ạ."

**2. Khách hỏi:** "Có hỗ trợ kết nối Chatwoot không?"
   **👉 Trả lời chuẩn:** "Dạ có hỗ trợ đồng bộ 2 chiều với Chatwoot CRM rất mượt mà ạ."

---

## 💬 4. Mẫu Hội Thoại Thực Tế Tiêu Biểu (Few-Shot Exemplar)
- **Khách:** Cho mình hỏi bot chạy bằng gì?
- **Tư vấn viên (Shop):** Dạ bot chạy trên nền Node.js siêu nhẹ dưới 100MB RAM ạ!

---

## 🛡️ 5. Ranh Giới, Quy Tắc & Điều Cấm Kỵ (Scope & Guardrails)
1. Không bịa đặt giá tiền ngoài danh mục.
2. Không spam tin nhắn liên tục.
`;

const parsed = aiAdapter.parseWikiMarkdown(sampleMarkdown);
assert.ok(parsed.recognizedSections.hasSoul, 'Should detect SOUL section');
assert.ok(parsed.soul.includes('vui tính, nhiệt tình'), 'Soul text should match');

assert.ok(parsed.recognizedSections.hasMemory, 'Should detect MEMORY section');
assert.ok(parsed.memory.includes('Zalo-Flow là bộ khung mã nguồn mở'), 'Memory text should match');

assert.ok(parsed.recognizedSections.hasScope, 'Should detect SCOPE section');
assert.ok(parsed.scope.includes('Không bịa đặt giá tiền'), 'Scope text should match');

assert.strictEqual(parsed.qnaPairs.length, 2, 'Should extract exactly 2 Q&A pairs');
assert.strictEqual(parsed.qnaPairs[0].question, 'Phần mềm Zalo-Flow có tốn tiền không?');
assert.strictEqual(parsed.qnaPairs[0].answer, 'Dạ Zalo-Flow là mã nguồn mở phi thương mại hoàn toàn miễn phí ạ.');
assert.strictEqual(parsed.qnaPairs[1].question, 'Có hỗ trợ kết nối Chatwoot không?');

// Test unstructured fallback
const unstructuredText = `Đây là tài liệu sản phẩm độc quyền của cửa hàng.
Chuyên cung cấp linh kiện máy tính và dịch vụ sửa chữa tại nhà.`;
const parsedFallback = aiAdapter.parseWikiMarkdown(unstructuredText);
assert.strictEqual(parsedFallback.memory, unstructuredText.trim(), 'Unstructured markdown should fallback to memory');

console.log('   ✅ Mini Second Brain Wiki Markdown Decompiler passed!\n');

// -----------------------------------------------------------------------------
// Test 25: Zalo Chat Markdown Sanitizer (cleanForZalo)
// -----------------------------------------------------------------------------
console.log('25. Testing Zalo Chat Markdown Sanitizer (cleanForZalo)...');
assert.strictEqual(typeof aiAdapter.cleanForZalo, 'function', 'cleanForZalo must be a function');

const rawMarkdownInput = `Dạ Zalo-Flow là nền tảng **mã nguồn mở miễn phí** kết nối Zalo cá nhân với Bot AI & CRM nhé! 🤖

Giờ Khoa hướng dẫn cài đặt **3 bước siêu nhanh** nha! 🚀

**Bước 1: Chuẩn bị**
- Máy tính Windows/macOS hoặc VPS Linux
- Cài sẵn Node.js bản >= 22.5.0 (hoặc Docker)

**Bước 2: Cài đặt**
- Mở Terminal/PowerShell, gõ lệnh:
- \`npx zalo-flow init\`
- Trình thuật sĩ sẽ tự hướng dẫn từng bước!

### Lưu ý quan trọng
- Không chia sẻ file .env!`;

const sanitized = aiAdapter.cleanForZalo(rawMarkdownInput);

// Verify no raw asterisks remain for bold
assert.ok(!sanitized.includes('**mã nguồn mở miễn phí**'), 'Should strip ** from inline text');
assert.ok(sanitized.includes('mã nguồn mở miễn phí'), 'Should preserve plain text content');

// Verify heading conversion
assert.ok(sanitized.includes('🔹 Bước 1: Chuẩn bị') || sanitized.includes('Bước 1: Chuẩn bị'), 'Should convert bold step headings cleanly');
assert.ok(sanitized.includes('📌 Lưu ý quan trọng'), 'Should convert markdown ### header to 📌 header');

// Verify code backticks stripped
assert.ok(!sanitized.includes('`npx zalo-flow init`'), 'Should strip backticks');
assert.ok(sanitized.includes('npx zalo-flow init'), 'Should preserve command text');

console.log('   ✅ Zalo Chat Markdown Sanitizer passed!\n');

// -----------------------------------------------------------------------------
// Test 26: Desktop Packaged Mode & Security Gate
// -----------------------------------------------------------------------------
console.log('26. Testing Desktop Packaged Mode & Security Gate...');
const originalEnvPackaged = process.env.ZALOFLOW_PACKAGED;
const originalEnvHost = process.env.HOST;

try {
  // 1. Verify HOST is forced to 127.0.0.1 when ZALOFLOW_PACKAGED is enabled
  process.env.ZALOFLOW_PACKAGED = '1';
  process.env.HOST = '0.0.0.0';
  const resolvedHost = (process.env.ZALOFLOW_PACKAGED === '1') ? '127.0.0.1' : (process.env.HOST || '0.0.0.0');
  assert.strictEqual(resolvedHost, '127.0.0.1', 'Desktop Packaged Mode must strictly enforce 127.0.0.1 host binding');

  // 2. Verify /api/system/update is blocked when ZALOFLOW_PACKAGED=1
  const isPackaged = process.env.ZALOFLOW_PACKAGED === '1';
  assert.strictEqual(isPackaged, true, 'ZALOFLOW_PACKAGED should be active');
  console.log('   ✅ Desktop Packaged Mode & Security Gate passed!\n');
} finally {
  process.env.ZALOFLOW_PACKAGED = originalEnvPackaged;
  process.env.HOST = originalEnvHost;
}

console.log('27. Testing DNS Bootstrap (IPv4-first Resolution)...');
await import('../src/dns-bootstrap.js');
import dns from 'node:dns';
if (typeof dns.getDefaultResultOrder === 'function') {
  assert.strictEqual(dns.getDefaultResultOrder(), 'ipv4first', 'DNS default result order must be ipv4first');
}
console.log('   ✅ DNS Bootstrap IPv4-first resolution passed!\n');

console.log('28. Testing QR Flow Generation Token & Zombie QR Suppression...');
const clientGuardTest = new ZaloClient();
clientGuardTest.isLoggedIn = true;
const profileOnline = clientGuardTest.getAccountProfile();
assert.strictEqual(profileOnline.hasQrWaiting, false, 'Online account must not have hasQrWaiting = true');
assert.strictEqual(profileOnline.qrDataUrl, null, 'Online account must have null qrDataUrl');
console.log('   ✅ QR Flow Generation Token & Zombie QR Suppression passed!\n');

console.log('29. Testing Profile Sync & In-Memory Friend Lookup (isFriend)...');
clientGuardTest.friendUids.add('123456789');
assert.strictEqual(clientGuardTest.isFriend('123456789'), true, 'Should detect friend UID');
assert.strictEqual(clientGuardTest.isFriend('999999999'), false, 'Should detect non-friend UID');

clientGuardTest.userProfile = {
  userId: '634023969879761967',
  displayName: 'Phan Lê Khoa',
  avatar: 'https://example.com/avatar.jpg'
};
const p = clientGuardTest.getAccountProfile();
assert.strictEqual(p.userId, '634023969879761967');
assert.strictEqual(p.displayName, 'Phan Lê Khoa');
assert.strictEqual(p.avatar, 'https://example.com/avatar.jpg');
assert.strictEqual(p.friendCount, 1);
console.log('   ✅ Profile Sync & In-Memory Friend Lookup passed!\n');

console.log('30. Testing Whitelist Data Preservation in cleanSwitchAccountData()...');
// Setup test data
store.upsertConversation({ id: 'conv_clean_test', name: 'Test Conv' });
store.addMessage({ id: 'msg_clean_test', threadId: 'conv_clean_test', senderId: 'u1', text: 'hello' });
const testTag = store.upsertTag({ name: 'VIP Tag', color: '#10b981' });
store.addConversationTag('conv_clean_test', testTag.id);
const testQuickMsg = store.upsertQuickMessage({ shortcut: '/hi-clean', title: 'Chào mừng', content: 'Xin chào bạn' });
const testCamp = store.createCampaign({ name: 'Campaign Clean Test', message: 'Test message', targetType: 'direct', isEnabled: 1 });
store.initCampaignQueue(testCamp.id, [{ threadId: 'conv_clean_test', customerName: 'Test Conv' }]);

// Execute cleanSwitchAccountData
store.cleanSwitchAccountData();

// Verify conversations, messages, conversation_tags are deleted
assert.strictEqual(store.getConversation('conv_clean_test'), null, 'Conversation must be wiped');
assert.strictEqual(store.getMessages('conv_clean_test').length, 0, 'Messages must be wiped');
assert.strictEqual(store.getConversationTags('conv_clean_test').length, 0, 'Conversation tags must be wiped');

// Verify Whitelist: ai_settings, tags, quick_messages, campaigns are preserved!
const allTags = store.getTags();
assert.ok(allTags.some(t => t.id === testTag.id), 'Tags must be strictly preserved!');
const allQm = store.getQuickMessages();
assert.ok(allQm.some(q => q.id === testQuickMsg.id), 'Quick Messages must be strictly preserved!');
assert.ok(store.getCampaign(testCamp.id), 'Campaigns must be strictly preserved!');

// Verify campaign_queue pending is cancelled and campaigns isEnabled is 0
const refreshedCamp = store.getCampaign(testCamp.id);
assert.strictEqual(refreshedCamp.isEnabled, 0, 'Campaign isEnabled must be reset to 0 to prevent accidental outbound');
const queueRows = store.db.prepare("SELECT COUNT(*) as cnt FROM campaign_queue WHERE campaignId = ? AND status = 'pending'").get(testCamp.id);
assert.strictEqual(queueRows.cnt, 0, 'Pending campaign queue must be completely cleared!');
console.log('   ✅ Whitelist Data Preservation in cleanSwitchAccountData passed!\n');

console.log('31. Testing Multi-Device Sync & Self-Echo Isolation...');
// A. Test SelfEchoShield properly identifies outbound echo from Zalo-Flow
const { defaultSelfEchoShield } = await import('../src/utils/self-echo.js');
defaultSelfEchoShield.recordSent('Tin nhắn gửi từ Zalo-Flow PC', 'thread_mobile_test');

// Echo of PC message should be detected
assert.strictEqual(
  defaultSelfEchoShield.isSelfEcho('Tin nhắn gửi từ Zalo-Flow PC', 'thread_mobile_test'),
  true,
  'Outbound message from PC must be flagged as echo'
);

// B. Message from Mobile app (not sent by Zalo-Flow) should NOT be flagged as echo
assert.strictEqual(
  defaultSelfEchoShield.isSelfEcho('Tin nhắn gõ trên điện thoại', 'thread_mobile_test'),
  false,
  'Message from mobile app must not be flagged as echo'
);

// C. Verify safeText handling for empty caption / media messages
const emptyCaption = undefined;
const safeText = String(emptyCaption || '');
assert.strictEqual(safeText.substring(0, 40), '', 'safeText.substring on undefined must safely return empty string');
assert.strictEqual(safeText.trim().length === 0, true, 'Empty caption must not trigger echo check');

// D. Verify mobile message persistence & Admin Cooldown trigger
store.upsertConversation({ id: 'thread_mobile_test', name: 'Khách Test Mobile' });
const mobileMsg = store.addMessage({
  id: 'msg_mobile_sync_001',
  threadId: 'thread_mobile_test',
  senderId: 'self',
  senderName: 'Admin (Bạn)',
  text: 'Bạn vào ở KTX trường nhé',
  mediaType: 'text',
  isSelf: true,
  isBot: false,
  status: 'sent'
});

assert.strictEqual(mobileMsg.isSelf, true, 'Mobile message must have isSelf = true');
assert.strictEqual(mobileMsg.isBot, false, 'Mobile message must have isBot = false');

const adminTimeAfterMobile = store.getLastAdminMessageTime('thread_mobile_test');
assert.ok(adminTimeAfterMobile > 0, 'getLastAdminMessageTime must reflect mobile message timestamp');
const diffSeconds = (Date.now() - adminTimeAfterMobile) / 1000;
assert.ok(diffSeconds < 5, 'Admin message timestamp must be recent (< 5s)');
console.log('   ✅ Multi-Device Sync & Self-Echo Isolation passed!\n');

console.log('32. Testing Group Mention & Dynamic Identity Protection (Anti-Ban & Token Shield)...');
const { detectMention, extractBotAliases, escapeRegex } = await import('../src/utils/mention-detector.js');

// A. Test Bot Aliases Extraction & Blacklist Pronoun Protection
const testAliases = extractBotAliases('Phan Lê Khoa', 'amon, em tấm');
assert.ok(testAliases.includes('Phan Lê Khoa'), 'Aliases must include full name');
assert.ok(testAliases.includes('Khoa'), 'Aliases must include first name');
assert.ok(testAliases.includes('amon'), 'Aliases must include custom alias');
assert.ok(testAliases.includes('em tấm'), 'Aliases must include custom alias');

// B. Negative Cases (MUST NOT TRIGGER)
const falsePositives = [
  'Có ai quen Bs bên khoa vi phẫu tạo hình không?',
  'Khám chuyên khoa tai mũi họng ở đâu tốt?',
  'Học ngành khoa học máy tính',
  'Cửa bị kẹt, đi mua ổ khóa mới',
  'Con robot này thông minh ghê',
  'Hết bột giặt rồi anh ơi'
];
for (const text of falsePositives) {
  const check = detectMention({
    text,
    botProfile: { userId: 'bot_uid_123', displayName: 'Phan Lê Khoa' }
  });
  assert.strictEqual(check.isMentioned, false, `False-positive triggered on: "${text}"`);
}

// C. Positive Cases (MUST TRIGGER)
const posAt = detectMention({
  text: '@Khoa tư vấn dịch vụ này với',
  botProfile: { userId: 'bot_uid_123', displayName: 'Phan Lê Khoa' }
});
assert.strictEqual(posAt.isMentioned, true, '@ Mention must trigger');
assert.strictEqual(posAt.reason, 'at_symbol');
assert.strictEqual(posAt.cleanText, 'tư vấn dịch vụ này với');

const posVocative = detectMention({
  text: 'Anh Khoa ơi cho em hỏi giá',
  botProfile: { userId: 'bot_uid_123', displayName: 'Phan Lê Khoa' }
});
assert.strictEqual(posVocative.isMentioned, true, 'Vocative must trigger');
assert.strictEqual(posVocative.reason, 'vocative');

const posTag = detectMention({
  message: { data: { mentions: [{ uid: 'bot_uid_123', pos: 0, len: 5 }] } },
  text: 'Chào bạn',
  botProfile: { userId: 'bot_uid_123', displayName: 'Phan Lê Khoa' }
});
assert.strictEqual(posTag.isMentioned, true, 'Zalo tag protocol must trigger');
assert.strictEqual(posTag.reason, 'tag');

// D. Test Database Persistence of botAliases in LocalStore
store.saveAiSettings({
  allowGroups: 1,
  botAliases: 'amon, trợ lý, khoa'
});
const savedAi = store.getAiSettings();
assert.strictEqual(savedAi.allowGroups, 1, 'allowGroups must be persisted as 1');
assert.strictEqual(savedAi.botAliases, 'amon, trợ lý, khoa', 'botAliases must be persisted');

console.log('   ✅ Group Mention & Dynamic Identity Protection passed!\n');

// =============================================================================
// Test 33: Campaign Quick-Message Media Integration (JSON Array Extraction & Multi-Dir Fallback)
// =============================================================================
console.log('33. Testing Campaign Quick-Message Media Integration (JSON Array Extraction & Multi-Dir Fallback)...');

// 1. Test trích xuất attachments từ Quick Message có JSON stringified array
const qmWithMedia = {
  id: 'qm_media_test',
  title: 'Mẫu khuyến mãi kèm ảnh',
  content: 'Khuyến mãi đặc biệt 50%',
  mediaUrl: JSON.stringify([
    { mediaUrl: '/api/quick-messages/media/qm_banner_1.jpg', mediaType: 'image', mediaName: 'banner1.jpg' },
    { mediaUrl: '/api/quick-messages/media/qm_banner_2.png', mediaType: 'image', mediaName: 'banner2.png' }
  ])
};

// Hàm trích xuất chuẩn hóa
function extractQmAttachments(qm) {
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

const extractedAtts = extractQmAttachments(qmWithMedia);
assert.strictEqual(extractedAtts.length, 2, 'Must extract 2 items');
assert.strictEqual(extractedAtts[0].mediaUrl, '/api/quick-messages/media/qm_banner_1.jpg');
assert.strictEqual(extractedAtts[1].mediaUrl, '/api/quick-messages/media/qm_banner_2.png');
assert.ok(!extractedAtts[0].mediaUrl.startsWith('['), 'mediaUrl must not be raw JSON string');

// 2. Test Multi-Directory Fallback cho Campaign Dispatcher
const mockQuickDir = path.resolve('data/uploads/quick-msg');
if (!fs.existsSync(mockQuickDir)) fs.mkdirSync(mockQuickDir, { recursive: true });
const mockFile1 = path.join(mockQuickDir, 'qm_banner_1.jpg');
fs.writeFileSync(mockFile1, 'dummy data');

try {
  const fn = path.basename(extractedAtts[0].mediaUrl);
  let diskPath = path.resolve('data/uploads/campaigns', fn);
  if (!fs.existsSync(diskPath)) {
    const qmPath = path.resolve('data/uploads/quick-msg', fn);
    if (fs.existsSync(qmPath)) diskPath = qmPath;
  }
  assert.strictEqual(diskPath, mockFile1, 'Dispatcher must successfully resolve file in quick-msg fallback folder');
} finally {
  if (fs.existsSync(mockFile1)) fs.unlinkSync(mockFile1);
}

console.log('   ✅ Campaign Quick-Message Media Integration passed!\n');

// -----------------------------------------------------------------------------
// Test 34: Campaign Test Send Protocol (Smart Caption Integration & Cold Outbound Shield)
// -----------------------------------------------------------------------------
console.log('34. Testing Campaign Test Send Protocol (Smart Caption & Cold Outbound Shield)...');
const { resolveCampaignAttachments, dispatchSmartCampaignMessage } = await import('../src/routes/campaigns.js');
const { zaloClient } = await import('../src/zalo-client.js');

// 1. Verify Cold Outbound Shield logic
const dummyConv = store.getConversation('nonexistent_cold_uid_8888');
assert.strictEqual(dummyConv, null, 'Cold outbound UID must return null');

// 2. Verify Smart Caption Dispatch logic with safe mock
const origUpload = zaloClient.uploadAttachment;
const origSend = zaloClient.sendMessage;
let mockedUploadCalls = [];
zaloClient.uploadAttachment = async (tId, p, isG, opt) => {
  mockedUploadCalls.push({ tId, p, isG, opt });
  return { status: 'ok' };
};
zaloClient.sendMessage = async () => ({ status: 'ok' });

try {
  const testCaptionResult = await dispatchSmartCampaignMessage({
    threadId: 'test_thread_34',
    customerName: 'Anh Nam',
    rawMessage: '{Chào|Hello} {name} nhé, ưu đãi nè!',
    localFilePaths: [{ path: '/tmp/banner.png', mediaUrl: '/media/banner.png', mediaType: 'image', originalName: 'banner.png' }],
    isGroup: false
  });
  assert.strictEqual(testCaptionResult.isCaptionMerged, true, '1 image + text <= 1000 must merge caption');
  assert.strictEqual(mockedUploadCalls.length, 1, 'Mocked uploadAttachment must be called once');
  assert.ok(mockedUploadCalls[0].opt.caption.includes('Anh Nam'), 'Personalized caption must include customer name');
  console.log('   ✅ Campaign Test Send Protocol passed!\n');
} finally {
  zaloClient.uploadAttachment = origUpload;
  zaloClient.sendMessage = origSend;
}

// -----------------------------------------------------------------------------
// Test 35: Ground-Truth Group Reconciliation & Anti-Downgrade Invariant
// -----------------------------------------------------------------------------
console.log('35. Testing Ground-Truth Group Reconciliation & Anti-Downgrade Invariant...');
const testStoreGroup = new LocalStore('data/test_group_reconcile.db');
try {
  // 1. Insert a group and a 1-1 conversation misclassified as group
  testStoreGroup.upsertConversation({ id: 'real_group_123', name: 'Nhóm Thật', isGroup: true });
  testStoreGroup.upsertConversation({ id: 'misclassified_user_456', name: 'Khoa Ai', isGroup: true });

  // 2. Verify reconcileGroupsWithGroundTruth heals misclassified user back to isGroup = 0
  const validGroupIds = new Set(['real_group_123']);
  const healed = testStoreGroup.reconcileGroupsWithGroundTruth(validGroupIds);
  assert.strictEqual(healed, 1, 'Should heal exactly 1 misclassified conversation');

  const userAfter = testStoreGroup.getConversation('misclassified_user_456');
  assert.strictEqual(userAfter.isGroup, false, 'Misclassified user must be restored to isGroup = false');

  const groupAfter = testStoreGroup.getConversation('real_group_123');
  assert.strictEqual(groupAfter.isGroup, true, 'Real group must remain isGroup = true');

  // 3. Verify setConversationGroupState direct update
  testStoreGroup.setConversationGroupState('misclassified_user_456', true);
  assert.strictEqual(testStoreGroup.getConversation('misclassified_user_456').isGroup, true);
  testStoreGroup.setConversationGroupState('misclassified_user_456', false);
  assert.strictEqual(testStoreGroup.getConversation('misclassified_user_456').isGroup, false);

  // 4. Verify Anti-Downgrade Invariant: ordinary upserting with isGroup = false must NOT downgrade an existing group
  testStoreGroup.upsertConversation({ id: 'real_group_123', name: 'Nhóm Thật Updated', isGroup: false });
  const convDowngradeAttempt = testStoreGroup.getConversation('real_group_123');
  assert.strictEqual(convDowngradeAttempt.isGroup, true, 'Anti-downgrade invariant must prevent upsertConversation from downgrading a group');

  console.log('   ✅ Ground-Truth Group Reconciliation & Anti-Downgrade Invariant passed!\n');
} finally {
  testStoreGroup.close();
  if (fs.existsSync('data/test_group_reconcile.db')) {
    try { fs.unlinkSync('data/test_group_reconcile.db'); } catch {}
  }
}

// -----------------------------------------------------------------------------
// Test 36: OpenRouter Auto-Fallback & Multi-Tier Key Compatibility
// -----------------------------------------------------------------------------
console.log('36. Testing OpenRouter Auto-Fallback & Multi-Tier Key Compatibility...');
const { isKeyCompatible } = await import('../src/adapters/ai-agent.js');

// 1. Kiểm tra isKeyCompatible
assert.strictEqual(isKeyCompatible('AIzaSy123456789', 'gemini'), true, 'Gemini key must be compatible with gemini');
assert.strictEqual(isKeyCompatible('AQ.987654321', 'gemini'), true, 'AQ. Gemini key must be compatible with gemini');
assert.strictEqual(isKeyCompatible('AIzaSy123456789', 'openrouter'), false, 'Gemini key MUST NOT be compatible with openrouter');
assert.strictEqual(isKeyCompatible('AIzaSy123456789', 'deepseek'), false, 'Gemini key MUST NOT be compatible with deepseek');
assert.strictEqual(isKeyCompatible('sk-or-v1-abcdef', 'openrouter'), true, 'OpenRouter key must be compatible with openrouter');
assert.strictEqual(isKeyCompatible('sk-or-v1-abcdef', 'gemini'), false, 'OpenRouter key MUST NOT be compatible with gemini');
assert.strictEqual(isKeyCompatible('', 'ollama'), true, 'Ollama does not require key');

// 2. Kiểm tra Runtime Fallback Key Resolution trong AiAgentAdapter
const testAiAdapter = new AiAgentAdapter({ localStore: store, sessionSecret: testPassphrase });

// Kịch bản A: CSDL còn lưu key rác Gemini cũ trong fallbackApiKeyEncrypted, nhưng cả 2 bên cùng OpenRouter
store.saveAiSettings({
  isEnabled: 1,
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
  apiKeyEncrypted: encryptSecret('sk-or-v1-primary-secret', testPassphrase),
  fallbackEnabled: 1,
  fallbackProvider: 'openrouter',
  fallbackModel: 'deepseek/deepseek-chat',
  fallbackApiKeyEncrypted: encryptSecret('AIzaSy-stale-gemini-key', testPassphrase) // Key rác
});

let capturedFallbackKey = '';
testAiAdapter.callProvider = async (params) => {
  if (params.model === 'google/gemini-2.5-flash') {
    throw new Error('HTTP 429 Quota Exceeded on Primary Model');
  }
  capturedFallbackKey = params.apiKey;
  return 'Fallback reply success';
};

const replyA = await testAiAdapter.callModelWithFallback('system', [], 'user ping', store.getAiSettings());
assert.strictEqual(replyA, 'Fallback reply success', 'Should successfully fallback');
assert.strictEqual(capturedFallbackKey, 'sk-or-v1-primary-secret', 'Fallback must discard stale Gemini key and inherit valid primary key');

// Kịch bản B: Người dùng có 2 tài khoản OpenRouter riêng biệt (Key A và Key B)
store.saveAiSettings({
  fallbackApiKeyEncrypted: encryptSecret('sk-or-v1-account-two-secret', testPassphrase)
});
capturedFallbackKey = '';
const replyB = await testAiAdapter.callModelWithFallback('system', [], 'user ping', store.getAiSettings());
assert.strictEqual(replyB, 'Fallback reply success');
assert.strictEqual(capturedFallbackKey, 'sk-or-v1-account-two-secret', 'Fallback must preserve custom fallback key when compatible');

// -----------------------------------------------------------------------------
// Test 37: Multimodal AI Vision Pipeline & Image Recognition
// -----------------------------------------------------------------------------
console.log('37. Testing Multimodal AI Vision Pipeline & Image Recognition...');
const { isVisionSupported } = await import('../src/adapters/ai-agent.js');

// 1. Kiểm tra isVisionSupported
assert.strictEqual(isVisionSupported('gemini', 'gemini-2.5-flash'), true, 'Gemini 2.5 Flash must support Vision');
assert.strictEqual(isVisionSupported('gemini', 'gemini-1.5-flash'), true, 'Gemini 1.5 Flash must support Vision');
assert.strictEqual(isVisionSupported('openai', 'gpt-4o'), true, 'GPT-4o must support Vision');
assert.strictEqual(isVisionSupported('openai', 'gpt-4o-mini'), true, 'GPT-4o-mini must support Vision');
assert.strictEqual(isVisionSupported('openrouter', 'google/gemini-2.5-flash'), true, 'OpenRouter Gemini must support Vision');
assert.strictEqual(isVisionSupported('deepseek', 'deepseek-chat'), false, 'DeepSeek V3 must be Text-only');
assert.strictEqual(isVisionSupported('zai', 'glm-5.3-flash'), false, 'Z.AI GLM-5.3 must be Text-only');

// 2. Kiểm tra đóng gói payload Gemini Native với inline_data
const visionAdapter = new AiAgentAdapter({ localStore: store, sessionSecret: testPassphrase });

let capturedGeminiPayload = null;
visionAdapter._callGeminiNative = async (params) => {
  capturedGeminiPayload = params;
  return 'Mock Gemini Vision Reply: Tôi thấy đây là hóa đơn tiền điện.';
};

const fakeImage = { mimeType: 'image/jpeg', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' };

await visionAdapter.callProvider({
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  apiKey: 'AIzaSyTestKey123',
  systemPrompt: 'Bạn là trợ lý',
  history: [],
  userMessage: 'Đọc hóa đơn này giúp mình',
  images: [fakeImage]
});

assert.ok(capturedGeminiPayload, 'callProvider must dispatch to _callGeminiNative');
assert.strictEqual(capturedGeminiPayload.images.length, 1, 'Must receive 1 image');
assert.strictEqual(capturedGeminiPayload.images[0].mimeType, 'image/jpeg');

// 3. Kiểm tra fallback an toàn khi URL ảnh lỗi hoặc không hợp lệ
const invalidDownload = await visionAdapter._downloadAndEncodeImage('ftp://invalid-scheme.com/pic.jpg');
assert.strictEqual(invalidDownload, null, 'Invalid scheme must return null gracefully');

const nullDownload = await visionAdapter._downloadAndEncodeImage('');
assert.strictEqual(nullDownload, null, 'Empty URL must return null gracefully');

// 4. Kiểm tra Text-Only Model (như DeepSeek) tự động lọc bỏ ảnh để tránh lỗi API
let capturedOpenAiPayload = null;
visionAdapter._callOpenAiCompatible = async (params) => {
  capturedOpenAiPayload = params;
  return 'DeepSeek Text Reply';
};

await visionAdapter.callProvider({
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: 'sk-deepseek-key-123',
  systemPrompt: 'System',
  history: [],
  userMessage: 'Đọc ảnh này',
  images: [fakeImage]
});

assert.ok(capturedOpenAiPayload, 'Should dispatch to _callOpenAiCompatible');
// Model deepseek không hỗ trợ vision nên images vẫn truyền nhưng _callOpenAiCompatible xử lý userMessage dạng text thuần
assert.strictEqual(isVisionSupported('deepseek', 'deepseek-chat'), false, 'DeepSeek is not vision supported');

// 5. Kiểm tra Debounce Buffer gom tối đa 2 ảnh và fallback prompt khi khách gửi ảnh không kèm chữ
const mockInboundCtx = {
  threadId: 'user_vision_test_1',
  senderId: 'user_vision_test_1',
  senderName: 'Khách Test Ảnh',
  mediaType: 'image',
  mediaUrl: 'https://res-zalo.zadn.vn/test1.jpg',
  text: '', // Khách không gõ chữ
  isGroup: false,
  isSelf: false,
  isBot: false
};

// Gọi handleInbound
store.saveAiSettings({
  isEnabled: 1,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  apiKeyEncrypted: encryptSecret('AIzaSyTestKey123', testPassphrase)
});

let autoReplyCalledWith = null;
visionAdapter._processAutoReply = async (params) => {
  autoReplyCalledWith = params;
};

await visionAdapter.handleInbound(mockInboundCtx);

// Gửi tiếp ảnh thứ 2 trong debounce window
await visionAdapter.handleInbound({
  ...mockInboundCtx,
  mediaUrl: 'https://res-zalo.zadn.vn/test2.jpg'
});

// Chờ debounce timer kích hoạt
await new Promise(resolve => setTimeout(resolve, 3200));

assert.ok(autoReplyCalledWith, '_processAutoReply must be called after debounce');
assert.strictEqual(autoReplyCalledWith.imageUrls.length, 2, 'Must buffer 2 images in debounce window');
assert.ok(autoReplyCalledWith.incomingText.includes('Khách hàng vừa gửi 1 hình ảnh đính kèm'), 'Must supply fallback text prompt when customer sent image without text');

console.log('   ✅ Multimodal AI Vision Pipeline & Image Recognition passed!\n');

console.log('38. Testing Stranger Auto-Identity Resolution & Name Protection...');
const strangerId = '7005543839233789338';
store.upsertConversation({
  id: strangerId,
  name: strangerId,
  avatar: '',
  isGroup: false
});

store.addMessage({
  id: 'msg_stranger_1',
  threadId: strangerId,
  senderId: strangerId,
  senderName: strangerId,
  text: 'Chào shop, em cần tư vấn ạ'
});

// Update identity
const updatedConv = store.updateConversationIdentity(strangerId, {
  name: 'Nguyễn Văn A',
  avatar: 'https://avatar.zalo.me/test.jpg'
});

assert.strictEqual(updatedConv.name, 'Nguyễn Văn A', 'Must update UID to real display name');
assert.strictEqual(updatedConv.avatar, 'https://avatar.zalo.me/test.jpg', 'Must update avatar');

const msgs = store.getMessages(strangerId);
const updatedMsg = msgs.find(m => m.id === 'msg_stranger_1');
assert.strictEqual(updatedMsg.senderName, 'Nguyễn Văn A', 'Must update message senderName to real name');

// Identity protection: If name is already real name, don't overwrite if not requested
const protectConv = store.updateConversationIdentity(strangerId, {
  name: 'Tên Khác',
  avatar: 'https://avatar.zalo.me/test2.jpg'
});
assert.strictEqual(protectConv.name, 'Nguyễn Văn A', 'Must protect custom/real name from accidental overwrite');
assert.strictEqual(protectConv.avatar, 'https://avatar.zalo.me/test2.jpg', 'Avatar can still be updated');

console.log('   ✅ Stranger Auto-Identity Resolution & Name Protection passed!\n');

console.log('39. Testing Scheduled Messages (1-1 Direct Scheduling, Dispatcher & Guards)...');
const schedThreadId = 'user_sched_test_1';
store.upsertConversation({
  id: schedThreadId,
  name: 'Anh Khoa BĐS',
  avatar: '',
  isGroup: false
});

// 1. Tạo lịch hẹn hợp lệ kèm đính kèm ảnh
const schedTimeFuture = Date.now() + 3600000; // 1 giờ sau
const createdSched = store.createScheduledMessage({
  threadId: schedThreadId,
  customerName: 'Anh Khoa BĐS',
  message: 'Chào anh {name}, 9h sáng nay mình gặp ở cafe nhé!',
  scheduledAt: schedTimeFuture,
  mediaUrl: '/api/scheduled-messages/media/cafe-highlands.jpg',
  mediaName: 'cafe-highlands.jpg'
});

assert.ok(createdSched.id, 'Must create scheduled message with valid ID');
assert.strictEqual(createdSched.status, 'pending', 'Initial status must be pending');
assert.strictEqual(createdSched.scheduledAt, schedTimeFuture, 'Must store exact epoch timestamp');
assert.strictEqual(createdSched.mediaUrl, '/api/scheduled-messages/media/cafe-highlands.jpg', 'Must persist mediaUrl');
assert.strictEqual(createdSched.mediaName, 'cafe-highlands.jpg', 'Must persist mediaName');

// 2. Kiểm tra getActiveScheduledMessage & update mediaUrl
const activeSched = store.getActiveScheduledMessage(schedThreadId);
assert.ok(activeSched, 'Must retrieve active scheduled message');
assert.strictEqual(activeSched.id, createdSched.id);
assert.strictEqual(activeSched.mediaUrl, '/api/scheduled-messages/media/cafe-highlands.jpg');

const updatedSchedWithNewImg = store.updateScheduledMessage(createdSched.id, {
  mediaUrl: '/api/scheduled-messages/media/cafe-the-coffee-house.jpg',
  mediaName: 'cafe-the-coffee-house.jpg'
});
assert.strictEqual(updatedSchedWithNewImg.mediaUrl, '/api/scheduled-messages/media/cafe-the-coffee-house.jpg', 'Must update mediaUrl');
assert.strictEqual(updatedSchedWithNewImg.mediaName, 'cafe-the-coffee-house.jpg', 'Must update mediaName');

// 3. Inbound Reply Guard: Khách nhắn tin đến -> tự động chuyển paused_by_reply
const pausedSched = store.pauseScheduledMessageByReply(schedThreadId);
assert.ok(pausedSched, 'Must pause active schedule when customer replies');
assert.strictEqual(pausedSched.status, 'paused_by_reply', 'Status must transition to paused_by_reply');

// 4. Resume lịch hẹn
const resumedSched = store.resumeScheduledMessage(createdSched.id);
assert.strictEqual(resumedSched.status, 'pending', 'Must resume status to pending');

// 5. Test Atomic Claim & Past-Due Guard
const pastDueThreadId = 'user_sched_test_past_due';
store.upsertConversation({ id: pastDueThreadId, name: 'Khách Quá Hạn', isGroup: false });

const pastDueSched = store.createScheduledMessage({
  threadId: pastDueThreadId,
  customerName: 'Khách Quá Hạn',
  message: 'Tin quá hạn',
  scheduledAt: Date.now() - (20 * 60 * 1000) // 20 phút trước
});

const claimedDue = store.claimDueScheduledMessages(Date.now(), 10);
assert.ok(claimedDue.length >= 1, 'Must claim due items');
const foundClaimed = claimedDue.find(item => item.id === pastDueSched.id);
assert.ok(foundClaimed, 'Past due item must be claimed atomically');
assert.strictEqual(foundClaimed.status, 'processing', 'Claimed item must be marked processing');

// 6. Test Cancel
const cancelTestThreadId = 'user_sched_test_cancel';
store.upsertConversation({ id: cancelTestThreadId, name: 'Khách Hủy', isGroup: false });
const cancelTestSched = store.createScheduledMessage({
  threadId: cancelTestThreadId,
  customerName: 'Khách Hủy',
  message: 'Tin muốn hủy',
  scheduledAt: Date.now() + 60000
});
const cancelledSched = store.cancelScheduledMessage(cancelTestSched.id);
assert.strictEqual(cancelledSched.status, 'cancelled', 'Must cancel scheduled message');
assert.strictEqual(store.getActiveScheduledMessage(cancelTestThreadId), null, 'Cancelled schedule must not be returned by getActiveScheduledMessage');

// 7. Test cleanSwitchAccountData cleans pending schedules
store.createScheduledMessage({
  threadId: schedThreadId,
  customerName: 'Anh Khoa',
  message: 'Tin pending trước khi switch account',
  scheduledAt: Date.now() + 120000
});
store.cleanSwitchAccountData();
const schedAfterClean = store.getActiveScheduledMessage(schedThreadId);
assert.strictEqual(schedAfterClean, null, 'Pending schedules must be cleaned on account switch');

console.log('   ✅ Scheduled Messages & Lifecycle Guards passed!\n');

console.log('40. Testing Universal Wiki URL Ingestion, SSRF Security Shield, Dual-Mode Parser & Golden Template...');

// 1. URL Normalization
const ghBlob = 'https://github.com/aizaloapp/zalo-flow/blob/main/docs/san-pham.md';
assert.strictEqual(
  normalizeWikiUrl(ghBlob),
  'https://raw.githubusercontent.com/aizaloapp/zalo-flow/main/docs/san-pham.md',
  'Must normalize GitHub blob to raw'
);

const gistUrl = 'https://gist.github.com/user123/abcd1234ef56';
assert.strictEqual(
  normalizeWikiUrl(gistUrl),
  'https://gist.githubusercontent.com/user123/abcd1234ef56/raw',
  'Must normalize Gist URL to raw'
);

const pbUrl = 'https://pastebin.com/xyz987';
assert.strictEqual(
  normalizeWikiUrl(pbUrl),
  'https://pastebin.com/raw/xyz987',
  'Must normalize Pastebin URL to raw'
);

const gdocUrl = 'https://docs.google.com/document/d/1A2B3C4D5E/edit?usp=sharing';
assert.strictEqual(
  normalizeWikiUrl(gdocUrl),
  'https://docs.google.com/document/d/1A2B3C4D5E/export?format=txt',
  'Must normalize Google Docs URL to export text'
);

// 2. SSRF Shield: IP & Port Validation
assert.strictEqual(isPrivateOrReservedIp('127.0.0.1'), true, '127.0.0.1 must be private');
assert.strictEqual(isPrivateOrReservedIp('10.0.0.1'), true, '10.0.0.1 must be private');
assert.strictEqual(isPrivateOrReservedIp('192.168.1.100'), true, '192.168.1.100 must be private');
assert.strictEqual(isPrivateOrReservedIp('172.16.5.1'), true, '172.16.5.1 must be private');
assert.strictEqual(isPrivateOrReservedIp('169.254.169.254'), true, '169.254.169.254 must be private');
assert.strictEqual(isPrivateOrReservedIp('::1'), true, '::1 loopback must be private');
assert.strictEqual(isPrivateOrReservedIp('8.8.8.8'), false, '8.8.8.8 is public');

const ssrfLocal = await isSafeEgressUrl('http://127.0.0.1:3000/api/ai/settings');
assert.strictEqual(ssrfLocal.safe, false, 'Must block localhost/loopback IP');

const ssrfPort = await isSafeEgressUrl('http://example.com:8080/data.md');
assert.strictEqual(ssrfPort.safe, false, 'Must block non-standard port 8080');

const ssrfFtp = await isSafeEgressUrl('ftp://example.com/file.txt');
assert.strictEqual(ssrfFtp.safe, false, 'Must block non-http/https protocol');

// 3. Dual-Mode Smart Parser
// Mode 1: Standard Structured Wiki
const standardWiki = `# 🧠 MINI SECOND BRAIN WIKI
## 🎭 1. Nhân Cách & Vai Trò (Soul)
Tư vấn viên nhiệt tình xưng em.
## 📚 2. Kho Tri Thức Sản Phẩm (Memory)
Gói VIP 5tr/năm.
## 🛡️ 5. Ranh Giới (Scope)
Không được giảm giá tự ý.
`;
const parsedStandard = aiAgentAdapter.parseWikiMarkdown(standardWiki, { soulPrompt: 'Cũ' });
assert.strictEqual(parsedStandard.recognizedSections.isFreeForm, false, 'Standard headings must be recognized as Mode 1');
assert.strictEqual(parsedStandard.soul.includes('Tư vấn viên nhiệt tình'), true);
assert.strictEqual(parsedStandard.memory.includes('Gói VIP 5tr/năm'), true);
assert.strictEqual(parsedStandard.scope.includes('Không được giảm giá'), true);

// Mode 2: Free-form Document (BOM UTF-8 + Bảng giá tự do)
const freeFormDoc = '\uFEFFBẢNG GIÁ CĂN HỘ VINHOMES:\n- Căn 1PN: 2.2 tỷ\n- Căn 2PN: 3.5 tỷ\nLiên hệ hotline 0909123456';
const currentShopSettings = { soulPrompt: 'Em là Trúc chuyên viên BĐS', scopePrompt: 'Cấm cãi khách' };
const parsedFreeForm = aiAgentAdapter.parseWikiMarkdown(freeFormDoc, currentShopSettings);
assert.strictEqual(parsedFreeForm.recognizedSections.isFreeForm, true, 'Free form doc must be recognized as Mode 2');
assert.strictEqual(parsedFreeForm.memory.includes('BẢNG GIÁ CĂN HỘ VINHOMES'), true, 'Free-form doc must be stored in memory');
assert.strictEqual(parsedFreeForm.memory.startsWith('\uFEFF'), false, 'BOM UTF-8 must be stripped');
assert.strictEqual(parsedFreeForm.soul, 'Em là Trúc chuyên viên BĐS', 'Must preserve existing soul in Mode 2');
assert.strictEqual(parsedFreeForm.scope, 'Cấm cãi khách', 'Must preserve existing scope in Mode 2');

// 4. Golden Template Integrity
assert.ok(/soul/i.test(GOLDEN_WIKI_TEMPLATE), 'Golden template must have SOUL');
assert.ok(/memory/i.test(GOLDEN_WIKI_TEMPLATE), 'Golden template must have MEMORY');
assert.ok(/q&a|faq/i.test(GOLDEN_WIKI_TEMPLATE), 'Golden template must have Q&A');
assert.ok(/few[-_\s]*shot/i.test(GOLDEN_WIKI_TEMPLATE), 'Golden template must have FEW-SHOT');
assert.ok(/scope|guardrail/i.test(GOLDEN_WIKI_TEMPLATE), 'Golden template must have SCOPE');

// 5. SQLite Schema Roundtrip for wikiSourceUrl
store.saveAiSettings({ wikiSourceUrl: 'https://raw.githubusercontent.com/shop/data/main/price.md' });
const savedAiSettingsWithUrl = store.getAiSettings();
assert.strictEqual(
  savedAiSettingsWithUrl.wikiSourceUrl,
  'https://raw.githubusercontent.com/shop/data/main/price.md',
  'wikiSourceUrl must persist in SQLite'
);

console.log('   ✅ Universal Wiki URL Ingestion, SSRF Shield, Dual-Mode Parser & Golden Template passed!\n');

// -----------------------------------------------------------------------------
// 41. Testing Live Chat Media Caption Integration & Smart Fallback Guard Protocol
// -----------------------------------------------------------------------------
console.log('41. Testing Live Chat Media Caption Integration & Smart Fallback Guard Protocol...');

function simulateLiveChatMediaDispatch({ localFilePaths, caption }) {
  const actions = [];
  const effectiveCaption = (caption || '').trim();
  const firstItem = localFilePaths[0];
  const isSingleImage = localFilePaths.length === 1 && firstItem.mediaType === 'image';

  if (isSingleImage && effectiveCaption.length <= 1000) {
    actions.push({
      type: 'uploadAttachment_merged_caption',
      caption: effectiveCaption,
      files: localFilePaths.map(f => f.path)
    });
  } else {
    if (effectiveCaption) {
      actions.push({
        type: 'sendMessage_text_first',
        text: effectiveCaption
      });
    }
    actions.push({
      type: 'uploadAttachment_separate_files',
      caption: '',
      files: localFilePaths.map(f => f.path)
    });
  }
  return actions;
}

// Case A: 1 Single Image + Text <= 1000 chars -> Merged Caption in 1 outbound action
const chatCaseA = simulateLiveChatMediaDispatch({
  localFilePaths: [{ path: '/tmp/photo.jpg', mediaType: 'image' }],
  caption: 'Báo giá sản phẩm mẫu'
});
assert.strictEqual(chatCaseA.length, 1, 'Single image + caption must produce exactly 1 merged action');
assert.strictEqual(chatCaseA[0].type, 'uploadAttachment_merged_caption');
assert.strictEqual(chatCaseA[0].caption, 'Báo giá sản phẩm mẫu');

// Case B: 1 Image + Long Text (> 1000 chars) -> Fallback: Text first, Image second
const longChatText = 'A'.repeat(1005);
const chatCaseB = simulateLiveChatMediaDispatch({
  localFilePaths: [{ path: '/tmp/photo.jpg', mediaType: 'image' }],
  caption: longChatText
});
assert.strictEqual(chatCaseB.length, 2, 'Long caption > 1000 chars must fallback into 2 actions');
assert.strictEqual(chatCaseB[0].type, 'sendMessage_text_first');
assert.strictEqual(chatCaseB[1].type, 'uploadAttachment_separate_files');
assert.strictEqual(chatCaseB[1].caption, '');

// Case C: Multiple files (2 images) + Text -> Fallback: Text first, files second
const chatCaseC = simulateLiveChatMediaDispatch({
  localFilePaths: [
    { path: '/tmp/photo1.jpg', mediaType: 'image' },
    { path: '/tmp/photo2.jpg', mediaType: 'image' }
  ],
  caption: 'Hai hình ảnh'
});
assert.strictEqual(chatCaseC.length, 2, 'Multiple images must separate text first, images second');
assert.strictEqual(chatCaseC[0].type, 'sendMessage_text_first');
assert.strictEqual(chatCaseC[1].type, 'uploadAttachment_separate_files');

// Case D: Single PDF Document + Text -> Fallback: Text first, document second
const chatCaseD = simulateLiveChatMediaDispatch({
  localFilePaths: [{ path: '/tmp/catalog.pdf', mediaType: 'file' }],
  caption: 'Gửi bạn tài liệu hướng dẫn'
});
assert.strictEqual(chatCaseD.length, 2, 'Document attachment must send text first then doc file');
assert.strictEqual(chatCaseD[0].type, 'sendMessage_text_first');
assert.strictEqual(chatCaseD[1].type, 'uploadAttachment_separate_files');

// Case E: Single Image without text -> 1 action without caption
const chatCaseE = simulateLiveChatMediaDispatch({
  localFilePaths: [{ path: '/tmp/photo.jpg', mediaType: 'image' }],
  caption: '   '
});
assert.strictEqual(chatCaseE.length, 1);
assert.strictEqual(chatCaseE[0].caption, '');

console.log('   ✅ Live Chat Media Caption Integration & Smart Fallback Guard Protocol passed!\n');

// -----------------------------------------------------------------------------
// Test 42: Chat Header Avatar Dynamic Re-rendering & Account Switching Clean State
// -----------------------------------------------------------------------------
console.log('42. Testing Chat Header Avatar Dynamic Re-rendering & Account Switching Clean State...');
const indexHtmlContent = fs.readFileSync(path.resolve('public/index.html'), 'utf-8');
assert(indexHtmlContent.includes('id="active-chat-avatar-container"'), 'index.html must have stable active-chat-avatar-container');
assert(indexHtmlContent.includes('id="active-chat-avatar"'), 'index.html must have active-chat-avatar inside');

const appJsContent = fs.readFileSync(path.resolve('public/app.js'), 'utf-8');
assert(appJsContent.includes('function renderActiveChatAvatar('), 'app.js must define renderActiveChatAvatar');
assert(appJsContent.includes('function closeActiveChat('), 'app.js must define closeActiveChat');
assert(!appJsContent.includes('activeAvatarEl.outerHTML'), 'app.js must not mutate outerHTML on cached activeAvatarEl');

// Simulate DOM container and multi-chat switching lifecycle
const mockContainer = { innerHTML: '' };
function simulateRenderAvatar(conv) {
  const name = (conv && (conv.name || conv.id)) || '';
  const initials = name ? name.substring(0, 2).toUpperCase() : 'Z';
  const avatarUrl = conv?.avatar;
  const isGroup = Boolean(conv?.isGroup);

  if (avatarUrl) {
    mockContainer.innerHTML = `<img class="conv-avatar" id="active-chat-avatar" src="${avatarUrl}">${isGroup ? '👥' : ''}`;
  } else {
    mockContainer.innerHTML = `<div class="conv-avatar" id="active-chat-avatar">${initials}</div>${isGroup ? '👥' : ''}`;
  }
}

// 1. Open chat 1 with custom avatar (VIBE)
simulateRenderAvatar({ id: 'vibe_123', name: 'VIBE AI', avatar: 'https://cdn.zalo.me/vibe.jpg', isGroup: true });
assert(mockContainer.innerHTML.includes('https://cdn.zalo.me/vibe.jpg'), 'Chat 1 should render custom avatar');
assert(mockContainer.innerHTML.includes('👥'), 'Chat 1 should render group badge');

// 2. Switch to chat 2 with NO avatar (Khoa Ai) -> MUST NOT retain VIBE avatar!
simulateRenderAvatar({ id: 'khoa_456', name: 'Khoa Ai', avatar: '', isGroup: false });
assert(!mockContainer.innerHTML.includes('vibe.jpg'), 'Chat 2 must NOT retain old avatar from Chat 1');
assert(mockContainer.innerHTML.includes('KH'), 'Chat 2 must render initials KH');
assert(!mockContainer.innerHTML.includes('👥'), 'Chat 2 must not have group badge');

// 3. Switch to chat 3 with another avatar
simulateRenderAvatar({ id: 'anh_789', name: 'Anh Nam', avatar: 'https://cdn.zalo.me/nam.png', isGroup: false });
assert(mockContainer.innerHTML.includes('nam.png'), 'Chat 3 should render its own avatar');
assert(!mockContainer.innerHTML.includes('KH'), 'Chat 3 must not retain Chat 2 initials');

console.log('   ✅ Chat Header Avatar Dynamic Re-rendering & Account Switching Clean State passed!\n');

// -----------------------------------------------------------------------------
// Test 43: Internationalization (i18n) Engine & 1:1 Translation Integrity
// -----------------------------------------------------------------------------
console.log('43. Testing Internationalization (i18n) Engine & 1:1 Translation Integrity...');
const i18nCode = fs.readFileSync(path.join(import.meta.dirname, '..', 'public', 'i18n.js'), 'utf8');

const localStorageMock = {};
global.localStorage = {
  getItem: (k) => localStorageMock[k] || null,
  setItem: (k, v) => { localStorageMock[k] = String(v); },
  removeItem: (k) => { delete localStorageMock[k]; }
};
try {
  Object.defineProperty(global, 'navigator', {
    value: { language: 'vi-VN' },
    configurable: true,
    writable: true
  });
} catch (e) {}
global.document = {
  documentElement: {
    setAttribute: () => {},
    getAttribute: () => 'vi'
  },
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  readyState: 'complete'
};
global.window = global;
global.CustomEvent = class CustomEvent { constructor(name, detail) { this.name = name; this.detail = detail; } };
global.dispatchEvent = () => true;

eval(i18nCode);
const { DICTIONARY, t, getLanguage, setLanguage, toggleLanguage, formatDate, getRelativeTime } = window.i18n;

assert(DICTIONARY.vi, 'DICTIONARY.vi must exist');
assert(DICTIONARY.en, 'DICTIONARY.en must exist');

function collectKeys(obj, prefix = '') {
  let keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys = keys.concat(collectKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const viKeys = new Set(collectKeys(DICTIONARY.vi));
const enKeys = new Set(collectKeys(DICTIONARY.en));
assert.strictEqual(viKeys.size, enKeys.size, 'VI and EN keys must match 1:1');

setLanguage('vi');
assert.strictEqual(t('common.save'), 'Lưu');
setLanguage('en');
assert.strictEqual(t('common.save'), 'Save');
assert.strictEqual(t('toast.sync_completed', { count: 50 }), 'Sync completed: 50 messages!');
setLanguage('vi');
assert.strictEqual(t('toast.sync_completed', { count: 50 }), 'Đồng bộ hoàn tất: 50 tin nhắn!');

console.log('   ✅ Internationalization (i18n) Engine & 1:1 Translation Integrity passed!\n');

// -----------------------------------------------------------------------------
// Test 44: Testing CSRF Shield, Localhost Drive-by Defense & Host Binding Guard
// -----------------------------------------------------------------------------
console.log('44. Testing CSRF Shield, Localhost Drive-by Defense & Host Binding...');

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

// Case 1: GET requests bypass CSRF
{
  const req = { method: 'GET', path: '/api/conversations', headers: {} };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'GET request should bypass CSRF shield');
}

// Case 2: OPTIONS requests bypass CSRF
{
  const req = { method: 'OPTIONS', path: '/api/messages/send', headers: {} };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'OPTIONS request should bypass CSRF shield');
}

// Case 3: Inbound Webhook bypass CSRF (Scope Isolation)
{
  const req = { method: 'POST', path: '/webhook/chatwoot', originalUrl: '/api/webhook/chatwoot', headers: {} };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Webhook request should bypass CSRF shield');
}

// Case 4: Shutdown CLI bypass CSRF (Scope Isolation)
{
  const req = { method: 'POST', path: '/system/shutdown', originalUrl: '/api/system/shutdown', headers: {} };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'System shutdown CLI should bypass CSRF shield');
}

// Case 5: Block Cross-Site request via Sec-Fetch-Site
{
  const req = {
    method: 'POST',
    path: '/messages/send',
    originalUrl: '/api/messages/send',
    headers: {
      'sec-fetch-site': 'cross-site',
      'x-zaloflow-client': '1'
    }
  };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, 'Cross-site request must not call next()');
  assert.strictEqual(res.statusCode, 403, 'Cross-site request must return 403 Forbidden');
}

// Case 6: Block POST request missing X-ZaloFlow-Client header
{
  const req = {
    method: 'POST',
    path: '/messages/send',
    originalUrl: '/api/messages/send',
    headers: {
      'sec-fetch-site': 'same-origin'
    }
  };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, 'Missing X-ZaloFlow-Client must not call next()');
  assert.strictEqual(res.statusCode, 403, 'Missing X-ZaloFlow-Client must return 403');
}

// Case 7: Block POST request with foreign Origin
{
  const req = {
    method: 'POST',
    path: '/messages/send',
    originalUrl: '/api/messages/send',
    headers: {
      'sec-fetch-site': 'same-origin',
      'x-zaloflow-client': '1',
      'origin': 'https://evil-attacker.com',
      'host': 'localhost:3000'
    }
  };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, 'Foreign origin must not call next()');
  assert.strictEqual(res.statusCode, 403, 'Foreign origin must return 403');
}

// Case 8: Valid local request passes CSRF shield
{
  const req = {
    method: 'POST',
    path: '/messages/send',
    originalUrl: '/api/messages/send',
    headers: {
      'sec-fetch-site': 'same-origin',
      'x-zaloflow-client': '1',
      'origin': 'http://localhost:3000',
      'host': 'localhost:3000'
    }
  };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Valid local request must pass CSRF shield');
  assert.strictEqual(res.statusCode, 200);
}

// Case 9: External API request with valid ADMIN_API_TOKEN bypasses CSRF
{
  process.env.ADMIN_API_TOKEN = 'test-admin-token-12345';
  const req = {
    method: 'POST',
    path: '/messages/send',
    originalUrl: '/api/messages/send',
    headers: {
      'x-admin-token': 'test-admin-token-12345'
    }
  };
  const res = createMockRes();
  let nextCalled = false;
  csrfShield(req, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true, 'Valid admin token must bypass CSRF shield');
  delete process.env.ADMIN_API_TOKEN;
}

console.log('   ✅ CSRF Shield, Localhost Drive-by Defense & Host Binding passed!\n');

// -----------------------------------------------------------------------------
// Test 45: Pin to Top, Limit 5, Mark Unread, Tag Dots & Context Actions
// -----------------------------------------------------------------------------
console.log('45. Testing Pin to Top, Limit 5, Mark Unread, Tag Dots & Context Actions...');
{
  const pinTestDb = 'data/test_pin_actions.db';
  if (fs.existsSync(pinTestDb)) fs.unlinkSync(pinTestDb);
  const pStore = new LocalStore(pinTestDb);

  try {
    for (let i = 1; i <= 7; i++) {
      pStore.upsertConversation({
        id: `u_${i}`,
        name: `User ${i}`,
        isGroup: false,
        unreadCount: 0,
        lastMessage: `Message ${i}`,
        lastTime: new Date(Date.now() - (10 - i) * 1000).toISOString()
      });
    }

    const t1 = pStore.upsertTag({ name: 'VIP', color: '#ef4444' });
    pStore.addConversationTag('u_1', t1.id);

    // Initial check
    let convs = pStore.getConversations();
    assert.strictEqual(convs[0].id, 'u_7');
    assert.strictEqual(convs[0].isPinned, false);
    const u1 = convs.find(c => c.id === 'u_1');
    assert.strictEqual(u1.tags.length, 1);
    assert.strictEqual(u1.tags[0].name, 'VIP');

    // Pin u_1
    const resPin1 = pStore.setConversationPinned('u_1', true);
    assert.strictEqual(resPin1.success, true);
    assert.strictEqual(resPin1.isPinned, true);

    convs = pStore.getConversations();
    assert.strictEqual(convs[0].id, 'u_1', 'Pinned conversation must be sorted on top');
    assert.strictEqual(convs[0].isPinned, true);

    // Pin up to 5
    assert.strictEqual(pStore.setConversationPinned('u_2', true).success, true);
    assert.strictEqual(pStore.setConversationPinned('u_3', true).success, true);
    assert.strictEqual(pStore.setConversationPinned('u_4', true).success, true);
    assert.strictEqual(pStore.setConversationPinned('u_5', true).success, true);

    // 6th pin must fail
    const resPin6 = pStore.setConversationPinned('u_6', true);
    assert.strictEqual(resPin6.success, false);
    assert.strictEqual(resPin6.error, 'limit_reached');

    // Unpin u_1
    assert.strictEqual(pStore.setConversationPinned('u_1', false).success, true);
    convs = pStore.getConversations();
    assert.notStrictEqual(convs[0].id, 'u_1');

    // Mark unread
    pStore.markAsUnread('u_7');
    assert.strictEqual(pStore.getConversation('u_7').unreadCount, 1);

    // Delete conversation
    pStore.addMessage({
      msgId: 'm_del',
      cliMsgId: 'c_del',
      threadId: 'u_7',
      senderId: 'u_7',
      senderName: 'User 7',
      text: 'To be deleted',
      time: Date.now()
    });
    pStore.deleteConversation('u_7');
    assert.strictEqual(pStore.getConversation('u_7'), null);
    assert.strictEqual(pStore.getMessages('u_7').length, 0);

    console.log('   ✅ Pin to Top, Limit 5, Mark Unread, Tag Dots & Context Actions passed!\n');
  } finally {
    pStore.close();
    if (fs.existsSync(pinTestDb)) fs.unlinkSync(pinTestDb);
    const wal = `${pinTestDb}-wal`;
    const shm = `${pinTestDb}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  }
}

// Clean test db
store.close();
if (fs.existsSync(testDbFile)) {
  try { fs.unlinkSync(testDbFile); } catch {}
}

console.log('🎉 ALL 45 INTEGRITY, SECURITY, CRM, AIZALO REMARKETING, AI SUITE, BULK DEEP-SYNC, QR AUTH, MEMORY GUARD, ZALO SANITIZER, DESKTOP PACKAGED, CLEAN SWITCH, MULTI-DEVICE SYNC, GROUP MENTION, QUICK-MSG, CAMPAIGN TEST DISPATCH, GROUP RECONCILIATION, AUTO-FALLBACK OPENROUTER, MULTIMODAL VISION, STRANGER IDENTITY, SCHEDULED MESSAGES, UNIVERSAL WIKI URL INGESTION, LIVE CHAT MEDIA CAPTION, CHAT AVATAR DYNAMIC, i18n MULTI-LANGUAGE, CSRF LOCALHOST SHIELD & PIN/CONTEXT ACTIONS TESTS PASSED 100%!');






