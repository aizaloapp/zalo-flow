import { Zalo, LoginQRCallbackEventType, ThreadType, Reactions } from 'zca-js';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import sizeOf from 'image-size';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { logger } from './utils/logger.js';
import { saveEncryptedSession, loadEncryptedSession } from './utils/session-store.js';
import { defaultRateLimiter } from './utils/rate-limiter.js';
import { defaultSelfEchoShield } from './utils/self-echo.js';
import { defaultFloodDetector } from './utils/flood-detector.js';
import { localStore } from './utils/local-store.js';
import { parseMessage } from './utils/message-parser.js';

export class ZaloClient {
  constructor() {
    this.api = null;
    this.isLoggedIn = false;
    this.currentQrCode = null;
    this.currentQrDataUrl = null;
    this.inboundHandlers = [];
    this.sessionName = 'zalo_default';
    this.botInfo = null;
    this.userProfile = { userId: '', displayName: '', avatar: '' };
    this.qrStatusText = '';
    this.scannedUser = null;
    this.onQrCallback = null;
    this._deliveredQueue = new Map(); // Map<threadId, Set<msgId>>
    this._deliveredFlushTimer = null;
  }

  /**
   * Register a callback to process inbound messages from Zalo
   * @param {Function} handler - async function ({ message, text, senderId, threadId, isGroup, client })
   */
  onMessage(handler) {
    this.inboundHandlers.push(handler);
  }

