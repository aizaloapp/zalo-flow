import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { defaultSelfEchoShield } from './self-echo.js';
import { defaultFloodDetector } from './flood-detector.js';
import { defaultRateLimiter } from './rate-limiter.js';
import { localStore } from './local-store.js';
import { aiAgentAdapter } from '../adapters/ai-agent.js';

const RESTART_LOG_PATH = path.resolve('data/restart-log.json');
const MAX_LOG_ENTRIES = 50;

/**
 * Record a restart event into data/restart-log.json (Ring buffer max 50 entries)
 */
function recordRestartLog(entry) {
  try {
    let logs = [];
    if (fs.existsSync(RESTART_LOG_PATH)) {
      try {
        const raw = fs.readFileSync(RESTART_LOG_PATH, 'utf8');
        logs = JSON.parse(raw);
        if (!Array.isArray(logs)) logs = [];
      } catch {}
    }
    logs.push(entry);
    if (logs.length > MAX_LOG_ENTRIES) {
      logs = logs.slice(-MAX_LOG_ENTRIES);
    }
    const dir = path.dirname(RESTART_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RESTART_LOG_PATH, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`[Memory Guard] Error saving restart log: ${err.message}`);
  }
}

function getTotalRestarts() {
  try {
    if (fs.existsSync(RESTART_LOG_PATH)) {
      const raw = fs.readFileSync(RESTART_LOG_PATH, 'utf8');
      const logs = JSON.parse(raw);
      if (Array.isArray(logs)) return logs.length;
    }
  } catch {}
  return 0;
}

/**
 * Memory Guard Sentinel & Self-Healing Circuit Breaker for Zalo-Flow (Audit v2)
 * Threshold: 150MB hard limit (Audit Fix C1), 112MB soft warning.
 */
export class MemoryGuard {
  constructor(options = {}) {
    this.maxMemoryMb = Number(options.maxMemoryMb || process.env.MAX_MEMORY_MB || 150);
    this.warnMemoryMb = Number(options.warnMemoryMb || process.env.WARN_MEMORY_MB || Math.round(this.maxMemoryMb * 0.75));
    this.checkIntervalMs = Number(options.checkIntervalSec || process.env.MEMORY_CHECK_INTERVAL_SEC || 30) * 1000;
    this.sustainedLimit = Number(options.sustainedLimit || 3);
    this.enabled = options.enabled !== undefined 
      ? Boolean(options.enabled) 
      : (process.env.MEMORY_GUARD_ENABLED !== 'false');

    this.consecutiveBreaches = 0;
    this._timer = null;
    this._isRestarting = false;
    this._server = null;
    this._sseBroadcastFn = null;
  }

