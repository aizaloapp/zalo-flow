import './dns-bootstrap.js';
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';
import fs from 'fs';
import { zaloClient } from './zalo-client.js';
import { accountManager } from './utils/account-manager.js';
import { localStore } from './utils/local-store.js';
import { requireAuth, csrfShield } from './middleware/auth.js';
import { defaultRateLimiter } from './utils/rate-limiter.js';

// Import Route Modules
import tagRoutes from './routes/tags.js';
import quickMsgRoutes from './routes/quick-messages.js';
import campaignRoutes from './routes/campaigns.js';
import chatActionRoutes from './routes/chat-actions.js';
import aiSettingsRoutes from './routes/ai-settings.js';
import aiVaultRoutes from './routes/ai-vault.js';
import backupRoutes from './routes/backup.js';
import { updaterRouter } from './routes/updater.js';
import scheduledMsgRoutes from './routes/scheduled-messages.js';
import oaRoutes from './routes/oa-routes.js';
import { scheduledDispatcher } from './utils/scheduled-dispatcher.js';
import { oaTokenManager } from './utils/oa-token-manager.js';

// Import Adapters & Utilities
import { chatwootInboundAdapter } from './adapters/chatwoot-inbound.js';
import { chatwootOutboundAdapter } from './adapters/chatwoot-outbound.js';
import { aiAgentAdapter } from './adapters/ai-agent.js';
import { genericWebhookAdapter } from './adapters/generic-webhook.js';
import { memoryGuard } from './utils/memory-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global Error Catchers (Anti-Crash Perimeter)
process.on('uncaughtException', (err) => {
  logger.error(`⚠️ [UncaughtException] ${err?.stack || err?.message || err}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`⚠️ [UnhandledRejection] ${reason?.stack || reason?.message || reason}`);
});

const app = express();
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf ? buf.toString('utf8') : '';
  }
}));
app.use(express.urlencoded({ extended: true }));

// Serve static assets from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Lightweight CORS for Chrome Extension & Localhost Clients
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (origin.startsWith('chrome-extension://') || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ZaloFlow-Client, X-Admin-Token, Authorization');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// CSRF Shield for state-changing endpoints (/api/*)
app.use('/api', csrfShield);

const isPackaged = process.env.ZALOFLOW_PACKAGED === '1';
const isDocker = fs.existsSync('/.dockerenv') || process.env.IS_DOCKER === '1';
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const HOST = isPackaged 
  ? '127.0.0.1' 
  : (process.env.HOST || (isDocker ? '0.0.0.0' : '127.0.0.1'));
const startTime = Date.now();

if (HOST === '0.0.0.0' && !process.env.ADMIN_API_TOKEN && !isDocker) {
  logger.warn('⚠️ [SECURITY WARNING] Server is binding to 0.0.0.0 (public LAN) without ADMIN_API_TOKEN! Anyone on your Wi-Fi network can access your Zalo session. Set ADMIN_API_TOKEN in .env to protect your data.');
}

// Register Inbound Listeners on Zalo Client & Account Manager Pool
const handleInboundMessage = async (ctx) => {
  // 1. Sync to Chatwoot if configured
  await chatwootInboundAdapter.handleInbound(ctx);

  // 2. Forward to Generic Webhook (n8n, Dify, Flowise, Make) if configured
  await genericWebhookAdapter.handleInbound(ctx);

  // 3. AI Auto-Reply Engine
  await aiAgentAdapter.handleInbound(ctx);

  // 4. Inbound Reply Guard for Scheduled Messages
  if (!ctx.isSelf && ctx.threadId) {
    localStore.pauseScheduledMessageByReply(ctx.threadId);
  }
};
zaloClient.onMessage(handleInboundMessage);
accountManager.onMessage(handleInboundMessage);

// -----------------------------------------------------------------------------
// Realtime Stream Engine (WebSocket Primary + SSE Fallback)
// -----------------------------------------------------------------------------
const wsClients = new Set();
const sseClients = new Set();
let sseEventId = 0;

app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  res.write(': connected\n\n');

  // Single Source of Truth: Send active startup sync state immediately if present
  if (zaloClient && zaloClient.startupSyncState && zaloClient.startupSyncState.stage !== 'idle') {
    sseEventId++;
    res.write(`id: ${sseEventId}\nevent: startup_sync_status\ndata: ${JSON.stringify(zaloClient.startupSyncState)}\n\n`);
  }

  // Heartbeat ping every 15 seconds
  const heartbeat = setInterval(() => {
    res.write(':ping\n\n');
  }, 15000);

  sseClients.add(res);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

export function broadcastSSE(eventType, data, accountUid = null) {
  const resolvedAccountUid = accountUid || (typeof data === 'object' && data?.accountUid) || accountManager.activeAccountUid || '';

  // 1. Broadcast to active WebSocket clients
  const wsPayload = JSON.stringify({ event: eventType, accountUid: resolvedAccountUid, data });
  for (const client of wsClients) {
    if (client.readyState === 1 /* OPEN */) {
      try {
        client.send(wsPayload);
      } catch {
        wsClients.delete(client);
      }
    }
  }

  // 2. Broadcast to SSE clients (fallback)
  sseEventId++;
  const sseData = (typeof data === 'object' && data !== null && !Array.isArray(data))
    ? { accountUid: resolvedAccountUid, ...data }
    : { accountUid: resolvedAccountUid, payload: data };
  const payload = `id: ${sseEventId}\nevent: ${eventType}\ndata: ${JSON.stringify(sseData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Forward localStore messages and reactions to SSE clients
localStore.onNewMessage((msg) => {
  broadcastSSE('new_message', msg, msg.accountUid);
});

localStore.on('messageReaction', (data) => {
  broadcastSSE('message_reaction', data);
});

localStore.on('messagesDelivered', (data) => {
  broadcastSSE('messages_delivered', data);
});

localStore.on('conversationUpdated', (conv) => {
  broadcastSSE('conversation_updated', conv, conv?.accountUid);
});

// Forward Account Manager pool events to SSE clients
accountManager.on('pool_updated', (profiles) => {
  broadcastSSE('accounts_updated', profiles);
});
accountManager.on('account_added', (data) => {
  broadcastSSE('account_added', data);
});
accountManager.on('account_removed', (data) => {
  broadcastSSE('account_removed', data);
});
accountManager.on('active_account_switched', (data) => {
  broadcastSSE('active_account_switched', data);
});

// Đồng bộ real-time trạng thái đăng nhập của singleton zaloClient vào accountManager pool
zaloClient.on('login_success', (profile) => {
  const uid = profile?.userId || zaloClient.accountUid;
  if (uid) {
    accountManager.clients.set(String(uid), zaloClient);
    if (!accountManager.activeAccountUid) {
      accountManager.activeAccountUid = String(uid);
    }
  }
  broadcastSSE('accounts_updated', accountManager.getAllProfiles());
});

localStore.on('messageRecalled', (data) => {
  broadcastSSE('message_recalled', data);
});

localStore.on('scheduledMessageUpdated', (data) => {
  broadcastSSE('scheduled_msg_updated', data);
});

// Forward Zalo startup synchronization lifecycle events
zaloClient.onStartupSync((syncState) => {
  broadcastSSE('startup_sync_status', syncState);
});

// -----------------------------------------------------------------------------
// Mount Modular REST Route Handlers
// -----------------------------------------------------------------------------
app.use('/api', tagRoutes);
app.use('/api', quickMsgRoutes);
app.use('/api', campaignRoutes);
app.use('/api', chatActionRoutes);
app.use('/api', scheduledMsgRoutes);
app.use('/api', aiSettingsRoutes);
app.use('/api', aiVaultRoutes);
app.use('/api', backupRoutes);
app.use('/api', updaterRouter);
app.use('/api', oaRoutes);

// Start OA Token auto-refresh watchdog
oaTokenManager.startWatchdog();

// -----------------------------------------------------------------------------
// Multi-Account Management REST APIs
// -----------------------------------------------------------------------------

// GET /api/accounts (Get all accounts and live statuses)
app.get('/api/accounts', requireAuth, (req, res) => {
  res.json({
    status: 'success',
    data: accountManager.getAllProfiles()
  });
});

// POST /api/accounts/add-qr (Generate non-disruptive QR flow for new account)
app.post('/api/accounts/add-qr', requireAuth, async (req, res) => {
  try {
    const flow = await accountManager.startAddAccountFlow((update) => {
      broadcastSSE('account_add_qr', update);
    });
    res.json({ success: true, data: flow });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/accounts/switch-active (Switch active interacting account)
app.post('/api/accounts/switch-active', requireAuth, (req, res) => {
  const { accountUid } = req.body;
  if (!accountUid) return res.status(400).json({ error: 'accountUid là bắt buộc.' });
  accountManager.setActiveAccount(accountUid);
  res.json({ success: true, activeAccountUid: accountManager.activeAccountUid });
});

// POST /api/accounts/:uid/delete (Logout & remove a specific account)
app.post('/api/accounts/:uid/delete', requireAuth, async (req, res) => {
  const { uid } = req.params;
  const cleanData = Boolean(req.body?.cleanData);
  try {
    const result = await accountManager.removeAccount(uid, { cleanData });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/:uid/set-default (Set default account)
app.post('/api/accounts/:uid/set-default', requireAuth, (req, res) => {
  const { uid } = req.params;
  try {
    localStore.setDefaultAccount(uid);
    broadcastSSE('accounts_updated', accountManager.getAllProfiles());
    res.json({ success: true });
  } catch (err) {
    logger.error(`Failed to set default account: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Core Conversation & Sync REST APIs
// -----------------------------------------------------------------------------

// GET /api/conversations
app.get('/api/conversations', requireAuth, (req, res) => {
  const { accountUid = '', search = '', filter = 'all', status = 'all', tagId = '', limit = 50, offset = 0 } = req.query;
  const conversations = localStore.getConversations({ accountUid, search, filter, status, tagId, limit, offset });
  res.json({
    status: 'success',
    data: conversations
  });
});

// GET /api/conversations/:threadId/messages
app.get('/api/conversations/:threadId/messages', requireAuth, (req, res) => {
  const { threadId } = req.params;
  const { limit = 50, before = null, accountUid = null } = req.query;
  const messages = localStore.getMessages(threadId, {
    limit: Math.min(Number(limit), 100),
    before,
    accountUid
  });
  res.json({
    status: 'success',
    data: messages
  });
});

// POST /api/conversations/:threadId/read
app.post('/api/conversations/:threadId/read', requireAuth, (req, res) => {
  const { threadId } = req.params;
  const { accountUid = null } = req.body || {};
  localStore.markAsRead(threadId, accountUid);
  res.json({ success: true });
});

// POST /api/sync-contacts (Manual contact sync trigger)
app.post('/api/sync-contacts', requireAuth, async (req, res) => {
  const { accountUid = null } = req.body || {};
  const client = accountManager.getClient(accountUid) || zaloClient;
  try {
    await client.syncInitialContacts();
    res.json({ success: true, message: 'Contacts synced successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations/:threadId/sync (On-Demand Deep Sync with Cooldown & Concurrency Guard)
const syncState = new Map();

app.post('/api/conversations/:threadId/sync', requireAuth, async (req, res) => {
  const { threadId } = req.params;
  const isGroup = req.query.isGroup === 'true' || req.body?.isGroup === true;
  const { accountUid = null } = req.body || {};
  const client = accountManager.getClient(accountUid) || zaloClient;

  if (!client || !client.isLoggedIn) {
    return res.status(503).json({ error: 'Zalo client is offline. Please login first.' });
  }

  // 1. Cooldown Guard
  const lastSync = syncState.get(threadId);
  if (typeof lastSync === 'number' && Date.now() - lastSync < 5 * 60 * 1000) {
    return res.json({ success: true, cached: true, message: 'Recently synced. Please wait 5 minutes.' });
  }

  // 2. Concurrency Guard
  if (lastSync === 'syncing') {
    return res.json({ success: true, pending: true, message: 'Sync in progress, please wait...' });
  }

  syncState.set(threadId, 'syncing');

  try {
    const count = await client.fetchThreadHistory(threadId, isGroup, 50);
    syncState.set(threadId, Date.now());
    res.json({ success: true, synced: count });
  } catch (err) {
    syncState.delete(threadId);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/send-message (Send message from Web UI / Admin API)
app.post('/api/send-message', requireAuth, async (req, res) => {
  const { recipientId, message, isGroup = false, isBot = false, accountUid = null } = req.body;
  if (!recipientId || !message) {
    return res.status(400).json({ error: 'recipientId và message là bắt buộc.' });
  }

  const client = accountManager.getClient(accountUid) || zaloClient;
  if (!client || !client.isLoggedIn) {
    return res.status(503).json({ error: 'Zalo chưa đăng nhập hoặc đang offline. Vui lòng quét mã QR trước.' });
  }

  try {
    const result = await client.sendMessage(recipientId, message, Boolean(isGroup), {
      isBot: Boolean(isBot),
      senderName: isBot ? 'Bot AI (Tự động)' : 'Admin (Bạn)'
    });
    res.json({ status: 'success', result });
  } catch (err) {
    logger.error(`Failed to send message to ${recipientId}: ${err.message}`);
    let friendlyError = err.message;
    if (err.message && (err.message.includes('Tham số không hợp lệ') || err.message.includes('112') || err.message.includes('10001'))) {
      friendlyError = 'Không thể gửi tin: Tài khoản Zalo hiện tại chưa kết bạn với người này hoặc người nhận chặn tin nhắn từ người lạ. Vui lòng kết bạn trên điện thoại trước.';
    }
    res.status(500).json({ error: friendlyError });
  }
});

// POST /api/sync-all-history (1-Click Bulk Deep-Sync All Conversations & History)
app.post('/api/sync-all-history', requireAuth, async (req, res) => {
  const { accountUid = null } = req.body || {};
  const client = accountManager.getClient(accountUid) || zaloClient;
  if (!client || !client.isLoggedIn) {
    return res.status(503).json({ error: 'Zalo chưa đăng nhập hoặc đang offline. Vui lòng quét mã QR trước.' });
  }

  const { limitThreads = 30, limitPerThread = 50 } = req.body || {};

  try {
    const result = await client.syncAllHistory({
      limitThreads: Number(limitThreads) || 30,
      limitPerThread: Number(limitPerThread) || 50,
      onProgress: (progress) => {
        broadcastSSE('sync_progress', progress, client.accountUid);
      }
    });

    broadcastSSE('sync_complete', result, client.accountUid);
    res.json({ success: true, result });
  } catch (err) {
    logger.error(`[Bulk Deep-Sync API] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Zalo Account Profile & Web QR Authentication APIs
// -----------------------------------------------------------------------------

// GET /api/zalo/profile
app.get('/api/zalo/profile', requireAuth, (req, res) => {
  const client = accountManager.getClient(req.query.accountUid) || zaloClient;
  res.json({
    status: 'success',
    data: client.getAccountProfile()
  });
});

// POST /api/zalo/qr/generate
app.post('/api/zalo/qr/generate', requireAuth, async (req, res) => {
  const cleanData = Boolean(req.body?.cleanData);
  const client = accountManager.getClient(req.body?.accountUid) || zaloClient;
  try {
    const profile = await client.requestNewQrLogin((updatedProfile) => {
      broadcastSSE('zalo_profile', updatedProfile, client.accountUid);
      if (updatedProfile.qrDataUrl) {
        broadcastSSE('zalo_qr', {
          qrDataUrl: updatedProfile.qrDataUrl,
          statusText: updatedProfile.qrStatusText,
          scannedUser: updatedProfile.scannedUser
        }, client.accountUid);
      }
      if (updatedProfile.isLoggedIn) {
        const uid = updatedProfile.userId || client.accountUid;
        if (uid) {
          accountManager.clients.set(String(uid), client);
          if (!accountManager.activeAccountUid) {
            accountManager.activeAccountUid = String(uid);
          }
        }
        broadcastSSE('accounts_updated', accountManager.getAllProfiles());
      }
    }, { cleanData });
    if (profile.isLoggedIn) {
      const uid = profile.userId || client.accountUid;
      if (uid) {
        accountManager.clients.set(String(uid), client);
        if (!accountManager.activeAccountUid) {
          accountManager.activeAccountUid = String(uid);
        }
      }
      broadcastSSE('accounts_updated', accountManager.getAllProfiles());
    }
    broadcastSSE('zalo_profile', profile, client.accountUid);
    res.json({ success: true, data: profile });
  } catch (err) {
    logger.error(`[QR Generate API] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/zalo/logout
app.post('/api/zalo/logout', requireAuth, async (req, res) => {
  const { accountUid = null, cleanData = false } = req.body || {};
  const targetUid = (accountUid && accountUid !== 'all')
    ? String(accountUid)
    : (accountManager.activeAccountUid || (zaloClient.isLoggedIn ? (zaloClient.accountUid || zaloClient.userProfile?.userId) : null));

  const emptyProfile = {
    isLoggedIn: false,
    userId: '',
    displayName: 'Chưa Đăng Nhập',
    avatar: '',
    hasQrWaiting: false,
    qrDataUrl: null,
    qrStatusText: ''
  };

  try {
    if (targetUid) {
      await accountManager.removeAccount(targetUid, { cleanData: Boolean(cleanData) });
    } else {
      const client = accountManager.getClient() || zaloClient;
      await client.logout({ cleanData: Boolean(cleanData) });
    }

    const nextClient = accountManager.getClient();
    const nextProfile = nextClient && nextClient.isLoggedIn ? nextClient.getAccountProfile() : emptyProfile;

    broadcastSSE('zalo_profile', nextProfile, nextClient?.accountUid || '');
    broadcastSSE('accounts_updated', accountManager.getAllProfiles());
    res.json({ success: true, data: nextProfile, pool: accountManager.getAllProfiles() });
  } catch (err) {
    logger.error(`[Zalo Logout API] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// Webhook & Adapter Outbound Routes
// -----------------------------------------------------------------------------

// Health Check JSON
app.get('/health', (req, res) => {
  const status = zaloClient.getStatus();
  const profile = zaloClient.getAccountProfile();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  
  res.json({
    status: status.isLoggedIn ? 'healthy' : (status.hasQrWaiting ? 'awaiting_qr_scan' : 'connecting'),
    zalo: status.isLoggedIn ? 'online' : 'offline',
    profile,
    uptime: `${Math.floor(uptimeSeconds / 60)}m ${uptimeSeconds % 60}s`,
    version: '1.0.0',
    memory: memoryGuard.getStats(),
    adapters: {
      chatwoot: chatwootInboundAdapter ? Boolean(process.env.CHATWOOT_API_URL) : false,
      genericWebhook: genericWebhookAdapter.isConfigured(),
      aiAgent: aiAgentAdapter.isConfigured()
    }
  });
});

// Webhook: Chatwoot Outbound Agent Message -> Send to Zalo
app.post('/api/webhook/chatwoot', (req, res) => {
  chatwootOutboundAdapter.handleOutbound(req, res, zaloClient);
});

// Webhook: Generic Outbound (n8n / Dify / Flowise / Make) -> Send to Zalo
app.post('/api/webhook/generic', (req, res) => {
  genericWebhookAdapter.handleOutbound(req, res, zaloClient);
});

// -----------------------------------------------------------------------------
// Main Web Route: Single Page Dashboard
// -----------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// -----------------------------------------------------------------------------
// System Lifecycle & Shutdown API (Localhost only)
// -----------------------------------------------------------------------------
app.post('/api/system/shutdown', async (req, res) => {
  const clientIp = req.ip || req.connection?.remoteAddress || '';
  const isLocal = clientIp.includes('127.0.0.1') || clientIp === '::1' || clientIp.includes('localhost');
  if (!isLocal) {
    return res.status(403).json({ error: 'Chỉ cho phép yêu cầu tắt ứng dụng từ localhost.' });
  }

  res.json({ success: true, message: 'Đang tắt Zalo-Flow an toàn...' });

  logger.info('🛑 [System] Shutdown requested via /api/system/shutdown. Draining outbound queues...');
  try {
    await defaultRateLimiter.drainAll(3000);
  } catch (err) {
    logger.warn(`[System] Notice during queue drain: ${err.message}`);
  }

  try {
    if (typeof localStore?.close === 'function') {
      localStore.close();
      logger.info('✅ [System] SQLite WAL checkpointed and closed successfully.');
    }
  } catch (dbErr) {
    logger.warn(`[System] Warning during DB close: ${dbErr.message}`);
  }

  setTimeout(() => {
    logger.info('👋 [System] Server exited cleanly.');
    process.exit(0);
  }, 500);
});

// Helper to probe if an existing instance is already Zalo-Flow
function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1500 }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(Boolean(data && (data.status || data.zalo)));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Start Server with resilient port fallback & single-instance detection
function startServer(port, host, attempt = 0, maxAttempts = 5) {
  const server = http.createServer(app);

  // Initialize WebSocket Server attached to HTTP server on /ws path
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
    try {
      ws.send(JSON.stringify({ event: 'connected', data: { timestamp: Date.now() } }));
      // Single Source of Truth: Send active startup sync state immediately upon connection
      if (zaloClient && zaloClient.startupSyncState && zaloClient.startupSyncState.stage !== 'idle') {
        ws.send(JSON.stringify({ event: 'startup_sync_status', data: zaloClient.startupSyncState }));
      }
    } catch {}
  });

  server.on('error', async (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`[Port Manager] Cổng ${port} hiện đang có ứng dụng khác hoặc phiên bản Zalo-Flow cũ sử dụng.`);

      if (isPackaged) {
        // Probe if it's already Zalo-Flow running
        const isZaloFlow = await probeHealth(port);
        if (isZaloFlow) {
          logger.info(`✨ [Single-Instance] Phát hiện Zalo-Flow đang chạy sẵn trên cổng ${port}. Đang mở lại tab trình duyệt và thoát tiến trình thứ hai...`);
          try {
            const opener = spawn('explorer', [`http://127.0.0.1:${port}`], { detached: true, stdio: 'ignore' });
            opener.unref();
          } catch {}
          process.exit(0);
        }
      }

      if (attempt < maxAttempts) {
        const nextPort = port + 1;
        logger.info(`[Port Manager] Đang thử kết nối với cổng kế tiếp: ${nextPort}...`);
        startServer(nextPort, host, attempt + 1, maxAttempts);
      } else {
        logger.error(`[Port Manager] Không thể tìm thấy cổng trống sau ${maxAttempts} lần thử. Vui lòng tắt bớt các ứng dụng đang chiếm cổng.`);
        process.exit(1);
      }
    } else {
      logger.error(`[Server Error] ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(port, host, () => {
    logger.info(`🚀 Zalo-Flow Server is running on http://${host}:${port}`);
    logger.info(`📊 Health check available at: http://${host}:${port}/health`);
    accountManager.initializeAllAccounts();
    memoryGuard.startMonitoring({
      server,
      sseBroadcast: (event, data) => broadcastSSE(event, data)
    });
    scheduledDispatcher.start();

    // In Packaged Desktop Mode: Auto-open system default browser
    if (isPackaged) {
      logger.info(`🖥️ [Desktop Mode] Tự động mở trình duyệt mặc định tại: http://127.0.0.1:${port}...`);
      try {
        const opener = spawn('explorer', [`http://127.0.0.1:${port}`], { detached: true, stdio: 'ignore' });
        opener.unref();
      } catch (openErr) {
        logger.warn(`Could not auto-open browser: ${openErr.message}`);
      }
    }
  });

  // Process signal graceful termination
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM signal. Executing graceful shutdown...');
    try {
      scheduledDispatcher.stop();
      await accountManager.destroyAll();
      server.close();
      localStore.close();
    } catch {}
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT (Ctrl+C). Executing graceful shutdown...');
    try {
      scheduledDispatcher.stop();
      await accountManager.destroyAll();
      server.close();
      localStore.close();
    } catch {}
    process.exit(0);
  });

  return server;
}

startServer(DEFAULT_PORT, HOST);
