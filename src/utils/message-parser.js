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

export const VN_PHONE_REGEX = /(?:\+?84|0)\s*[1-9](?:[\s.-]*\d){8,9}\b/;

export function normalizeVnPhone(phoneStr) {
  if (!phoneStr) return '';
  const match = String(phoneStr).match(VN_PHONE_REGEX);
  if (!match) return '';
  return match[0].replace(/[\s.-]/g, '').replace(/^\+?84/, '0');
}

/**
 * Làm sạch nội dung trích dẫn (Quote Text)
 * Loại bỏ chuỗi JSON thô khi trích dẫn hình ảnh, file, sticker hoặc danh thiếp
 */
export function cleanQuoteText(msgText, attachRaw) {
  const cleanMsg = String(msgText || '').trim();
  if (cleanMsg) return cleanMsg;

  if (!attachRaw) return '[Đính kèm]';

  let attachObj = null;
  if (typeof attachRaw === 'object') {
    attachObj = attachRaw;
  } else if (typeof attachRaw === 'string') {
    const trimmed = attachRaw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        attachObj = JSON.parse(trimmed);
      } catch {}
    }
  }

  if (attachObj && typeof attachObj === 'object') {
    // 1. Trích dẫn Hình ảnh (Photo / Image)
    if (
      attachObj.href ||
      attachObj.thumb ||
      attachObj.hdUrl ||
      attachObj.url ||
      attachObj.type === 'photo' ||
      attachObj.action === 'photo' ||
      (typeof attachObj.href === 'string' && (attachObj.href.includes('zdn.vn') || attachObj.href.includes('photo')))
    ) {
      return '📷 [Hình ảnh]';
    }

    // 2. Trích dẫn Sticker
    if (attachObj.catId || attachObj.sticker || attachObj.type === 'sticker') {
      return '🎭 [Sticker]';
    }

    // 3. Trích dẫn Tệp tin (File / Document)
    if (attachObj.fileSize || attachObj.checksum || attachObj.fileName || attachObj.title) {
      const name = attachObj.title || attachObj.fileName || attachObj.name || '';
      return name ? `📎 [Tệp tin] ${name}` : '📎 [Tệp tin]';
    }

    // 4. Trích dẫn Danh thiếp (Contact Card)
    if (attachObj.phone || attachObj.contactUid || attachObj.type === 'contact' || attachObj.type === 'card') {
      const name = attachObj.title || attachObj.name || '';
      return name ? `📇 [Danh thiếp] ${name}` : '📇 [Danh thiếp]';
    }

    // 5. Trích dẫn Video
    if (attachObj.video || attachObj.type === 'video' || attachObj.duration) {
      return '🎬 [Video]';
    }

    if (attachObj.title && typeof attachObj.title === 'string' && attachObj.title.trim()) {
      return attachObj.title.trim();
    }
    if (attachObj.description && typeof attachObj.description === 'string' && attachObj.description.trim()) {
      return attachObj.description.trim();
    }
    return '📎 [Đính kèm]';
  }

  const attachStr = String(attachRaw).trim();
  if (attachStr.startsWith('{') && attachStr.includes('zdn.vn')) {
    return '📷 [Hình ảnh]';
  }
  return attachStr || '[Đính kèm]';
}

