import './dns-bootstrap.js';
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';
import { zaloClient } from './zalo-client.js';
import { localStore } from './utils/local-store.js';
import { requireAuth } from './middleware/auth.js';
import { defaultRateLimiter } from './utils/rate-limiter.js';

// Import Route Modules
import tagRoutes from './routes/tags.js';
import quickMsgRoutes from './routes/quick-messages.js';
import campaignRoutes from './routes/campaigns.js';
import chatActionRoutes from './routes/chat-actions.js';
import aiSettingsRoutes from './routes/ai-settings.js';
import backupRoutes from './routes/backup.js';
import { updaterRouter } from './routes/updater.js';

// Import Adapters & Utilities
import { chatwootInboundAdapter } from './adapters/chatwoot-inbound.js';
import { chatwootOutboundAdapter } from './adapters/chatwoot-outbound.js';
import { aiAgentAdapter } from './adapters/ai-agent.js';
import { genericWebhookAdapter } from './adapters/generic-webhook.js';
import { memoryGuard } from './utils/memory-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

const isPackaged = process.env.ZALOFLOW_PACKAGED === '1';
const DEFAULT_PORT = Number(process.env.PORT || 3000);
const HOST = isPackaged ? '127.0.0.1' : (process.env.HOST || '0.0.0.0');
const startTime = Date.now();

// Register Inbound Listeners on Zalo Client
zaloClient.onMessage(async (ctx) => {
  // 1. Sync to Chatwoot if configured
  await chatwootInboundAdapter.handleInbound(ctx);

  // 2. Forward to Generic Webhook (n8n, Dify, Flowise, Make) if configured
  await genericWebhookAdapter.handleInbound(ctx);

  // 3. AI Auto-Reply Engine
  await aiAgentAdapter.handleInbound(ctx);
});

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

export function broadcastSSE(eventType, data) {
  // 1. Broadcast to active WebSocket clients (Zero HTTP pending queue, eliminates tab spinner)
  const wsPayload = JSON.stringify({ event: eventType, data });
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
  const payload = `id: ${sseEventId}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
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
  broadcastSSE('new_message', msg);
});

localStore.on('messageReaction', (data) => {
  broadcastSSE('message_reaction', data);
});

localStore.on('messagesDelivered', (data) => {
  broadcastSSE('message_status', data);
});

localStore.on('messageRecalled', (data) => {
  broadcastSSE('message_recalled', data);
});

localStore.on('conversationUpdated', (conv) => {
  broadcastSSE('conversation_updated', conv);
});

// -----------------------------------------------------------------------------
// Mount Modular REST Route Handlers
// -----------------------------------------------------------------------------
app.use('/api', tagRoutes);
app.use('/api', quickMsgRoutes);
app.use('/api', campaignRoutes);
app.use('/api', chatActionRoutes);
app.use('/api', aiSettingsRoutes);
app.use('/api', backupRoutes);
app.use('/api', updaterRouter);

// -----------------------------------------------------------------------------
// Core Conversation & Sync REST APIs
// -----------------------------------------------------------------------------

// GET /api/conversations
app.get('/api/conversations', requireAuth, (req, res) => {
  const { search = '', filter = 'all', tagId = '' } = req.query;
  const conversations = localStore.getConversations({ search, filter, tagId });
  res.json({
    status: 'success',
    data: conversations
  });
});

// GET /api/conversations/:threadId/messages
app.get('/api/conversations/:threadId/messages', requireAuth, (req, res) => {
  const { threadId } = req.params;
  const { limit = 50, before = null } = req.query;
  const messages = localStore.getMessages(threadId, {
    limit: Math.min(Number(limit), 100),
    before
  });
  res.json({
    status: 'success',
    data: messages
  });
});

// POST /api/conversations/:threadId/read
app.post('/api/conversations/:threadId/read', requireAuth, (req, res) => {
  const { threadId } = req.params;
  localStore.markAsRead(threadId);
  res.json({ success: true });
});

// POST /api/sync-contacts (Manual contact sync trigger)
app.post('/api/sync-contacts', requireAuth, async (req, res) => {
  try {
    await zaloClient.syncInitialContacts();
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

  if (!zaloClient.isLoggedIn) {
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
    const count = await zaloClient.fetchThreadHistory(threadId, isGroup, 50);
    syncState.set(threadId, Date.now());
    res.json({ success: true, synced: count });
  } catch (err) {
    syncState.delete(threadId);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/send-message (Send message from Web UI / Admin API)
app.post('/api/send-message', requireAuth, async (req, res) => {
  const { recipientId, message, isGroup = false, isBot = false } = req.body;
  if (!recipientId || !message) {
    return res.status(400).json({ error: 'recipientId và message là bắt buộc.' });
  }

  if (!zaloClient.isLoggedIn) {
    return res.status(503).json({ error: 'Zalo chưa đăng nhập hoặc đang offline. Vui lòng quét mã QR trước.' });
  }

  try {
    const result = await zaloClient.sendMessage(recipientId, message, Boolean(isGroup), {
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
  if (!zaloClient.isLoggedIn) {
    return res.status(503).json({ error: 'Zalo chưa đăng nhập hoặc đang offline. Vui lòng quét mã QR trước.' });
  }

  const { limitThreads = 30, limitPerThread = 50 } = req.body || {};

  try {
    const result = await zaloClient.syncAllHistory({
      limitThreads: Number(limitThreads) || 30,
      limitPerThread: Number(limitPerThread) || 50,
      onProgress: (progress) => {
        // Send SSE broadcast to update active connected UI sessions
        broadcastSSE('sync_progress', progress);
      }
    });

    // Notify UI that sync completed
    broadcastSSE('sync_complete', result);
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
  res.json({
    status: 'success',
    data: zaloClient.getAccountProfile()
  });
});

// POST /api/zalo/qr/generate
app.post('/api/zalo/qr/generate', requireAuth, async (req, res) => {
  const cleanData = Boolean(req.body?.cleanData);
  try {
    const profile = await zaloClient.requestNewQrLogin((updatedProfile) => {
      broadcastSSE('zalo_profile', updatedProfile);
      if (updatedProfile.qrDataUrl) {
        broadcastSSE('zalo_qr', {
          qrDataUrl: updatedProfile.qrDataUrl,
          statusText: updatedProfile.qrStatusText,
          scannedUser: updatedProfile.scannedUser
        });
      }
    }, { cleanData });
    broadcastSSE('zalo_profile', profile);
    res.json({ success: true, data: profile });
  } catch (err) {
    logger.error(`[QR Generate API] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/zalo/logout
app.post('/api/zalo/logout', requireAuth, async (req, res) => {
  const cleanData = Boolean(req.body?.cleanData);
  try {
    const profile = await zaloClient.logout({ cleanData });
    broadcastSSE('zalo_profile', profile);
    res.json({ success: true, data: profile });
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
    zaloClient.initialize();
    memoryGuard.startMonitoring({
      server,
      sseBroadcast: (event, data) => broadcastSSE(event, data)
    });

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
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal. Executing graceful shutdown...');
    try {
      server.close();
      localStore.close();
    } catch {}
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('Received SIGINT (Ctrl+C). Executing graceful shutdown...');
    try {
      server.close();
      localStore.close();
    } catch {}
    process.exit(0);
  });

  return server;
}

startServer(DEFAULT_PORT, HOST);
