/**
 * test/test-ai-resilience-phase2.js
 * 
 * Test Suite #60: AI Resilience & Continuity (Phase 2)
 * 
 * Kiểm tra toàn diện 3 trụ cột cốt lõi:
 * 1. Dual-Provider Auto-Fallback & Robust Routing (Chuyển đổi dự phòng khi Primary lỗi).
 * 2. Scoped Graceful Fallback Reply (Tin nhắn cứu hộ 1-1, cấm gửi nhóm, cooldown 5 phút).
 * 3. Smart Human Takeover Engine (Hủy debounce/buffer tức thì, chặn chen ngang giữa các chunk, multi-account isolation).
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';
import { AiAgentAdapter } from '../src/adapters/ai-agent.js';
import { LocalStore } from '../src/utils/local-store.js';
import { resolveEffectiveBaseUrl } from '../src/utils/ai-crypto.js';
import { ZaloClient } from '../src/zalo-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('60. Testing AI Resilience & Continuity Phase 2 (Auto-Fallback, Graceful Rescue & Smart Takeover)...');

const testDbPath = path.resolve(rootDir, 'data', 'test_ai_resilience_phase2.db');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch {}
}

const testStore = new LocalStore(testDbPath);

try {
  // =============================================================================
  // 1. Kiểm thử Universal Fallback & Base URL Routing
  // =============================================================================
  console.log('   🔹 1. Testing Universal Auto-Fallback & Base URL Resolver...');

  // 1.1 Kiểm tra resolveEffectiveBaseUrl khử domain cũ
  assert.strictEqual(resolveEffectiveBaseUrl('https://api.deepseek.com/v1', 'deepseek'), 'https://api.deepseek.com/v1');
  assert.strictEqual(resolveEffectiveBaseUrl('https://api.deepseek.com/v1', 'openrouter'), '', 'Phải xóa URL DeepSeek khi chuyển sang OpenRouter');
  assert.strictEqual(resolveEffectiveBaseUrl('https://openrouter.ai/api/v1', 'zai'), '', 'Phải xóa URL OpenRouter khi chuyển sang ZAI');
  assert.strictEqual(resolveEffectiveBaseUrl('https://custom-proxy.internal/v1', 'openai'), 'https://custom-proxy.internal/v1', 'Giữ nguyên custom proxy');

  // 1.2 Tạo adapter và mock callProvider để kiểm tra Auto-Fallback
  const aiAdapter = new AiAgentAdapter({ localStore: testStore });

  let primaryCallCount = 0;
  let fallbackCallCount = 0;

  aiAdapter.callProvider = async ({ provider, model }) => {
    if (provider === 'gemini') {
      primaryCallCount++;
      const err = new Error('HTTP 429 Too Many Requests: Resource has been exhausted');
      err.status = 429;
      throw err;
    }
    if (provider === 'deepseek') {
      fallbackCallCount++;
      return 'Xin chào từ DeepSeek Fallback Model!';
    }
    throw new Error('Unknown provider');
  };

  const fallbackSettings = {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKeyEncrypted: '',
    fallbackEnabled: 1,
    fallbackProvider: 'deepseek',
    fallbackModel: 'deepseek-chat',
    fallbackApiKeyEncrypted: ''
  };

  // Mock resolveApiKey để luôn có key hợp lệ
  aiAdapter._resolveApiKey = (keyEnc, envVar) => 'test-valid-api-key-12345';

  const reply = await aiAdapter.callModelWithFallback('System prompt', [], 'Khách hỏi giá', fallbackSettings);
  assert.strictEqual(primaryCallCount, 1, 'Primary model phải được gọi 1 lần');
  assert.strictEqual(fallbackCallCount, 1, 'Fallback model phải được gọi khi primary thất bại');
  assert.strictEqual(reply, 'Xin chào từ DeepSeek Fallback Model!');

  console.log('      ✅ Universal Auto-Fallback & Base URL Resolver passed!');

  // =============================================================================
  // 2. Kiểm thử Smart Human Takeover Engine (Hủy Timer, Buffer & Chặn Chen Ngang)
  // =============================================================================
  console.log('   🔹 2. Testing Smart Human Takeover Engine...');

  // Kích hoạt AI trong test store
  testStore.saveAiSettings({ isEnabled: 1, adminCooldownMinutes: 15 });

  const takeoverAdapter = new AiAgentAdapter({ localStore: testStore });

  // 2.1 markHumanActivity hủy ngay debounce timer và buffer của thread đó
  const testThread = 'user_takeover_test_1';
  const testAccount = 'acc_user_1';
  const bufferKey = testThread;

  takeoverAdapter._inboundBuffers.set(bufferKey, ['Tin nhắn 1 của khách', 'Tin nhắn 2 của khách']);
  takeoverAdapter._debounceTimers.set(bufferKey, setTimeout(() => {}, 10000));

  assert.strictEqual(takeoverAdapter._inboundBuffers.get(bufferKey).length, 2);
  assert.ok(takeoverAdapter._debounceTimers.has(bufferKey));

  // Admin nhắn tin thủ công
  takeoverAdapter.markHumanActivity({ accountUid: testAccount, threadId: testThread });

  assert.ok(!takeoverAdapter._debounceTimers.has(bufferKey), 'Debounce timer phải bị hủy ngay');
  assert.ok(!takeoverAdapter._inboundBuffers.has(bufferKey), 'Inbound buffer phải bị xóa sạch');
  assert.ok(takeoverAdapter.isHumanActive(testAccount, testThread), 'isHumanActive phải trả về true');

  // 2.2 Phân lập Multi-Account: Takeover trên acc_user_1 không làm ảnh hưởng acc_user_2
  assert.ok(!takeoverAdapter.isHumanActive('acc_user_2', testThread), 'Account khác không bị ảnh hưởng takeover');

  // 2.3 Chặn chen ngang giữa các chunk khi Admin nhắn tin lúc LLM hoặc gửi tin dở dang
  let sentChunks = [];
  const mockClient = {
    accountUid: testAccount,
    sendMessage: async (tId, text, isGroup, options) => {
      sentChunks.push(text);
      if (sentChunks.length === 1) {
        // Mô phỏng Admin nhắn tin ngay sau khi chunk 1 vừa gửi xong
        takeoverAdapter.markHumanActivity({ accountUid: testAccount, threadId: tId, timestamp: Date.now() });
      }
    }
  };

  takeoverAdapter.callModelWithFallback = async () => {
    // Trả về câu trả lời dài cần tách thành 2 chunk
    return 'Phần 1: ' + 'A'.repeat(1800) + '\n\nPhần 2: ' + 'B'.repeat(1800);
  };

  sentChunks = [];
  await takeoverAdapter._processAutoReply({
    threadId: 'thread_multi_chunks',
    incomingText: 'Câu hỏi cần trả lời dài',
    isGroup: false,
    client: mockClient
  });

  assert.strictEqual(sentChunks.length, 1, 'Chỉ được gửi chunk 1, chunk 2 phải bị hủy vì Admin vừa chen vào!');

  console.log('      ✅ Smart Human Takeover Engine passed all tests!');

  // =============================================================================
  // 3. Kiểm thử Scoped Graceful Fallback Reply (Tin Nhắn Cứu Hộ Lịch Sự)
  // =============================================================================
  console.log('   🔹 3. Testing Scoped Graceful Fallback Reply...');

  const rescueAdapter = new AiAgentAdapter({ localStore: testStore });
  let rescueSent = [];
  const rescueClient = {
    accountUid: 'acc_rescue_1',
    sendMessage: async (tId, text, isGroup, options) => {
      rescueSent.push({ tId, text, isGroup, options });
    }
  };

  // Cấu hình bật tin nhắn cứu hộ
  testStore.saveAiSettings({
    isEnabled: 1,
    fallbackReplyEnabled: 1,
    fallbackReplyMessage: 'Hệ thống đang bảo trì giây lát, shop sẽ hỗ trợ ngay ạ!'
  });

  // Mô phỏng LLM sập hoàn toàn (cả 2 provider đều ném lỗi)
  rescueAdapter.callModelWithFallback = async () => {
    throw new Error('503 Service Unavailable: All AI providers unreachable');
  };

  // 3.1 Chat cá nhân 1-1 (isGroup: false) -> Gửi đúng 1 tin cứu hộ
  rescueSent = [];
  await rescueAdapter._processAutoReply({
    threadId: 'user_rescue_1',
    incomingText: 'Alo shop có đó không',
    isGroup: false,
    client: rescueClient
  });

  assert.strictEqual(rescueSent.length, 1, 'Phải gửi tin cứu hộ cho chat 1-1');
  assert.strictEqual(rescueSent[0].isGroup, false);
  assert.ok(rescueSent[0].options.isBot, 'Tin cứu hộ phải có cờ isBot: true');
  assert.ok(rescueSent[0].text.includes('Hệ thống đang bảo trì giây lát'), 'Nội dung tin cứu hộ chuẩn xác');

  // 3.2 Cooldown 5 phút: Khách nhắn tiếp ngay sau đó -> KHÔNG gửi lại tin cứu hộ
  rescueSent = [];
  await rescueAdapter._processAutoReply({
    threadId: 'user_rescue_1',
    incomingText: 'Shop ơi?',
    isGroup: false,
    client: rescueClient
  });
  assert.strictEqual(rescueSent.length, 0, 'Không được gửi tin cứu hộ lần 2 trong vòng 5 phút (chống spam bot)');

  // 3.3 Nhóm Chat (isGroup: true) -> TUYỆT ĐỐI CẤM gửi tin cứu hộ
  rescueSent = [];
  await rescueAdapter._processAutoReply({
    threadId: 'group_rescue_1',
    incomingText: '@bot tư vấn giúp',
    isGroup: true,
    client: rescueClient
  });
  assert.strictEqual(rescueSent.length, 0, 'Tuyệt đối không gửi tin cứu hộ vào nhóm chat');

  // 3.4 Khi hội thoại tắt AI (aiEnabled = 0) -> KHÔNG gửi tin cứu hộ
  testStore.setConversationAi('user_rescue_disabled', false);
  rescueSent = [];
  await rescueAdapter._processAutoReply({
    threadId: 'user_rescue_disabled',
    incomingText: 'Tư vấn giúp',
    isGroup: false,
    client: rescueClient
  });
  assert.strictEqual(rescueSent.length, 0, 'Không gửi tin cứu hộ khi aiEnabled = 0');

  // 3.5 Khi đang trong thời gian Human Takeover -> KHÔNG gửi tin cứu hộ
  rescueAdapter.markHumanActivity({ accountUid: 'acc_rescue_1', threadId: 'user_rescue_takeover' });
  rescueSent = [];
  await rescueAdapter._processAutoReply({
    threadId: 'user_rescue_takeover',
    incomingText: 'Tin nhắn khách gửi lúc Admin vừa nhắn',
    isGroup: false,
    client: rescueClient
  });
  assert.strictEqual(rescueSent.length, 0, 'Không gửi tin cứu hộ khi Admin đang trò chuyện');

  console.log('      ✅ Scoped Graceful Fallback Reply passed all tests!');

  // =============================================================================
  // 4. Kiểm thử ZaloClient EventEmitter Takeover Hook
  // =============================================================================
  console.log('   🔹 4. Testing ZaloClient EventEmitter Takeover Hook...');

  const dummyClient = new ZaloClient({ sessionName: 'test_takeover_client', accountUid: 'acc_hook_1' });
  let hookFired = false;
  dummyClient.on('human_activity', (data) => {
    if (data.threadId === 'thread_hook_test') hookFired = true;
  });

  // Kích hoạt qua emit
  dummyClient.emit('human_activity', { accountUid: 'acc_hook_1', threadId: 'thread_hook_test', timestamp: Date.now() });
  assert.ok(hookFired, 'Event human_activity phải được phát ra');

  console.log('      ✅ ZaloClient EventEmitter Takeover Hook passed!');

  // =============================================================================
  // 5. Kiểm thử SQLite Schema Migration & getLastAdminMessageTime Multi-Account
  // =============================================================================
  console.log('   🔹 5. Testing SQLite Multi-Account & Index Query...');

  // Lưu tin nhắn Admin cho acc_1 và default
  testStore.addMessage({
    id: 'msg_admin_1',
    accountUid: 'acc_test_owner',
    threadId: 'thread_sqlite_test',
    senderId: 'self',
    text: 'Tin nhắn của Admin',
    isSelf: true,
    isBot: false,
    timestamp: '2026-10-05T06:00:00.000Z'
  });

  const lastTime = testStore.getLastAdminMessageTime('thread_sqlite_test', 'acc_test_owner');
  assert.ok(lastTime > 0, 'Phải tìm thấy thời gian nhắn tin của Admin theo accountUid');

  const otherAccountTime = testStore.getLastAdminMessageTime('thread_sqlite_test', 'acc_other_owner');
  assert.strictEqual(otherAccountTime, 0, 'Account khác không được thấy tin nhắn của acc_test_owner');

  console.log('      ✅ SQLite Multi-Account & Index Query passed!');

  console.log('\n   ✅ AI Resilience & Continuity Phase 2 Test Suite passed 100%!\n');

} finally {
  testStore.close();
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch {}
  }
}