  getStats() {
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / 1024 / 1024);
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);

    let status = 'normal';
    if (rssMb >= this.maxMemoryMb) {
      status = 'critical';
    } else if (rssMb >= this.warnMemoryMb) {
      status = 'warning';
    }

    return {
      rssMb,
      heapUsedMb,
      heapTotalMb,
      limitMb: this.maxMemoryMb,
      warnMb: this.warnMemoryMb,
      status,
      consecutiveBreaches: this.consecutiveBreaches,
      totalRestarts: getTotalRestarts(),
      guardEnabled: this.enabled
    };
  }

  /**
   * Periodic check executed every interval (default 30s)
   */
  checkMemory() {
    if (!this.enabled) return this.getStats();

    const stats = this.getStats();

    // Debug logging for post-mortem trend analysis
    logger.debug(`[Memory Guard] Check: RSS=${stats.rssMb}MB, Heap=${stats.heapUsedMb}MB (Warn=${this.warnMemoryMb}MB, Max=${this.maxMemoryMb}MB)`);

    if (stats.rssMb >= this.maxMemoryMb) {
      this.consecutiveBreaches++;
      logger.warn(`⚠️ [Memory Guard] High RAM usage breach #${this.consecutiveBreaches}/${this.sustainedLimit}: ${stats.rssMb}MB (Threshold: ${this.maxMemoryMb}MB)`);

      // Attempt soft cleanup immediately
      this._performSoftCleanup();

      if (this.consecutiveBreaches >= this.sustainedLimit) {
        this.initiateGracefulRestart(`RAM breach sustained for ${this.sustainedLimit} consecutive cycles (${stats.rssMb}MB >= ${this.maxMemoryMb}MB)`);
      }
    } else if (stats.rssMb >= this.warnMemoryMb) {
      if (this.consecutiveBreaches > 0) this.consecutiveBreaches = 0;
      logger.info(`ℹ️ [Memory Guard] Proactive soft purge triggered: ${stats.rssMb}MB >= ${this.warnMemoryMb}MB`);
      this._performSoftCleanup();
    } else {
      if (this.consecutiveBreaches > 0) this.consecutiveBreaches = 0;
    }

    return stats;
  }

  /**
   * Soft Cleanup Protocol — Drains 5 Specific Map Stores (Audit Fix I2)
   */
  _performSoftCleanup() {
    try {
      // 1. Clear SelfEchoShield sentMessages
      if (defaultSelfEchoShield?.sentMessages) {
        defaultSelfEchoShield.sentMessages.clear();
      }

      // 2 & 3. Clear FloodDetector history & muted senders
      if (defaultFloodDetector?.senderHistory) {
        defaultFloodDetector.senderHistory.clear();
      }
      if (defaultFloodDetector?.mutedSenders) {
        defaultFloodDetector.mutedSenders.clear();
      }

      // 4 & 5. Clear AI Agent debounce timers & inbound buffers
      if (aiAgentAdapter?._debounceTimers) {
        for (const timer of aiAgentAdapter._debounceTimers.values()) {
          try { clearTimeout(timer); } catch {}
        }
        aiAgentAdapter._debounceTimers.clear();
      }
      if (aiAgentAdapter?._inboundBuffers) {
        aiAgentAdapter._inboundBuffers.clear();
      }

      // Force V8 Garbage Collection if flag --expose-gc is active
      if (typeof global.gc === 'function') {
        global.gc();
        logger.debug('[Memory Guard] V8 Garbage Collection executed.');
      }
    } catch (err) {
      logger.warn(`[Memory Guard] Error during soft cleanup: ${err.message}`);
    }
  }

  /**
   * 4-Stage Graceful Shutdown Protocol (Audit Fix C1, C2, I1, I3, N1)
   */
  async initiateGracefulRestart(reason = 'Memory limit exceeded') {
    if (this._isRestarting) return;
    this._isRestarting = true;

    const stats = this.getStats();
    logger.error(`🚨 [Memory Guard Sentinel Triggered] ${reason}`);
    logger.info('⏳ Starting Graceful Restart Protocol (allowing in-flight tasks to complete)...');

    // 1. Broadcast SSE warning to Dashboard if function registered (Audit Fix I3: wrapped in try-catch)
    if (typeof this._sseBroadcastFn === 'function') {
      try {
        this._sseBroadcastFn('memory_restart', {
          type: 'memory_restart',
          message: '🚨 Hệ thống đang khởi động lại êm ái để giải phóng bộ nhớ...',
          rssMb: stats.rssMb,
          limitMb: this.maxMemoryMb,
          timestamp: new Date().toISOString()
        });
      } catch {}
    }

    // 2. Record event in data/restart-log.json (Audit Fix N1)
    recordRestartLog({
      timestamp: new Date().toISOString(),
      reason,
      rssMb: stats.rssMb,
      heapUsedMb: stats.heapUsedMb,
      limitMb: this.maxMemoryMb
    });

    try {
      // 3. Drain RateLimiter outbound queue (Audit Fix I1)
      logger.info('⏳ [Memory Guard] Waiting for RateLimiter queue to drain (max 5s)...');
      if (typeof defaultRateLimiter.drainAll === 'function') {
        await defaultRateLimiter.drainAll(5000);
      }

      // 4. Flush SQLite WAL and close database safely (Audit Fix C2)
      localStore.close();

      // 5. Close HTTP Server if listening
      if (this._server && typeof this._server.close === 'function') {
        this._server.close();
      }
    } catch (err) {
      logger.warn(`[Memory Guard] Warning during shutdown sequence: ${err.message}`);
    }

    logger.info('👋 Graceful shutdown complete. Exiting process for supervisor auto-restart...');
    process.exit(1);
  }

  /**
   * Start sentinel interval monitoring
   */
  startMonitoring({ server = null, sseBroadcast = null } = {}) {
    if (server) this._server = server;
    if (sseBroadcast) this._sseBroadcastFn = sseBroadcast;

    if (!this.enabled) {
      logger.info('🛡️ [Memory Guard] Monitoring disabled via MEMORY_GUARD_ENABLED=false.');
      return;
    }

    if (this._timer) clearInterval(this._timer);

    this._timer = setInterval(() => {
      this.checkMemory();
    }, this.checkIntervalMs);

    if (this._timer && typeof this._timer.unref === 'function') {
      this._timer.unref();
    }

    logger.info(`🛡️ [Memory Guard] Sentinel active: Limit ${this.maxMemoryMb}MB (Warn at ${this.warnMemoryMb}MB), Interval: ${this.checkIntervalMs / 1000}s`);
  }

  stopMonitoring() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

export const memoryGuard = new MemoryGuard();
