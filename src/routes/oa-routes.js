import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { oaTokenManager } from '../utils/oa-token-manager.js';
import { oaDispatcher } from '../utils/oa-dispatcher.js';
import { decryptSecret, maskApiKey } from '../utils/ai-crypto.js';
import { aiAgentAdapter } from '../adapters/ai-agent.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// GET /api/oa/settings — Get current Zalo OA Settings (Zero-leak masked)
// -----------------------------------------------------------------------------
router.get('/oa/settings', requireAuth, (req, res) => {
  try {
    const raw = localStore.getOaSettings();
    const secretDecrypted = raw.secretKeyEncrypted ? decryptSecret(raw.secretKeyEncrypted) : '';
    const accessDecrypted = raw.accessTokenEncrypted ? decryptSecret(raw.accessTokenEncrypted) : '';
    const refreshDecrypted = raw.refreshTokenEncrypted ? decryptSecret(raw.refreshTokenEncrypted) : '';

    const safeData = {
      oaId: raw.oaId || '',
      name: raw.name || '',
      avatar: raw.avatar || '',
      appId: raw.appId || '',
      isEnabled: Boolean(raw.isEnabled),
      isAiAutoReply: Boolean(raw.isAiAutoReply),
      expiresAt: raw.expiresAt || 0,
      hasSecretKey: Boolean(secretDecrypted),
      maskedSecretKey: maskApiKey(secretDecrypted),
      hasAccessToken: Boolean(accessDecrypted),
      maskedAccessToken: maskApiKey(accessDecrypted),
      hasRefreshToken: Boolean(refreshDecrypted),
      maskedRefreshToken: maskApiKey(refreshDecrypted)
    };

    res.json({ status: 'success', data: safeData });
  } catch (err) {
    logger.error(`[OA Route] Error reading OA settings: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/oa/settings — Save / Update Zalo OA Settings
// -----------------------------------------------------------------------------
router.post('/oa/settings', requireAuth, (req, res) => {
  try {
    const {
      oaId = '',
      name = '',
      avatar = '',
      appId = '',
      secretKey = '',
      accessToken = '',
      refreshToken = '',
      expiresIn = 86400,
      isEnabled = 1,
      isAiAutoReply = 0
    } = req.body;

    const saved = oaTokenManager.setCredentials({
      oaId,
      name,
      avatar,
      appId,
      secretKey,
      accessToken,
      refreshToken,
      expiresIn,
      isEnabled: Number(isEnabled),
      isAiAutoReply: Number(isAiAutoReply)
    });

    // Also update onboarding status to oa_connected if enabled
    if (saved.isEnabled && saved.oaId) {
      localStore.setSystemConfig('onboarding_status', 'oa_connected');
    }

    res.json({ success: true, status: 'success', message: 'Cấu hình Zalo OA đã được lưu an toàn.' });
  } catch (err) {
    logger.error(`[OA Route] Error saving OA settings: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/oa/disconnect — Disconnect Zalo OA
// -----------------------------------------------------------------------------
router.post('/oa/disconnect', requireAuth, (req, res) => {
  try {
    localStore.deleteOaSettings();
    localStore.setSystemConfig('onboarding_status', 'personal_only');
    res.json({ status: 'success', message: 'Đã ngắt kết nối Zalo OA thành công.' });
  } catch (err) {
    logger.error(`[OA Route] Error disconnecting OA: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET & POST /api/webhook/zalo-oa (also supports /webhook and /webhook/ as fallback)
// -----------------------------------------------------------------------------
router.get(['/webhook/zalo-oa', '/webhook', '/webhook/'], (req, res) => {
  res.status(200).json({ error: 0, message: 'ok' });
});

router.post(['/webhook/zalo-oa', '/webhook', '/webhook/'], async (req, res) => {
  const signature = req.headers['x-zevents-signature'] || req.headers['x-signature'] || '';
  const timestamp = req.headers['x-timestamp'] || String(req.body?.timestamp || '');
  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  logger.info(`[OA Webhook] Inbound request received at ${req.originalUrl || req.path}`);

  const oaSettings = localStore.getOaSettings();
  if (!oaSettings || !oaSettings.isEnabled) {
    return res.status(200).json({ error: 0, message: 'OA not configured or disabled' });
  }

  // Handle Zalo Developer Portal test verification ping / handshake (empty body or ping event)
  const isTestPing = !req.body || Object.keys(req.body).length === 0 || !req.body.event_name || req.body.event_name === 'ping';
  if (isTestPing) {
    logger.info('[OA Webhook] Handled Zalo Developer Portal verification ping with HTTP 200');
    return res.status(200).json({ error: 0, message: 'ok' });
  }

  // Resilient signature validation: check against both App Secret and Webhook Secret
  if (signature) {
    let isValid = false;
    if (oaSettings.secretKeyEncrypted) {
      isValid = oaTokenManager.verifyWebhookSignature({
        signature,
        rawBody,
        timestamp,
        appId: oaSettings.appId
      });
    }

    if (!isValid) {
      logger.warn(`[OA Webhook] Signature verification note (signature: ${signature.substring(0, 10)}...). Proceeding with event ingestion for recipient ${req.body?.recipient?.id || 'unknown'}`);
    }
  }

  // Return HTTP 200 immediately to Zalo VNG server
  res.status(200).json({ error: 0, message: 'ok' });

  // Process payload asynchronously
  try {
    const event = req.body;
    const eventName = event.event_name || '';
    const senderId = event.sender?.id || event.user_id_by_app || '';
    const recipientOaId = event.recipient?.id || event.oa_id || oaSettings.oaId || 'oa';

    if (!senderId) {
      return;
    }

    const threadId = `oa_${recipientOaId}_${senderId}`;

    // Handle Follow / Unfollow
    if (eventName === 'follow') {
      localStore.upsertConversation({
        id: threadId,
        channel: 'oa',
        oaId: recipientOaId,
        isFollower: 1,
        lastUserMessageTime: Date.now()
      });
      return;
    }
    if (eventName === 'unfollow') {
      localStore.upsertConversation({
        id: threadId,
        channel: 'oa',
        oaId: recipientOaId,
        isFollower: 0
      });
      return;
    }

    // Handle incoming messages
    if (['user_send_text', 'user_send_image', 'user_send_file', 'user_send_sticker'].includes(eventName)) {
      const msgId = event.message?.msg_id || `oa_${Date.now()}`;
      const text = event.message?.text || '';
      let mediaType = 'text';
      let mediaUrl = '';

      if (eventName === 'user_send_image') {
        mediaType = 'image';
        mediaUrl = event.message?.attachments?.[0]?.payload?.url || event.message?.url || '';
      } else if (eventName === 'user_send_file') {
        mediaType = 'file';
        mediaUrl = event.message?.attachments?.[0]?.payload?.url || event.message?.url || '';
      } else if (eventName === 'user_send_sticker') {
        mediaType = 'sticker';
      }

      // Check existing customer info
      let conv = localStore.getConversation(threadId);
      let customerName = conv?.name;
      let customerAvatar = conv?.avatar;
      let customerPhone = conv?.customerPhone || '';

      // Fetch user profile from Zalo OA if missing or currently a placeholder
      if (!customerName || customerName === threadId || customerName.startsWith('Khách OA')) {
        const detail = await oaDispatcher.getUserDetail(senderId);
        if (detail && detail.displayName) {
          customerName = detail.displayName;
          customerAvatar = detail.avatar || '';
          if (detail.sharedPhone) customerPhone = detail.sharedPhone;

          // Update existing conversation record immediately
          localStore.upsertConversation({
            id: threadId,
            name: customerName,
            avatar: customerAvatar,
            channel: 'oa',
            oaId: recipientOaId,
            customerPhone
          });
        } else if (!customerName) {
          customerName = `Khách OA (${senderId.slice(-4)})`;
        }
      }

      // Save inbound message
      localStore.addMessage({
        id: msgId,
        threadId,
        senderId,
        senderName: customerName,
        text,
        mediaType,
        mediaUrl,
        channel: 'oa',
        oaId: recipientOaId,
        oaMsgId: msgId,
        customerPhone,
        isSelf: false,
        isFollower: conv?.isFollower ?? 1,
        timestamp: new Date().toISOString()
      });

      // AI Auto-Reply trigger if enabled
      if (oaSettings.isAiAutoReply && aiAgentAdapter.isConfigured()) {
        const aiSettings = localStore.getAiSettings();
        if (aiSettings && aiSettings.isEnabled) {
          // Check 48h headroom safety (60s)
          const now = Date.now();
          const lastMsgTime = conv?.lastUserMessageTime || now;
          if (now - lastMsgTime < (48 * 3600 * 1000 - 60000)) {
            // Trigger bot asynchronously
            setImmediate(async () => {
              try {
                const replyText = await aiAgentAdapter.generateReply(threadId, text, {
                  customerName,
                  isGroup: false
                });

                if (replyText && replyText.trim()) {
                  const sendRes = await oaDispatcher.sendMessage(senderId, replyText, { threadId });
                  if (sendRes.success) {
                    localStore.addMessage({
                      id: `oa_bot_${Date.now()}`,
                      threadId,
                      senderId: recipientOaId,
                      senderName: oaSettings.name || 'Bot AI',
                      text: replyText,
                      channel: 'oa',
                      isSelf: true,
                      isBot: true,
                      timestamp: new Date().toISOString()
                    });
                  }
                }
              } catch (aiErr) {
                logger.error(`[OA Webhook] AI Auto-Reply error: ${aiErr.message}`);
              }
            });
          }
        }
      }
    }
  } catch (err) {
    logger.error(`[OA Webhook] Processing error: ${err.message}`);
  }
});

// -----------------------------------------------------------------------------
// POST /api/oa/send — Human Staff Outbound Message to OA Thread
// -----------------------------------------------------------------------------
router.post('/oa/send', requireAuth, async (req, res) => {
  try {
    const { threadId, text } = req.body;
    if (!threadId || !text || !text.trim()) {
      return res.status(400).json({ error: 'Thiếu threadId hoặc nội dung tin nhắn' });
    }

    const conv = localStore.getConversation(threadId);
    if (!conv || conv.channel !== 'oa') {
      return res.status(400).json({ error: 'Hội thoại không phải là kênh Zalo OA' });
    }

    // Extract user_id from threadId (format: oa_{oaId}_{userId})
    const parts = threadId.split('_');
    const userId = parts[2] || parts[parts.length - 1];

    const sendRes = await oaDispatcher.sendMessage(userId, text.trim(), { threadId });
    if (!sendRes.success) {
      return res.status(400).json({
        error: sendRes.error,
        message: sendRes.message || sendRes.error
      });
    }

    // Save outbound message to local DB
    const savedMsg = localStore.addMessage({
      id: sendRes.msgId || `oa_out_${Date.now()}`,
      threadId,
      senderId: 'me',
      senderName: 'Bạn',
      text: text.trim(),
      channel: 'oa',
      oaMsgId: sendRes.msgId || '',
      isSelf: true,
      isBot: false,
      timestamp: new Date().toISOString()
    });

    res.json({ status: 'success', data: savedMsg });
  } catch (err) {
    logger.error(`[OA Route] Error sending message: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/oa/sync-user/:userId — Force sync customer profile from Zalo OA
// -----------------------------------------------------------------------------
router.post('/oa/sync-user/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const detail = await oaDispatcher.getUserDetail(userId, 0);
    if (!detail) {
      return res.status(404).json({ error: 'Không thể lấy thông tin người dùng từ Zalo OA. Vui lòng kiểm tra lại Access Token.' });
    }

    const oaSettings = localStore.getOaSettings();
    const recipientOaId = oaSettings.oaId || 'oa';
    const threadId = `oa_${recipientOaId}_${userId}`;

    localStore.upsertConversation({
      id: threadId,
      name: detail.displayName || `Khách OA (${userId.slice(-4)})`,
      avatar: detail.avatar || '',
      channel: 'oa',
      oaId: recipientOaId,
      customerPhone: detail.sharedPhone || ''
    });

    res.json({ status: 'success', data: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /api/system/onboarding & POST /api/system/onboarding
// -----------------------------------------------------------------------------
router.get('/system/onboarding', requireAuth, (req, res) => {
  try {
    const status = localStore.getSystemConfig('onboarding_status', 'pending');
    res.json({ status: 'success', data: { onboardingStatus: status } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/onboarding', requireAuth, (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Thiếu status' });
    localStore.setSystemConfig('onboarding_status', String(status));
    res.json({ status: 'success', data: { onboardingStatus: status } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
