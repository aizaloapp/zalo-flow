import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './utils/logger.js';
import { zaloClient } from './zalo-client.js';
import { localStore } from './utils/local-store.js';
import { requireAuth } from './middleware/auth.js';

// Import Route Modules
import tagRoutes from './routes/tags.js';
import quickMsgRoutes from './routes/quick-messages.js';
import campaignRoutes from './routes/campaigns.js';
import chatActionRoutes from './routes/chat-actions.js';
import aiSettingsRoutes from './routes/ai-settings.js';
import backupRoutes from './routes/backup.js';

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

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
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
// Realtime SSE Stream Engine
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Mount Modular REST Route Handlers
// -----------------------------------------------------------------------------
app.use('/api', tagRoutes);
app.use('/api', quickMsgRoutes);
app.use('/api', campaignRoutes);
app.use('/api', chatActionRoutes);
app.use('/api', aiSettingsRoutes);
app.use('/api', backupRoutes);

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
    res.status(500).json({ error: err.message });
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
    });
    broadcastSSE('zalo_profile', profile);
    res.json({ success: true, data: profile });
  } catch (err) {
    logger.error(`[QR Generate API] Failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/zalo/logout
app.post('/api/zalo/logout', requireAuth, async (req, res) => {
  try {
    const profile = await zaloClient.logout();
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

// Start Server
const server = app.listen(PORT, HOST, () => {
  logger.info(`🚀 Zalo-Flow Server is running on http://${HOST}:${PORT}`);
  logger.info(`📊 Health check available at: http://${HOST}:${PORT}/health`);
  zaloClient.initialize();
  memoryGuard.startMonitoring({
    server,
    sseBroadcast: (event, data) => broadcastSSE(event, data)
  });
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
