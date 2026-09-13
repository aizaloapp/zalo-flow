import crypto from 'crypto';
import axios from 'axios';
import { localStore } from './local-store.js';
import { encryptSecret, decryptSecret } from './ai-crypto.js';
import { logger } from './logger.js';

/**
 * AsyncMutex to serialize token refresh operations
 * Prevents race conditions with Zalo OAuth v4 One-Time Refresh Token rotation
 */
export class AsyncMutex {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  async acquire() {
    if (!this._locked) {
      this._locked = true;
      return () => this._release();
    }
    return new Promise((resolve) => {
      this._queue.push(resolve);
    });
  }

  _release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next(() => this._release());
    } else {
      this._locked = false;
    }
  }

  async runExclusive(callback) {
    const release = await this.acquire();
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

export class OaTokenManager {
  constructor() {
    this.mutex = new AsyncMutex();
    this.watchdogTimer = null;
  }

  /**
   * Initialize or update OA settings with credentials
   */
  setCredentials({ oaId = '', name = '', avatar = '', appId = '', secretKey = '', accessToken = '', refreshToken = '', expiresIn = 86400, isEnabled = 1, isAiAutoReply = 0 }) {
    const expiresAt = Date.now() + (Number(expiresIn) * 1000);
    const toSave = {
      oaId: String(oaId || '').trim(),
      name: String(name || '').trim(),
      avatar: String(avatar || '').trim(),
      appId: String(appId || '').trim(),
      isEnabled: isEnabled ? 1 : 0,
      isAiAutoReply: isAiAutoReply ? 1 : 0,
      expiresAt
    };

    if (secretKey && secretKey.trim()) {
      toSave.secretKeyEncrypted = encryptSecret(secretKey.trim());
    }
    if (accessToken && accessToken.trim()) {
      toSave.accessTokenEncrypted = encryptSecret(accessToken.trim());
    }
    if (refreshToken && refreshToken.trim()) {
      toSave.refreshTokenEncrypted = encryptSecret(refreshToken.trim());
    }

    return localStore.saveOaSettings(toSave);
  }

  /**
   * Get valid access token for OA dispatching
   * Automatically refreshes via Mutex when expired or expiring within 1 hour
   */
  async getValidAccessToken(id = 'default') {
    const settings = localStore.getOaSettings(id);
    if (!settings || !settings.isEnabled) {
      return null;
    }

    const currentToken = decryptSecret(settings.accessTokenEncrypted);
    const now = Date.now();

    // If token is still valid with > 1 hour headroom, return immediately
    if (currentToken && settings.expiresAt && now < (settings.expiresAt - 3600000)) {
      return currentToken;
    }

    // Refresh token with Mutex Lock
    return await this.mutex.runExclusive(async () => {
      // Re-read settings in case another thread just finished refreshing
      const freshSettings = localStore.getOaSettings(id);
      const freshToken = decryptSecret(freshSettings.accessTokenEncrypted);
      if (freshToken && freshSettings.expiresAt && Date.now() < (freshSettings.expiresAt - 3600000)) {
        return freshToken;
      }

      const refreshToken = decryptSecret(freshSettings.refreshTokenEncrypted);
      const secretKey = decryptSecret(freshSettings.secretKeyEncrypted);
      const appId = freshSettings.appId;

      if (!refreshToken || !secretKey || !appId) {
        logger.warn('[OaTokenManager] Missing credentials for OAuth refresh');
        return freshToken || null;
      }

      logger.info(`[OaTokenManager] Refreshing Zalo OA access token for OA ${freshSettings.oaId || freshSettings.name}...`);

      try {
        const params = new URLSearchParams();
        params.append('app_id', appId);
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshToken);

        const response = await axios.post('https://oauth.zalo.me/v4/oa/access_token', params.toString(), {
          headers: {
            'secret_key': secretKey,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        });

        const data = response.data;
        if (data.error) {
          logger.error(`[OaTokenManager] Zalo OAuth returned error: ${data.error} - ${data.message || ''}`);
          return freshToken || null;
        }

        if (data.access_token && data.refresh_token) {
          const expiresInSec = Number(data.expires_in) || 86400;
          const newExpiresAt = Date.now() + (expiresInSec * 1000);

          localStore.updateOaTokens({
            accessTokenEncrypted: encryptSecret(data.access_token),
            refreshTokenEncrypted: encryptSecret(data.refresh_token),
            expiresAt: newExpiresAt
          }, id);

          logger.info(`[OaTokenManager] ✅ Successfully refreshed Zalo OA token. Next expiry: ${new Date(newExpiresAt).toISOString()}`);
          return data.access_token;
        }

        return freshToken || null;
      } catch (err) {
        logger.error(`[OaTokenManager] Failed to refresh Zalo OA token: ${err.message}`);
        return freshToken || null;
      }
    });
  }

  /**
   * Verify Webhook SHA256 MAC signature
   * Signature formula: sha256(appId + rawBody + timestamp + oaSecret)
   */
  verifyWebhookSignature({ signature = '', rawBody = '', timestamp = '', appId = '', secretKey = '' }) {
    if (!signature || !rawBody) return false;

    try {
      const resolvedSecret = secretKey || decryptSecret(localStore.getOaSettings()?.secretKeyEncrypted);
      const resolvedAppId = appId || localStore.getOaSettings()?.appId;

      if (!resolvedSecret || !resolvedAppId) return false;

      const dataToHash = `${resolvedAppId}${rawBody}${timestamp}${resolvedSecret}`;
      const calculatedHash = crypto.createHash('sha256').update(dataToHash, 'utf8').digest('hex');

      return crypto.timingSafeEqual(Buffer.from(calculatedHash, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      return false;
    }
  }

  /**
   * Background Watchdog to automatically refresh tokens before expiry
   */
  startWatchdog(intervalMs = 30 * 60 * 1000) {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(async () => {
      try {
        const settings = localStore.getOaSettings();
        if (settings && settings.isEnabled && settings.refreshTokenEncrypted) {
          // If token expires in less than 2 hours, trigger proactive refresh
          if (settings.expiresAt && Date.now() > (settings.expiresAt - 7200000)) {
            await this.getValidAccessToken();
          }
        }
      } catch (err) {
        logger.warn(`[OaTokenManager] Watchdog notice: ${err.message}`);
      }
    }, intervalMs);

    if (this.watchdogTimer.unref) {
      this.watchdogTimer.unref();
    }
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}

export const oaTokenManager = new OaTokenManager();
