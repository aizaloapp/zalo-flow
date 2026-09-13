import { BaseAdapter } from './base-adapter.js';
import { logger } from '../utils/logger.js';
import { localStore } from '../utils/local-store.js';
import { oaDispatcher } from '../utils/oa-dispatcher.js';

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
      const conv = localStore.getConversation(zaloUid);
      const isOa = conv?.channel === 'oa' || zaloUid.startsWith('oa_');

      if (isOa) {
        logger.info(`[Chatwoot -> Zalo OA] Agent reply to OA User ${zaloUid}: "${content.substring(0, 30)}..."`);
        const parts = zaloUid.split('_');
        const userId = parts[2] || parts[parts.length - 1];
        const sendRes = await oaDispatcher.sendMessage(userId, content.trim(), { threadId: zaloUid });
        if (!sendRes.success) {
          return res.status(500).json({ error: sendRes.error, message: sendRes.message });
        }
        return res.json({ success: true, zaloUid, channel: 'oa', status: 'sent' });
      }

      logger.info(`[Chatwoot -> Zalo Personal] Agent reply to Zalo User ${zaloUid}: "${content.substring(0, 30)}..."`);
      await client.sendMessage(zaloUid, content.trim(), false);
      return res.json({ success: true, zaloUid, channel: 'personal', status: 'sent' });
    } catch (err) {
      logger.error(`[Chatwoot -> Zalo] Send failed: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }
}

export const chatwootOutboundAdapter = new ChatwootOutboundAdapter();
