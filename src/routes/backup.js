import express from 'express';
import multer from 'multer';
import { localStore } from '../utils/local-store.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Memory storage for JSON file uploads (Max 5MB)
const uploadJson = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
}).single('file');

// In-memory rate limiter for import abuse prevention (Max 5 imports per 10 minutes)
const importRateLimitMap = new Map();
function checkImportRateLimit(key) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxAttempts = 5;

  const history = importRateLimitMap.get(key) || [];
  const validHistory = history.filter(ts => now - ts < windowMs);

  if (validHistory.length >= maxAttempts) {
    return false;
  }

  validHistory.push(now);
  importRateLimitMap.set(key, validHistory);
  return true;
}

// -----------------------------------------------------------------------------
// GET /api/backup/export
// Export templates, tags, campaigns and prompts into standardized JSON
// -----------------------------------------------------------------------------
router.get('/backup/export', requireAuth, (req, res) => {
  try {
    const quickMessages = localStore.getQuickMessages() || [];
    const tags = localStore.getTags() || [];
    const campaigns = localStore.getCampaigns() || [];
    const aiSettings = localStore.getAiSettings() || {};

    // Export only non-sensitive prompts (NO API keys or secrets!)
    const aiPrompts = {
      soulPrompt: aiSettings.soulPrompt || '',
      memoryPrompt: aiSettings.memoryPrompt || '',
      fewShotPrompt: aiSettings.fewShotPrompt || '',
      scopePrompt: aiSettings.scopePrompt || '',
      exemplarConversation: aiSettings.exemplarConversation || ''
    };

    const payload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      source: 'zalo-flow',
      data: {
        quickMessages: quickMessages.map(q => ({
          id: q.id,
          shortcut: q.shortcut,
          title: q.title,
          customerQuestion: q.customerQuestion,
          content: q.content,
          mediaUrl: q.mediaUrl,
          mediaType: q.mediaType,
          mediaName: q.mediaName
        })),
        tags: tags.map(t => ({
          id: t.id,
          name: t.name,
          color: t.color,
          description: t.description
        })),
        campaigns: campaigns.map(c => ({
          id: c.id,
          name: c.name,
          description: c.description,
          message: c.message,
          mediaUrls: c.mediaUrls,
          targetType: c.targetType,
          targetTagIds: c.targetTagIds,
          targetKeyword: c.targetKeyword,
          scheduleType: c.scheduleType,
          scheduleTime: c.scheduleTime,
          scheduleMode: c.scheduleMode,
          startDate: c.startDate,
          recurrence: c.recurrence
        })),
        aiPrompts
      }
    };

    if (req.query.download === 'true') {
      const dateStr = new Date().toISOString().split('T')[0];
      res.setHeader('Content-Disposition', `attachment; filename="zaloflow-backup-${dateStr}.json"`);
      res.setHeader('Content-Type', 'application/json');
    }

    res.json({
      status: 'success',
      ...payload
    });
  } catch (err) {
    logger.error(`[Backup Export] Failed: ${err.message}`);
    res.status(500).json({ error: `Export failed: ${err.message}` });
  }
});

