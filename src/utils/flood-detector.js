import { logger } from './logger.js';

/**
 * Flood Detector
 * Detects sudden message bursts (>5 msgs in 3s) from a sender and temporarily mutes them
 */
export class FloodDetector {
  constructor({
    threshold = 5,       // Max 5 messages in window
    windowMs = 3000,      // 3 seconds window
    muteDurationMs = 60000 // 60 seconds mute
  } = {}) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.muteDurationMs = muteDurationMs;
    this.senderHistory = new Map(); // senderId -> [timestamps]
    this.mutedSenders = new Map();  // senderId -> muteUntilTimestamp
  }

  /**
   * Check if a message from sender should be blocked due to flood
   * @param {string} senderId 
   * @returns {boolean} true if sender is flooding / muted
   */
  isFlooding(senderId) {
    if (!senderId) return false;
    const now = Date.now();

    // Check if currently muted
    const muteUntil = this.mutedSenders.get(senderId);
    if (muteUntil && now < muteUntil) {
      const remainingSec = Math.ceil((muteUntil - now) / 1000);
      logger.warn(`[Flood Shield] Sender ${senderId} is MUTED. Remaining: ${remainingSec}s`);
      return true;
    }

    // Clean expired mute
    if (muteUntil && now >= muteUntil) {
      this.mutedSenders.delete(senderId);
      logger.info(`[Flood Shield] Sender ${senderId} unmuted.`);
    }

    // Record incoming message timestamp
    const timestamps = (this.senderHistory.get(senderId) || []).filter(t => now - t < this.windowMs);
    timestamps.push(now);
    this.senderHistory.set(senderId, timestamps);

    // Detect flood
    if (timestamps.length > this.threshold) {
      this.mutedSenders.set(senderId, now + this.muteDurationMs);
      logger.warn(`[Flood Shield] SENDER ${senderId} TRIGGERED FLOOD (${timestamps.length} msgs in ${this.windowMs / 1000}s)! Muting for ${this.muteDurationMs / 1000}s.`);
      return true;
    }

    return false;
  }
}

export const defaultFloodDetector = new FloodDetector({
  threshold: Number(process.env.FLOOD_THRESHOLD || 5),
  muteDurationMs: Number(process.env.FLOOD_MUTE_SECONDS ? Number(process.env.FLOOD_MUTE_SECONDS) * 1000 : 60000)
});
