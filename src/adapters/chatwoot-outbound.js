import { BaseAdapter } from './base-adapter.js';
import { logger } from '../utils/logger.js';

export class ChatwootOutboundAdapter extends BaseAdapter {
  constructor() {
    super('chatwoot-outbound');
  }

  /**
   * Handle Chatwoot Webhook event when Agent replies in Chatwoot UI
   * POST /api/webhook/chatwoot
   */
  async handleOutbound(req, res, client) {
    const payload = req.body;

    // Only process 'message_created' events from human agents or bots
    if (payload.event !== 'message_created' || payload.message_type !== 'outgoing') {
      return res.json({ status: 'ignored', reason: 'Not an outgoing message event' });
    }

    // Skip private notes
    if (payload.private) {
      return res.json({ status: 'ignored', reason: 'Private note' });
    }

    const content = payload.content;
    const conversation = payload.conversation;
    const contact = payload.conversation?.meta?.sender || payload.sender;

    const zaloUid = conversation?.custom_attributes?.zalo_uid || contact?.identifier || contact?.custom_attributes?.zalo_uid;

    if (!zaloUid) {
      logger.warn('[Chatwoot] Outbound message ignored: Cannot find Zalo UID from conversation/contact metadata.');
      return res.status(400).json({ error: 'Cannot find Zalo UID' });
    }

    if (!content || !content.trim()) {
      return res.json({ status: 'ignored', reason: 'Empty content' });
    }

    try {
      logger.info(`[Chatwoot -> Zalo] Agent reply to Zalo User ${zaloUid}: "${content.substring(0, 30)}..."`);
      await client.sendMessage(zaloUid, content.trim(), false);
      return res.json({ success: true, zaloUid, status: 'sent' });
    } catch (err) {
      logger.error(`[Chatwoot -> Zalo] Send failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }
}

export const chatwootOutboundAdapter = new ChatwootOutboundAdapter();
