import axios from 'axios';
import { BaseAdapter } from './base-adapter.js';
import { logger } from '../utils/logger.js';

export class GenericWebhookAdapter extends BaseAdapter {
  constructor() {
    super('generic-webhook');
  }

  isConfigured() {
    return Boolean(process.env.GENERIC_WEBHOOK_URL || process.env.WEBHOOK_URL);
  }

  getWebhookUrl() {
    return process.env.GENERIC_WEBHOOK_URL || process.env.WEBHOOK_URL || '';
  }

  /**
   * Forward inbound Zalo messages to external webhook (n8n, Dify, Flowise, Make, Custom API)
   */
  async handleInbound(ctx) {
    const webhookUrl = this.getWebhookUrl();
    if (!webhookUrl) return;

    const { message, text, senderId, threadId, isGroup } = ctx;
    if (!message && !text) return;

    const payload = {
      event: 'zalo_message_received',
      timestamp: new Date().toISOString(),
      data: {
        id: message?.id || `msg_${Date.now()}`,
        threadId: threadId || message?.threadId,
        senderId: senderId || message?.senderId,
        senderName: message?.senderName || 'Người dùng Zalo',
        text: text || message?.text || '',
        isGroup: Boolean(isGroup ?? message?.isGroup),
        mediaType: message?.mediaType || 'text',
        mediaUrl: message?.mediaUrl || ''
      }
    };

    try {
      await axios.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Zalo-Flow-Webhook-Bridge/1.0'
        },
        timeout: 8000
      });
      logger.info(`📡 [Generic Webhook] Forwarded inbound message from ${payload.data.senderName} to ${webhookUrl}`);
    } catch (err) {
      logger.warn(`⚠️ [Generic Webhook] Failed to forward message: ${err.message}`);
    }
  }

  /**
   * Handle outbound message dispatch from external platform back to Zalo
   */
  async handleOutbound(req, res, zaloClient) {
    const { threadId, message, text, isGroup } = req.body || {};
    const content = message || text;

    if (!threadId || !content) {
      return res.status(400).json({
        error: 'Missing required parameters: threadId and message (or text) are required.'
      });
    }

    try {
      const result = await zaloClient.sendMessage(String(threadId), String(content), Boolean(isGroup));
      return res.json({
        success: true,
        message: 'Message queued and dispatched via Rate Limiter',
        data: result
      });
    } catch (err) {
      logger.error(`[Generic Webhook Outbound] Failed to dispatch: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }
}

export const genericWebhookAdapter = new GenericWebhookAdapter();