// -----------------------------------------------------------------------------
// POST /api/backup/import
// Idempotent merge of quick messages, tags and campaigns from JSON payload/file
// -----------------------------------------------------------------------------
router.post('/backup/import', requireAuth, (req, res) => {
  uploadJson(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Tệp JSON vượt quá dung lượng tối đa (Tối đa 5MB)' });
      }
      return res.status(400).json({ error: uploadErr.message });
    }

    try {
      const clientIp = req.ip || req.connection.remoteAddress || 'local';
      if (!checkImportRateLimit(clientIp)) {
        return res.status(429).json({ error: 'Quá giới hạn import. Vui lòng thử lại sau 10 phút.' });
      }

      let importData = null;

      if (req.file && req.file.buffer) {
        try {
          const raw = req.file.buffer.toString('utf8');
          importData = JSON.parse(raw);
        } catch (e) {
          return res.status(400).json({ error: 'Tệp tải lên không phải là định dạng JSON hợp lệ' });
        }
      } else if (req.body) {
        importData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      }

      if (!importData || typeof importData !== 'object') {
        return res.status(400).json({ error: 'Dữ liệu import không hợp lệ (Phải là JSON object)' });
      }

      const payload = importData.data || importData;
      const imported = { quickMessages: 0, tags: 0, campaigns: 0 };
      const skipped = { duplicates: 0, invalid: 0 };

      // 1. Import Tags
      if (Array.isArray(payload.tags)) {
        const existingTags = localStore.getTags() || [];
        const existingIds = new Set(existingTags.map(t => t.id));
        const existingNames = new Set(existingTags.map(t => (t.name || '').toLowerCase().trim()));

        for (const t of payload.tags) {
          if (!t || !t.name) {
            skipped.invalid++;
            continue;
          }
          const cleanName = String(t.name).trim().toLowerCase();
          if (existingIds.has(t.id) || existingNames.has(cleanName)) {
            skipped.duplicates++;
            continue;
          }

          localStore.upsertTag({
            id: t.id,
            name: t.name,
            color: t.color || '#38bdf8',
            description: t.description || ''
          });
          existingIds.add(t.id);
          existingNames.add(cleanName);
          imported.tags++;
        }
      }

      // 2. Import Quick Messages
      if (Array.isArray(payload.quickMessages)) {
        const existingQMs = localStore.getQuickMessages() || [];
        const existingIds = new Set(existingQMs.map(q => q.id));
        const existingShortcuts = new Set(existingQMs.map(q => (q.shortcut || '').toLowerCase().trim()));

        for (const q of payload.quickMessages) {
          if (!q || !q.content || (!q.shortcut && !q.title)) {
            skipped.invalid++;
            continue;
          }
          const cleanShortcut = (q.shortcut || '').startsWith('/') ? q.shortcut.toLowerCase().trim() : `/${(q.shortcut || '').toLowerCase().trim()}`;
          if (existingIds.has(q.id) || (q.shortcut && existingShortcuts.has(cleanShortcut))) {
            skipped.duplicates++;
            continue;
          }

          localStore.upsertQuickMessage({
            id: q.id,
            shortcut: q.shortcut || cleanShortcut,
            title: q.title || q.customerQuestion || cleanShortcut,
            customerQuestion: q.customerQuestion || '',
            content: q.content,
            mediaUrl: q.mediaUrl || '',
            mediaType: q.mediaType || '',
            mediaName: q.mediaName || ''
          });
          existingIds.add(q.id);
          if (q.shortcut) existingShortcuts.add(cleanShortcut);
          imported.quickMessages++;
        }
      }

      // 3. Import Campaigns
      if (Array.isArray(payload.campaigns)) {
        const existingCamps = localStore.getCampaigns() || [];
        const existingIds = new Set(existingCamps.map(c => c.id));
        const existingNames = new Set(existingCamps.map(c => (c.name || '').toLowerCase().trim()));

        for (const c of payload.campaigns) {
          if (!c || !c.name || !c.message) {
            skipped.invalid++;
            continue;
          }
          const cleanName = String(c.name).trim().toLowerCase();
          if (existingIds.has(c.id) || existingNames.has(cleanName)) {
            skipped.duplicates++;
            continue;
          }

          localStore.createCampaign({
            id: c.id,
            name: c.name,
            description: c.description || '',
            message: c.message,
            mediaUrls: c.mediaUrls || [],
            targetType: c.targetType || 'all',
            targetTagIds: c.targetTagIds || [],
            targetKeyword: c.targetKeyword || '',
            scheduleType: c.scheduleType || 'manual',
            scheduleTime: c.scheduleTime || '08:30',
            scheduleMode: c.scheduleMode || 'scheduled',
            startDate: c.startDate || '',
            recurrence: c.recurrence || 'once'
          });
          existingIds.add(c.id);
          existingNames.add(cleanName);
          imported.campaigns++;
        }
      }

      logger.info(`[Backup Import] Success: Imported ${JSON.stringify(imported)}, Skipped ${JSON.stringify(skipped)}`);

      res.json({
        success: true,
        imported,
        skipped
      });
    } catch (err) {
      logger.error(`[Backup Import] Failed: ${err.message}`);
      res.status(500).json({ error: `Import failed: ${err.message}` });
    }
  });
});

export default router;