export function parseMessage(rawMsg) {
  if (!rawMsg) {
    return { type: 'text', text: '' };
  }

  const text = extractPlainText(rawMsg);

  try {
    const data = rawMsg.data || rawMsg;
    const content = data.content !== undefined ? data.content : rawMsg.content;
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

    // 1. Quote Message Detection (Làm sạch chuỗi JSON thô trong attach)
    const quote = data.quote || rawMsg.quote;
    if (quote && (quote.msg || quote.attach)) {
      const qText = cleanQuoteText(quote.msg, quote.attach);
      return {
        type: 'quote',
        text: text || String(content?.msg || content?.title || ''),
        quoteText: qText,
        quoteSender: String(quote.fromD || quote.dName || quote.ownerId || 'Người dùng'),
        mediaUrl: ''
      };
    }

    // 1.5. Contact / Card Message Detection (Personal QR Cards & Phonebook Shared Contacts)
    const isExplicitContact = (
      msgType === '6' ||
      msgType === 6 ||
      msgType.includes('contact') ||
      msgType.includes('recommend') ||
      content?.type === 'contact' ||
      content?.type === 'card' ||
      content?.type === 'share_contact'
    );

    let contactObj = null;
    if (content && typeof content === 'object') {
      contactObj = content;
    } else if (typeof content === 'string' && (content.startsWith('{') || isExplicitContact)) {
      try {
        const parsedJson = JSON.parse(content);
        if (parsedJson && typeof parsedJson === 'object') {
          contactObj = parsedJson;
        }
      } catch {}
    }

    if (!contactObj && data?.msgInfo) {
      if (typeof data.msgInfo === 'object') {
        contactObj = data.msgInfo;
      } else if (typeof data.msgInfo === 'string') {
        try { contactObj = JSON.parse(data.msgInfo); } catch {}
      }
    }

    const isProfileLink = Boolean(
      contactObj && (
        contactObj.action === 'view_profile' ||
        contactObj.action === 'view_contact' ||
        (contactObj.href && String(contactObj.href).includes('zalo.me'))
      )
    );

    const hasPhoneInPayload = Boolean(
      contactObj && (
        contactObj.phone ||
        contactObj.phoneNumber ||
        contactObj.phone_number ||
        data?.msgInfo?.phone ||
        VN_PHONE_REGEX.test(rawContentStr)
      )
    );

    const isContactCard = Boolean(
      isExplicitContact ||
      (contactObj && (contactObj.contactUid || contactObj.qrCodeUrl)) ||
      (isProfileLink && hasPhoneInPayload)
    );

    if (isContactCard) {
      let detectedPhone = '';
      let qrCodeUrl = contactObj?.qrCodeUrl || '';

      // Check if description is a JSON string containing phone / qrCodeUrl
      if (typeof contactObj?.description === 'string' && contactObj.description.trim().startsWith('{')) {
        try {
          const descJson = JSON.parse(contactObj.description);
          if (descJson && typeof descJson === 'object') {
            if (!detectedPhone && descJson.phone) detectedPhone = normalizeVnPhone(descJson.phone);
            if (!qrCodeUrl && descJson.qrCodeUrl) qrCodeUrl = descJson.qrCodeUrl;
          }
        } catch {}
      }

      if (contactObj?.phone) detectedPhone = normalizeVnPhone(contactObj.phone);
      if (!detectedPhone && contactObj?.phoneNumber) detectedPhone = normalizeVnPhone(contactObj.phoneNumber);
      if (!detectedPhone && contactObj?.phone_number) detectedPhone = normalizeVnPhone(contactObj.phone_number);
      if (!detectedPhone && data?.msgInfo?.phone) detectedPhone = normalizeVnPhone(data.msgInfo.phone);
      if (!detectedPhone && contactObj?.params) {
        const pStr = typeof contactObj.params === 'string' ? contactObj.params : JSON.stringify(contactObj.params);
        detectedPhone = normalizeVnPhone(pStr);
      }
      if (!detectedPhone) {
        detectedPhone = normalizeVnPhone(rawContentStr);
      }

      const isValidPhone = /^0\d{9,10}$/.test(detectedPhone);

      const isCleanName = (str) => {
        if (!str || typeof str !== 'string') return false;
        const trimmed = str.trim();
        if (!trimmed) return false;
        if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.endsWith('}')) return false;
        if (/^https?:\/\//i.test(trimmed) || trimmed.includes('zdn.vn') || trimmed.includes('zalo.me')) return false;
        if (/^(\+?84|0)[\d\s.-]+$/.test(trimmed)) return false;
        if (['view_profile', 'view_contact', 'chat.contact', 'contact', 'card'].includes(trimmed.toLowerCase())) return false;
        return true;
      };

      // Priority: title (contact card owner) -> name -> contactName -> displayName -> description (if text)
      let contactName = '';
      if (isCleanName(contactObj?.title)) {
        contactName = contactObj.title.trim();
      } else if (isCleanName(contactObj?.name)) {
        contactName = contactObj.name.trim();
      } else if (isCleanName(contactObj?.contactName)) {
        contactName = contactObj.contactName.trim();
      } else if (isCleanName(contactObj?.displayName)) {
        contactName = contactObj.displayName.trim();
      } else if (isCleanName(contactObj?.description)) {
        contactName = contactObj.description.trim();
      } else if (isCleanName(data?.msgInfo?.title)) {
        contactName = data.msgInfo.title.trim();
      } else if (isCleanName(data?.dName)) {
        contactName = data.dName.trim();
      } else {
        contactName = 'Liên hệ';
      }

      const mediaUrl = qrCodeUrl || contactObj?.avatar || contactObj?.avatarUrl || contactObj?.thumb || '';

      return {
        type: 'contact',
        text: isValidPhone ? `📇 [Danh thiếp] ${contactName} - SĐT: ${detectedPhone}` : `📇 [Danh thiếp] ${contactName} (Không hiển thị SĐT)`,
        mediaUrl: mediaUrl || ''
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
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.title === 'string' && parsed.title.trim() && !parsed.title.startsWith('{')) return parsed.title.trim();
            if (typeof parsed.description === 'string' && parsed.description.trim() && !parsed.description.startsWith('{')) return parsed.description.trim();
            if (typeof parsed.msg === 'string' && parsed.msg.trim() && !parsed.msg.startsWith('{')) return parsed.msg.trim();
            // Nếu là payload thuần hình ảnh / sticker không có text
            if (parsed.href || parsed.thumb || parsed.hdUrl || parsed.url || parsed.catId) return '';
          }
        } catch {}
      } else {
        return trimmed;
      }
    }
    if (content && typeof content === 'object') {
      if (typeof content.title === 'string' && !content.title.trim().startsWith('{')) return content.title.trim();
      if (typeof content.description === 'string' && !content.description.trim().startsWith('{')) return content.description.trim();
      if (typeof content.msg === 'string' && !content.msg.trim().startsWith('{')) return content.msg.trim();
    }
    const bodyStr = String(data?.body || data?.text || '').trim();
    if (bodyStr.startsWith('{') && (bodyStr.includes('hdUrl') || bodyStr.includes('thumb') || bodyStr.includes('href'))) {
      return '';
    }
    return bodyStr;
  } catch {
    return '';
  }
}