  /**
   * Initialize Zalo connection (restore session or generate QR)
   */
  async initialize() {
    logger.info('Initializing Zalo Client...');
    const savedSession = loadEncryptedSession(this.sessionName);

    const imageMetadataGetter = (filePath) => {
      try {
        const stats = fs.statSync(filePath);
        let width = 800;
        let height = 600;
        try {
          const dimensions = sizeOf(filePath);
          if (dimensions?.width) width = dimensions.width;
          if (dimensions?.height) height = dimensions.height;
        } catch {}
        return { size: stats.size, width, height };
      } catch {
        return { size: 1024, width: 800, height: 600 };
      }
    };

    const zalo = new Zalo({
      imageMetadataGetter
    });

    if (savedSession) {
      logger.info('Found saved session. Attempting automatic restoration...');
      try {
        this.api = await zalo.login(savedSession);
        this.isLoggedIn = true;
        this.currentQrCode = null;
        this.currentQrDataUrl = null;
        logger.info('✅ Session restored successfully!');
        this._setupListener();
        this.syncInitialContacts();
        return;
      } catch (err) {
        logger.warn(`Failed to restore session: ${err.message}. Generating new QR code...`);
      }
    }

    logger.info('Starting QR Code login flow...');
    try {
      this.api = await zalo.loginQR({}, async (event) => {
        if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
          const qrCode = event.data.code;
          const qrImage = event.data.image;
          this.currentQrCode = qrCode;

          if (qrImage && qrImage.startsWith('data:image')) {
            this.currentQrDataUrl = qrImage;
          } else if (qrImage) {
            this.currentQrDataUrl = `data:image/png;base64,${qrImage}`;
          } else {
            try {
              this.currentQrDataUrl = await QRCode.toDataURL(qrCode);
            } catch {
              this.currentQrDataUrl = null;
            }
          }

          console.log('\n=================== [ ZALO LOGIN QR CODE ] ===================');
          qrcodeTerminal.generate(qrCode, { small: true });
          console.log('==============================================================');
          logger.info('👉 Scan the QR code above with your Zalo App on mobile.');
          logger.info(`👉 Or open your browser at: http://localhost:${process.env.PORT || 3000} to view the QR Code.`);
        } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
          logger.info(`📱 QR Code scanned by ${event.data.display_name}. Please confirm on mobile...`);
        } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
          logger.info('🔑 Received login credentials. Saving encrypted session...');
          saveEncryptedSession(this.sessionName, event.data);
        } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
          logger.warn('⌛ QR Code expired. Retrying...');
          if (event.actions && typeof event.actions.retry === 'function') {
            event.actions.retry();
          }
        }
      });

      this.isLoggedIn = true;
      this.currentQrCode = null;
      this.currentQrDataUrl = null;
      logger.info('🎉 Zalo login successful!');
      this._setupListener();
      this.syncInitialContacts();
    } catch (err) {
      logger.error(`Login failed: ${err.message}`);
    }
  }

  /**
   * Sync initial friend list, group list and past chat messages into LocalStore
   */
  async syncInitialContacts() {
    if (!this.api) return;
    try {
      // 1. Sync Friends
      if (typeof this.api.getAllFriends === 'function') {
        const friends = await this.api.getAllFriends();
        if (Array.isArray(friends)) {
          for (const f of friends) {
            const id = String(f.userId || f.uid || f.id || '');
            if (!id) continue;
            localStore.upsertConversation({
              id,
              name: f.displayName || f.zaloName || f.name || id,
              avatar: f.avatar || f.avatarUrl || '',
              isGroup: false
            });
          }
          logger.info(`📇 Initial contact sync: Synced ${friends.length} friends into LocalStore.`);
        }
      }

      // 2. Sync Groups & Group Info
      if (typeof this.api.getAllGroups === 'function') {
        const groupsRes = await this.api.getAllGroups();
        const groupMap = groupsRes?.gridVerMap || groupsRes || {};
        const groupIds = Object.keys(groupMap);
        for (const gid of groupIds) {
          let groupName = `Nhóm ${gid.substring(0, 8)}`;
          let groupAvatar = '';

          // Fetch group info if available
          if (typeof this.api.getGroupInfo === 'function') {
            try {
              const gInfo = await this.api.getGroupInfo(gid);
              if (gInfo?.gridInfoMap?.[gid]) {
                const info = gInfo.gridInfoMap[gid];
                groupName = info.name || groupName;
                groupAvatar = info.avt || info.avatar || '';
              }
            } catch {}
          }

          localStore.upsertConversation({
            id: gid,
            name: groupName,
            avatar: groupAvatar,
            isGroup: true
          });
        }
        if (groupIds.length > 0) {
          logger.info(`👥 Initial group sync: Synced ${groupIds.length} groups into LocalStore.`);
        }
      }

      // 3. Request Recent Old Messages for User and Group threads via WebSocket
      if (this.api.listener && typeof this.api.listener.requestOldMessages === 'function') {
        setTimeout(() => {
          try {
            this.api.listener.requestOldMessages(ThreadType.User);
            this.api.listener.requestOldMessages(ThreadType.Group);
            logger.info('📡 Requested recent chat history from Zalo via WebSocket.');
          } catch (e) {
            logger.warn(`Could not request old messages: ${e.message}`);
          }
        }, 1500);
      }
    } catch (err) {
      logger.warn(`⚠️ syncInitialContacts fallback: ${err.message}`);
    }
  }

  /**
   * Fetch historical messages for a specific thread (On-Demand Deep Sync)
   * @param {string} threadId - User ID or Group ID
   * @param {boolean} isGroup - Whether thread is a group
   * @param {number} count - Number of messages to retrieve
   */
  async fetchThreadHistory(threadId, isGroup = false, count = 50) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    let syncedCount = 0;

    if (isGroup && typeof this.api.getGroupChatHistory === 'function') {
      try {
        const hist = await this.api.getGroupChatHistory(threadId, count);
        const msgs = hist?.groupMsgs || [];
        for (const gm of msgs) {
          const parsed = parseMessage(gm);
          localStore.addMessage({
            id: String(gm.msgId || crypto.randomUUID()),
            threadId,
            senderId: String(gm.uidFrom || 'unknown'),
            senderName: gm.dName || gm.displayName || '',
            text: parsed.text,
            mediaType: parsed.type,
            mediaUrl: parsed.mediaUrl || '',
            quoteText: parsed.quoteText || '',
            quoteSender: parsed.quoteSender || '',
            isGroup: true,
            isSelf: Boolean(gm.isSelf),
            isBot: false,
            timestamp: gm.ts ? new Date(Number(gm.ts)).toISOString() : new Date().toISOString()
          }, { silent: true });
        }
        syncedCount = msgs.length;
      } catch (err) {
        logger.warn(`Group history API note for ${threadId}: ${err.message}`);
      }
    }

    // Universal WebSocket trigger for history buffer
    if (this.api.listener && typeof this.api.listener.requestOldMessages === 'function') {
      try {
        this.api.listener.requestOldMessages(isGroup ? ThreadType.Group : ThreadType.User);
      } catch {}
    }

    return syncedCount;
  }

  /**
   * 1-Click Bulk Deep-Sync:
   * Syncs contacts, groups, and loops through all recent conversations to fetch history
   * with anti-ban spacing (350ms per thread) and concurrency lock.
   * @param {object} options
   * @param {number} options.limitThreads - Max threads to sync (default: 30)
   * @param {number} options.limitPerThread - Messages per thread (default: 50)
   * @param {function} options.onProgress - Progress callback ({ current, total, threadName, percent, messagesSynced })
   * @returns {Promise<{ totalThreads: number, syncedThreads: number, totalMessagesSynced: number, durationMs: number }>}
   */
  async syncAllHistory({ limitThreads = 30, limitPerThread = 50, onProgress = null } = {}) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    if (this.isSyncingAll) {
      throw new Error('Đang có tiến trình đồng bộ lịch sử đang chạy, vui lòng đợi trong giây lát...');
    }

    this.isSyncingAll = true;
    const startTime = Date.now();

    try {
      logger.info('🚀 [Bulk Deep-Sync] Starting 1-Click Full History Sync...');

      // 1. Sync Friends & Groups into LocalStore
      await this.syncInitialContacts();

      // 2. Get list of active conversations from SQLite sorted by latest interaction
      const conversations = localStore.getConversations({ filter: 'all' }) || [];
      const targetThreads = conversations.slice(0, limitThreads);
      const total = targetThreads.length;

      let totalMessagesSynced = 0;
      let syncedThreads = 0;

      for (let i = 0; i < total; i++) {
        const conv = targetThreads[i];
        const threadId = conv.id;
        const isGroup = Boolean(conv.isGroup);
        const threadName = conv.name || threadId;

        try {
          const count = await this.fetchThreadHistory(threadId, isGroup, limitPerThread);
          totalMessagesSynced += count;
          syncedThreads++;

          if (typeof onProgress === 'function') {
            onProgress({
              current: i + 1,
              total,
              threadName,
              percent: Math.round(((i + 1) / total) * 100),
              messagesSynced: totalMessagesSynced
            });
          }
        } catch (err) {
          logger.warn(`[Bulk Deep-Sync] Error syncing ${threadName}: ${err.message}`);
        }

        // Anti-ban spacing (350ms between thread history requests)
        if (i < total - 1) {
          await new Promise(resolve => setTimeout(resolve, 350));
        }
      }

      // Trigger universal old messages request for user and group buffers
      if (this.api.listener && typeof this.api.listener.requestOldMessages === 'function') {
        try {
          this.api.listener.requestOldMessages(ThreadType.User);
          this.api.listener.requestOldMessages(ThreadType.Group);
        } catch {}
      }

      const durationMs = Date.now() - startTime;
      logger.info(`✅ [Bulk Deep-Sync] Completed: Synced ${syncedThreads}/${total} threads (${totalMessagesSynced} messages) in ${durationMs}ms.`);

      return {
        totalThreads: total,
        syncedThreads,
        totalMessagesSynced,
        durationMs
      };
    } finally {
      this.isSyncingAll = false;
    }
  }

  _setupListener() {
    if (!this.api || typeof this.api.listener !== 'object') return;

    logger.info('🎧 Starting Zalo message listener...');

    // 1. Real-time Incoming Messages
    this.api.listener.on('message', async (message) => {
      try {
        // Skip messages sent by the bot itself
        if (message.isSelf) return;

        const senderId = String(message.data?.uidFrom || message.uidFrom || message.senderId || '');
        const threadId = String(message.threadId || message.data?.idTo || senderId);
        const isGroup = Boolean(message.data?.idTo && message.data.idTo.startsWith('g_'));
        
        // Parse with Rich Media Parser
        const parsed = parseMessage(message);
        const text = parsed.text;

        if (!text && !parsed.mediaUrl) return;

        // Anti-ban: Flood Shield
        if (defaultFloodDetector.isFlooding(senderId)) {
          return;
        }

        // Anti-ban: Self-Echo Check
        if (text && defaultSelfEchoShield.isSelfEcho(text, senderId)) {
          return;
        }

        logger.info(`📨 [Inbound] ${isGroup ? 'Group' : 'Direct'} from ${senderId} [${parsed.type}]: "${text.substring(0, 50)}"`);

        // Record to LocalStore (Emits realtime SSE)
        const senderName = message.data?.dName || message.data?.displayName || senderId;
        const msgCliId = String(message.cliMsgId || message.data?.cliMsgId || message.data?.ts || message.ts || Date.now());
        localStore.addMessage({
          id: String(message.msgId || message.data?.msgId || crypto.randomUUID()),
          threadId,
          senderId,
          senderName,
          text,
          mediaType: parsed.type,
          mediaUrl: parsed.mediaUrl || '',
          quoteText: parsed.quoteText || '',
          quoteSender: parsed.quoteSender || '',
          isGroup,
          isSelf: false,
          isBot: false,
          timestamp: new Date().toISOString(),
          cliMsgId: msgCliId
        });

        // Dispatch to all registered adapters (Backward compatibility: raw text only)
        for (const handler of this.inboundHandlers) {
          try {
            await handler({
              message,
              text,
              senderId,
              threadId,
              isGroup,
              client: this
            });
          } catch (handlerErr) {
            logger.error(`Handler error: ${handlerErr.message}`);
          }
        }
      } catch (err) {
        logger.error(`Error processing inbound message: ${err.message}`);
      }
    });

    // 2. Historical / Old Messages via WebSocket
    this.api.listener.on('old_messages', (messages, threadType) => {
      try {
        if (!Array.isArray(messages) || messages.length === 0) return;
        logger.info(`📥 Ingested ${messages.length} historical messages from Zalo.`);

        for (const msg of messages) {
          const senderId = String(msg.uidFrom || msg.data?.uidFrom || msg.senderId || '');
          const threadId = String(msg.threadId || msg.data?.idTo || senderId);
          const isGroup = threadType === ThreadType.Group;
          
          const parsed = parseMessage(msg);
          if (!parsed.text && !parsed.mediaUrl) continue;
          if (!threadId) continue;

          const senderName = msg.dName || msg.data?.dName || msg.displayName || senderId;
          const ts = msg.ts ? new Date(Number(msg.ts)).toISOString() : (msg.data?.ts ? new Date(Number(msg.data.ts)).toISOString() : new Date().toISOString());
          const oldCliMsgId = String(msg.cliMsgId || msg.data?.cliMsgId || msg.ts || msg.data?.ts || Date.now());

          localStore.addMessage({
            id: String(msg.msgId || msg.data?.msgId || crypto.randomUUID()),
            threadId,
            senderId,
            senderName,
            text: parsed.text,
            mediaType: parsed.type,
            mediaUrl: parsed.mediaUrl || '',
            quoteText: parsed.quoteText || '',
            quoteSender: parsed.quoteSender || '',
            isGroup,
            isSelf: Boolean(msg.isSelf),
            isBot: false,
            timestamp: ts,
            cliMsgId: oldCliMsgId
          }, { silent: true });
        }
      } catch (err) {
        logger.warn(`Error processing old_messages: ${err.message}`);
      }
    });

    // 3. Real-time Incoming Reactions
    this.api.listener.on('reaction', (reaction) => {
      try {
        const data = reaction.data || reaction;
        const rMsg = data.content?.rMsg?.[0] || data.rMsg?.[0];
        const gMsgId = String(rMsg?.gMsgID || data.msgId || '');
        const rIcon = data.content?.rIcon || data.rIcon || '';
        const iconToEmoji = {
          '/-heart': '❤️',
          '/-strong': '👍',
          ':>': '😂',
          ':o': '😮',
          ':-((': '😭',
          ':-h': '😡'
        };
        const emoji = iconToEmoji[rIcon] || rIcon;
        if (gMsgId && emoji) {
          logger.info(`✨ [Inbound Reaction] Realtime reaction ${emoji} on msg ${gMsgId}`);
          localStore.updateMessageReaction(gMsgId, emoji);
        }
      } catch (err) {
        logger.warn(`Error processing reaction event: ${err.message}`);
      }
    });

    // 4. Real-time Delivered Messages Batch Queue
    this.api.listener.on('delivered_messages', (messages) => {
      try {
        if (!Array.isArray(messages) || messages.length === 0) return;
        for (const dm of messages) {
          if (!dm) continue;
          const threadId = String(dm.data?.threadId || dm.data?.idTo || dm.threadId || '');
          const msgIds = dm.data?.msgIds || dm.msgIds || [];
          if (!threadId || !Array.isArray(msgIds) || msgIds.length === 0) continue;

          if (!this._deliveredQueue.has(threadId)) {
            this._deliveredQueue.set(threadId, new Set());
          }
          for (const id of msgIds) {
            if (id) this._deliveredQueue.get(threadId).add(String(id));
          }
        }
      } catch (err) {
        logger.warn(`Error processing delivered_messages: ${err.message}`);
      }
    });

    if (this._deliveredFlushTimer) clearInterval(this._deliveredFlushTimer);
    this._deliveredFlushTimer = setInterval(() => {
      this.flushDeliveredBuffer();
    }, 3000);
    if (this._deliveredFlushTimer.unref) this._deliveredFlushTimer.unref();

    // 5. Real-time Undo / Recall Messages Inbound
    this.api.listener.on('undo', (undoData) => {
      try {
        const msgId = String(undoData.data?.msgId || undoData.msgId || '');
        if (msgId) {
          logger.info(`🗑️ [Undo Inbound] Message ${msgId} recalled by sender`);
          localStore.markMessageRecalled(msgId);
        }
      } catch (err) {
        logger.warn(`Error processing undo event: ${err.message}`);
      }
    });

    this.api.listener.start();
  }

  /**
   * Flush queued delivered messages to database and broadcast SSE
   */
  flushDeliveredBuffer() {
    if (this._deliveredQueue.size === 0) return;
    for (const [threadId, msgIdSet] of this._deliveredQueue.entries()) {
      const ids = Array.from(msgIdSet);
      if (ids.length > 0) {
        localStore.updateMessagesStatus(ids, 'delivered');
        localStore.emit('messagesDelivered', { threadId, msgIds: ids });
      }
    }
    this._deliveredQueue.clear();
  }

  /**
   * Send a text message to a Zalo user or group with Rate Limiting and Self-Echo Shield
   * @param {string} threadId - User ID or Group ID
   * @param {string} text - Message content
   * @param {boolean} isGroup - Whether threadId is a group
   * @param {Object} options - { isBot, senderName }
   */
  async sendMessage(threadId, text, isGroup = false, { isBot = false, senderName = 'Admin (Bạn)' } = {}) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    // Schedule through Anti-Ban Rate Limiter
    return defaultRateLimiter.schedule(async () => {
      // Record to self-echo shield
      defaultSelfEchoShield.recordSent(text, threadId);

      const senderTag = isBot ? '🤖 [AI Bot]' : '📤 [Outbound]';
      logger.info(`${senderTag} Sending to ${threadId}: "${String(text).substring(0, 40)}..."`);
      
      const threadType = isGroup ? ThreadType.Group : ThreadType.User;
      const res = await this.api.sendMessage(text, threadId, threadType);

      let outMsgId = crypto.randomUUID();
      let outCliMsgId = '';
      if (res && typeof res === 'object') {
        const extractedId = res.message?.msgId || res.data?.msgId || res.msgId || res.messageId || res.data?.messageId;
        const extractedCliId = res.message?.cliMsgId || res.data?.cliMsgId || res.cliMsgId || res.clientMsgId || res.data?.clientMsgId;
        if (extractedId) outMsgId = String(extractedId);
        if (extractedCliId) outCliMsgId = String(extractedCliId);
      }

      // Record outbound to LocalStore
      localStore.addMessage({
        id: outMsgId,
        threadId,
        senderId: isBot ? 'ai_bot' : 'self',
        senderName: isBot ? 'Bot AI (Tự động)' : senderName,
        text,
        mediaType: 'text',
        isGroup,
        isSelf: true,
        isBot: Boolean(isBot),
        status: 'sent',
        isRecalled: 0,
        cliMsgId: outCliMsgId,
        timestamp: new Date().toISOString()
      });

      return res;
    });
  }

  /**
   * 1. Thả reaction cảm xúc lên tin nhắn Zalo
   * @param {string} msgId - ID tin nhắn cần thả cảm xúc
   * @param {string} threadId - ID cuộc trò chuyện
   * @param {string} emoji - Icon cảm xúc (❤️, 👍, 😂, 😮, 😭, 😡)
   * @param {boolean} isGroup - Cuộc trò chuyện là nhóm hay cá nhân
   */
  async addReaction(msgId, threadId, emoji, isGroup = false) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    const type = isGroup ? ThreadType.Group : ThreadType.User;

    // Look up original message from localStore to obtain the real cliMsgId
    let origMsg = localStore.getMessage(msgId);
    let targetCliMsgId = origMsg?.cliMsgId;

    if (!targetCliMsgId && origMsg?.timestamp) {
      targetCliMsgId = String(new Date(origMsg.timestamp).getTime());
    }
    if (!targetCliMsgId) {
      targetCliMsgId = String(msgId);
    }

    const dest = {
      data: {
        msgId: String(msgId),
        cliMsgId: String(targetCliMsgId)
      },
      threadId: String(threadId),
      type: type
    };

    const reactionMap = {
      '❤️': Reactions.HEART,
      '👍': Reactions.LIKE,
      '😂': Reactions.HAHA,
      '😮': Reactions.WOW,
      '😭': Reactions.CRY,
      '😡': Reactions.ANGRY
    };

    const icon = reactionMap[emoji] || Reactions.HEART;
    logger.info(`✨ [Reaction] Adding ${emoji} (${icon}) to msg ${msgId} (cliMsgId: ${targetCliMsgId}) in thread ${threadId}`);
    return await this.api.addReaction(icon, dest);
  }

  /**
   * 2. Thu hồi tin nhắn đã gửi (Message Recall / Undo)
   * @param {string} msgId - ID tin nhắn cần thu hồi
   * @param {string} threadId - ID cuộc trò chuyện
   * @param {boolean} isGroup - Nhóm hay cá nhân
   */
  async undoMessage(msgId, threadId, isGroup = false) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    const origMsg = localStore.getMessage(msgId);
    let targetCliMsgId = origMsg?.cliMsgId;

    if (!targetCliMsgId && origMsg?.timestamp) {
      targetCliMsgId = String(new Date(origMsg.timestamp).getTime());
    }
    if (!targetCliMsgId) {
      targetCliMsgId = String(msgId);
    }

    const type = isGroup ? ThreadType.Group : ThreadType.User;
    logger.info(`🗑️ [Undo Outbound] Recalling msg ${msgId} (cliMsgId: ${targetCliMsgId}) in thread ${threadId}`);

    const result = await this.api.undo(
      { msgId: String(msgId), cliMsgId: String(targetCliMsgId) },
      String(threadId),
      type
    );

    // Mark recalled in LocalStore
    localStore.markMessageRecalled(msgId);
    return result;
  }

  /**
   * 3. Tra cứu thông tin người dùng Zalo qua Số Điện Thoại (Guardrail #7 Anti-Ban Safe)
   * @param {string} phoneNumber - Số điện thoại cần tra cứu
   */
  async lookupPhoneNumber(phoneNumber) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    return defaultRateLimiter.schedule(async () => {
      logger.info(`🔍 [Phone Lookup] Finding Zalo user by phone: ${phoneNumber}`);
      const res = await this.api.findUser(phoneNumber);
      if (!res || !res.uid) {
        throw new Error('Số điện thoại chưa đăng ký Zalo hoặc đã tắt tính năng cho phép tìm kiếm.');
      }

      let isFriend = false;
      try {
        const reqStatus = await this.api.getFriendRequestStatus(String(res.uid));
        if (reqStatus && (reqStatus.is_friend === 1 || reqStatus.is_friend === true)) {
          isFriend = true;
        }
      } catch (_) {
        try {
          const uInfo = await this.api.getUserInfo(String(res.uid));
          const p = uInfo?.changed_profiles?.[String(res.uid)];
          if (p && p.isFr === 1) isFriend = true;
        } catch (_) {}
      }

      return {
        uid: String(res.uid),
        displayName: res.display_name || res.zalo_name || 'Người dùng Zalo',
        avatar: res.avatar || '',
        isFriend,
        canMessage: isFriend === true
      };
    });
  }

  /**
   * 2. Gửi tin nhắn kèm trích dẫn (Quote Reply)
   * @param {string} threadId - ID người nhận / nhóm
   * @param {string} text - Nội dung câu trả lời
   * @param {object} quoteData - Dữ liệu tin nhắn gốc cần trích dẫn
   * @param {boolean} isGroup - Nhóm hay cá nhân
   */
  async sendMessageWithQuote(threadId, text, quoteData, isGroup = false) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    return defaultRateLimiter.schedule(async () => {
      defaultSelfEchoShield.recordSent(text, threadId);
      logger.info(`📤 [Quote Outbound] Replying to ${threadId}: "${String(text).substring(0, 40)}..."`);

      const threadType = isGroup ? ThreadType.Group : ThreadType.User;

      let origMsg = null;
      if (quoteData?.msgId) {
        origMsg = localStore.getMessage(quoteData.msgId);
      }

      const uidFrom = quoteData?.uidFrom || origMsg?.senderId || threadId;
      const msgId = quoteData?.msgId || origMsg?.id || '0';
      const cliMsgId = quoteData?.cliMsgId || msgId;
      const ts = quoteData?.ts || (origMsg?.timestamp ? new Date(origMsg.timestamp).getTime() : Date.now());
      const quoteText = quoteData?.content || quoteData?.text || origMsg?.text || '';
      const msgType = quoteData?.msgType || (origMsg?.mediaType === 'image' ? 'chat.photo' : 'chat.message');

      const formattedQuote = {
        content: String(quoteText),
        msgType: msgType,
        propertyExt: quoteData?.propertyExt || {},
        uidFrom: String(uidFrom),
        msgId: String(msgId),
        cliMsgId: String(cliMsgId),
        ts: Number(ts),
        ttl: 0
      };

      const messagePayload = {
        msg: text,
        quote: formattedQuote
      };

      let res;
      try {
        res = await this.api.sendMessage(messagePayload, threadId, threadType);
      } catch (err) {
        logger.warn(`Quote send fallback to plain text: ${err.message}`);
        res = await this.api.sendMessage(text, threadId, threadType);
      }

      let quoteMsgId = crypto.randomUUID();
      let quoteCliMsgId = '';
      if (res && typeof res === 'object') {
        const extractedId = res.message?.msgId || res.data?.msgId || res.msgId || res.messageId || res.data?.messageId;
        const extractedCliId = res.message?.cliMsgId || res.data?.cliMsgId || res.cliMsgId || res.clientMsgId || res.data?.clientMsgId;
        if (extractedId) quoteMsgId = String(extractedId);
        if (extractedCliId) quoteCliMsgId = String(extractedCliId);
      }

      localStore.addMessage({
        id: quoteMsgId,
        threadId,
        senderId: 'self',
        senderName: 'Admin (Bạn)',
        text,
        mediaType: 'text',
        quoteText: quoteText,
        quoteSender: quoteData?.senderName || origMsg?.senderName || uidFrom,
        isGroup,
        isSelf: true,
        isBot: false,
        status: 'sent',
        isRecalled: 0,
        cliMsgId: quoteCliMsgId,
        timestamp: new Date().toISOString()
      });

      return res;
    });
  }

  /**
   * 3. Upload & gửi ảnh / tệp tin đính kèm
   * @param {string} threadId - ID người nhận
   * @param {string|string[]} filePaths - Đường dẫn file trên ổ đĩa
   * @param {boolean} isGroup - Nhóm hay cá nhân
   */
  async uploadAttachment(threadId, filePaths, isGroup = false, meta = {}) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    return defaultRateLimiter.schedule(async () => {
      const conv = localStore.getConversation(threadId);
      const isGroupResolved = conv ? Boolean(conv.isGroup) : Boolean(isGroup === true || isGroup === 'true' || isGroup === '1');
      const threadType = isGroupResolved ? ThreadType.Group : ThreadType.User;
      const rawPaths = Array.isArray(filePaths) ? filePaths : [filePaths];
      const paths = rawPaths.map(p => typeof p === 'string' ? path.resolve(p).replace(/\\/g, '/') : p);
      logger.info(`📤 [Attachment Outbound] Sending ${paths.length} file(s) to ${threadId} (type: ${threadType === ThreadType.Group ? 'Group' : 'User'})...`);

      // Must call api.sendMessage with attachments to upload AND deliver the message into the chat
      const res = await this.api.sendMessage({
        msg: meta.caption || '',
        attachments: paths
      }, threadId, threadType);

      logger.info(`📥 [Attachment Outbound Result] ${JSON.stringify(res)}`);

      let attachMsgId = crypto.randomUUID();
      let attachCliMsgId = '';
      if (res && typeof res === 'object') {
        const attachRes = Array.isArray(res.attachment) ? res.attachment[0] : res.attachment;
        const targetObj = attachRes?.data || attachRes || res.message?.data || res.message || res.data || res;
        const extractedId = targetObj.msgId || targetObj.messageId || targetObj.id;
        const extractedCliId = targetObj.cliMsgId || targetObj.clientMsgId;
        if (extractedId) attachMsgId = String(extractedId);
        if (extractedCliId) attachCliMsgId = String(extractedCliId);
      }

      const items = (meta.items && Array.isArray(meta.items) && meta.items.length > 0)
        ? meta.items
        : [{
            mediaUrl: meta.mediaUrl || '',
            mediaType: meta.mediaType || 'image',
            originalName: meta.originalName || (meta.mediaType === 'image' ? '[Hình ảnh]' : '[Tập tin]')
          }];

      logger.info(`💾 [Attachment Storage] Recording ${items.length} individual attachment message(s) to localStore...`);

      const baseTime = Date.now();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemMediaType = item.mediaType || 'image';
        const itemMediaUrl = item.mediaUrl || '';
        const itemText = item.originalName || (itemMediaType === 'image' ? '[Hình ảnh]' : '[Tập tin]');
        const subMsgId = i === 0 ? attachMsgId : `${attachMsgId}_${i}`;
        const subCliMsgId = attachCliMsgId ? (i === 0 ? attachCliMsgId : `${attachCliMsgId}_${i}`) : '';

        defaultSelfEchoShield.recordSent(itemText, threadId);

        localStore.addMessage({
          id: subMsgId,
          threadId,
          senderId: 'self',
          senderName: 'Admin (Bạn)',
          text: itemText,
          mediaType: itemMediaType,
          mediaUrl: itemMediaUrl,
          isGroup: isGroupResolved,
          isSelf: true,
          isBot: false,
          status: 'sent',
          isRecalled: 0,
          cliMsgId: subCliMsgId,
          timestamp: new Date(baseTime + i * 50).toISOString()
        });
      }

      return res;
    });
  }

  /**
   * 4. Chuyển tiếp tin nhắn sang danh sách hội thoại khác
   * @param {object} msgPayload - Payload tin nhắn cần chuyển tiếp
   * @param {string[]} targetThreadIds - Danh sách threadId nhận
   * @param {boolean} isGroup - Nhóm hay cá nhân
   */
  async forwardMessage(msgPayload, targetThreadIds, isGroup = false) {
    if (!this.api || !this.isLoggedIn) {
      throw new Error('Zalo Client is not logged in.');
    }

    const threadType = isGroup ? ThreadType.Group : ThreadType.User;
    logger.info(`📤 [Forward Outbound] Forwarding msg to ${targetThreadIds.join(', ')}`);
    return await this.api.forwardMessage(msgPayload, targetThreadIds, threadType);
  }

  /**
   * Get current connection status & profile for Web UI / Health Check
   */
  getStatus() {
    return {
      isLoggedIn: this.isLoggedIn,
      hasQrWaiting: Boolean(this.currentQrDataUrl),
      qrDataUrl: this.currentQrDataUrl,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get detailed profile of the connected Zalo account
   */
  getAccountProfile() {
    let uid = this.userProfile?.userId || '';
    let displayName = this.userProfile?.displayName || '';
    let avatar = this.userProfile?.avatar || '';

    if (this.api) {
      try {
        const ctx = typeof this.api.getContext === 'function' ? this.api.getContext() : null;
        if (ctx?.uid || ctx?.userId) {
          uid = String(ctx.uid || ctx.userId);
        }
        if (!displayName) {
          displayName = ctx?.displayName || ctx?.name || (uid ? `Zalo User (${uid.substring(0, 6)}...)` : 'Zalo User');
        }
        if (!avatar) {
          avatar = ctx?.avatar || ctx?.avatarUrl || '';
        }
      } catch {}
    }

    return {
      isLoggedIn: this.isLoggedIn,
      userId: uid,
      displayName: displayName || (this.isLoggedIn ? 'Tài Khoản Zalo' : 'Chưa Đăng Nhập'),
      avatar: avatar,
      hasQrWaiting: Boolean(this.currentQrDataUrl),
      qrDataUrl: this.currentQrDataUrl,
      qrStatusText: this.qrStatusText || (this.currentQrDataUrl ? 'Mở app Zalo trên điện thoại quét mã bên dưới để đăng nhập:' : ''),
      scannedUser: this.scannedUser || null
    };
  }

  /**
   * Request a fresh QR Code Login flow (for new login or account switching)
   * @param {Function} onQrUpdate - Callback when QR changes, is scanned, or succeeds
   */
  async requestNewQrLogin(onQrUpdate = null) {
    this.onQrCallback = onQrUpdate;
    this.isLoggedIn = false;
    this.api = null;
    this.currentQrCode = null;
    this.currentQrDataUrl = null;
    this.qrStatusText = 'Đang khởi tạo mã QR...';
    this.scannedUser = null;

    const imageMetadataGetter = (filePath) => {
      try {
        const stats = fs.statSync(filePath);
        let width = 800;
        let height = 600;
        try {
          const dimensions = sizeOf(filePath);
          if (dimensions?.width) width = dimensions.width;
          if (dimensions?.height) height = dimensions.height;
        } catch {}
        return { size: stats.size, width, height };
      } catch {
        return { size: 1024, width: 800, height: 600 };
      }
    };

    const zalo = new Zalo({ imageMetadataGetter });

    zalo.loginQR({}, async (event) => {
      if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
        const qrCode = event.data.code;
        const qrImage = event.data.image;
        this.currentQrCode = qrCode;

        if (qrImage && qrImage.startsWith('data:image')) {
          this.currentQrDataUrl = qrImage;
        } else if (qrImage) {
          this.currentQrDataUrl = `data:image/png;base64,${qrImage}`;
        } else {
          try {
            this.currentQrDataUrl = await QRCode.toDataURL(qrCode);
          } catch {
            this.currentQrDataUrl = null;
          }
        }

        this.qrStatusText = 'Mở app Zalo trên điện thoại quét mã bên dưới để đăng nhập:';
        this.scannedUser = null;

        if (typeof this.onQrCallback === 'function') {
          this.onQrCallback(this.getAccountProfile());
        }
      } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
        this.scannedUser = event.data?.display_name || 'Người dùng';
        this.qrStatusText = `📱 Đã quét bởi ${this.scannedUser}. Vui lòng bấm 'Cho phép' trên điện thoại...`;
        if (typeof this.onQrCallback === 'function') {
          this.onQrCallback(this.getAccountProfile());
        }
      } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
        logger.info('🔑 Received login credentials. Saving encrypted session...');
        saveEncryptedSession(this.sessionName, event.data);
        this.userProfile = {
          userId: String(event.data?.uid || event.data?.userId || ''),
          displayName: event.data?.display_name || event.data?.name || 'Zalo User',
          avatar: event.data?.avatar || ''
        };
      } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
        this.qrStatusText = '⌛ Mã QR đã hết hạn. Đang tự động tạo lại mã mới...';
        if (typeof this.onQrCallback === 'function') {
          this.onQrCallback(this.getAccountProfile());
        }
        if (event.actions && typeof event.actions.retry === 'function') {
          event.actions.retry();
        }
      }
    }).then((api) => {
      this.api = api;
      this.isLoggedIn = true;
      this.currentQrCode = null;
      this.currentQrDataUrl = null;
      this.qrStatusText = '';
      this.scannedUser = null;
      logger.info('🎉 Zalo login successful!');
      this._setupListener();
      this.syncInitialContacts();

      if (typeof this.onQrCallback === 'function') {
        this.onQrCallback(this.getAccountProfile());
      }
    }).catch((err) => {
      logger.error(`Login error: ${err.message}`);
      this.qrStatusText = `Lỗi đăng nhập: ${err.message}`;
      if (typeof this.onQrCallback === 'function') {
        this.onQrCallback(this.getAccountProfile());
      }
    });

    return this.getAccountProfile();
  }

  /**
   * Logout from Zalo account and remove encrypted session file
   */
  async logout() {
    this.isLoggedIn = false;
    this.api = null;
    this.currentQrCode = null;
    this.currentQrDataUrl = null;
    this.userProfile = { userId: '', displayName: '', avatar: '' };
    this.qrStatusText = '';
    this.scannedUser = null;

    const sessionFile = path.join(process.cwd(), 'sessions', `${this.sessionName}.enc`);
    if (fs.existsSync(sessionFile)) {
      try {
        fs.unlinkSync(sessionFile);
        logger.info(`🗑️ Removed encrypted session file: ${sessionFile}`);
      } catch (e) {
        logger.warn(`Could not remove session file: ${e.message}`);
      }
    }

    return this.getAccountProfile();
  }
}

export const zaloClient = new ZaloClient();
