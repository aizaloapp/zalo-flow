import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { zaloClient } from '../zalo-client.js';
import { resolveSpintax, generateSamplePreviews } from '../utils/spintax.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Uploads directory for campaign media
const campaignsUploadDir = path.resolve('data/uploads/campaigns');
if (!fs.existsSync(campaignsUploadDir)) {
  fs.mkdirSync(campaignsUploadDir, { recursive: true });
}

// Multer Storage Configuration
const campaignStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, campaignsUploadDir),
  filename: (req, file, cb) => {
    const uniquePrefix = `camp_${crypto.randomUUID().substring(0, 8)}_${Date.now()}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniquePrefix}${ext}`);
  }
});

const upload = multer({
  storage: campaignStorage,
  limits: { fileSize: 25 * 1024 * 1024, files: 5 } // 25MB per file, max 5 files
});

// Guardrail #19: Multer Safe Middleware & Guaranteed JSON Error Contract
const uploadAny = (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      logger.error(`[Campaign Multer Error] ${err.message}`);
      return res.status(400).json({ error: err.message || 'Lỗi khi tải tệp tin lên' });
    }
    next();
  });
};

// Track active campaign background workers
const runningCampaigns = new Set();

// Helper sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// =============================================================================
// 1. GET /api/campaigns - Get all campaigns
// =============================================================================
router.get('/campaigns', requireAuth, (req, res) => {
  try {
    const list = localStore.getCampaigns();
    res.json({ status: 'success', data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 2. POST /api/campaigns/upload - Safe Media Upload (Images & Docs up to 5 files)
// =============================================================================
router.post('/campaigns/upload', requireAuth, uploadAny, (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 tệp tin hợp lệ (tối đa 5 tệp, <= 10MB/tệp)' });
    }

    const uploaded = files.map(f => {
      const ext = path.extname(f.originalname).toLowerCase();
      const isImage = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext);
      return {
        mediaUrl: `/api/campaigns/media/${f.filename}`,
        mediaType: isImage ? 'image' : 'file',
        mediaName: f.originalname,
        size: f.size
      };
    });

    res.json({ status: 'success', data: uploaded });
  } catch (err) {
    logger.error(`[Campaign Upload Handler Error] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 3. GET /api/campaigns/media/:filename - Controlled Media Delivery
// =============================================================================
router.get('/campaigns/media/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(campaignsUploadDir, filename);

  if (!filePath.startsWith(campaignsUploadDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Tệp đính kèm không tồn tại hoặc đã bị xóa.' });
  }

  res.sendFile(filePath);
});

// =============================================================================
// 4. POST /api/campaigns/preview - Preview 3 spintax variation samples
// =============================================================================
router.post('/campaigns/preview', requireAuth, (req, res) => {
  const { message, sampleName = 'Nguyễn Văn A' } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Nội dung tin nhắn không được để trống' });
  }

  try {
    const previews = generateSamplePreviews(message, { name: sampleName }, 3);
    res.json({ status: 'success', data: previews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 5. POST /api/campaigns - Create a new campaign
// =============================================================================
router.post('/campaigns', requireAuth, (req, res) => {
  const {
    name,
    description = '',
    message,
    mediaUrls = [],
    targetType = 'all',
    targetTagIds = [],
    targetKeyword = '',
    scheduleType = 'manual',
    scheduleTime = '08:30',
    scheduleMode = 'scheduled',
    startDate = '',
    recurrence = 'once',
    isEnabled = 0,
    delayMinMs,
    delayMaxMs,
    batchSize,
    batchPauseMs
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Tên chiến dịch không được để trống' });
  }

  if (!message && (!mediaUrls || mediaUrls.length === 0)) {
    return res.status(400).json({ error: 'Vui lòng nhập nội dung tin nhắn hoặc chọn tệp đính kèm' });
  }

  try {
    const targets = localStore.getCampaignTargets({ targetType, targetTagIds, targetKeyword });
    if (targets.length === 0) {
      return res.status(400).json({ error: 'Không tìm thấy khách hàng nào khớp với đối tượng, từ khóa và thẻ đã chọn.' });
    }

    const campaign = localStore.createCampaign({
      name,
      description,
      message: message || '',
      mediaUrls,
      targetType,
      targetTagIds,
      targetKeyword,
      scheduleType,
      scheduleTime,
      scheduleMode,
      startDate,
      recurrence,
      isEnabled: Boolean(isEnabled) ? 1 : 0,
      delayMinMs: Number(delayMinMs) || 10000,
      delayMaxMs: Number(delayMaxMs) || 25000,
      batchSize: Number(batchSize) || 25,
      batchPauseMs: Number(batchPauseMs) || 180000
    });

    // Populate persistent queue
    localStore.initCampaignQueue(campaign.id, targets);
    localStore.updateCampaignStatus(campaign.id, { totalCount: targets.length });

    res.json({ status: 'success', data: localStore.getCampaign(campaign.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 6. PUT /api/campaigns/:id - Update an existing campaign
// =============================================================================
router.put('/campaigns/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    message,
    mediaUrls,
    targetType,
    targetTagIds,
    targetKeyword,
    scheduleType,
    scheduleTime,
    scheduleMode,
    startDate,
    recurrence,
    isEnabled,
    delayMinMs,
    delayMaxMs,
    batchSize,
    batchPauseMs
  } = req.body;

  const existing = localStore.getCampaign(id);
  if (!existing) {
    return res.status(404).json({ error: 'Chiến dịch không tồn tại' });
  }

  try {
    const updated = localStore.updateCampaign(id, {
      name,
      description,
      message,
      mediaUrls,
      targetType,
      targetTagIds,
      targetKeyword,
      scheduleType,
      scheduleTime,
      scheduleMode,
      startDate,
      recurrence,
      isEnabled,
      delayMinMs,
      delayMaxMs,
      batchSize,
      batchPauseMs
    });

    // Re-populate targets if targets changed and campaign is not currently running
    if (!runningCampaigns.has(id) && (targetType !== undefined || targetTagIds !== undefined || targetKeyword !== undefined)) {
      const targets = localStore.getCampaignTargets({
        targetType: targetType !== undefined ? targetType : existing.targetType,
        targetTagIds: targetTagIds !== undefined ? targetTagIds : existing.targetTagIds,
        targetKeyword: targetKeyword !== undefined ? targetKeyword : existing.targetKeyword
      });
      localStore.initCampaignQueue(id, targets);
      localStore.updateCampaignStatus(id, { totalCount: targets.length, sentCount: 0, failedCount: 0 });
    }

    res.json({ status: 'success', data: localStore.getCampaign(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 7. DELETE /api/campaigns/:id - Delete a campaign
// =============================================================================
router.delete('/campaigns/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  runningCampaigns.delete(id);
  try {
    localStore.deleteCampaign(id);
    res.json({ status: 'success', message: 'Đã xóa chiến dịch thành công' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 8. POST /api/campaigns/:id/toggle - Toggle Enable/Disable Switch
// =============================================================================
router.post('/campaigns/:id/toggle', requireAuth, (req, res) => {
  const { id } = req.params;
  const campaign = localStore.getCampaign(id);
  if (!campaign) {
    return res.status(404).json({ error: 'Chiến dịch không tồn tại' });
  }

  const nextState = campaign.isEnabled ? 0 : 1;
  localStore.toggleCampaign(id, nextState);
  if (nextState === 0) {
    runningCampaigns.delete(id);
    localStore.updateCampaignStatus(id, { status: 'paused' });
  }

  res.json({ status: 'success', data: localStore.getCampaign(id) });
});

// =============================================================================
// 9. POST /api/campaigns/:id/start - Start campaign background worker
// =============================================================================
router.post('/campaigns/:id/start', requireAuth, (req, res) => {
  const { id } = req.params;
  const campaign = localStore.getCampaign(id);

  if (!campaign) {
    return res.status(404).json({ error: 'Chiến dịch không tồn tại' });
  }

  if (!zaloClient.isLoggedIn) {
    return res.status(503).json({ error: 'Zalo client chưa đăng nhập. Vui lòng kết nối Zalo trước.' });
  }

  if (runningCampaigns.has(id)) {
    return res.json({ status: 'success', message: 'Chiến dịch đang chạy' });
  }

  const MAX_DAILY_SENDS = 200;
  const sentToday = localStore.getCampaignSentToday();
  if (sentToday >= MAX_DAILY_SENDS) {
    return res.status(429).json({
      error: `Đã đạt giới hạn an toàn ${MAX_DAILY_SENDS} tin nhắn/ngày để bảo vệ tài khoản Zalo. Vui lòng tiếp tục vào ngày mai.`
    });
  }

  // Ensure queue is populated
  const pending = localStore.getNextQueueItem(id);
  if (!pending) {
    const targets = localStore.getCampaignTargets({
      targetType: campaign.targetType,
      targetTagIds: campaign.targetTagIds
    });
    if (targets.length === 0) {
      return res.status(400).json({ error: 'Không tìm thấy khách hàng nào trong nhóm đối tượng đã chọn.' });
    }
    localStore.initCampaignQueue(id, targets);
    localStore.updateCampaignStatus(id, { totalCount: targets.length, sentCount: 0, failedCount: 0 });
  }

  localStore.updateCampaignStatus(id, { status: 'running' });
  localStore.toggleCampaign(id, 1);
  runningCampaigns.add(id);

  // Launch non-blocking background queue dispatcher
  setImmediate(() => runCampaignDispatcher(id));

  res.json({ status: 'success', message: 'Đã khởi chạy chiến dịch thành công' });
});

// =============================================================================
// 10. POST /api/campaigns/:id/pause - Pause campaign
// =============================================================================
router.post('/campaigns/:id/pause', requireAuth, (req, res) => {
  const { id } = req.params;
  runningCampaigns.delete(id);
  localStore.updateCampaignStatus(id, { status: 'paused' });
  res.json({ status: 'success', message: 'Đã tạm dừng chiến dịch' });
});

// =============================================================================
// 11. GET /api/campaigns/:id/logs - Get campaign execution logs
// =============================================================================
router.get('/campaigns/:id/logs', requireAuth, (req, res) => {
  const { id } = req.params;
  try {
    const logs = localStore.getCampaignLogs(id);
    res.json({ status: 'success', data: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// 12. Adaptive Safe Background Dispatcher (With Discrete Multi-Attachment Persistence)
// =============================================================================
async function runCampaignDispatcher(campaignId) {
  logger.info(`🚀 Starting Safe Campaign Dispatcher for [${campaignId}]...`);
  let consecutiveErrors = 0;
  let batchCount = 0;

  while (runningCampaigns.has(campaignId)) {
    const campaign = localStore.getCampaign(campaignId);
    if (!campaign || campaign.status !== 'running') {
      runningCampaigns.delete(campaignId);
      break;
    }

    const item = localStore.getNextQueueItem(campaignId);
    if (!item) {
      // Queue completed!
      localStore.updateCampaignStatus(campaignId, { status: 'completed' });
      runningCampaigns.delete(campaignId);
      logger.info(`🎉 Campaign [${campaignId}] has completed all recipients!`);
      break;
    }

    // 1. Resolve Spintax & Personalization
    const personalizedMessage = campaign.message ? resolveSpintax(campaign.message, {
      name: item.customerName || 'bạn',
      threadId: item.threadId
    }) : '';

    const isGroup = Boolean(item.isGroup);

    try {
      logger.info(`📢 [Campaign] Dispatching to ${item.customerName} (${item.threadId}): "${(personalizedMessage || '[Đính kèm]').substring(0, 40)}..."`);
      
      // 2. Send Text Message (if text message provided)
      if (personalizedMessage) {
        await zaloClient.sendMessage(item.threadId, personalizedMessage, isGroup);
      }

      // 3. Send Multi-Attachments (if attachments provided) - Guardrail #20
      const mediaItems = Array.isArray(campaign.mediaUrls) ? campaign.mediaUrls : JSON.parse(campaign.mediaUrls || '[]');
      if (mediaItems.length > 0) {
        const localFilePaths = [];
        for (const m of mediaItems) {
          const fn = path.basename(m.mediaUrl || m);
          const p = path.resolve('data/uploads/campaigns', fn);
          if (fs.existsSync(p)) {
            localFilePaths.push({
              path: p,
              mediaUrl: `/api/campaigns/media/${fn}`,
              mediaType: m.mediaType || (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(fn).toLowerCase()) ? 'image' : 'file'),
              originalName: m.mediaName || fn
            });
          }
        }

        if (localFilePaths.length > 0) {
          const diskPaths = localFilePaths.map(f => f.path);
          await zaloClient.uploadAttachment(item.threadId, diskPaths, isGroup, {
            items: localFilePaths,
            mediaUrl: localFilePaths[0].mediaUrl,
            mediaType: localFilePaths[0].mediaType,
            originalName: localFilePaths.length === 1 ? localFilePaths[0].originalName : `${localFilePaths.length} tệp đính kèm`
          });
        }
      }

      localStore.updateQueueItem(item.id, { status: 'sent' });
      localStore.logCampaignSend({
        campaignId,
        threadId: item.threadId,
        customerName: item.customerName,
        sentContent: personalizedMessage || `[Đã gửi ${mediaItems.length} tệp đính kèm]`,
        status: 'success'
      });

      const updatedSent = (campaign.sentCount || 0) + 1;
      localStore.updateCampaignStatus(campaignId, { sentCount: updatedSent });

      consecutiveErrors = 0;
      batchCount++;

      // 4. Check Batch Breathing Pause (Every 25 items -> pause 3 minutes)
      if (batchCount >= (campaign.batchSize || 25)) {
        batchCount = 0;
        const pauseMs = campaign.batchPauseMs || 180000;
        logger.info(`☕ [Campaign] Batch breathing pause: resting for ${Math.round(pauseMs / 1000)}s...`);
        await sleep(pauseMs);
      } else {
        // 5. Random Jitter Delay (10s - 25s)
        const delay = randomBetween(campaign.delayMinMs || 10000, campaign.delayMaxMs || 25000);
        logger.info(`⏳ [Campaign] Jitter delay: waiting ${(delay / 1000).toFixed(1)}s before next message...`);
        await sleep(delay);
      }
    } catch (sendErr) {
      consecutiveErrors++;
      logger.error(`❌ [Campaign] Send error to ${item.threadId}: ${sendErr.message}`);

      localStore.updateQueueItem(item.id, { status: 'failed', error: sendErr.message });
      localStore.logCampaignSend({
        campaignId,
        threadId: item.threadId,
        customerName: item.customerName,
        sentContent: personalizedMessage || '[Đính kèm]',
        status: 'failed',
        error: sendErr.message
      });

      const updatedFailed = (campaign.failedCount || 0) + 1;
      localStore.updateCampaignStatus(campaignId, { failedCount: updatedFailed });

      // Auto-pause after 3 consecutive errors
      if (consecutiveErrors >= 3) {
        logger.warn(`⚠️ [Campaign] Auto-paused due to 3 consecutive errors.`);
        localStore.updateCampaignStatus(campaignId, { status: 'paused' });
        runningCampaigns.delete(campaignId);
        break;
      }

      await sleep(15000); // Back off 15s on error
    }
  }
}

// =============================================================================
// 13. Auto-Schedule Background Ticker (Every 30 seconds)
// =============================================================================
setInterval(async () => {
  try {
    if (!zaloClient.isLoggedIn) return;

    const now = new Date();
    // Vietnam Time (UTC+7)
    const vnDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }); // "YYYY-MM-DD"
    const vnTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }); // "HH:MM"
    const vnDayOfWeek = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'short' }).format(now);
    const vnDayOfMonth = parseInt(vnDateStr.split('-')[2], 10);

    const campaigns = localStore.getCampaigns();
    for (const camp of campaigns) {
      if (camp.isEnabled !== 1 || runningCampaigns.has(camp.id)) continue;

      const scheduleMode = camp.scheduleMode || (camp.scheduleType === 'daily' ? 'scheduled' : 'now');
      if (scheduleMode !== 'scheduled') continue;

      const timeMatches = (camp.scheduleTime || '08:30') === vnTimeStr;
      const notRunToday = camp.lastRunAt !== vnDateStr;
      const startDate = camp.startDate || vnDateStr;
      const recurrence = camp.recurrence || (camp.scheduleType === 'daily' ? 'daily' : 'once');

      let shouldTrigger = false;

      if (timeMatches && notRunToday) {
        if (recurrence === 'once') {
          if (startDate === vnDateStr) {
            shouldTrigger = true;
          }
        } else if (recurrence === 'daily') {
          if (vnDateStr >= startDate) {
            shouldTrigger = true;
          }
        } else if (recurrence === 'weekly') {
          if (vnDateStr >= startDate) {
            const startD = new Date(startDate);
            const startDOW = startD.toLocaleDateString('en-US', { weekday: 'short' });
            if (startDOW === vnDayOfWeek) {
              shouldTrigger = true;
            }
          }
        } else if (recurrence === 'monthly') {
          if (vnDateStr >= startDate) {
            const startDOM = parseInt(startDate.split('-')[2], 10);
            if (startDOM === vnDayOfMonth) {
              shouldTrigger = true;
            }
          }
        }
      }

      if (shouldTrigger) {
        logger.info(`⏰ [Campaign Scheduler] Triggering ${recurrence} campaign [${camp.name}] at ${vnTimeStr}...`);
        localStore.updateCampaignStatus(camp.id, { lastRunAt: vnDateStr, status: 'running' });

        // If once, automatically turn off isEnabled so it doesn't repeat
        if (recurrence === 'once') {
          localStore.toggleCampaign(camp.id, false);
        }

        const targets = localStore.getCampaignTargets({
          targetType: camp.targetType,
          targetTagIds: camp.targetTagIds
        });

        if (targets.length > 0) {
          localStore.initCampaignQueue(camp.id, targets);
          localStore.updateCampaignStatus(camp.id, { totalCount: targets.length, sentCount: 0, failedCount: 0 });
          runningCampaigns.add(camp.id);
          setImmediate(() => runCampaignDispatcher(camp.id));
        }
      }
    }
  } catch (scheduleErr) {
    logger.warn(`[Campaign Scheduler Error] ${scheduleErr.message}`);
  }
}, 30000).unref();

export default router;
