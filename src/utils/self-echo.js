import { logger } from './logger.js';

/**
 * Self-Echo Shield
 * Deduplicates messages sent by the bot itself to prevent infinite loop replies
 */
export class SelfEchoShield {
  constructor(ttlSeconds = 30) {
    this.ttlMs = ttlSeconds * 1000;
    this.sentMessages = new Map(); // key: hash/content, value: timestamp
  }

  /**
   * Record that the bot sent a message
   * @param {string} text 
   * @param {string} recipientId 
   */
  recordSent(text, recipientId = '') {
    const key = `${recipientId}_${String(text).trim()}`;
    this.sentMessages.set(key, Date.now());
    this._cleanup();
  }

  /**
   * Check if a newly received message is just an echo of what the bot recently sent
   * @param {string} text 
   * @param {string} senderId 
   * @returns {boolean}
   */
  isSelfEcho(text, senderId = '') {
    const key = `${senderId}_${String(text).trim()}`;
    const timestamp = this.sentMessages.get(key);
    if (!timestamp) return false;

    const isEcho = Date.now() - timestamp < this.ttlMs;
    if (isEcho) {
      logger.debug(`[Self-Echo] Suppressed echo message to/from ${senderId}: "${text.substring(0, 30)}..."`);
    }
    return isEcho;
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, timestamp] of this.sentMessages.entries()) {
      if (now - timestamp > this.ttlMs) {
        this.sentMessages.delete(key);
      }
    }
  }
}

export const defaultSelfEchoShield = new SelfEchoShield(
  Number(process.env.SELF_ECHO_TTL_SECONDS || 30)
);
