import test from 'node:test';
import assert from 'node:assert';
import { detectMention, extractBotAliases, escapeRegex } from '../src/utils/mention-detector.js';

test('=== MENTION DETECTOR TEST SUITE ===', async (t) => {
  const botProfile = {
    userId: '123456789',
    displayName: 'Phan Lê Khoa'
  };

  await t.test('1. Helper: escapeRegex', () => {
    assert.strictEqual(escapeRegex('Khoa [Admin] (VIP) + AI?'), 'Khoa \\[Admin\\] \\(VIP\\) \\+ AI\\?');
    assert.strictEqual(escapeRegex(''), '');
  });

  await t.test('2. Helper: extractBotAliases', () => {
    const aliases = extractBotAliases('Phan Lê Khoa', 'amon, em tấm');
    assert.ok(aliases.includes('bot'));
    assert.ok(aliases.includes('trợ lý'));
    assert.ok(aliases.includes('Phan Lê Khoa'));
    assert.ok(aliases.includes('Khoa'));
    assert.ok(aliases.includes('amon'));
    assert.ok(aliases.includes('em tấm'));
    
    // Blacklisted pronouns should NOT be extracted as standalone alias
    const pronounAliases = extractBotAliases('Anh Tuấn');
    assert.ok(pronounAliases.includes('Anh Tuấn'));
    assert.ok(pronounAliases.includes('Tuấn'));
    assert.ok(!pronounAliases.includes('Anh')); // 'anh' is in pronoun blacklist
  });

  await t.test('3. False-Positive Cases (Negative tests - MUST NOT TRIGGER)', () => {
    const negativeCases = [
      'Có ai quen Bs bên khoa vi phẫu tạo hình không?',
      'Khám chuyên khoa tai mũi họng ở đâu tốt vậy mọi người?',
      'Em đang học ngành khoa học dữ liệu năm 2',
      'Cửa bị kẹt, chiều nay phải đi mua ổ khóa mới',
      'Con robot hút bụi này thông minh ghê',
      'Hết bột giặt rồi anh ơi',
      'Hôm nay trời đẹp quá cả nhà ơi',
      'Alo mọi người ơi mai đi đá banh không?',
      'Mọi người ơi cho mình hỏi địa chỉ ăn bún bò ngon ở gần đây'
    ];

    for (const text of negativeCases) {
      const res = detectMention({
        text,
        botProfile,
        customAliases: 'amon'
      });
      assert.strictEqual(res.isMentioned, false, `Failed on negative case: "${text}" (Got reason: ${res.reason})`);
    }
  });

  await t.test('4. Tag @all or Special Broadcast UIDs MUST NOT TRIGGER', () => {
    const allCases = [
      { mentions: [{ uid: '0', pos: 0, len: 4 }], text: '@all Mọi người họp nhé' },
      { mentions: [{ uid: '-1', pos: 0, len: 4 }], text: '@all Nhớ nộp báo cáo' },
      { mentions: [{ uid: 'all', pos: 0, len: 4 }], text: '@all Chúc mừng sinh nhật' }
    ];

    for (const item of allCases) {
      const res = detectMention({
        message: { data: { mentions: item.mentions } },
        text: item.text,
        botProfile
      });
      assert.strictEqual(res.isMentioned, false, `Failed: @all triggered bot!`);
    }
  });

  await t.test('5. Level 1: Zalo Tag Protocol (Positive test)', () => {
    const res = detectMention({
      message: {
        data: {
          mentions: [
            { uid: '999999', pos: 0, len: 5 },
            { uid: '123456789', pos: 6, len: 10 }
          ]
        }
      },
      text: '@Khoa hỗ trợ giúp em',
      botProfile
    });

    assert.strictEqual(res.isMentioned, true);
    assert.strictEqual(res.reason, 'tag');
  });

  await t.test('6. Level 2: Typed @ Mention (Positive test)', () => {
    const testCases = [
      { text: '@Khoa xem giúp em cái này', expectedClean: 'xem giúp em cái này' },
      { text: '@Phan Lê Khoa cho mình hỏi giá', expectedClean: 'cho mình hỏi giá' },
      { text: '@bot báo giá giúp mình', expectedClean: 'báo giá giúp mình' },
      { text: '@trợ lý tư vấn nhé', expectedClean: 'tư vấn nhé' },
      { text: 'Anh @Khoa ơi xem đơn', expectedClean: 'Anh ơi xem đơn' },
      { text: '@amon hỗ trợ ca này với', expectedClean: 'hỗ trợ ca này với' }
    ];

    for (const tc of testCases) {
      const res = detectMention({
        text: tc.text,
        botProfile,
        customAliases: 'amon'
      });
      assert.strictEqual(res.isMentioned, true, `Failed on: "${tc.text}"`);
      assert.strictEqual(res.reason, 'at_symbol');
      assert.strictEqual(res.cleanText, tc.expectedClean);
    }
  });

  await t.test('7. Level 3: Vocative Context at Start (Positive test)', () => {
    const testCases = [
      'Khoa ơi tư vấn giúp em với',
      'Khoa à cho mình hỏi chút',
      'Anh Khoa ơi cho em hỏi giá',
      'Chị Khoa ơi hỗ trợ với',
      'Bot ơi hôm nay có khuyến mãi gì không',
      'Trợ lý ơi tư vấn giúp',
      'Nhờ Khoa hỗ trợ ca này với bạn'
    ];

    for (const text of testCases) {
      const res = detectMention({
        text,
        botProfile
      });
      assert.strictEqual(res.isMentioned, true, `Failed on vocative: "${text}"`);
      assert.strictEqual(res.reason, 'vocative');
    }
  });

  await t.test('8. Quoted message immunity (Only current text is evaluated)', () => {
    // Current text is just "Haha vui ghê", but raw message contains quote of a mention
    const res = detectMention({
      message: {
        quoteText: '@Khoa ơi tư vấn giá với',
        data: {
          quote: { msg: '@Khoa ơi tư vấn giá với' }
        }
      },
      text: 'Haha vui ghê',
      botProfile
    });

    assert.strictEqual(res.isMentioned, false, 'Failed: Quoted text leaked into mention detection!');
  });

  await t.test('9. Special characters & emoji in Bot Display Name (Anti-Crash)', () => {
    const fancyBot = {
      userId: '888888',
      displayName: '[VIP] Khoa (Dev) 🚀'
    };

    assert.doesNotThrow(() => {
      const res = detectMention({
        text: '@Khoa hỗ trợ em',
        botProfile: fancyBot
      });
      assert.strictEqual(res.isMentioned, true);
    });
  });
});
