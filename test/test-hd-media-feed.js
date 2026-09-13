import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { LocalStore } from '../src/utils/local-store.js';
import { parseMessage } from '../src/utils/message-parser.js';

describe('🚀 Test Suite: HD Media & Smart Feed Performance', () => {
  const testDbPath = 'data/test-hd-feed.db';
  let store;

  before(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    store = new LocalStore(testDbPath);
  });

  after(() => {
    store.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  test('TC-01: Smart Feed Sorting - Active conversations must always be sorted on top', () => {
    for (let i = 1; i <= 5; i++) {
      store.upsertConversation({
        id: `empty_user_${i}`,
        name: `Empty User ${i}`,
        lastTime: null,
        lastMessage: ''
      });
    }

    store.upsertConversation({
      id: `active_user_1`,
      name: `Active User 1`,
      lastTime: '2026-09-10T10:00:00.000Z',
      lastMessage: 'Chào bạn, cho mình hỏi giá'
    });

    store.upsertConversation({
      id: `active_user_2`,
      name: `Active User 2`,
      lastTime: '2026-09-12T15:30:00.000Z',
      lastMessage: 'Đã thanh toán rồi nhé!'
    });

    const convs = store.getConversations({ limit: 10 });
    assert.equal(convs.length, 7);

    assert.equal(convs[0].id, 'active_user_2');
    assert.equal(convs[0].lastMessage, 'Đã thanh toán rồi nhé!');

    assert.equal(convs[1].id, 'active_user_1');
    assert.equal(convs[1].lastMessage, 'Chào bạn, cho mình hỏi giá');

    assert.ok(convs[2].id.startsWith('empty_user_'));
    assert.equal(convs[2].lastMessage, '');
  });

  test('TC-02: Batch Transaction Insert - Inserts 50 historical messages in a single transaction', () => {
    const threadId = 'group_test_history_123';
    store.upsertConversation({
      id: threadId,
      name: 'Nhóm Test Lịch Sử',
      isGroup: true,
      lastTime: null,
      lastMessage: ''
    });

    const messages = [];
    const baseTime = new Date('2026-09-11T08:00:00.000Z').getTime();
    for (let i = 1; i <= 50; i++) {
      messages.push({
        id: `msg_hist_${i}`,
        threadId,
        senderId: `user_${i % 5}`,
        senderName: `Thành viên ${i % 5}`,
        text: `Tin nhắn thảo luận số ${i}`,
        mediaType: 'text',
        timestamp: new Date(baseTime + i * 60000).toISOString(),
        isGroup: true
      });
    }

    const t0 = performance.now();
    const inserted = store.addMessagesBatch(messages);
    const duration = performance.now() - t0;

    assert.equal(inserted.length, 50);
    assert.ok(duration < 80, `Batch insert took ${duration}ms, expected < 80ms`);

    const dbMsgs = store.getMessages(threadId, { limit: 100 });
    assert.equal(dbMsgs.length, 50);

    const conv = store.getConversation(threadId);
    assert.equal(conv.lastMessage, 'Tin nhắn thảo luận số 50');
    assert.equal(conv.lastTime, new Date(baseTime + 50 * 60000).toISOString());
  });

  test('TC-03: Message Parser - Prioritize hdUrl and safely parse JSON photo payloads', () => {
    const photoPayloadWithJsonString = {
      data: {
        msgType: 'chat.photo',
        content: JSON.stringify({
          href: 'https://photo-thumb.zadn.vn/thumb/120/abc.jpg',
          normalUrl: 'https://photo-normal.zadn.vn/normal/abc.jpg',
          hdUrl: 'https://photo-hd.zadn.vn/hd/abc_origin.jpg',
          width: 1920,
          height: 1080
        })
      }
    };

    const parsedPhoto = parseMessage(photoPayloadWithJsonString);
    assert.equal(parsedPhoto.type, 'image');
    assert.equal(parsedPhoto.mediaUrl, 'https://photo-hd.zadn.vn/hd/abc_origin.jpg');
    assert.equal(parsedPhoto.text, '');

    const photoPayloadFallback = {
      data: {
        msgType: 'chat.photo',
        content: {
          thumb: 'https://photo-thumb.zadn.vn/thumb/120/xyz.jpg',
          normalUrl: 'https://photo-normal.zadn.vn/normal/xyz.jpg'
        }
      }
    };

    const parsedFallback = parseMessage(photoPayloadFallback);
    assert.equal(parsedFallback.type, 'image');
    assert.equal(parsedFallback.mediaUrl, 'https://photo-normal.zadn.vn/normal/xyz.jpg');
  });

  test('TC-04: Message Parser - Prevent raw JSON leaks in extractPlainText', () => {
    const jsonMessage = {
      data: {
        content: '{"href":"https://s120.zadn.vn/test.jpg","title":"Thông báo nhóm","description":"Họp lúc 9h"}'
      }
    };

    const parsed = parseMessage(jsonMessage);
    assert.ok(!parsed.text.startsWith('{'));
    assert.ok(parsed.text.includes('Thông báo nhóm') || parsed.text.includes('Họp lúc 9h'));
  });

  test('TC-05: Migration - Fake timestamp cleanup for empty conversations', () => {
    store.db.prepare(`
      INSERT INTO conversations (id, name, lastMessage, lastTime, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run('fake_conv_999', 'Fake Conv', '', '2026-09-06T08:17:00.000Z', '2026-09-06T08:17:00.000Z');

    store.db.exec("UPDATE conversations SET lastTime = NULL WHERE (lastMessage = '' OR lastMessage IS NULL) AND lastTime IS NOT NULL;");

    const cleaned = store.getConversation('fake_conv_999');
    assert.equal(cleaned.lastTime, null);
  });
});
