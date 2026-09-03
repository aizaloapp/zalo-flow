import { logger } from './logger.js';

/**
 * Token Bucket Rate Limiter for Zalo Outbound Messaging
 * Prevents account ban by spacing outbound requests
 */
export class RateLimiter {
  constructor({
    minIntervalMs = 3000,   // Min 3s between messages
    maxPerMinute = 20       // Max 20 messages per minute
  } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxPerMinute = maxPerMinute;
    this.lastSentTimestamp = 0;
    this.sentTimestamps = [];
    this.queue = [];
    this.isProcessing = false;
  }

  /**
   * Enqueue a send function to be executed safely within rate limits
   * @param {Function} sendFn - Async function returning a promise
   * @returns {Promise<any>}
   */
  schedule(sendFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ sendFn, resolve, reject });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      
      // Clean up timestamps older than 60s
      this.sentTimestamps = this.sentTimestamps.filter(t => now - t < 60000);

      // Check minute limit
      if (this.sentTimestamps.length >= this.maxPerMinute) {
        const oldest = this.sentTimestamps[0];
        const waitTime = Math.max(0, 60000 - (now - oldest));
        logger.warn(`[Anti-Ban] Rate limit reached (${this.maxPerMinute}/min). Waiting ${Math.ceil(waitTime / 1000)}s...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      // Check interval between messages
      const timeSinceLast = now - this.lastSentTimestamp;
      if (timeSinceLast < this.minIntervalMs) {
        const waitInterval = this.minIntervalMs - timeSinceLast;
        await new Promise(r => setTimeout(r, waitInterval));
      }

      // Execute next in queue
      const item = this.queue.shift();
      if (!item) break;

      try {
        const result = await item.sendFn();
        const sendTime = Date.now();
        this.lastSentTimestamp = sendTime;
        this.sentTimestamps.push(sendTime);
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Drain entire queue before graceful shutdown.
   * Resolves when queue is empty and isProcessing is false or on timeout.
   */
  drainAll(timeoutMs = 5000) {
    if (this.queue.length === 0 && !this.isProcessing) return Promise.resolve();
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = setInterval(() => {
        if ((this.queue.length === 0 && !this.isProcessing) || (Date.now() - startTime >= timeoutMs)) {
          clearInterval(check);
          resolve();
        }
      }, 150);
    });
  }
}

export const defaultRateLimiter = new RateLimiter({
  minIntervalMs: Number(process.env.RATE_LIMIT_PER_SECOND ? 1000 / Number(process.env.RATE_LIMIT_PER_SECOND) : 3000),
  maxPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 20)
});