function extractImageUrl(content, data) {
  if (!content && !data) return '';

  let cObj = null;
  if (typeof content === 'object' && content !== null) {
    cObj = content;
  } else if (typeof content === 'string') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      try {
        cObj = JSON.parse(trimmed);
      } catch {}
    } else if (isImageUrl(trimmed)) {
      return trimmed;
    }
  }

  const dObj = (typeof data === 'object' && data !== null) ? data : null;

  // Thứ tự ưu tiên chất lượng ảnh: hdUrl (ảnh gốc HD) -> normalUrl -> url -> href -> thumb -> fileUrl
  const candidateUrl = (
    cObj?.hdUrl ||
    cObj?.normalUrl ||
    cObj?.url ||
    cObj?.href ||
    cObj?.thumb ||
    cObj?.fileUrl ||
    dObj?.hdUrl ||
    dObj?.normalUrl ||
    dObj?.url ||
    dObj?.thumb ||
    ''
  );

  if (typeof candidateUrl === 'string' && candidateUrl.trim() && !candidateUrl.trim().startsWith('{')) {
    return candidateUrl.trim();
  }

  return '';
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
  const trimmed = url.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return /\.(jpg|jpeg|png|webp|gif|bmp)(\?.*)?$/i.test(trimmed) || trimmed.includes('zadn.vn') || trimmed.includes('zdn.vn');
}
