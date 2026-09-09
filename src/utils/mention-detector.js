/**
 * Mention Detector & Dynamic Identity Sanitizer for Group Chats
 * Phòng thủ 3 cấp độ: Zalo Tag Protocol, @ Gõ tay, Vocative Xưng hô tiếng Việt (Neo vị trí vàng).
 */

const PRONOUN_BLACKLIST = new Set([
  'anh', 'chị', 'em', 'bạn', 'ad', 'admin',
  'ơi', 'à', 'ạ', 'nè', 'mọi người', 'cả nhà',
  'all', 'ai', 'bot', 'group', 'nhóm'
]);

/**
 * Escape special characters for safe regular expression compilation (Anti-ReDoS)
 * @param {string} str
 * @returns {string}
 */
export function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract distinct bot aliases from display name and custom aliases
 * @param {string} displayName
 * @param {string|string[]} customAliases
 * @returns {string[]}
 */
export function extractBotAliases(displayName = '', customAliases = '') {
  const aliases = new Set();

  // 1. Defaults
  aliases.add('bot');
  aliases.add('trợ lý');

  // 2. Extract from Display Name
  const cleanName = String(displayName || '').trim();
  if (cleanName && cleanName.length >= 2 && !cleanName.toLowerCase().startsWith('zalo user')) {
    aliases.add(cleanName);

    // Bóc tách tên cốt lõi loại bỏ các tag [VIP], (Dev) và icon emoji
    // ví dụ: "[VIP] Khoa (Dev) 🚀" -> "Khoa"
    const stripped = cleanName
      .replace(/\[.*?\]|\(.*?\)/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();

    if (stripped && stripped.length >= 2) {
      aliases.add(stripped);
      const strippedWords = stripped.split(/\s+/).filter(Boolean);
      const coreFirstName = strippedWords[strippedWords.length - 1];
      if (coreFirstName && coreFirstName.length >= 2 && !PRONOUN_BLACKLIST.has(coreFirstName.toLowerCase())) {
        aliases.add(coreFirstName);
      }
    }

    // Tách tên từ từ cuối cùng thông thường
    const words = cleanName.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      const firstName = words[words.length - 1];
      if (firstName.length >= 2 && !PRONOUN_BLACKLIST.has(firstName.toLowerCase())) {
        aliases.add(firstName);
      }
    }
  }

  // 3. User Custom Aliases
  if (typeof customAliases === 'string' && customAliases.trim()) {
    const list = customAliases.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    for (const item of list) {
      if (item.length >= 2 && !PRONOUN_BLACKLIST.has(item.toLowerCase())) {
        aliases.add(item);
      }
    }
  } else if (Array.isArray(customAliases)) {
    for (const item of customAliases) {
      const s = String(item || '').trim();
      if (s.length >= 2 && !PRONOUN_BLACKLIST.has(s.toLowerCase())) {
        aliases.add(s);
      }
    }
  }

  // Return sorted by length descending so multi-word aliases match before single words
  return Array.from(aliases).sort((a, b) => b.length - a.length);
}

/**
 * Detect whether an inbound message mentions or addresses the bot
 * @param {Object} options
 * @param {Object} options.message - Raw Zalo message object
 * @param {string} options.text - Cleaned message text (excluding quote content)
 * @param {Object} options.botProfile - { userId, displayName }
 * @param {string|string[]} options.customAliases - Custom bot nicknames
 * @returns {{ isMentioned: boolean, reason: 'tag'|'at_symbol'|'vocative'|null, matchedKeyword: string|null, cleanText: string }}
 */
