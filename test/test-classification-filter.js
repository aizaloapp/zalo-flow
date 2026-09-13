import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { LocalStore } from '../src/utils/local-store.js';

console.log('🧪 Testing Classification & Combination Filters...');

const testDbPath = path.join(process.cwd(), 'data', 'test-filter-suite.db');
if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

const store = new LocalStore(testDbPath);

try {
  store.upsertConversation({
    id: 'user_1',
    name: 'Nguyễn Văn A',
    isGroup: false,
    unreadCount: 0,
    lastMessage: 'Chào bạn',
    lastTime: new Date(Date.now() - 1000).toISOString()
  });

  store.upsertConversation({
    id: 'user_2',
    name: 'Trần Thị B',
    isGroup: false,
    unreadCount: 3,
    lastMessage: 'Có căn này đẹp lắm',
    lastTime: new Date().toISOString()
  });

  store.upsertConversation({
    id: 'group_1',
    name: 'Nhóm BĐS Thủ Đức',
    isGroup: true,
    unreadCount: 0,
    lastMessage: 'Cần bán gấp',
    lastTime: new Date(Date.now() - 2000).toISOString()
  });

  store.upsertConversation({
    id: 'group_2',
    name: 'Nhóm Đầu Tư AI',
    isGroup: true,
    unreadCount: 5,
    lastMessage: 'Review tool mới',
    lastTime: new Date(Date.now() - 500).toISOString()
  });

  const tagVip = store.upsertTag({ name: 'Khách VIP', color: '#ef4444' });
  store.addConversationTag('user_2', tagVip.id);

  const allList = store.getConversations({ filter: 'all', status: 'all' });
  assert.strictEqual(allList.length, 4, 'Should return all 4 conversations');

  const personalList = store.getConversations({ filter: 'personal', status: 'all' });
  assert.strictEqual(personalList.length, 2, 'Should return 2 personal conversations');
  assert.ok(personalList.every(c => !c.isGroup), 'All items must be personal');

  const groupList = store.getConversations({ filter: 'group', status: 'all' });
  assert.strictEqual(groupList.length, 2, 'Should return 2 group conversations');
  assert.ok(groupList.every(c => c.isGroup), 'All items must be groups');

  const personalUnread = store.getConversations({ filter: 'personal', status: 'unread' });
  assert.strictEqual(personalUnread.length, 1, 'Should return 1 personal unread conversation');
  assert.strictEqual(personalUnread[0].id, 'user_2', 'Should match user_2');

  const groupUnread = store.getConversations({ filter: 'group', status: 'unread' });
  assert.strictEqual(groupUnread.length, 1, 'Should return 1 group unread conversation');
  assert.strictEqual(groupUnread[0].id, 'group_2', 'Should match group_2');

  const legacyUnread = store.getConversations({ filter: 'unread' });
  assert.strictEqual(legacyUnread.length, 2, 'Legacy filter=unread must return both unread conversations');

  const tagList = store.getConversations({ tagId: tagVip.id });
  assert.strictEqual(tagList.length, 1, 'Should return 1 conversation tagged with VIP');
  assert.strictEqual(tagList[0].id, 'user_2', 'Tagged conversation should be user_2');

  console.log('✅ ALL Classification & Combination Filter Tests Passed 100%!');
} finally {
  store.close();
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
}
