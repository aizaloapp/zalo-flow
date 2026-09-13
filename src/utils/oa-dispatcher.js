import axios from 'axios';
import { oaTokenManager } from './oa-token-manager.js';
import { localStore } from './local-store.js';
import { aiAgentAdapter } from '../adapters/ai-agent.js';
import { logger } from './logger.js';

export class OaDispatcher {
  /**
   * Send CS text message to user within 48h interaction window
   * Zalo OpenAPI: POST https://openapi.zalo.me/v3.0/oa/message/cs
   */
  async sendMessage(userId, text, { threadId = '', silent = false, store = null } = {}) {
    if (!userId || !text) {
      return { success: false, error: 'missing_recipient_or_text' };
    }

    // Check 48h interaction window guard
    if (threadId) {
      const activeStore = store || localStore;
      const conv = activeStore.getConversation(threadId);
      if (conv && conv.lastUserMessageTime) {
        const timeSinceLastMsg = Date.now() - Number(conv.lastUserMessageTime);
        const maxWindow = 48 * 3600 * 1000;
        if (timeSinceLastMsg > maxWindow) {
          logger.warn(`[OaDispatcher] Blocked outbound message to ${userId}: 48h interaction window expired`);
          return {
            success: false,
            error: 'window_48h_expired',
            message: 'Cuộc trò chuyện đã quá 48h. Zalo OA chặn tin nhắn thường.'
          };
        }
      }
    }

    const token = await oaTokenManager.getValidAccessToken();
    if (!token) {
      return { success: false, error: 'oa_not_configured_or_disabled' };
    }

    const cleanedText = aiAgentAdapter.cleanForZalo(text);

    try {
      const payload = {
        recipient: {
          user_id: String(userId)
        },
        message: {
          text: cleanedText
        }
      };

      const response = await axios.post('https://openapi.zalo.me/v3.0/oa/message/cs', payload, {
        headers: {
          'access_token': token,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      const resData = response.data || {};
      if (resData.error && resData.error !== 0) {
        logger.error(`[OaDispatcher] Zalo OA send error: code ${resData.error} - ${resData.message}`);
        return {
          success: false,
          errorCode: resData.error,
          error: resData.message || `Zalo Error ${resData.error}`
        };
      }

      logger.info(`[OaDispatcher] ✅ Sent message to OA user ${userId} (msg_id: ${resData.data?.message_id || 'ok'})`);
      return {
        success: true,
        data: resData.data,
        msgId: resData.data?.message_id
      };
    } catch (err) {
      logger.error(`[OaDispatcher] Network/HTTP error sending OA message: ${err.message}`);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Fetch customer user details from Zalo OA API
   * GET https://openapi.zalo.me/v3.0/oa/user/detail?data={"user_id":"..."}
   */
  async getUserDetail(userId) {
    if (!userId) return null;
    const token = await oaTokenManager.getValidAccessToken();
    if (!token) return null;

    try {
      const queryData = JSON.stringify({ user_id: String(userId) });
      const response = await axios.get(`https://openapi.zalo.me/v3.0/oa/user/detail?data=${encodeURIComponent(queryData)}`, {
        headers: {
          'access_token': token
        },
        timeout: 10000
      });

      const data = response.data;
      if (data && data.error === 0 && data.data) {
        return {
          userId: data.data.user_id,
          displayName: data.data.display_name || '',
          avatar: data.data.avatar || '',
          userGender: data.data.user_gender,
          sharedPhone: data.data.shared_info?.phone || ''
        };
      }
      return null;
    } catch (err) {
      logger.warn(`[OaDispatcher] Failed to fetch user detail for ${userId}: ${err.message}`);
      return null;
    }
  }
}

export const oaDispatcher = new OaDispatcher();
