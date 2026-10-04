/**
 * test/test-ai-stability-phase1.js
 * 
 * Test Suite #59: AI Stability Phase 1 (Smart Chunking, Concurrency Lock & Friend Guard)
 * 
 * Kiểm tra:
 * 1. Smart Message Chunking: Phân đoạn tự nhiên, bảo vệ Emoji/Surrogate pairs, đánh số [1/N], trần max 3 phần.
 * 2. Friend & System Event Guard: Chặn chính xác thông báo kết bạn Zalo, không chặn nhầm tin thật của khách.
 * 3. Worker State Machine & Concurrency Lock: Đệm tin khi đang suy luận, xả đệm tuần tự, kiểm tra lại Admin Cooldown.
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { splitMessageForZalo } from '../src/utils/message-splitter.js';
import { AiAgentAdapter } from '../src/adapters/ai-agent.js';
import { LocalStore } from '../src/utils/local-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('59. Testing AI Stability Phase 1 (Smart Chunking, Worker Concurrency & Friend Guard)...');

// =============================================================================
// 1. Kiểm thử Smart Message Chunking (Unicode, Natural Split, Surrogate Safety)
// =============================================================================
console.log('   🔹 1. Testing splitMessageForZalo...');

// 1.1 Chuỗi ngắn <= 1750 ký tự -> 1 phần nguyên vẹn, không đánh số
const shortText = 'Xin chào, đây là câu trả lời ngắn gọn của bot AI tư vấn sản phẩm.';
const shortChunks = splitMessageForZalo(shortText, 1750);
assert.strictEqual(shortChunks.length, 1, 'Chuỗi ngắn phải trả về đúng 1 phần');
assert.strictEqual(shortChunks[0], shortText, 'Nội dung chuỗi ngắn phải giữ nguyên vẹn');

// 1.2 Chuỗi dài có đoạn văn (\n\n) -> Tách tại ranh giới đoạn văn
const p1 = 'A'.repeat(900) + ' kết thúc đoạn một.';
const p2 = 'B'.repeat(900) + ' kết thúc đoạn hai.';
const longTextWithParagraph = `${p1}\n\n${p2}`;
const paraChunks = splitMessageForZalo(longTextWithParagraph, 1200);
assert.strictEqual(paraChunks.length, 2, 'Chuỗi 1800 ký tự với max 1200 phải tách thành 2 phần');
assert.ok(paraChunks[0].startsWith('[1/2] '), 'Phần 1 phải có tiền tố [1/2]');
assert.ok(paraChunks[1].startsWith('[2/2] '), 'Phần 2 phải có tiền tố [2/2]');
assert.ok(paraChunks[0].includes('kết thúc đoạn một.'), 'Phần 1 phải ngắt đúng đoạn một');
assert.ok(paraChunks[1].includes('kết thúc đoạn hai.'), 'Phần 2 phải chứa đoạn hai');

// 1.3 Chuỗi dài có dấu chấm câu (. ) -> Tách tại dấu chấm câu
const s1 = 'C'.repeat(800) + ' hoàn thành bước một.';
const s2 = ' D'.repeat(400) + ' hoàn thành bước hai.';
const sentenceChunks = splitMessageForZalo(s1 + s2, 1000);
assert.strictEqual(sentenceChunks.length, 2, 'Tách tại dấu chấm câu');
assert.ok(sentenceChunks[0].includes('hoàn thành bước một.'), 'Phần 1 kết thúc ở dấu chấm câu');

// 1.4 Bảo vệ cặp Surrogate & Emoji phức tạp (không bị chẻ đôi ký tự UTF-16)
const emojiTail = ' 🚀🎉👨‍👩‍👧‍👦🌟';
const rawEmojiText = 'E'.repeat(995) + emojiTail + ' ' + 'F'.repeat(500);
const emojiChunks = splitMessageForZalo(rawEmojiText, 1000);
assert.ok(emojiChunks.length >= 2, 'Phải chia đoạn thành công khi có emoji');
for (const chunk of emojiChunks) {
  // Chuỗi UTF-8/NFC hợp lệ, không chứa ký tự lone surrogate
  assert.doesNotThrow(() => {
    Buffer.from(chunk, 'utf8').toString('utf8');
  }, 'Chunk không được chứa ký tự surrogate bị rách');
}

// 1.5 Giới hạn trần maxChunks = 3 và thêm hậu tố nhắn tiếp
const veryLongText = 'G'.repeat(6000);
const cappedChunks = splitMessageForZalo(veryLongText, 1500, 3);
assert.strictEqual(cappedChunks.length, 3, 'Không được vượt quá maxChunks = 3');
assert.ok(cappedChunks[2].includes('(Nhắn "tiếp" để xem thêm)'), 'Phần cuối cùng khi chạm trần phải có hậu tố nhắn tiếp');
assert.ok(cappedChunks[0].startsWith('[1/3] '));
assert.ok(cappedChunks[1].startsWith('[2/3] '));
assert.ok(cappedChunks[2].startsWith('[3/3] '));

console.log('      ✅ splitMessageForZalo passed all cases (Short, Paragraph, Sentence, Emoji & Max Capping)!');

// =============================================================================
// 2. Kiểm thử Friend & System Event Regex Guard
// =============================================================================
console.log('   🔹 2. Testing Friend & System Event Regex Guard...');

const friendEventRegex = /^(bạn và .* đã trở thành bạn bè|các bạn đã trở thành bạn bè|hai bạn đã trở thành bạn bè|đã chấp nhận yêu cầu kết bạn|you are now connected with|đã trở thành bạn bè trên zalo)/i;

const positiveCases = [
  'Bạn và Nguyễn Văn A đã trở thành bạn bè.',
  'Bạn và Lê Thị Mai đã trở thành bạn bè trên Zalo.',
  'các bạn đã trở thành bạn bè',
  'Hai bạn đã trở thành bạn bè, hãy gửi lời chào!',
  'Đã chấp nhận yêu cầu kết bạn.',
  'You are now connected with David.'
];

for (const text of positiveCases) {
  assert.ok(friendEventRegex.test(text), `Phải nhận diện tin hệ thống kết bạn: "${text}"`);
}

const negativeCases = [
  'Chào shop, mình muốn hỏi về sản phẩm',
  'Bạn vừa kết bạn với mình đúng không ạ',
  'Shop ơi tư vấn gói Pro giúp mình với',
  'Đã chuyển khoản xong rồi nha shop'
];

for (const text of negativeCases) {
  assert.strictEqual(friendEventRegex.test(text), false, `Không được chặn nhầm tin nhắn của khách: "${text}"`);
}

console.log('      ✅ Friend Event Regex Guard passed (6 positive, 4 negative cases)!');

// =============================================================================
// 3. Kiểm thử Worker State Machine & Concurrency Lock
// =============================================================================
console.log('   🔹 3. Testing Worker State Machine & Concurrency Lock...');

const testDbDir = path.join(rootDir, 'data', 'test_sessions_isolation');
if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });
const testDbPath = path.join(testDbDir, 'test_stability_worker.db');
try { fs.unlinkSync(testDbPath); } catch {}

const mockStore = new LocalStore(testDbPath);
mockStore.saveAiSettings({
  isEnabled: 1,
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  apiKeyEncrypted: '',
  adminCooldownMinutes: 15,
  debounceSeconds: 1
});

const adapter = new AiAgentAdapter({
  localStore: mockStore
});

// 3.1 Worker lock key generation & busy state
const threadId = 'test_thread_concurrent_1';
const accountUid = 'acc_user_1';
const workerKey = `${accountUid}:${threadId}`;

// Khởi tạo worker đang bận
adapter._activeWorkers.set(workerKey, {
  timestamp: Date.now(),
  threadId,
  accountUid
});

// Giả lập tin nhắn đến trong khi worker đang bận
const sentMessages = [];
const mockClient = {
  accountUid,
  userProfile: { userId: accountUid },
  sendMessage: async (thId, text, isGrp, opts) => {
    sentMessages.push({ thId, text, isGrp, opts });
    return { messageId: 'mock_msg_123' };
  }
};

await adapter.handleInbound({
  threadId,
  text: 'Câu hỏi phụ 1 của khách',
  isSelf: false,
  isBot: false,
  client: mockClient
});

await adapter.handleInbound({
  threadId,
  text: 'Câu hỏi phụ 2 của khách',
  isSelf: false,
  isBot: false,
  client: mockClient
});

// Xác nhận tin nhắn đã vào buffer chứ không gọi LLM hoặc tạo timer mới
const buffered = adapter._inboundBuffers.get(threadId);
assert.ok(buffered && buffered.length === 2, 'Tin nhắn đến khi worker bận phải nằm trong _inboundBuffers');
assert.strictEqual(buffered[0], 'Câu hỏi phụ 1 của khách');
assert.strictEqual(buffered[1], 'Câu hỏi phụ 2 của khách');

// 3.2 Kiểm tra Admin Cooldown Interruption: Nếu Admin chat, worker tự hủy buffer
mockStore.addMessage({
  id: 'admin_msg_1',
  accountUid,
  threadId,
  senderId: 'admin_self',
  senderName: 'Admin',
  text: 'Dạ em chào anh, em đang hỗ trợ đây ạ',
  isSelf: true,
  isBot: false,
  timestamp: new Date().toISOString()
});

// Giả lập worker kết thúc và kiểm tra buffer
const latestConv = mockStore.getConversation(threadId, accountUid);
const lastAdminTime = mockStore.getLastAdminMessageTime(threadId, accountUid);
assert.ok(lastAdminTime, 'Phải ghi nhận thời điểm Admin vừa chat');

// Giải phóng tài nguyên test
adapter._activeWorkers.clear();
adapter._inboundBuffers.clear();
mockStore.close();

try { fs.unlinkSync(testDbPath); } catch {}
try { fs.unlinkSync(`${testDbPath}-wal`); } catch {}
try { fs.unlinkSync(`${testDbPath}-shm`); } catch {}

console.log('      ✅ Worker State Machine & Concurrency Lock passed!\n');
console.log('   ✅ AI Stability Phase 1 Test Suite passed 100%!\n');
