import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { LocalStore } from '../src/utils/local-store.js';

console.log('🧪 Testing Pin to Top, Limit 5, Mark Unread & Context Actions...');

const testDbPath = path.join(process.cwd(), 'data', 'test-pin-suite.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const store = new LocalStore(testDbPath);

try {
  // 1. Setup sample conversations
  for (let i = 1; i <= 7; i++) {
    store.upsertConversation({
      id: `user_${i}`,
      name: `Người dùng ${i}`,
      isGroup: false,
      unreadCount: 0,
      lastMessage: `Tin nhắn ${i}`,
      lastTime: new Date(Date.now() - (10 - i) * 1000).toISOString()
    });
  }

  // Add tags to user_1
  const tagVip = store.upsertTag({ name: 'Khách VIP', color: '#ef4444' });
  const tagPartner = store.upsertTag({ name: 'Đối tác', color: '#10b981' });
  store.addConversationTag('user_1', tagVip.id);
  store.addConversationTag('user_1', tagPartner.id);

  // 2. Verify Initial Sorting (by lastTime DESC)
  let convs = store.getConversations();
  assert.strictEqual(convs[0].id, 'user_7', 'Newest conversation should be on top initially');
  assert.strictEqual(convs[0].isPinned, false, 'Initial isPinned should be false');

  // Verify tags attached
  const user1 = convs.find(c => c.id === 'user_1');
  assert.ok(user1, 'user_1 must exist');
  assert.strictEqual(user1.tags.length, 2, 'user_1 should have 2 tags attached');
  assert.strictEqual(user1.tags[0].name, 'Khách VIP');

  // 3. Test Pinning
  const res1 = store.setConversationPinned('user_1', true);
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.isPinned, true);

  // Pinned item should now be at the very top despite older lastTime
  convs = store.getConversations();
  assert.strictEqual(convs[0].id, 'user_1', 'Pinned user_1 must be on top');
  assert.strictEqual(convs[0].isPinned, true);
  assert.strictEqual(convs[1].id, 'user_7', 'Non-pinned newest should be second');

  // 4. Test Pin Limit (Max 5)
  assert.strictEqual(store.setConversationPinned('user_2', true).success, true);
  assert.strictEqual(store.setConversationPinned('user_3', true).success, true);
  assert.strictEqual(store.setConversationPinned('user_4', true).success, true);
  const res5 = store.setConversationPinned('user_5', true);
  assert.strictEqual(res5.success, true, '5th pin should succeed');

  // Attempting 6th pin should return limit_reached error
  const res6 = store.setConversationPinned('user_6', true);
  assert.strictEqual(res6.success, false);
  assert.strictEqual(res6.error, 'limit_reached');

  // 5. Test Unpinning
  const resUnpin = store.setConversationPinned('user_1', false);
  assert.strictEqual(resUnpin.success, true);
  assert.strictEqual(resUnpin.isPinned, false);

  convs = store.getConversations();
  assert.strictEqual(convs[0].isPinned, true);
  assert.notStrictEqual(convs[0].id, 'user_1', 'user_1 should no longer be at the very top');

  // 6. Test Mark Unread
  assert.strictEqual(store.getConversation('user_7').unreadCount, 0);
  store.markAsUnread('user_7');
  assert.strictEqual(store.getConversation('user_7').unreadCount, 1, 'unreadCount should become 1');

  // 7. Test Delete Conversation
  store.addMessage({
    msgId: 'msg_del_1',
    cliMsgId: 'cli_del_1',
    threadId: 'user_7',
    senderId: 'user_7',
    senderName: 'Người dùng 7',
    text: 'Tin nhắn sắp xóa',
    time: Date.now()
  });
  assert.strictEqual(store.getMessages('user_7').length, 1);

  store.deleteConversation('user_7');
  assert.strictEqual(store.getConversation('user_7'), null, 'Conversation must be deleted');
  assert.strictEqual(store.getMessages('user_7').length, 0, 'Messages must be deleted');

  console.log('✅ ALL PIN & CONTEXT ACTION TESTS PASSED PERFECTLY!');
} finally {
  store.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  const walPath = `${testDbPath}-wal`;
  const shmPath = `${testDbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
}
