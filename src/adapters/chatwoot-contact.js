import axios from 'axios';
import { logger } from '../utils/logger.js';

export class ChatwootContactManager {
  constructor() {
    this.apiUrl = process.env.CHATWOOT_API_URL;
    this.apiToken = process.env.CHATWOOT_API_TOKEN;
    this.accountId = process.env.CHATWOOT_ACCOUNT_ID;
    this.inboxId = process.env.CHATWOOT_INBOX_ID;
    this.contactCache = new Map(); // zaloUid -> { contactId, conversationId }
  }

  isConfigured() {
    return Boolean(this.apiUrl && this.apiToken && this.accountId && this.inboxId);
  }

  getHeaders() {
    return {
      'api_access_token': this.apiToken,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Get or create a Chatwoot Contact and Conversation for a Zalo User
   */
  async getOrCreateConversation(zaloUid, displayName = `Zalo User ${zaloUid.substring(0, 6)}`) {
    if (!this.isConfigured()) return null;

    if (this.contactCache.has(zaloUid)) {
      return this.contactCache.get(zaloUid);
    }

    try {
      const baseUrl = `${this.apiUrl.replace(/\/$/, '')}/api/v1/accounts/${this.accountId}`;

      // 1. Search or create contact
      let contactId = null;
      try {
        const searchRes = await axios.get(`${baseUrl}/contacts/search?q=${zaloUid}`, {
          headers: this.getHeaders()
        });
        if (searchRes.data?.payload?.length > 0) {
          contactId = searchRes.data.payload[0].id;
        }
      } catch (err) {
        logger.debug(`Contact search failed: ${err.message}`);
      }

      if (!contactId) {
        const createContactRes = await axios.post(`${baseUrl}/contacts`, {
          name: displayName,
          identifier: zaloUid,
          custom_attributes: { zalo_uid: zaloUid }
        }, { headers: this.getHeaders() });
        contactId = createContactRes.data?.payload?.contact?.id;
      }

      if (!contactId) return null;

      // 2. Create or get conversation in inbox
      const createConvRes = await axios.post(`${baseUrl}/conversations`, {
        source_id: zaloUid,
        inbox_id: this.inboxId,
        contact_id: contactId
      }, { headers: this.getHeaders() });

      const conversationId = createConvRes.data?.id;
      const result = { contactId, conversationId };
      this.contactCache.set(zaloUid, result);
      return result;
    } catch (err) {
      logger.error(`[Chatwoot] Contact/Conversation creation error: ${err.message}`);
      return null;
    }
  }
}

export const chatwootContactManager = new ChatwootContactManager();
