import assert from 'assert';
import crypto from 'crypto';
import { localStore } from '../src/utils/local-store.js';
import { oaTokenManager } from '../src/utils/oa-token-manager.js';
import { oaDispatcher } from '../src/utils/oa-dispatcher.js';
import { chatwootOutboundAdapter } from '../src/adapters/chatwoot-outbound.js';

console.log('🧪 Testing Zalo OA Webhook, Routes, 48h Window & Chatwoot Router...');

async function runTests() {
  // 1. Setup credentials
  const appId = 'app_test_999';
  const secretKey = 'secret_test_999';
  const oaId = 'oa_branch_hcm';

  oaTokenManager.setCredentials({
    oaId,
    name: 'Chi Nhanh HCM',
    appId,
    secretKey,
    accessToken: 'test_access_token',
    refreshToken: 'test_refresh_token',
    expiresIn: 7200,
    isEnabled: 1,
    isAiAutoReply: 0
  });

  const settings = localStore.getOaSettings();
  assert.strictEqual(settings.oaId, oaId);
  assert.strictEqual(settings.isEnabled, 1);
  console.log('   ✅ OA Credentials configured successfully');

  // 2. Test Inbound Webhook Payload & Signature Verification
  const userSenderId = 'user_oa_cust_123';
  const expectedThreadId = `oa_${oaId}_${userSenderId}`;

  const payloadObj = {
    event_name: 'user_send_text',
    app_id: appId,
    sender: { id: userSenderId },
    recipient: { id: oaId },
    message: {
      msg_id: 'msg_oa_1001',
      text: 'Cho minh hoi gia san pham voi shop'
    },
    timestamp: Date.now()
  };

  const rawBody = JSON.stringify(payloadObj);
  const timestampStr = String(payloadObj.timestamp);
  const dataToHash = `${appId}${rawBody}${timestampStr}${secretKey}`;
  const validSignature = crypto.createHash('sha256').update(dataToHash, 'utf8').digest('hex');

  // Verify signature
  const sigValid = oaTokenManager.verifyWebhookSignature({
    signature: validSignature,
    rawBody,
    timestamp: timestampStr,
    appId,
    secretKey
  });
  assert.strictEqual(sigValid, true, 'Webhook signature must be valid');

  // Simulate Webhook processing in localStore
  localStore.addMessage({
    id: payloadObj.message.msg_id,
    threadId: expectedThreadId,
    senderId: userSenderId,
    senderName: 'Khách Hàng OA',
    text: payloadObj.message.text,
    channel: 'oa',
    oaId,
    oaMsgId: payloadObj.message.msg_id,
    isSelf: false,
    timestamp: new Date().toISOString()
  });

  // Verify conversation is created with channel: 'oa'
  const conv = localStore.getConversation(expectedThreadId);
  assert.notStrictEqual(conv, null, 'Conversation must be created');
  assert.strictEqual(conv.channel, 'oa', 'Conversation channel must be oa');
  assert.strictEqual(conv.oaId, oaId);
  assert.strictEqual(Boolean(conv.lastUserMessageTime), true, 'lastUserMessageTime must be set');
  console.log('   ✅ Webhook processed: Created OA conversation with channel=oa and 48h reset');

  // 3. Test 48h Interaction Window Guard
  // Case A: Within 48h (simulate 1 hour ago)
  localStore.upsertConversation({
    id: expectedThreadId,
    lastUserMessageTime: Date.now() - 3600000 // 1 hour ago
  });

  // Case B: Expired 48h (simulate 50 hours ago)
  const expiredThreadId = `oa_${oaId}_user_expired_48h`;
  localStore.upsertConversation({
    id: expiredThreadId,
    name: 'Khách Hết Hạn 48h',
    channel: 'oa',
    oaId,
    lastUserMessageTime: Date.now() - (50 * 3600 * 1000) // 50 hours ago
  });

  const sendExpiredResult = await oaDispatcher.sendMessage('user_expired_48h', 'Tin nhắn thử nghiệm', {
    threadId: expiredThreadId
  });
  assert.strictEqual(sendExpiredResult.success, false, 'Should block send when 48h expired');
  assert.strictEqual(sendExpiredResult.error, 'window_48h_expired', 'Error must indicate 48h expired');
  console.log('   ✅ 48h Interaction Window Guard correctly blocked message after 50 hours');

  // 4. Test Chatwoot Outbound Routing
  let clientCalled = false;
  const mockClient = {
    sendMessage: async (uid, text) => {
      clientCalled = true;
    }
  };

  // 4a. Outbound to Personal Zalo UID -> goes to client.sendMessage
  const mockPersonalReq = {
    body: {
      event: 'message_created',
      message_type: 'outgoing',
      content: 'Chao ban tu Chatwoot',
      conversation: {
        custom_attributes: { zalo_uid: '123456789012345' }
      }
    }
  };
  let personalResponseJson = null;
  const mockPersonalRes = {
    json: (data) => { personalResponseJson = data; return data; },
    status: () => mockPersonalRes
  };

  await chatwootOutboundAdapter.handleOutbound(mockPersonalReq, mockPersonalRes, mockClient);
  assert.strictEqual(clientCalled, true, 'Personal conversation must route to zaloClient');
  assert.strictEqual(personalResponseJson?.channel, 'personal');
  console.log('   ✅ Chatwoot Outbound correctly routed personal message to zaloClient');

  // 4b. Outbound to OA Thread -> routes to oaDispatcher
  const mockOaReq = {
    body: {
      event: 'message_created',
      message_type: 'outgoing',
      content: 'Chao quy khach tu Zalo OA',
      conversation: {
        custom_attributes: { zalo_uid: expectedThreadId }
      }
    }
  };
  let oaResponseJson = null;
  const mockOaRes = {
    json: (data) => { oaResponseJson = data; return data; },
    status: () => mockOaRes
  };

  // Mock oaDispatcher.sendMessage for test without real network
  const originalSend = oaDispatcher.sendMessage;
  let oaDispatcherCalled = false;
  oaDispatcher.sendMessage = async (userId, text) => {
    oaDispatcherCalled = true;
    return { success: true, msgId: 'test_msg_id_oa' };
  };

  await chatwootOutboundAdapter.handleOutbound(mockOaReq, mockOaRes, mockClient);
  assert.strictEqual(oaDispatcherCalled, true, 'OA conversation must route to oaDispatcher');
  assert.strictEqual(oaResponseJson?.channel, 'oa');
  oaDispatcher.sendMessage = originalSend;
  console.log('   ✅ Chatwoot Outbound correctly routed OA message to oaDispatcher');

  // 5. Test Channel Filtering in getConversations
  const personalList = localStore.getConversations({ filter: 'personal' });
  const oaList = localStore.getConversations({ filter: 'oa' });
  const allList = localStore.getConversations({ filter: 'all' });

  assert.strictEqual(oaList.some(c => c.id === expectedThreadId), true, 'OA list must contain OA thread');
  assert.strictEqual(personalList.some(c => c.id === expectedThreadId), false, 'Personal list must NOT contain OA thread');
  assert.strictEqual(allList.some(c => c.id === expectedThreadId), true, 'All list must contain OA thread');
  console.log('   ✅ LocalStore getConversations channel filtering passed (personal vs oa vs all)!');

  // Clean up
  localStore.deleteConversation(expectedThreadId);
  localStore.deleteConversation(expiredThreadId);
  localStore.deleteOaSettings();

  console.log('🎉 All Zalo OA Webhook, Routes, 48h Window & Chatwoot tests passed 100%!');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
