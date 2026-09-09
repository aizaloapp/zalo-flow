import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { scheduledDispatcher } from '../utils/scheduled-dispatcher.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Ensure upload directory exists for scheduled media
const scheduledUploadDir = path.resolve('data/uploads/scheduled');
if (!fs.existsSync(scheduledUploadDir)) {
  fs.mkdirSync(scheduledUploadDir, { recursive: true });
}

// Multer Storage Configuration (25MB limit)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, scheduledUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `sched_${crypto.randomUUID().substring(0, 8)}_${Date.now()}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// =============================================================================
// 0. Static Media Serving & Upload for Scheduled Messages
// =============================================================================
router.get('/scheduled-messages/media/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(scheduledUploadDir, filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Not Found');
  }
});

router.post('/scheduled-messages/upload', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Không tìm thấy tệp tải lên' });
    }
    const mediaUrl = `/api/scheduled-messages/media/${req.file.filename}`;
    res.json({
      status: 'success',
      data: {
        mediaUrl,
        mediaName: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size
      }
    });
  } catch (err) {
    logger.error(`[Scheduled Msg Upload Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 1. GET /conversations/:threadId/scheduled-message - Lấy lịch hẹn của hội thoại
// =============================================================================
router.get('/conversations/:threadId/scheduled-message', requireAuth, (req, res) => {
  try {
    const { threadId } = req.params;
    const active = localStore.getActiveScheduledMessage(threadId);
    res.json({ status: 'success', data: active });
  } catch (err) {
    logger.error(`[Scheduled Msg GET Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 2. POST /conversations/:threadId/scheduled-message - Tạo mới lịch hẹn
// =============================================================================
router.post('/conversations/:threadId/scheduled-message', requireAuth, (req, res) => {
  try {
    const { threadId } = req.params;
    const { message, scheduledAt, customerName, mediaUrl = '', mediaName = '' } = req.body;

    // Guard 1: Chặn nhóm chat
    const conv = localStore.getConversation(threadId);
    if (conv && conv.isGroup) {
      return res.status(400).json({ error: 'Tính năng hẹn giờ hiện tại chỉ hỗ trợ tin nhắn cá nhân 1-1' });
    }

    // Guard 2: Mỗi hội thoại chỉ tối đa 1 lịch hẹn đang pending / active
    const existing = localStore.getActiveScheduledMessage(threadId);
    if (existing && ['pending', 'processing', 'paused_by_reply'].includes(existing.status)) {
      return res.status(400).json({
        error: 'Hội thoại này đang có một lịch hẹn chờ gửi. Vui lòng sửa hoặc hủy lịch cũ trước khi tạo lịch mới.'
      });
    }

    // Guard 3: Validate message / mediaUrl
    const trimmedMsg = (message || '').trim();
    if (!trimmedMsg && !mediaUrl) {
      return res.status(400).json({ error: 'Nội dung tin nhắn hoặc hình ảnh đính kèm là bắt buộc' });
    }

    // Guard 4: Validate scheduledAt (Epoch ms)
    const schedMs = Number(scheduledAt);
    if (!schedMs || isNaN(schedMs)) {
      return res.status(400).json({ error: 'Thời gian hẹn không hợp lệ' });
    }
    if (schedMs <= Date.now()) {
      return res.status(400).json({ error: 'Thời gian hẹn phải lớn hơn thời điểm hiện tại' });
    }

    const created = localStore.createScheduledMessage({
      threadId,
      customerName: (customerName || conv?.name || '').trim(),
      message: trimmedMsg,
      mediaUrl: (mediaUrl || '').trim(),
      mediaName: (mediaName || '').trim(),
      scheduledAt: schedMs
    });

    logger.info(`⏰ [Scheduled Msg Created] ID: ${created.id} for thread: ${threadId} at ${new Date(schedMs).toLocaleString('vi-VN')}`);
    res.json({ status: 'success', data: created });
  } catch (err) {
    logger.error(`[Scheduled Msg POST Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 3. PUT /scheduled-messages/:id - Sửa lịch hẹn hoặc thao tác resume / send_now
// =============================================================================
router.put('/scheduled-messages/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { message, scheduledAt, action, mediaUrl, mediaName } = req.body;

    const existing = localStore.getScheduledMessageById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Không tìm thấy lịch hẹn' });
    }

    // Action: Tiếp tục gửi sau khi bị tạm dừng
    if (action === 'resume') {
      const resumed = localStore.resumeScheduledMessage(id);
      return res.json({ status: 'success', data: resumed });
    }

    // Action: Gửi ngay lập tức (Send Now)
    if (action === 'send_now') {
      const updated = localStore.updateScheduledMessage(id, {
        scheduledAt: Date.now() - 1000,
        status: 'pending',
        error: ''
      });
      // Kích hoạt ticker ngay
      setImmediate(() => scheduledDispatcher.tick());
      return res.json({ status: 'success', data: updated, message: 'Đã kích hoạt gửi ngay' });
    }

    // Normal Update: Sửa nội dung hoặc dời giờ hẹn
    const updates = {};
    if (message !== undefined) {
      updates.message = (message || '').trim();
    }
    if (mediaUrl !== undefined) {
      updates.mediaUrl = (mediaUrl || '').trim();
    }
    if (mediaName !== undefined) {
      updates.mediaName = (mediaName || '').trim();
    }
    if (scheduledAt !== undefined) {
      const schedMs = Number(scheduledAt);
      if (!schedMs || isNaN(schedMs) || schedMs <= Date.now()) {
        return res.status(400).json({ error: 'Thời gian dời hẹn phải ở tương lai' });
      }
      updates.scheduledAt = schedMs;
      if (existing.status === 'missed') {
        updates.status = 'pending';
        updates.error = '';
      }
    }

    const updated = localStore.updateScheduledMessage(id, updates);
    res.json({ status: 'success', data: updated });
  } catch (err) {
    logger.error(`[Scheduled Msg PUT Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 4. DELETE /scheduled-messages/:id - Hủy lịch hẹn
// =============================================================================
router.delete('/scheduled-messages/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const cancelled = localStore.cancelScheduledMessage(id);
    if (!cancelled) {
      return res.status(404).json({ error: 'Không tìm thấy lịch hẹn để hủy' });
    }
    logger.info(`🗑️ [Scheduled Msg Cancelled] ID: ${id}`);
    res.json({ status: 'success', data: cancelled });
  } catch (err) {
    logger.error(`[Scheduled Msg DELETE Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