export function detectMention({ message = {}, text = '', botProfile = {}, customAliases = '' } = {}) {
  const rawText = String(text || message.data?.content || message.text || '').trim();
  const botUid = String(botProfile?.userId || botProfile?.uid || '');

  // ---------------------------------------------------------------------------
  // Cấp 1: Zalo Tag Protocol (message.data.mentions)
  // ---------------------------------------------------------------------------
  const mentions = message.data?.mentions || message.mentions;
  if (Array.isArray(mentions) && mentions.length > 0) {
    for (const m of mentions) {
      const uid = String(m.uid || m.id || '');
      // Bỏ qua tag @all hoặc broadcast UID ('0', '-1', 'all')
      if (['0', '-1', 'all'].includes(uid)) {
        continue;
      }
      if (botUid && uid === botUid) {
        return {
          isMentioned: true,
          reason: 'tag',
          matchedKeyword: `@${botProfile.displayName || 'bot'}`,
          cleanText: rawText
        };
      }
    }
  }

  if (!rawText) {
    return { isMentioned: false, reason: null, matchedKeyword: null, cleanText: '' };
  }

  // ---------------------------------------------------------------------------
  // Chuẩn bị danh sách Alias an toàn
  // ---------------------------------------------------------------------------
  const aliases = extractBotAliases(botProfile.displayName, customAliases);
  if (aliases.length === 0) {
    aliases.push('bot');
  }
  const escapedAliases = aliases.map(escapeRegex).join('|');

  // ---------------------------------------------------------------------------
  // Cấp 2: Ký hiệu @ gõ tay (@Khoa, @bot, @trợ lý)
  // Bắt buộc có tiền tố @ đứng liền trước tên. Tuyệt đối không match từ trơ trọi.
  // ---------------------------------------------------------------------------
  const atPattern = new RegExp(`(?:^|\\s)@(${escapedAliases})(?:\\s|$|[.,?!:])`, 'i');
  const atMatch = rawText.match(atPattern);
  if (atMatch) {
    // Làm sạch ký hiệu @tên khỏi câu hỏi để AI trả lời tự nhiên
    const clean = rawText.replace(atPattern, ' ').replace(/\s+/g, ' ').trim();
    return {
      isMentioned: true,
      reason: 'at_symbol',
      matchedKeyword: atMatch[0].trim(),
      cleanText: clean || rawText
    };
  }

  // ---------------------------------------------------------------------------
  // Cấp 3: Ngữ cảnh xưng hô tiếng Việt (Vocative Context - Neo Vị Trí Vàng)
  // Chỉ kích hoạt ở ĐẦU CÂU hoặc ngay sau dấu ngắt câu (^ hoặc [.,?!;\n]\s*)
  // ---------------------------------------------------------------------------
  const vocativePattern = new RegExp(
    `(?:^|[.?!;\\n]\\s*)(?:(?:anh|chị|em|bạn|ad|admin)\\s+)?(${escapedAliases})\\s*(?:ơi|à|ạ|nè|cho\\s+mình\\s+hỏi|giúp\\s+(?:mình|với|em)|tư\\s+vấn|hỗ\\s+trợ)(?:\\s|$|[.,?!:])`,
    'i'
  );
  const vocativeMatch = rawText.match(vocativePattern);
  if (vocativeMatch) {
    const clean = rawText.replace(vocativePattern, ' ').replace(/\s+/g, ' ').trim();
    return {
      isMentioned: true,
      reason: 'vocative',
      matchedKeyword: vocativeMatch[0].trim(),
      cleanText: clean || rawText
    };
  }

  // Cấu trúc nhờ vả trực tiếp ở đầu câu: "Nhờ/hỏi/kêu/gọi [Bot] [câu hỏi]..."
  const directReqPattern = new RegExp(
    `^(?:nhờ|hỏi|kêu|gọi)\\s+(?:(?:anh|chị|em|bạn|ad|admin)\\s+)?(${escapedAliases})\\s+`,
    'i'
  );
  const directMatch = rawText.match(directReqPattern);
  if (directMatch) {
    const clean = rawText.replace(directReqPattern, '').trim();
    return {
      isMentioned: true,
      reason: 'vocative',
      matchedKeyword: directMatch[0].trim(),
      cleanText: clean || rawText
    };
  }

  // Không khớp
  return {
    isMentioned: false,
    reason: null,
    matchedKeyword: null,
    cleanText: rawText
  };
}
