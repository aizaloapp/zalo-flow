/**
 * src/utils/message-splitter.js
 * 
 * Bộ tiện ích phân tách tin nhắn văn bản thông minh cho Zalo di động.
 * Đảm bảo:
 * 1. Chuẩn hóa Unicode NFC, an toàn tuyệt đối với Emoji & cặp Surrogate (không chẻ đôi ký tự).
 * 2. Ngắt theo ranh giới tự nhiên: Đoạn văn (\n\n) -> Xuống dòng (\n) -> Câu kết thúc ý ([.!?] ) -> Khoảng trắng.
 * 3. Đánh số chuỗi tin nhắn nhất quán: "[1/N] ", "[2/N] "...
 * 4. Giới hạn trần tối đa maxChunks (mặc định 3 phần), nếu còn dư thì cắt ngắn an toàn kèm lời nhắn 'tiếp'.
 */

/**
 * Cắt một chuỗi văn bản dài thành các đoạn nhỏ an toàn cho Zalo API
 * @param {string} text - Văn bản cần phân tách
 * @param {number} [maxChunkLen=1750] - Độ dài tối đa mỗi đoạn (ký tự)
 * @param {number} [maxChunks=3] - Số đoạn tối đa cho phép
 * @returns {string[]} Mảng các đoạn tin nhắn đã được đánh số nếu có nhiều phần
 */
export function splitMessageForZalo(text, maxChunkLen = 1750, maxChunks = 3) {
  if (!text || typeof text !== 'string') return [];
  const normalized = text.normalize('NFC').trim();
  if (!normalized) return [];

  // Nếu chuỗi ngắn hơn hoặc bằng maxChunkLen, trả về 1 phần nguyên vẹn
  if (normalized.length <= maxChunkLen) {
    return [normalized];
  }

  const rawChunks = [];
  let remaining = normalized;

  while (remaining.length > 0 && rawChunks.length < maxChunks) {
    // Nếu là phần cuối cùng cho phép (maxChunks) hoặc phần còn lại đã đủ ngắn
    if (rawChunks.length === maxChunks - 1 || remaining.length <= maxChunkLen) {
      if (remaining.length <= maxChunkLen) {
        rawChunks.push(remaining.trim());
        remaining = '';
      } else {
        // Cần cắt bớt phần còn lại để vừa trần maxChunkLen kèm hậu tố
        const suffix = '\n\n...(Nhắn "tiếp" để xem thêm)';
        const safeLen = Math.max(100, maxChunkLen - suffix.length);
        const candidate = remaining.slice(0, safeLen);
        
        let splitIdx = findNaturalSplitPoint(candidate);
        if (splitIdx === -1) splitIdx = safeLen;
        
        const chunk = remaining.slice(0, splitIdx).trim();
        rawChunks.push(chunk + suffix);
        remaining = ''; // Đã chạm trần maxChunks, kết thúc
      }
      break;
    }

    const candidate = remaining.slice(0, maxChunkLen);
    let splitIdx = findNaturalSplitPoint(candidate);
    
    // Fallback: Nếu không tìm thấy điểm ngắt tự nhiên, cắt cứng tại maxChunkLen
    if (splitIdx === -1) {
      splitIdx = maxChunkLen;
      // Tránh chẻ đôi cặp surrogate (UTF-16 high/low surrogate)
      if (splitIdx > 0 && splitIdx < remaining.length) {
        const charCode = remaining.charCodeAt(splitIdx - 1);
        if (charCode >= 0xD800 && charCode <= 0xDBFF) {
          splitIdx--; // Lùi 1 vị trí nếu đang đứng giữa cặp surrogate
        }
      }
    }

    const chunk = remaining.slice(0, splitIdx).trim();
    if (chunk) {
      rawChunks.push(chunk);
    }
    remaining = remaining.slice(splitIdx).trim();
  }

  // Nếu chỉ có 1 phần thì không cần đánh số
  if (rawChunks.length <= 1) {
    return rawChunks;
  }

  // Đánh số phần: [1/N], [2/N]...
  const total = rawChunks.length;
  return rawChunks.map((chunk, idx) => {
    const prefix = `[${idx + 1}/${total}] `;
    return `${prefix}${chunk}`;
  });
}

/**
 * Tìm điểm ngắt tự nhiên trong đoạn văn bản
 * @param {string} candidate
 * @returns {number} Vị trí ngắt hợp lý, hoặc -1 nếu không có điểm ngắt phù hợp
 */
function findNaturalSplitPoint(candidate) {
  const minLen = Math.floor(candidate.length * 0.35);

  // 1. Ưu tiên cao nhất: Ngắt theo đoạn văn (\n\n) ở nửa sau
  const paragraphBreak = candidate.lastIndexOf('\n\n');
  if (paragraphBreak >= minLen) {
    return paragraphBreak + 2;
  }

  // 2. Ưu tiên 2: Ngắt theo xuống dòng (\n) ở nửa sau
  const lineBreak = candidate.lastIndexOf('\n');
  if (lineBreak >= minLen) {
    return lineBreak + 1;
  }

  // 3. Ưu tiên 3: Ngắt theo dấu kết thúc câu (. ! ?) kèm khoảng trắng hoặc xuống dòng
  const sentenceRegex = /[.!?](\s|\n|$)/g;
  let match;
  let lastSentenceEnd = -1;
  while ((match = sentenceRegex.exec(candidate)) !== null) {
    if (match.index >= minLen) {
      lastSentenceEnd = match.index + 1; // Bao gồm cả dấu chấm câu
    }
  }
  if (lastSentenceEnd !== -1) {
    return lastSentenceEnd;
  }

  // 4. Ưu tiên 4: Ngắt theo khoảng trắng gần nhất
  const spaceBreak = candidate.lastIndexOf(' ');
  if (spaceBreak >= minLen) {
    return spaceBreak + 1;
  }

  return -1;
}
