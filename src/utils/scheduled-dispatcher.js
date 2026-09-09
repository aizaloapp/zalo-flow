import { localStore } from '../utils/local-store.js';
import { zaloClient } from '../zalo-client.js';
import { logger } from '../utils/logger.js';
import { resolveSpintax } from '../utils/spintax.js';

// Offline past-due threshold: 15 minutes
const MAX_PAST_DUE_MS = 15 * 60 * 1000;

export class ScheduledDispatcher {
  constructor() {
    this.timer = null;
    this.isTicking = false;
    this.inFlightIds = new Set();
  }

  /**
   * Khởi động background ticker (mặc định mỗi 15 giây, unref chống block event loop)
   */
  start(intervalMs = 15000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(err => {
        logger.error(`[Scheduled Dispatcher Ticker Error] ${err.message}`);
      });
    }, intervalMs).unref();
    logger.info('⏰ [Scheduled Dispatcher] Service started (Ticker: 15s)');
  }

  /**
   * Dừng timer an toàn
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('⏰ [Scheduled Dispatcher] Service stopped');
    }
  }

  /**
   * Xử lý 1 chu kỳ kiểm tra và gửi tin đến hạn (Atomic Claim + Anti-Ban RateLimiter)
   */
  async tick(customNowMs = null) {
    if (this.isTicking) return;
    this.isTicking = true;

    const nowMs = customNowMs || Date.now();

    try {
      // 1. Chỉ thực thi khi Zalo đã đăng nhập online
      if (!zaloClient.isLoggedIn) {
        return;
      }

      // 2. Atomic claim các bản ghi đến hạn trong SQLite (chuyển ngay sang processing)
      const dueItems = localStore.claimDueScheduledMessages(nowMs, 10);
      if (!dueItems || dueItems.length === 0) {
        return;
      }

      for (const item of dueItems) {
        // 3. Offline Past-Due Guard: Nếu trễ hơn 15 phút do máy tính tắt/sleep
        if (nowMs - item.scheduledAt > MAX_PAST_DUE_MS) {
          logger.warn(`⚠️ [Scheduled Dispatcher] Message ${item.id} for ${item.threadId} missed due to being offline > 15m`);
          localStore.updateScheduledMessage(item.id, {
            status: 'missed',
            error: 'Đã bỏ lỡ do thiết bị offline/tắt máy quá 15 phút so với giờ hẹn'
          });
          continue;
        }

        // 4. Memory Lock: Chống gửi lặp ID đang nằm trong hàng đợi RateLimiter
        if (this.inFlightIds.has(item.id)) {
          continue;
        }
        this.inFlightIds.add(item.id);

        // 5. Xử lý Spintax và biến cá nhân hóa {name}
        const resolvedText = resolveSpintax(item.message, {
          name: item.customerName || 'bạn',
          threadId: item.threadId
        });

        // 6. Gửi bất đồng bộ qua RateLimiter của zaloClient
        (async () => {
          try {
            // Double check trạng thái DB trước khi bắn tin (trường hợp user vừa bấm Hủy)
            const fresh = localStore.getScheduledMessageById(item.id);
            if (!fresh || fresh.status === 'cancelled') {
              logger.info(`🚫 [Scheduled Dispatcher] Message ${item.id} was cancelled by user, dropping dispatch`);
              return;
            }

            // Gửi tin nhắn qua RateLimiter (giãn cách >= 3s, SelfEchoShield 30s)
            await zaloClient.sendMessage(item.threadId, resolvedText, false, {
              isBot: false,
              senderName: 'Admin (Lịch hẹn)'
            });

            localStore.updateScheduledMessage(item.id, {
              status: 'sent',
              sentAt: Date.now()
            });
            logger.info(`✅ [Scheduled Dispatcher] Sent scheduled message ${item.id} to ${item.threadId} successfully`);
          } catch (sendErr) {
            logger.error(`❌ [Scheduled Dispatcher] Send error for ${item.id}: ${sendErr.message}`);
            localStore.updateScheduledMessage(item.id, {
              status: 'failed',
              error: sendErr.message || 'Lỗi khi gửi tin'
            });
          } finally {
            this.inFlightIds.delete(item.id);
          }
        })();
      }
    } catch (err) {
      logger.error(`[Scheduled Dispatcher tick error] ${err.message}`);
    } finally {
      this.isTicking = false;
    }
  }
}

export const scheduledDispatcher = new ScheduledDispatcher();
