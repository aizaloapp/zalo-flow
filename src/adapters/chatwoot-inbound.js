import axios from 'axios';
import { BaseAdapter } from './base-adapter.js';
import { chatwootContactManager } from './chatwoot-contact.js';
import { logger } from '../utils/logger.js';

export class ChatwootInboundAdapter extends BaseAdapter {
  constructor() {
    super('chatwoot-inbound');
  }

  /**
   * Forward incoming Zalo message to Chatwoot Conversation
   */
  async handleInbound({ text, senderId, threadId, isGroup }) {
    if (!chatwootContactManager.isConfigured() || isGroup) return;

    try {
      const conv = await chatwootContactManager.getOrCreateConversation(senderId);
      if (!conv || !conv.conversationId) return;

      const baseUrl = `${process.env.CHATWOOT_API_URL.replace(/\/$/, '')}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}`;
      
      await axios.post(`${baseUrl}/conversations/${conv.conversationId}/messages`, {
        content: text,
        message_type: 'incoming'
      }, { headers: chatwootContactManager.getHeaders() });

      logger.info(`[Chatwoot] Synced message from Zalo User ${senderId} -> Chatwoot Conv #${conv.conversationId}`);
    } catch (err) {
      logger.error(`[Chatwoot] Inbound sync error: ${err.message}`);
    }
  }
}

export const chatwootInboundAdapter = new ChatwootInboundAdapter();
