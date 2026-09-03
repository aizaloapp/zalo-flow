import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { zaloClient } from '../zalo-client.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Ensure upload directory exists
const uploadDir = path.resolve('data/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer upload config: 25MB limit for Zalo standard document compatibility
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Safe Multer Middleware with Guaranteed JSON Error Response
const uploadAny = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Lỗi tải tệp: ${err.message}` });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

// =============================================================================
// 1. POST /conversations/:threadId/react - Thả Reaction cảm xúc
// =============================================================================
router.post('/conversations/:threadId/react', requireAuth, async (req, res) => {
  const { threadId } = req.params;
  const { msgId, emoji = '❤️', isGroup = false } = req.body;

  if (!msgId) {
    return res.status(400).json({ error: 'Thiếu msgId để thả cảm xúc!' });
  }

  try {
    const result = await zaloClient.addReaction(msgId, threadId, emoji, Boolean(isGroup));
    localStore.updateMessageReaction(msgId, emoji);
    res.json({
      status: 'success',
      message: `Đã thả cảm xúc ${emoji} thành công!`,
      emoji,
      msgId,
      data: result
    });
  } catch (err) {
    logger.warn(`[Reaction Error] ${err.message}`);
    res.status(500).json({ error: `Không thể thả cảm xúc: ${err.message}` });
  }
});

// =============================================================================
// 2. POST /conversations/:threadId/reply-quote - Trả lời kèm trích dẫn
// =============================================================================
router.post('/conversations/:threadId/reply-quote', requireAuth, async (req, res) => {
  const { threadId } = req.params;
  const { text, quoteData, isGroup = false } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Nội dung tin nhắn không được để trống!' });
  }

  try {
    const result = await zaloClient.sendMessageWithQuote(threadId, text.trim(), quoteData || {}, Boolean(isGroup));
    res.json({
      status: 'success',
      message: 'Đã gửi tin nhắn trích dẫn thành công!',
      data: result
    });
  } catch (err) {
    logger.error(`[Quote Reply Error] ${err.message}`);
    res.status(500).json({ error: `Không thể gửi trích dẫn: ${err.message}` });
  }
});

// Ensure chat-media directory exists
const chatMediaDir = path.resolve('data/uploads/chat-media');
if (!fs.existsSync(chatMediaDir)) {
  fs.mkdirSync(chatMediaDir, { recursive: true });
}

// =============================================================================
// 3. POST /conversations/:threadId/upload-media - Upload & Gửi Ảnh / Tệp (Tối đa 5 tệp)
// =============================================================================
router.post('/conversations/:threadId/upload-media', requireAuth, uploadAny, async (req, res) => {
  const { threadId } = req.params;
  const conv = localStore.getConversation(threadId);
  const isGroup = conv ? Boolean(conv.isGroup) : (req.body.isGroup === true || req.body.isGroup === 'true' || req.body.isGroup === '1');

  const files = req.files || (req.file ? [req.file] : []);
  const localFilePaths = [];
  const tempFilesToClean = [];

  if (files.length > 0) {
    for (const file of files) {
      tempFilesToClean.push(file.path);
      const ext = path.extname(file.originalname).toLowerCase();
      const isImage = file.mimetype.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
      const safeFilename = `chat_${crypto.randomUUID().substring(0, 8)}_${Date.now()}${ext}`;
      const persistentPath = path.resolve(chatMediaDir, safeFilename);

      try {
        fs.copyFileSync(file.path, persistentPath);
        localFilePaths.push({
          path: persistentPath,
          mediaUrl: `/api/chat-media/${safeFilename}`,
          mediaType: isImage ? 'image' : 'file',
          originalName: file.originalname
        });
      } catch (err) {
        logger.warn(`Failed to copy file: ${err.message}`);
      }
    }
  } else if (req.body.mediaUrls) {
    let urls = [];
    try {
      urls = Array.isArray(req.body.mediaUrls) ? req.body.mediaUrls : JSON.parse(req.body.mediaUrls);
    } catch (_) {
      urls = [String(req.body.mediaUrls)];
    }
    for (const u of urls) {
      const urlStr = typeof u === 'string' ? u : (u.mediaUrl || '');
      const filename = path.basename(urlStr);
      const qmPath = path.resolve('data/uploads/quick-msg', filename);
      if (fs.existsSync(qmPath)) {
        const ext = path.extname(filename).toLowerCase();
        const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
        localFilePaths.push({
          path: qmPath,
          mediaUrl: `/api/quick-messages/media/${filename}`,
          mediaType: isImage ? 'image' : 'file',
          originalName: (typeof u === 'object' && u.mediaName) ? u.mediaName : filename
        });
      }
    }
  }

  if (localFilePaths.length === 0) {
    return res.status(400).json({ error: 'Vui lòng đính kèm tệp tin hợp lệ (tối đa 5 tệp, mỗi tệp <= 10MB)!' });
  }

  try {
    const diskPaths = localFilePaths.map(f => f.path);
    const firstItem = localFilePaths[0];

    const result = await zaloClient.uploadAttachment(threadId, diskPaths, isGroup, {
      items: localFilePaths,
      mediaUrl: firstItem.mediaUrl,
      mediaType: firstItem.mediaType,
      originalName: localFilePaths.length === 1 ? firstItem.originalName : `${localFilePaths.length} tệp đính kèm`
    });

    res.json({
      status: 'success',
      message: `Đã gửi ${localFilePaths.length} tệp tin đính kèm thành công!`,
      data: {
        ...result,
        items: localFilePaths
      }
    });
  } catch (err) {
    logger.error(`[Upload Media Error] ${err.message}`);
    res.status(500).json({ error: `Lỗi gửi tệp tin: ${err.message}` });
  } finally {
    for (const p of tempFilesToClean) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (_) {}
    }
  }
});

// GET /chat-media/:filename - Controlled Media Delivery with Path Traversal Guard
router.get('/chat-media/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(chatMediaDir, filename);

  if (!filePath.startsWith(chatMediaDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Tệp đính kèm không tồn tại hoặc đã bị xóa.' });
  }

  res.sendFile(filePath);
});

// =============================================================================
// 4. POST /conversations/:threadId/forward - Chuyển tiếp tin nhắn
// =============================================================================
router.post('/conversations/:threadId/forward', requireAuth, async (req, res) => {
  const { msgPayload, targetThreadIds = [], isGroup = false } = req.body;

  if (!Array.isArray(targetThreadIds) || targetThreadIds.length === 0) {
    return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 người nhận để chuyển tiếp!' });
  }

  // ⚠️ Guardrail #7: Chỉ forward tới các cuộc trò chuyện đã có trong danh bạ
  for (const targetId of targetThreadIds) {
    const conv = localStore.getConversation(targetId);
    if (!conv) {
      return res.status(400).json({
        error: `Không thể chuyển tiếp tới [${targetId}]: Chưa có lịch sử trò chuyện (Chống Spam).`
      });
    }
  }

  try {
    const result = await zaloClient.forwardMessage(msgPayload, targetThreadIds, Boolean(isGroup));
    res.json({
      status: 'success',
      message: `Đã chuyển tiếp tin nhắn tới ${targetThreadIds.length} người nhận!`,
      data: result
    });
  } catch (err) {
    logger.error(`[Forward Error] ${err.message}`);
    res.status(500).json({ error: `Lỗi chuyển tiếp: ${err.message}` });
  }
});

// =============================================================================
// 5. GET & POST /conversations/:threadId/crm - Quản lý thông tin CRM
// =============================================================================
router.get('/conversations/:threadId/crm', requireAuth, (req, res) => {
  const { threadId } = req.params;
  try {
    const info = localStore.getCrmInfo(threadId);
    res.json({ status: 'success', data: info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversations/:threadId/crm', requireAuth, (req, res) => {
  const { threadId } = req.params;
  try {
    const updated = localStore.saveCrmInfo(threadId, req.body || {});
    res.json({ status: 'success', message: 'Đã lưu thông tin khách hàng thành công!', data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 6. POST /conversations/:threadId/messages/:msgId/undo - Thu hồi tin nhắn
// =============================================================================
router.post('/conversations/:threadId/messages/:msgId/undo', requireAuth, async (req, res) => {
  const { threadId, msgId } = req.params;
  const { isGroup = false } = req.body;

  const origMsg = localStore.getMessage(msgId);
  if (origMsg) {
    const msgAge = Date.now() - new Date(origMsg.timestamp).getTime();
    if (msgAge > 2 * 60 * 1000) {
      return res.status(400).json({
        error: 'Không thể thu hồi: tin nhắn đã gửi quá 2 phút.'
      });
    }
  }

  try {
    const result = await zaloClient.undoMessage(msgId, threadId, Boolean(isGroup));
    res.json({
      status: 'success',
      message: 'Đã thu hồi tin nhắn thành công!',
      data: result
    });
  } catch (err) {
    logger.error(`[Undo Error] ${err.message}`);
    res.status(500).json({ error: `Lỗi thu hồi tin nhắn: ${err.message}` });
  }
});

// =============================================================================
// 7. POST /phone-lookup - Tra cứu Profile Zalo qua Số Điện Thoại
// =============================================================================
router.post('/phone-lookup', requireAuth, async (req, res) => {
  const { phone } = req.body;
  if (!phone || String(phone).trim().length < 9) {
    return res.status(400).json({ error: 'Vui lòng nhập số điện thoại hợp lệ (tối thiểu 9 số)!' });
  }

  try {
    const result = await zaloClient.lookupPhoneNumber(String(phone).trim());
    res.json({
      status: 'success',
      data: {
        ...result,
        canMessage: result.isFriend === true,
        guardNote: result.isFriend
          ? null
          : '⚠️ Chưa là bạn bè — không thể nhắn tin trực tiếp (Quy tắc Anti-Spam: In-Thread Reply Only)'
      }
    });
  } catch (err) {
    logger.warn(`[Phone Lookup Error] ${err.message}`);
    res.status(404).json({ error: err.message });
  }
});

export default router;
