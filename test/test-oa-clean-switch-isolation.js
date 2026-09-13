import { localStore } from '../src/utils/local-store.js';
import assert from 'assert';

console.log('🧪 Testing OA Data Isolation in cleanSwitchAccountData & OA Settings...');

// 1. Prepare data for Personal channel and OA channel
const personalThreadId = 'user_personal_test_1';
const oaThreadId = 'oa_123456_user_999';

// Insert Personal conversation & messages
localStore.upsertConversation({
  id: personalThreadId,
  name: 'Personal Contact',
  channel: 'personal'
});
localStore.addMessage({
  id: 'msg_personal_1',
  threadId: personalThreadId,
  senderId: personalThreadId,
  senderName: 'Personal Contact',
  text: 'Hello from personal Zalo',
  channel: 'personal'
});

// Insert OA conversation & messages
localStore.upsertConversation({
  id: oaThreadId,
  name: 'OA Customer',
  channel: 'oa',
  oaId: '123456',
  customerPhone: '84901234567',
  isFollower: 1,
  lastUserMessageTime: Date.now()
});
localStore.addMessage({
  id: 'msg_oa_1',
  threadId: oaThreadId,
  senderId: 'user_999',
  senderName: 'OA Customer',
  text: 'Hello from Zalo OA',
  channel: 'oa',
  oaMsgId: 'oa_msg_uuid_1'
});

// Verify both exist before clean switch
assert.strictEqual(Boolean(localStore.getConversation(personalThreadId)), true, 'Personal conversation should exist');
assert.strictEqual(Boolean(localStore.getConversation(oaThreadId)), true, 'OA conversation should exist');
assert.strictEqual(localStore.getMessages(personalThreadId).length, 1, 'Personal message should exist');
assert.strictEqual(localStore.getMessages(oaThreadId).length, 1, 'OA message should exist');

// 2. Perform cleanSwitchAccountData()
localStore.cleanSwitchAccountData();

// 3. Verify Isolation: Personal deleted, OA preserved!
const personalAfter = localStore.getConversation(personalThreadId);
const oaAfter = localStore.getConversation(oaThreadId);
const personalMsgsAfter = localStore.getMessages(personalThreadId);
const oaMsgsAfter = localStore.getMessages(oaThreadId);

assert.strictEqual(personalAfter, null, 'Personal conversation MUST be wiped on clean switch');
assert.strictEqual(personalMsgsAfter.length, 0, 'Personal messages MUST be wiped on clean switch');

assert.notStrictEqual(oaAfter, null, 'OA conversation MUST be preserved 100% on clean switch');
assert.strictEqual(oaAfter.channel, 'oa', 'OA channel should remain oa');
assert.strictEqual(oaAfter.customerPhone, '84901234567', 'OA customerPhone should be preserved');
assert.strictEqual(oaMsgsAfter.length, 1, 'OA messages MUST be preserved 100% on clean switch');
assert.strictEqual(oaMsgsAfter[0].text, 'Hello from Zalo OA', 'OA message text matches');

// 4. Test OA Settings CRUD
const initialOa = localStore.getOaSettings();
assert.strictEqual(initialOa.id, 'default');

localStore.saveOaSettings({
  oaId: '123456',
  name: 'Cong Ty ABC',
  appId: 'app_test_123',
  isEnabled: 1,
  isAiAutoReply: 1
});

const savedOa = localStore.getOaSettings();
assert.strictEqual(savedOa.oaId, '123456');
assert.strictEqual(savedOa.name, 'Cong Ty ABC');
assert.strictEqual(savedOa.isEnabled, 1);
assert.strictEqual(savedOa.isAiAutoReply, 1);

localStore.updateOaTokens({
  accessTokenEncrypted: 'enc_access_token_xyz',
  refreshTokenEncrypted: 'enc_refresh_token_xyz',
  expiresAt: 1800000000000
});

const tokenOa = localStore.getOaSettings();
assert.strictEqual(tokenOa.accessTokenEncrypted, 'enc_access_token_xyz');
assert.strictEqual(tokenOa.refreshTokenEncrypted, 'enc_refresh_token_xyz');
assert.strictEqual(tokenOa.expiresAt, 1800000000000);

// 5. Test System Configs
localStore.setSystemConfig('onboarding_status', 'oa_connected');
assert.strictEqual(localStore.getSystemConfig('onboarding_status'), 'oa_connected');

// Clean up test OA conversation
localStore.deleteConversation(oaThreadId);
localStore.deleteOaSettings();

console.log('✅ OA Data Isolation in cleanSwitchAccountData & OA Settings passed 100%!');
