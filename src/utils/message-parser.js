import fs from 'fs';
import path from 'path';

export const DOC_EXTS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.rar', '.7z', '.tar', '.gz',
  '.txt', '.csv', '.json', '.xml', '.mp3', '.mp4', '.m4a', '.wav', '.apk'
]);

export function isDocumentFileName(filename) {
  if (!filename || typeof filename !== 'string') return false;
  const ext = path.extname(filename.trim().toLowerCase());
  return DOC_EXTS.has(ext);
}

export function parseMessage(rawMsg) {
  if (!rawMsg) {
    return { type: 'text', text: '' };
  }

  const text = extractPlainText(rawMsg);

  try {
    const data = rawMsg.data || rawMsg;
    const content = data.content;
    const msgType = String(data.msgType || rawMsg.msgType || '');

    // 0. Call Message Detection (Audit I3)
    const rawContentStr = typeof content === 'string' ? content : JSON.stringify(content || {});
    if (
      msgType === 'chat.call' ||
      msgType === 'sendBubbleMessage' ||
      rawContentStr.includes('sendBubbleMessage') ||
      rawContentStr.includes('"call_type"') ||
      rawContentStr.includes('"voice_call"') ||
      rawContentStr.includes('"video_call"') ||
      text.includes('sendBubbleMessage')
    ) {
      return {
        type: 'call',
        text: '📞 Cuộc gọi thoại (Zalo Call)',
        mediaUrl: ''
      };
    }

    // 1. Quote Message Detection
    const quote = data.quote || rawMsg.quote;
    if (quote && (quote.msg || quote.attach)) {
      return {
        type: 'quote',
        text: text || String(content?.msg || content?.title || ''),
        quoteText: String(quote.msg || '[Đính kèm]'),
        quoteSender: String(quote.fromD || quote.dName || quote.ownerId || 'Người dùng'),
        mediaUrl: ''
      };
    }

    // 2. Image / Photo Message Detection
    if (msgType.includes('photo') || msgType.includes('image')) {
      const mediaUrl = extractImageUrl(content, data);
      return {
        type: 'image',
        text: text,
        mediaUrl
      };
    }

    // 3. File / Document Message Detection
    if (
      msgType.includes('file') ||
      msgType.includes('sharefile') ||
      (content && typeof content === 'object' && (content.type === 'file' || content.type === 'sharefile' || content.fileUrl || content.file_url || content.checksum || content.fsize || isDocumentFileName(content.title || content.fileName || content.name))) ||
      isDocumentFileName(text)
    ) {
      const fileUrl = extractFileUrl(content, data, text);
      const fileName = extractFileName(content, data, text);
      return {
        type: 'file',
        text: fileName || text || '[Tập tin đính kèm]',
        mediaUrl: fileUrl
      };
    }

    if (content && typeof content === 'object') {
      if (content.href || content.thumb || content.url || content.fileUrl) {
        if (content.type === 'photo' || isImageUrl(content.href || content.thumb || content.url)) {
          return {
            type: 'image',
            text: content.description || text,
            mediaUrl: content.href || content.url || content.thumb || content.fileUrl || ''
          };
        }
      }

      // 4. Sticker Detection
      if (content.type === 'sticker' || msgType.includes('sticker') || content.catId || content.stickerId) {
        const stickerUrl = extractStickerUrl(content, data);
        return {
          type: 'sticker',
          text: '[Sticker]',
          mediaUrl: stickerUrl
        };
      }

      // 5. Link Preview Detection
      if (content.href || content.link) {
        return {
          type: 'link',
          text: content.title || content.description || text || content.href,
          mediaUrl: content.href || content.link || ''
        };
      }
    }

    // 6. Plain text check
    return {
      type: 'text',
      text
    };
  } catch {
    // Graceful fallback to text on any unexpected schema change
    return {
      type: 'text',
      text
    };
  }
}

function extractPlainText(msg) {
  try {
    const data = msg?.data || msg;
    const content = data?.content;
    if (typeof content === 'string') return content.trim();
    if (content && typeof content === 'object') {
      if (typeof content.title === 'string') return content.title.trim();
      if (typeof content.description === 'string') return content.description.trim();
      if (typeof content.msg === 'string') return content.msg.trim();
    }
    return String(data?.body || data?.text || '').trim();
  } catch {
    return '';
  }
}

function extractImageUrl(content, data) {
  if (!content && !data) return '';
  if (typeof content === 'string' && isImageUrl(content)) return content;
  if (typeof content === 'object') {
    return content.href || content.url || content.thumb || content.fileUrl || '';
  }
  return data?.url || data?.thumb || '';
}

function extractFileUrl(content, data, text) {
  if (content && typeof content === 'object') {
    const directUrl = content.href || content.fileUrl || content.url || content.link || content.downloadUrl || content.tUrl || '';
    if (directUrl) return directUrl;
  }
  if (data && typeof data === 'object') {
    const directUrl = data.fileUrl || data.href || data.url || '';
    if (directUrl) return directUrl;
  }
  const cleanName = path.basename(text || '').trim();
  if (cleanName) {
    if (fs.existsSync(path.resolve('data/uploads/chat-media', cleanName))) {
      return `/api/chat-media/${cleanName}`;
    }
    if (fs.existsSync(path.resolve('data/uploads/quick-msg', cleanName))) {
      return `/api/quick-messages/media/${cleanName}`;
    }
  }
  return '';
}

function extractFileName(content, data, text) {
  if (content && typeof content === 'object') {
    const name = content.title || content.fileName || content.file_name || content.name || content.description || '';
    if (name) return name;
  }
  if (data && typeof data === 'object') {
    const name = data.fileName || data.file_name || data.name || '';
    if (name) return name;
  }
  return text || 'Tập tin đính kèm';
}

function extractStickerUrl(content, data) {
  if (typeof content === 'object' && content.url) return content.url;
  const stickerId = content?.id || content?.stickerId || data?.id || data?.stickerId;
  const catId = content?.catId || data?.catId;
  if (stickerId && catId) {
    return `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${stickerId}&cid=${catId}`;
  }
  return '';
}

function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i.test(url) || url.includes('zadn.vn');
}
