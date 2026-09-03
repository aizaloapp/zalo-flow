import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { logger } from './logger.js';

export class BrowserHistoryImporter {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.resolve(process.cwd(), 'data');
    this.tmpSnapshotDir = path.join(this.dataDir, 'tmp_idb_snapshot');
  }

  /**
   * Detect all available Zalo Web IndexedDB directories on the user's computer
   * Supports Google Chrome, Microsoft Edge, CocCoc Browser, Brave Browser
   * @returns {Array<{ id: string, browser: string, profile: string, path: string, sizeBytes: number, sizeFormatted: string, mtime: string }>}
   */
  detectProfiles() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

    const browserDefs = [
      { name: 'Google Chrome', root: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
      { name: 'Microsoft Edge', root: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
      { name: 'CocCoc Browser', root: path.join(localAppData, 'CocCoc', 'Browser', 'User Data') },
      { name: 'Brave Browser', root: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') }
    ];

    const profiles = [];

    for (const b of browserDefs) {
      if (!fs.existsSync(b.root)) continue;
      try {
        const entries = fs.readdirSync(b.root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && (entry.name === 'Default' || entry.name.startsWith('Profile '))) {
            const indexedDbPath = path.join(b.root, entry.name, 'IndexedDB');
            if (fs.existsSync(indexedDbPath)) {
              try {
                const idbEntries = fs.readdirSync(indexedDbPath);
                for (const idb of idbEntries) {
                  if (idb.toLowerCase().includes('chat.zalo.me') && idb.endsWith('.leveldb')) {
                    const fullPath = path.join(indexedDbPath, idb);
                    const files = fs.readdirSync(fullPath);
                    let totalSize = 0;
                    let latestMtime = new Date(0);

                    for (const f of files) {
                      const fPath = path.join(fullPath, f);
                      try {
                        const stat = fs.statSync(fPath);
                        totalSize += stat.size;
                        if (stat.mtime > latestMtime) latestMtime = stat.mtime;
                      } catch {}
                    }

                    if (totalSize > 0) {
                      const id = Buffer.from(fullPath).toString('base64url');
                      profiles.push({
                        id,
                        browser: b.name,
                        profile: entry.name,
                        path: fullPath,
                        sizeBytes: totalSize,
                        sizeFormatted: `${(totalSize / (1024 * 1024)).toFixed(2)} MB`,
                        mtime: latestMtime.toISOString()
                      });
                    }
                  }
                }
              } catch (scanErr) {
                logger.warn(`[Browser Importer] Could not read ${indexedDbPath}: ${scanErr.message}`);
              }
            }
          }
        }
      } catch (err) {
        logger.warn(`[Browser Importer] Error scanning ${b.name}: ${err.message}`);
      }
    }

    // Sort by latest modified date descending
    profiles.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
    return profiles;
  }

  /**
   * Safely create a local isolated snapshot of the LevelDB folder
   * Avoids Windows Chrome file locking (EBUSY)
   * @param {string} sourcePath
   * @returns {string} Path to snapshot folder
   */
  createSnapshot(sourcePath) {
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source IndexedDB path does not exist: ${sourcePath}`);
    }

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.tmpSnapshotDir)) {
      fs.rmSync(this.tmpSnapshotDir, { recursive: true, force: true });
    }

    fs.cpSync(sourcePath, this.tmpSnapshotDir, { recursive: true });
    logger.info(`[Browser Importer] Created isolated snapshot at: ${this.tmpSnapshotDir}`);
    return this.tmpSnapshotDir;
  }

  /**
   * Extract messages and conversations from the LevelDB snapshot
   * @param {string} snapshotDir
   * @returns {{ conversations: Array, messages: Array }}
   */
  extractData(snapshotDir) {
    if (!fs.existsSync(snapshotDir)) {
      throw new Error(`Snapshot directory not found: ${snapshotDir}`);
    }

    const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.ldb') || f.endsWith('.log'));
    const conversationMap = new Map();
    const messageMap = new Map();

    for (const file of files) {
      const filePath = path.join(snapshotDir, file);
      try {
        const buffer = fs.readFileSync(filePath);
        this._scanBufferForZaloObjects(buffer, conversationMap, messageMap);
      } catch (err) {
        logger.warn(`[Browser Importer] Error scanning ${file}: ${err.message}`);
      }
    }

    const conversations = Array.from(conversationMap.values());
    const messages = Array.from(messageMap.values());

    logger.info(`[Browser Importer] Extracted ${conversations.length} conversations and ${messages.length} messages from LevelDB.`);
    return { conversations, messages };
  }

  /**
   * Internal scanner to extract text, contacts and message objects from raw binary chunks
   */
  _scanBufferForZaloObjects(buffer, conversationMap, messageMap) {
    const textUtf8 = buffer.toString('utf8');

    // 1. JSON Regex Scanner (For structured Zalo records)
    const jsonRegex = /\{[\s\S]*?"(?:msgId|cliMsgId|userId|displayName|dName|zaloName|gridInfo)"[\s\S]*?\}/g;
    let match;
    while ((match = jsonRegex.exec(textUtf8)) !== null) {
      try {
        const start = match.index;
        let depth = 0;
        let end = start;
        for (let i = start; i < Math.min(start + 4000, textUtf8.length); i++) {
          if (textUtf8[i] === '{') depth++;
          else if (textUtf8[i] === '}') {
            depth--;
            if (depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
        if (end > start) {
          const jsonStr = textUtf8.substring(start, end);
          const obj = JSON.parse(jsonStr);
          this._processZaloObject(obj, conversationMap, messageMap);
        }
      } catch {}
    }

    // Only extract structured JSON objects with valid message/contact signatures
  }

  /**
   * Process and normalize individual Zalo JSON object
   */
  _processZaloObject(obj, conversationMap, messageMap) {
    if (!obj || typeof obj !== 'object') return;

    // A. Conversation / Contact
    const userId = String(obj.userId || obj.uid || obj.id || '');
    const userName = obj.displayName || obj.dName || obj.zaloName || obj.name;
    const isGroup = Boolean(obj.isGroup || (userId && userId.startsWith('g_')) || obj.gridInfo);

    if (userId && userName && !userId.startsWith('system_')) {
      const convId = isGroup ? (obj.groupId || obj.grid || userId) : userId;
      if (!conversationMap.has(convId)) {
        conversationMap.set(convId, {
          id: convId,
          name: String(userName).trim(),
          avatar: obj.avatar || obj.avt || obj.avatarUrl || '',
          isGroup: Boolean(isGroup)
        });
      }
    }

    // B. Message
    const msgId = String(obj.msgId || obj.id || '');
    const msgText = (typeof obj.content === 'string' ? obj.content : obj.msg || obj.text || '')?.trim();
    const senderId = String(obj.uidFrom || obj.senderId || obj.userId || '');
    const threadId = String(obj.idTo || obj.threadId || (isGroup ? obj.groupId : senderId) || '');

    // Normalize timestamp (detect seconds vs milliseconds)
    let finalTimestamp = new Date().toISOString();
    const rawTs = obj.ts || obj.dTime || obj.time || obj.timestamp;
    if (rawTs) {
      const num = Number(rawTs);
      if (!isNaN(num) && num > 0) {
        finalTimestamp = new Date(num < 1e11 ? num * 1000 : num).toISOString();
      }
    }

    if ((msgId || msgText) && (msgText || obj.mediaUrl)) {
      const finalMsgId = msgId || `imp_${crypto.createHash('md5').update(msgText + senderId).digest('hex').substring(0, 16)}`;
      const resolvedThreadId = threadId || senderId || 'imported_history';

      if (!messageMap.has(finalMsgId)) {
        messageMap.set(finalMsgId, {
          id: finalMsgId,
          threadId: resolvedThreadId,
          senderId: senderId || 'unknown',
          senderName: obj.dName || obj.displayName || senderId,
          text: msgText,
          mediaType: obj.msgType || obj.mediaType || 'text',
          mediaUrl: obj.mediaUrl || obj.hdUrl || obj.thumbUrl || '',
          quoteText: obj.quote?.text || obj.quoteText || '',
          quoteSender: obj.quote?.sender || obj.quoteSender || '',
          isGroup: Boolean(isGroup),
          isSelf: Boolean(obj.isSelf || obj.fromMe),
          isBot: false,
          timestamp: finalTimestamp,
          cliMsgId: String(obj.cliMsgId || '')
        });
      }
    }
  }

  /**
   * Execute full migration from Browser Profile into SQLite LocalStore
   * @param {string} profilePath - Absolute path to LevelDB folder or profile ID
   * @param {object} localStore - LocalStore instance
   * @returns {Promise<{ status: string, conversationsCount: number, messagesCount: number, durationMs: number }>}
   */
  async importProfile(profilePath = '', localStore) {
    const startTime = Date.now();
    let targetPath = profilePath || '';

    // Check if profilePath is encoded ID
    if (targetPath) {
      try {
        const decoded = Buffer.from(targetPath, 'base64url').toString('utf8');
        if (fs.existsSync(decoded)) targetPath = decoded;
      } catch {}
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      const profiles = this.detectProfiles();
      if (profiles.length === 0) {
        throw new Error('No Zalo Web browser profiles found on this computer.');
      }
      targetPath = profiles[0].path;
    }

    logger.info(`[Browser Importer] Starting import from: ${targetPath}`);

    // 1. Create isolated snapshot
    const snapshot = this.createSnapshot(targetPath);

    try {
      // 2. Extract Data
      const { conversations, messages } = this.extractData(snapshot);

      // 3. Batch Ingest into SQLite using SQLite Transaction for max speed (<150ms)
      let insertedConv = 0;
      let insertedMsg = 0;

      if (localStore?.db && typeof localStore.db.transaction === 'function') {
        const runBatchTransaction = localStore.db.transaction(() => {
          for (const conv of conversations) {
            try {
              localStore.upsertConversation({
                id: conv.id,
                name: conv.name,
                avatar: conv.avatar || '',
                isGroup: conv.isGroup
              });
              insertedConv++;
            } catch {}
          }

          for (const msg of messages) {
            try {
              localStore.addMessage(msg, { silent: true });
              insertedMsg++;
            } catch {}
          }
        });
        runBatchTransaction();
      } else {
        // Fallback sequential
        for (const conv of conversations) {
          try {
            localStore.upsertConversation({
              id: conv.id,
              name: conv.name,
              avatar: conv.avatar || '',
              isGroup: conv.isGroup
            });
            insertedConv++;
          } catch {}
        }
        for (const msg of messages) {
          try {
            localStore.addMessage(msg, { silent: true });
            insertedMsg++;
          } catch {}
        }
      }

      const durationMs = Date.now() - startTime;
      logger.info(`✅ [Browser Importer] Successfully migrated ${insertedConv} conversations and ${insertedMsg} messages in ${durationMs}ms.`);

      return {
        status: 'success',
        targetPath,
        conversationsCount: insertedConv,
        messagesCount: insertedMsg,
        durationMs
      };
    } finally {
      // Cleanup temporary snapshot
      if (fs.existsSync(this.tmpSnapshotDir)) {
        try {
          fs.rmSync(this.tmpSnapshotDir, { recursive: true, force: true });
          logger.info(`[Browser Importer] Cleaned up snapshot directory.`);
        } catch {}
      }
    }
  }
}

export const browserHistoryImporter = new BrowserHistoryImporter();
