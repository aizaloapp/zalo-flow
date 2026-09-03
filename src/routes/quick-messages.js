import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Ensure persistent quick-msg upload directory exists
const quickUploadDir = path.resolve('data/uploads/quick-msg');
if (!fs.existsSync(quickUploadDir)) {
  fs.mkdirSync(quickUploadDir, { recursive: true });
}

// 100MB Directory Quota Guard
const MAX_TOTAL_QUOTA = 100 * 1024 * 1024; // 100MB
function getQuickMsgDirSize() {
  try {
    const files = fs.readdirSync(quickUploadDir);
    let total = 0;
    for (const f of files) {
      const stat = fs.statSync(path.join(quickUploadDir, f));
      total += stat.size;
    }
    return total;
  } catch {
    return 0;
  }
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, quickUploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `qm_${crypto.randomUUID().substring(0, 8)}_${Date.now()}${ext}`;
    cb(null, safeName);
  }
});

// Whitelist Filter (Hard Guardrail #2 & #3)
const ALLOWED_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.txt']);
const FORBIDDEN_EXTS = new Set(['.exe', '.bat', '.cmd', '.sh', '.js', '.vbs', '.msi', '.ps1', '.php', '.phtml', '.py']);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit per file
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (FORBIDDEN_EXTS.has(ext)) {
      return cb(new Error('Loại tệp thực thi này bị nghiêm cấm vì lý do an toàn.'));
    }
    if (!ALLOWED_EXTS.has(ext)) {
      return cb(new Error(`Định dạng tệp ${ext} không được hỗ trợ. Vui lòng chọn ảnh (.png, .jpg, .webp) hoặc tài liệu (.pdf, .doc, .xls, .zip).`));
    }
    cb(null, true);
  }
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

// GET /api/quick-messages - Get all quick reply templates
router.get('/quick-messages', requireAuth, (req, res) => {
  try {
    const list = localStore.getQuickMessages();
    res.json({ status: 'success', data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quick-messages/upload - Upload 1 or up to 5 attachments for quick message
router.post('/quick-messages/upload', requireAuth, uploadAny, (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'Vui lòng chọn tệp tin để tải lên.' });
  }

  // Check 50MB total quota
  const currentSize = getQuickMsgDirSize();
  if (currentSize > MAX_TOTAL_QUOTA) {
    for (const f of files) {
      try { fs.unlinkSync(f.path); } catch (_) {}
    }
    return res.status(400).json({
      error: 'Tổng dung lượng lưu trữ tệp tin nhắn nhanh đã vượt quá giới hạn 50MB. Vui lòng dọn dẹp các mẫu tin cũ.'
    });
  }

  const uploaded = files.map(file => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isImage = file.mimetype.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext);
    const mediaType = isImage ? 'image' : 'file';
    const mediaUrl = `/api/quick-messages/media/${file.filename}`;

    logger.info(`📎 [QuickMsg Media] Uploaded ${file.originalname} -> ${file.filename} (${mediaType})`);
    return {
      mediaUrl,
      mediaType,
      mediaName: file.originalname
    };
  });

  res.json({
    status: 'success',
    data: uploaded.length === 1 ? uploaded[0] : uploaded,
    items: uploaded
  });
});

// GET /api/quick-messages/media/:filename - Controlled Media Delivery with Path Traversal Guard
router.get('/quick-messages/media/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(quickUploadDir, filename);

  if (!filePath.startsWith(quickUploadDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Tệp đính kèm không tồn tại hoặc đã bị xóa.' });
  }

  res.sendFile(filePath);
});

// POST /api/quick-messages - Create or update quick reply template & Q&A pair
router.post('/quick-messages', requireAuth, (req, res) => {
  const { id, shortcut, customerQuestion, title, content, mediaUrl, mediaType, mediaName, attachments } = req.body;
  if (!shortcut || !content) {
    return res.status(400).json({ error: 'Phím tắt và nội dung không được để trống' });
  }

  let finalMediaUrl = mediaUrl || '';
  let finalMediaType = mediaType || '';
  let finalMediaName = mediaName || '';

  if (Array.isArray(attachments)) {
    if (attachments.length > 0) {
      const capped = attachments.slice(0, 5);
      finalMediaUrl = JSON.stringify(capped);
      finalMediaType = capped[0]?.mediaType || '';
      finalMediaName = capped[0]?.mediaName || '';
    } else {
      finalMediaUrl = '';
      finalMediaType = '';
      finalMediaName = '';
    }
  }

  try {
    const qm = localStore.upsertQuickMessage({
      id,
      shortcut,
      customerQuestion,
      title: title || customerQuestion || shortcut,
      content,
      mediaUrl: finalMediaUrl,
      mediaType: finalMediaType,
      mediaName: finalMediaName
    });
    res.json({ status: 'success', data: qm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/quick-messages/:id - Delete template
router.delete('/quick-messages/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  try {
    localStore.deleteQuickMessage(id);
    res.json({ status: 'success', message: 'Đã xóa tin nhắn nhanh' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
