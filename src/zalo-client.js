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
    this.qrFlowId = 0; // Flow generation token to prevent zombie QR loops
    this.friendUids = new Set(); // In-memory cache of current account friends
    this.groupUids = new Set(); // In-memory cache of current account groups
    this._deliveredQueue = new Map(); // Map<threadId, Set<msgId>>
    this._deliveredFlushTimer = null;
    this.strangerProfileCache = new Map(); // Bounded LRU cache for stranger profiles
    this.maxStrangerCacheSize = 500;
    this.strangerCacheTtlMs = 24 * 60 * 60 * 1000; // 24 hours
    this.pendingStrangerResolves = new Map(); // Anti-race lock for pending requests
    this.startupSyncState = { stage: 'idle', message: '', errorDetail: null };
    this.onStartupSyncCallback = null;
  }

  /**
   * Update and broadcast startup synchronization state
   * @param {'idle'|'contacts'|'groups'|'messages'|'ready'|'error'} stage
   * @param {string} message
   * @param {string|null} errorDetail
   */
  _setStartupSyncState(stage, message = '', errorDetail = null) {
    this.startupSyncState = { stage, message, errorDetail, timestamp: Date.now() };
    if (typeof this.onStartupSyncCallback === 'function') {
      try {
        this.onStartupSyncCallback(this.startupSyncState);
      } catch (err) {
        logger.warn(`[Startup Sync Callback] Error: ${err.message}`);
      }
    }
  }

  /**
   * Register listener for startup sync progress events
   * @param {Function} callback - ({ stage, message, errorDetail, timestamp })
   */
  onStartupSync(callback) {
    this.onStartupSyncCallback = callback;
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
      imageMetadataGetter,
      selfListen: true
    });

    if (savedSession) {
      logger.info('Found saved session. Attempting automatic restoration...');
      try {
        this.api = await zalo.login(savedSession);
        this.isLoggedIn = true;
        this.currentQrCode = null;
        this.currentQrDataUrl = null;
        logger.info('✅ Session restored successfully!');
        await this.syncAccountProfile();
        this._setupListener();
        this.syncInitialContacts();
        return;
      } catch (err) {
        logger.warn(`Failed to restore session: ${err.message}. Generating new QR code...`);
      }
    }

    logger.info('Starting QR Code login flow...');
    const currentFlow = ++this.qrFlowId;
    try {
      this.api = await zalo.loginQR({}, async (event) => {
        if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
          if (this.isLoggedIn || this.qrFlowId !== currentFlow) return;
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
          if (this.isLoggedIn || this.qrFlowId !== currentFlow) return;
          logger.info(`📱 QR Code scanned by ${event.data.display_name}. Please confirm on mobile...`);
        } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
          logger.info('🔑 Received login credentials. Saving encrypted session...');
          saveEncryptedSession(this.sessionName, event.data);
          this.userProfile = {
            userId: String(event.data?.uid || event.data?.userId || ''),
            displayName: event.data?.display_name || event.data?.name || 'Zalo User',
            avatar: event.data?.avatar || ''
          };
        } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
          if (this.isLoggedIn || this.qrFlowId !== currentFlow) {
            logger.info('[QR Guard] Session is online or newer flow active. Skipping expired QR retry.');
            return;
          }
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
      await this.syncAccountProfile();
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
      this._setStartupSyncState('contacts', 'Đang nạp danh bạ bạn bè Zalo...');

      // 1. Sync Friends
      if (typeof this.api.getAllFriends === 'function') {
        const friends = await this.api.getAllFriends();
        if (Array.isArray(friends)) {
          this.friendUids.clear();
          for (const f of friends) {
            const id = String(f.userId || f.uid || f.id || '');
            if (!id) continue;
            this.friendUids.add(id);
            localStore.upsertConversation({
              id,
              name: f.displayName || f.zaloName || f.name || id,
              avatar: f.avatar || f.avatarUrl || '',
              isGroup: false
            });
          }
          logger.info(`📇 Initial contact sync: Synced ${friends.length} friends into LocalStore and in-memory cache.`);
        }
      }

      this._setStartupSyncState('groups', 'Đang đồng bộ danh sách nhóm...');

      // 2. Sync Groups & Group Info
      if (typeof this.api.getAllGroups === 'function') {
        const groupsRes = await this.api.getAllGroups();
        const groupMap = groupsRes?.gridVerMap || groupsRes || {};
        const groupIds = Object.keys(groupMap);
        this.groupUids.clear();
        for (const gid of groupIds) {
          this.groupUids.add(String(gid));
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
          const healed = localStore.reconcileGroupsWithGroundTruth(this.groupUids);
          if (healed > 0) {
            logger.info(`👥 [Ground-Truth Reconcile] Corrected ${healed} misclassified conversations back to isGroup=0.`);
          }
        }
      }

      this._setStartupSyncState('messages', 'Đang cập nhật tin nhắn mới nhất...');

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

        // Transition to ready state after short buffer allowing socket frames to arrive
        setTimeout(() => {
          this._setStartupSyncState('ready', 'Đồng bộ hoàn tất! Dữ liệu đã sẵn sàng.');
        }, 4000);
      } else {
        this._setStartupSyncState('ready', 'Đồng bộ hoàn tất! Dữ liệu đã sẵn sàng.');
      }
    } catch (err) {
      logger.warn(`⚠️ syncInitialContacts fallback: ${err.message}`);
      this._setStartupSyncState('error', 'Gặp sự cố khi nạp dữ liệu: ' + err.message, err.message);
    }
  }

  /**
   * Check if a specific UID is in current account's friend list (In-Memory)
   * @param {string} uid
   * @returns {boolean}
   */
  isFriend(uid) {
    if (!uid) return false;
    return this.friendUids.has(String(uid));
  }

  /**
   * Sync connected account profile (Real name, avatar, own UID)
   */
  async syncAccountProfile() {
    if (!this.api) return;
    try {
      let profileData = null;
      if (typeof this.api.fetchAccountInfo === 'function') {
        try {
          const res = await this.api.fetchAccountInfo();
          profileData = res?.profile || res?.data?.profile || res?.data || res;
        } catch (e) {
          logger.warn(`[ProfileSync] fetchAccountInfo error: ${e.message}`);
        }
      }

      const ownUid = typeof this.api.getOwnId === 'function' ? String(this.api.getOwnId() || '') : '';
      const ctx = typeof this.api.getContext === 'function' ? this.api.getContext() : null;

      const finalUid = ownUid || String(ctx?.uid || ctx?.userId || profileData?.userId || this.userProfile?.userId || '');

      // Check all possible sources for display name
      let candidateName = 
        profileData?.displayName ||
        profileData?.name ||
        profileData?.zaloName ||
        this.userProfile?.displayName ||
        ctx?.displayName ||
        ctx?.name;

      if (candidateName && candidateName.startsWith('Zalo User')) {
        candidateName = '';
      }

      // Fallback: lookup in SQLite database for real name
      if (!candidateName && finalUid) {
        try {
          const row = localStore.db.prepare("SELECT senderName FROM messages WHERE senderId = ? AND senderName != '' AND senderName NOT LIKE 'Zalo User%' LIMIT 1").get(finalUid);
          if (row?.senderName) candidateName = row.senderName;
        } catch {}
      }

      const finalName = candidateName || (finalUid ? `Zalo User (${finalUid.substring(0, 6)}...)` : 'Zalo User');

      // Check all possible sources for avatar
      let finalAvatar = 
        profileData?.avatar ||
        profileData?.avatarUrl ||
        this.userProfile?.avatar ||
        ctx?.avatar ||
        ctx?.avatarUrl || '';

      // Fallback: lookup in SQLite database for real avatar
      if (!finalAvatar && finalUid) {
        try {
          const row = localStore.db.prepare("SELECT avatar FROM conversations WHERE (id = ? OR name = ?) AND avatar != '' LIMIT 1").get(finalUid, finalName);
          if (row?.avatar) finalAvatar = row.avatar;
        } catch {}
      }

      this.userProfile = {
        userId: finalUid,
        displayName: finalName,
        avatar: finalAvatar
      };
      logger.info(`👤 Zalo Profile synced: ${this.userProfile.displayName} (UID: ${this.userProfile.userId})`);
    } catch (err) {
      logger.warn(`[ProfileSync] Failed: ${err.message}`);
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
        const senderId = String(message.data?.uidFrom || message.uidFrom || message.senderId || '');
        const threadId = String(message.threadId || (message.isSelf ? message.data?.idTo : message.data?.idTo) || senderId);
        const isGroup = Boolean(
          message.type === ThreadType.Group || 
          message.type === 1 || 
          message.constructor?.name === 'GroupMessage' ||
          (this.groupUids && this.groupUids.has(threadId)) ||
          localStore.getConversation(threadId)?.isGroup
        );
        
        // Parse with Rich Media Parser
        const parsed = parseMessage(message);
        const text = parsed.text;
        const safeText = String(text || '');

        if (!safeText && !parsed.mediaUrl) return;

        // Xử lý gói tin đồng bộ từ chính tài khoản (Self Message / Multi-Device Sync từ điện thoại hoặc PC)
        if (message.isSelf) {
          // 1. Nếu tin nhắn do chính Zalo-Flow vừa gửi đi qua Web Dashboard/Bot (có trong SelfEchoShield)
          // Chỉ kiểm tra Shield khi có text để tránh false-positive với ảnh/tệp không caption
          if (safeText.trim()) {
            const isEcho = defaultSelfEchoShield.isSelfEcho(safeText, threadId);
            if (isEcho) {
              logger.debug(`[Self-Echo] Ignored echo of Zalo-Flow outbound message to ${threadId}`);
              return;
            }
          }

          // 2. Kiểm tra trùng lặp theo msgId trong SQLite
          const incomingMsgId = String(message.msgId || message.data?.msgId || '');
          if (incomingMsgId && localStore.getMessage(incomingMsgId)) {
            return;
          }

          // 3. Đích thị là tin nhắn Admin vừa gõ gửi từ Zalo Mobile App hoặc Zalo PC ngoài:
          logger.info(`📱 [Multi-Device Sync] Synced message from mobile/external device to ${threadId} [${parsed.type}]: "${safeText.substring(0, 40)}"`);

          const senderName = this.userProfile?.displayName || 'Admin (Bạn)';
          const msgCliId = String(message.cliMsgId || message.data?.cliMsgId || message.data?.ts || message.ts || Date.now());

          localStore.addMessage({
            id: incomingMsgId || crypto.randomUUID(),
            threadId,
            senderId: 'self',
            senderName,
            text: safeText,
            mediaType: parsed.type,
            mediaUrl: parsed.mediaUrl || '',
            quoteText: parsed.quoteText || '',
            quoteSender: parsed.quoteSender || '',
            isGroup,
            isSelf: true,
            isBot: false,
            status: 'sent',
            timestamp: new Date().toISOString(),
            cliMsgId: msgCliId
          });

          // Không dispatch vào inboundHandlers (tránh bot tự trả lời tin nhắn của Admin)
          return;
        }

        // Anti-ban: Flood Shield (chỉ áp dụng cho tin nhắn từ khách hàng)
        if (defaultFloodDetector.isFlooding(senderId)) {
          return;
        }

        // Anti-ban: Self-Echo Check
        if (safeText && defaultSelfEchoShield.isSelfEcho(safeText, senderId)) {
          return;
        }

        logger.info(`📨 [Inbound] ${isGroup ? 'Group' : 'Direct'} from ${senderId} [${parsed.type}]: "${safeText.substring(0, 50)}"`);

        // Record to LocalStore (Emits realtime SSE)
        const senderName = message.data?.dName || message.data?.displayName || senderId;
        const msgCliId = String(message.cliMsgId || message.data?.cliMsgId || message.data?.ts || message.ts || Date.now());
        localStore.addMessage({
          id: String(message.msgId || message.data?.msgId || crypto.randomUUID()),
          threadId,
          senderId,
          senderName,
          text: safeText,
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

        // Dispatch to all registered adapters (Backward compatibility + Rich Media support)
        for (const handler of this.inboundHandlers) {
          try {
            await handler({
              message,
              text,
              senderId,
              senderName,
              threadId,
              isGroup,
              mediaType: parsed.type,
              mediaUrl: parsed.mediaUrl || '',
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
   * Send a text message to a Zalo user or group with Rate Limiting, Quote and Self-Echo Shield
   * @param {string} threadId - User ID or Group ID
   * @param {string} text - Message content
   * @param {boolean} isGroup - Whether threadId is a group
   * @param {Object} options - { isBot, senderName, quote }
   */
  async sendMessage(threadId, text, isGroup = false, { isBot = false, senderName = 'Admin (Bạn)', quote = null } = {}) {
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

      let messagePayload = text;
      let quoteText = '';
      let quoteSender = '';

      if (quote && (quote.msgId || quote.cliMsgId || quote.content || quote.text)) {
        let origMsg = null;
        if (quote.msgId) {
          origMsg = localStore.getMessage(quote.msgId);
        }
        const uidFrom = quote.uidFrom || origMsg?.senderId || threadId;
        const msgId = quote.msgId || origMsg?.id || '0';
        const cliMsgId = quote.cliMsgId || origMsg?.cliMsgId || msgId;
        const ts = quote.ts || (origMsg?.timestamp ? new Date(origMsg.timestamp).getTime() : Date.now());
        quoteText = quote.content || quote.text || origMsg?.text || '';
        quoteSender = quote.senderName || origMsg?.senderName || uidFrom;
        const msgType = quote.msgType || (origMsg?.mediaType === 'image' ? 'chat.photo' : 'chat.message');

        const formattedQuote = {
          content: String(quoteText),
          msgType: msgType,
          propertyExt: quote.propertyExt || {},
          uidFrom: String(uidFrom),
          msgId: String(msgId),
          cliMsgId: String(cliMsgId),
          ts: Number(ts),
          ttl: 0
        };

        messagePayload = {
          msg: text,
          quote: formattedQuote
        };
      }

      let res;
      try {
        res = await this.api.sendMessage(messagePayload, threadId, threadType);
      } catch (err) {
        if (typeof messagePayload === 'object' && messagePayload.quote) {
          logger.warn(`Quote send fallback to plain text: ${err.message}`);
          res = await this.api.sendMessage(text, threadId, threadType);
        } else {
          throw err;
        }
      }

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
        quoteText: quoteText || '',
        quoteSender: quoteSender || '',
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
   * Lazy-resolve stranger identity with bounded LRU cache & rate-limiting
   * @param {string} rawUid - User ID
   * @returns {Promise<{ uid: string, displayName: string, avatar: string }|null>}
   */
  async resolveStrangerProfile(rawUid) {
    const uid = String(rawUid || '').trim();
    if (!uid || !/^\d{10,25}$/.test(uid)) return null;
    if (!this.api || !this.isLoggedIn) return null;

    // 1. Check bounded LRU cache
    const cached = this.strangerProfileCache.get(uid);
    if (cached) {
      if (Date.now() - cached.timestamp < this.strangerCacheTtlMs) {
        if (cached.error) return null;
        return cached.profile;
      }
      this.strangerProfileCache.delete(uid);
    }

    // 2. Return pending promise if already resolving this UID (Anti-race condition)
    if (this.pendingStrangerResolves.has(uid)) {
      return this.pendingStrangerResolves.get(uid);
    }

    const resolvePromise = (async () => {
      try {
        if (typeof this.api.getUserInfo !== 'function') return null;

        // Schedule via defaultRateLimiter to satisfy Anti-Ban 3s guardrail
        const res = await defaultRateLimiter.schedule(async () => {
          return await this.api.getUserInfo(uid);
        });

        const p = res?.changed_profiles?.[uid];
        const displayName = p?.displayName || p?.zaloName || '';
        const avatar = p?.avatar || '';

        if (displayName) {
          // Bounded LRU cache eviction
          if (this.strangerProfileCache.size >= this.maxStrangerCacheSize) {
            const firstKey = this.strangerProfileCache.keys().next().value;
            this.strangerProfileCache.delete(firstKey);
          }
          const profile = { uid, displayName, avatar };
          this.strangerProfileCache.set(uid, { timestamp: Date.now(), profile });

          // Update SQLite Database
          localStore.updateConversationIdentity(uid, { name: displayName, avatar });
          logger.info(`✨ [LazyResolve] Identified stranger ${uid} ➔ "${displayName}"`);
          return profile;
        } else {
          // Cache error/null with TTL to prevent hammering Zalo API
          if (this.strangerProfileCache.size >= this.maxStrangerCacheSize) {
            const firstKey = this.strangerProfileCache.keys().next().value;
            this.strangerProfileCache.delete(firstKey);
          }
          this.strangerProfileCache.set(uid, { timestamp: Date.now(), error: true });
          return null;
        }
      } catch (err) {
        logger.warn(`[LazyResolve] Could not resolve profile for ${uid}: ${err.message}`);
        if (this.strangerProfileCache.size >= this.maxStrangerCacheSize) {
          const firstKey = this.strangerProfileCache.keys().next().value;
          this.strangerProfileCache.delete(firstKey);
        }
        this.strangerProfileCache.set(uid, { timestamp: Date.now(), error: true });
        return null;
      } finally {
        this.pendingStrangerResolves.delete(uid);
      }
    })();

    this.pendingStrangerResolves.set(uid, resolvePromise);
    return resolvePromise;
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
      const hasCaption = Boolean(meta.caption && typeof meta.caption === 'string' && meta.caption.trim());
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemMediaType = item.mediaType || 'image';
        const itemMediaUrl = item.mediaUrl || '';
        const itemText = (i === 0 && hasCaption)
          ? meta.caption.trim()
          : (item.originalName || (itemMediaType === 'image' ? '[Hình ảnh]' : '[Tập tin]'));
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
        if (!uid && (ctx?.uid || ctx?.userId)) {
          uid = String(ctx.uid || ctx.userId);
        }
        if (!displayName || displayName.startsWith('Zalo User')) {
          displayName = ctx?.displayName || ctx?.name || displayName;
        }
        if (!avatar) {
          avatar = ctx?.avatar || ctx?.avatarUrl || avatar;
        }
      } catch {}
    }

    // SQLite fallback if still missing real name or avatar
    if ((!displayName || displayName.startsWith('Zalo User')) && uid) {
      try {
        const row = localStore.db.prepare("SELECT senderName FROM messages WHERE senderId = ? AND senderName != '' AND senderName NOT LIKE 'Zalo User%' LIMIT 1").get(uid);
        if (row?.senderName) displayName = row.senderName;
      } catch {}
    }
    if (!avatar && uid) {
      try {
        const row = localStore.db.prepare("SELECT avatar FROM conversations WHERE (id = ? OR name = ?) AND avatar != '' LIMIT 1").get(uid, displayName);
        if (row?.avatar) avatar = row.avatar;
      } catch {}
    }

    return {
      isLoggedIn: this.isLoggedIn,
      userId: uid,
      displayName: displayName || (this.isLoggedIn ? 'Tài Khoản Zalo' : 'Chưa Đăng Nhập'),
      avatar: avatar,
      friendCount: this.friendUids ? this.friendUids.size : 0,
      friendUids: this.friendUids ? Array.from(this.friendUids) : [],
      hasQrWaiting: !this.isLoggedIn && Boolean(this.currentQrDataUrl),
      qrDataUrl: this.isLoggedIn ? null : this.currentQrDataUrl,
      qrStatusText: this.isLoggedIn ? '' : (this.qrStatusText || (this.currentQrDataUrl ? 'Mở app Zalo trên điện thoại quét mã bên dưới để đăng nhập:' : '')),
      scannedUser: this.scannedUser || null
    };
  }

  /**
   * Request a fresh QR Code Login flow (for new login or account switching)
   * @param {Function} onQrUpdate - Callback when QR changes, is scanned, or succeeds
   * @param {object} options - Options e.g. cleanData: boolean
   */
  async requestNewQrLogin(onQrUpdate = null, { cleanData = false } = {}) {
    this.onQrCallback = onQrUpdate;
    this.isLoggedIn = false;
    this.api = null;
    this.currentQrCode = null;
    this.currentQrDataUrl = null;
    this.qrStatusText = 'Đang khởi tạo mã QR...';
    this.scannedUser = null;
    this.friendUids.clear();
    this._deliveredQueue.clear();
    this.startupSyncState = { stage: 'idle', message: '', errorDetail: null };

    if (cleanData) {
      try {
        localStore.cleanSwitchAccountData();
      } catch (e) {
        logger.warn(`Could not clean localstore data on QR request: ${e.message}`);
      }
    }

    const currentFlow = ++this.qrFlowId;

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
      imageMetadataGetter,
      selfListen: true
    });

    zalo.loginQR({}, async (event) => {
      if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
        if (this.isLoggedIn || this.qrFlowId !== currentFlow) return;
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
        if (this.isLoggedIn || this.qrFlowId !== currentFlow) return;
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
        if (this.isLoggedIn || this.qrFlowId !== currentFlow) {
          logger.info('[QR Guard] Session is online or newer flow active. Skipping expired QR retry.');
          return;
        }
        this.qrStatusText = '⌛ Mã QR đã hết hạn. Đang tự động tạo lại mã mới...';
        if (typeof this.onQrCallback === 'function') {
          this.onQrCallback(this.getAccountProfile());
        }
        if (event.actions && typeof event.actions.retry === 'function') {
          event.actions.retry();
        }
      }
    }).then(async (api) => {
      this.api = api;
      this.isLoggedIn = true;
      this.currentQrCode = null;
      this.currentQrDataUrl = null;
      this.qrStatusText = '';
      this.scannedUser = null;
      logger.info('🎉 Zalo login successful!');
      await this.syncAccountProfile();
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
   * @param {object} options - Options e.g. cleanData: boolean
   */
  async logout({ cleanData = false } = {}) {
    this.isLoggedIn = false;
    this.api = null;
    this.currentQrCode = null;
    this.currentQrDataUrl = null;
    this.userProfile = { userId: '', displayName: '', avatar: '' };
    this.qrStatusText = '';
    this.scannedUser = null;
    this.friendUids.clear();
    this._deliveredQueue.clear();
    this.startupSyncState = { stage: 'idle', message: '', errorDetail: null };

    if (cleanData) {
      try {
        localStore.cleanSwitchAccountData();
      } catch (e) {
        logger.warn(`Could not clean localstore data on logout: ${e.message}`);
      }
    }

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
