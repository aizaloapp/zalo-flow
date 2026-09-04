import { DatabaseSync } from 'node:sqlite';
import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';

export class LocalStore extends EventEmitter {
  constructor(dbPath = 'data/zaloflow.db') {
    super();
    this.dbPath = dbPath;
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this._initSchema();
    this._migrate();
  }

  close() {
    if (this.db) {
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        this.db.close();
        logger.info('[LocalStore] SQLite database flushed WAL and closed safely.');
      } catch (err) {
        logger.warn(`[LocalStore] Error closing DB: ${err.message}`);
      }
    }
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL DEFAULT '',
        avatar      TEXT DEFAULT '',
        isGroup     INTEGER DEFAULT 0,
        lastMessage TEXT DEFAULT '',
        lastTime    TEXT DEFAULT '',
        unreadCount INTEGER DEFAULT 0,
        updatedAt   TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT PRIMARY KEY,
        threadId    TEXT NOT NULL,
        senderId    TEXT NOT NULL,
        senderName  TEXT NOT NULL DEFAULT '',
        text        TEXT NOT NULL DEFAULT '',
        isSelf      INTEGER DEFAULT 0,
        isBot       INTEGER DEFAULT 0,
        timestamp   TEXT DEFAULT (datetime('now')),
        mediaType   TEXT DEFAULT 'text',
        mediaUrl    TEXT DEFAULT '',
        quoteText   TEXT DEFAULT '',
        quoteSender TEXT DEFAULT '',
        reactions   TEXT DEFAULT '',
        cliMsgId    TEXT DEFAULT '',
        status      TEXT DEFAULT 'sent',
        isRecalled  INTEGER DEFAULT 0,
        FOREIGN KEY (threadId) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(threadId, timestamp DESC);

      CREATE TABLE IF NOT EXISTS ai_settings (
        id                      TEXT PRIMARY KEY DEFAULT 'default',
        isEnabled               INTEGER DEFAULT 0,
        provider                TEXT DEFAULT 'gemini',
        model                   TEXT DEFAULT 'gemini-2.5-flash',
        baseUrl                 TEXT DEFAULT '',
        apiKeyEncrypted         TEXT DEFAULT '',
        timeoutMs               INTEGER DEFAULT 15000,
        fallbackEnabled         INTEGER DEFAULT 0,
        fallbackProvider        TEXT DEFAULT 'openai',
        fallbackModel           TEXT DEFAULT 'deepseek-chat',
        fallbackBaseUrl         TEXT DEFAULT 'https://api.deepseek.com/v1',
        fallbackApiKeyEncrypted TEXT DEFAULT '',
        fallbackTimeoutMs       INTEGER DEFAULT 12000,
        soulPrompt              TEXT DEFAULT '',
        memoryPrompt            TEXT DEFAULT '',
        fewShotPrompt           TEXT DEFAULT '',
        scopePrompt             TEXT DEFAULT '',
        exemplarConversation    TEXT DEFAULT '',
        allowGroups             INTEGER DEFAULT 0,
        autoTagNewLead          INTEGER DEFAULT 0,
        defaultLeadTagId        TEXT DEFAULT '',
        targetMode              TEXT DEFAULT 'all',
        excludedTagIds          TEXT DEFAULT '[]',
        allowedTagIds           TEXT DEFAULT '[]',
        adminCooldownMinutes    INTEGER DEFAULT 15,
        debounceSeconds         INTEGER DEFAULT 3,
        updatedAt               TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  _migrate() {
    try {
      const versionStmt = this.db.prepare('PRAGMA user_version;');
      const versionRow = versionStmt.get();
      const version = versionRow ? (versionRow.user_version || 0) : 0;

      if (version < 1) {
        const tableInfoStmt = this.db.prepare("PRAGMA table_info('messages');");
        const columns = tableInfoStmt.all().map(c => c.name);

        if (!columns.includes('senderName')) {
          this.db.exec("ALTER TABLE messages ADD COLUMN senderName TEXT DEFAULT '';");
        }
        if (!columns.includes('mediaType')) {
          this.db.exec("ALTER TABLE messages ADD COLUMN mediaType TEXT DEFAULT 'text';");
        }
        if (!columns.includes('mediaUrl')) {
          this.db.exec("ALTER TABLE messages ADD COLUMN mediaUrl TEXT DEFAULT '';");
        }
        if (!columns.includes('quoteText')) {
          this.db.exec("ALTER TABLE messages ADD COLUMN quoteText TEXT DEFAULT '';");
        }
        if (!columns.includes('quoteSender')) {
          this.db.exec("ALTER TABLE messages ADD COLUMN quoteSender TEXT DEFAULT '';");
        }

        this.db.exec('PRAGMA user_version = 1;');
        logger.info('📦 DB migrated to version 1 (added senderName + media columns)');
      }

      if (version < 2) {
        this.db.exec(`
          -- 1. Tags Table
          CREATE TABLE IF NOT EXISTS tags (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            color       TEXT NOT NULL DEFAULT '#38bdf8',
            description TEXT DEFAULT '',
            createdAt   TEXT DEFAULT (datetime('now'))
          );

          -- 2. Conversation Tags (Many-to-Many)
          CREATE TABLE IF NOT EXISTS conversation_tags (
            threadId    TEXT NOT NULL,
            tagId       TEXT NOT NULL,
            createdAt   TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (threadId, tagId),
            FOREIGN KEY (threadId) REFERENCES conversations(id) ON DELETE CASCADE,
            FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
          );

          -- 3. Quick Messages (Templates & Q&A Pairs)
          CREATE TABLE IF NOT EXISTS quick_messages (
            id                TEXT PRIMARY KEY,
            shortcut          TEXT NOT NULL UNIQUE,
            customerQuestion  TEXT DEFAULT '',
            title             TEXT NOT NULL,
            content           TEXT NOT NULL,
            mediaUrl          TEXT DEFAULT '',
            mediaType         TEXT DEFAULT '',
            mediaName         TEXT DEFAULT '',
            createdAt         TEXT DEFAULT (datetime('now'))
          );

          -- 5. Campaigns Table
          CREATE TABLE IF NOT EXISTS campaigns (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            message     TEXT NOT NULL,
            targetTagId TEXT DEFAULT '',
            status      TEXT DEFAULT 'draft',
            totalCount  INTEGER DEFAULT 0,
            sentCount   INTEGER DEFAULT 0,
            failedCount INTEGER DEFAULT 0,
            delayMinMs  INTEGER DEFAULT 10000,
            delayMaxMs  INTEGER DEFAULT 25000,
            batchSize   INTEGER DEFAULT 25,
            batchPauseMs INTEGER DEFAULT 180000,
            createdAt   TEXT DEFAULT (datetime('now'))
          );

          -- 6. Campaign Queue (Persistent State)
          CREATE TABLE IF NOT EXISTS campaign_queue (
            id           TEXT PRIMARY KEY,
            campaignId   TEXT NOT NULL,
            threadId     TEXT NOT NULL,
            customerName TEXT NOT NULL DEFAULT '',
            status       TEXT DEFAULT 'pending',
            error        TEXT DEFAULT '',
            sentAt       TEXT DEFAULT NULL,
            FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE
          );

          -- 7. Campaign Logs
          CREATE TABLE IF NOT EXISTS campaign_logs (
            id           TEXT PRIMARY KEY,
            campaignId   TEXT NOT NULL,
            threadId     TEXT NOT NULL,
            customerName TEXT NOT NULL DEFAULT '',
            sentContent  TEXT NOT NULL,
            status       TEXT NOT NULL,
            error        TEXT DEFAULT '',
            sentAt       TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (campaignId) REFERENCES campaigns(id) ON DELETE CASCADE
          );
        `);

        // Ensure quick_messages.customerQuestion exists
        const qmCols = this.db.prepare("PRAGMA table_info('quick_messages');").all().map(c => c.name);
        if (!qmCols.includes('customerQuestion')) {
          this.db.exec("ALTER TABLE quick_messages ADD COLUMN customerQuestion TEXT DEFAULT '';");
        }

        this.db.exec('PRAGMA user_version = 2;');
        logger.info('📦 DB migrated to version 2 (Tags, Quick Messages, Campaigns)');
      }

      if (version < 3) {
        this.db.exec('PRAGMA user_version = 3;');
        logger.info('📦 DB migrated to version 3 (Auto-Fallback Shield columns)');
      }

      if (version < 4) {
        const msgCols = this.db.prepare("PRAGMA table_info('messages');").all().map(c => c.name);
        if (!msgCols.includes('status'))     this.db.exec("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'sent';");
        if (!msgCols.includes('isRecalled')) this.db.exec("ALTER TABLE messages ADD COLUMN isRecalled INTEGER DEFAULT 0;");
        this.db.exec('PRAGMA user_version = 4;');
        logger.info('📦 DB migrated to version 4 (message status + recall undo)');
      }

      // -----------------------------------------------------------------------
      // Universal Schema Reconciliation (Idempotent Check for All DBs)
      // -----------------------------------------------------------------------
      const qmCols = this.db.prepare("PRAGMA table_info('quick_messages');").all().map(c => c.name);
      if (!qmCols.includes('customerQuestion')) {
        this.db.exec("ALTER TABLE quick_messages ADD COLUMN customerQuestion TEXT DEFAULT '';");
      }
      if (!qmCols.includes('mediaUrl')) {
        this.db.exec("ALTER TABLE quick_messages ADD COLUMN mediaUrl TEXT DEFAULT '';");
      }
      if (!qmCols.includes('mediaType')) {
        this.db.exec("ALTER TABLE quick_messages ADD COLUMN mediaType TEXT DEFAULT '';");
      }
      if (!qmCols.includes('mediaName')) {
        this.db.exec("ALTER TABLE quick_messages ADD COLUMN mediaName TEXT DEFAULT '';");
      }

      const convColumns = this.db.prepare("PRAGMA table_info('conversations');").all().map(c => c.name);
      if (!convColumns.includes('aiEnabled')) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN aiEnabled INTEGER DEFAULT 1;");
      }
      if (!convColumns.includes('phone'))   this.db.exec("ALTER TABLE conversations ADD COLUMN phone TEXT DEFAULT '';");
      if (!convColumns.includes('email'))   this.db.exec("ALTER TABLE conversations ADD COLUMN email TEXT DEFAULT '';");
      if (!convColumns.includes('address')) this.db.exec("ALTER TABLE conversations ADD COLUMN address TEXT DEFAULT '';");
      if (!convColumns.includes('needs'))   this.db.exec("ALTER TABLE conversations ADD COLUMN needs TEXT DEFAULT '';");
      if (!convColumns.includes('notes'))   this.db.exec("ALTER TABLE conversations ADD COLUMN notes TEXT DEFAULT '';");

      const msgColumns = this.db.prepare("PRAGMA table_info('messages');").all().map(c => c.name);
      if (!msgColumns.includes('reactions')) {
        this.db.exec("ALTER TABLE messages ADD COLUMN reactions TEXT DEFAULT '';");
      }
      if (!msgColumns.includes('cliMsgId')) {
        this.db.exec("ALTER TABLE messages ADD COLUMN cliMsgId TEXT DEFAULT '';");
      }
      if (!msgColumns.includes('status')) {
        this.db.exec("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'sent';");
      }
      const campColumns = this.db.prepare("PRAGMA table_info('campaigns');").all().map(c => c.name);
      if (!campColumns.includes('description'))  this.db.exec("ALTER TABLE campaigns ADD COLUMN description TEXT DEFAULT '';");
      if (!campColumns.includes('mediaUrls'))    this.db.exec("ALTER TABLE campaigns ADD COLUMN mediaUrls TEXT DEFAULT '[]';");
      if (!campColumns.includes('targetType'))   this.db.exec("ALTER TABLE campaigns ADD COLUMN targetType TEXT DEFAULT 'all';");
      if (!campColumns.includes('targetTagIds')) this.db.exec("ALTER TABLE campaigns ADD COLUMN targetTagIds TEXT DEFAULT '[]';");
      if (!campColumns.includes('targetKeyword')) this.db.exec("ALTER TABLE campaigns ADD COLUMN targetKeyword TEXT DEFAULT '';");
      if (!campColumns.includes('scheduleType')) this.db.exec("ALTER TABLE campaigns ADD COLUMN scheduleType TEXT DEFAULT 'manual';");
      if (!campColumns.includes('scheduleTime')) this.db.exec("ALTER TABLE campaigns ADD COLUMN scheduleTime TEXT DEFAULT '08:30';");
      if (!campColumns.includes('scheduleMode')) this.db.exec("ALTER TABLE campaigns ADD COLUMN scheduleMode TEXT DEFAULT 'scheduled';");
      if (!campColumns.includes('startDate'))    this.db.exec("ALTER TABLE campaigns ADD COLUMN startDate TEXT DEFAULT '';");
      if (!campColumns.includes('recurrence'))   this.db.exec("ALTER TABLE campaigns ADD COLUMN recurrence TEXT DEFAULT 'once';");
      if (!campColumns.includes('nextRunAt'))    this.db.exec("ALTER TABLE campaigns ADD COLUMN nextRunAt INTEGER DEFAULT NULL;");
      if (!campColumns.includes('isEnabled'))    this.db.exec("ALTER TABLE campaigns ADD COLUMN isEnabled INTEGER DEFAULT 0;");
      if (!campColumns.includes('lastRunAt'))    this.db.exec("ALTER TABLE campaigns ADD COLUMN lastRunAt TEXT DEFAULT NULL;");
      if (!campColumns.includes('updatedAt'))    this.db.exec("ALTER TABLE campaigns ADD COLUMN updatedAt TEXT DEFAULT (datetime('now'));");

      // AI Settings Reconciliation
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ai_settings (
          id                      TEXT PRIMARY KEY DEFAULT 'default',
          isEnabled               INTEGER DEFAULT 0,
          provider                TEXT DEFAULT 'gemini',
          model                   TEXT DEFAULT 'gemini-2.5-flash',
          baseUrl                 TEXT DEFAULT '',
          apiKeyEncrypted         TEXT DEFAULT '',
          timeoutMs               INTEGER DEFAULT 15000,
          fallbackEnabled         INTEGER DEFAULT 0,
          fallbackProvider        TEXT DEFAULT 'openai',
          fallbackModel           TEXT DEFAULT 'deepseek-chat',
          fallbackBaseUrl         TEXT DEFAULT 'https://api.deepseek.com/v1',
          fallbackApiKeyEncrypted TEXT DEFAULT '',
          fallbackTimeoutMs       INTEGER DEFAULT 12000,
          soulPrompt              TEXT DEFAULT '',
          memoryPrompt            TEXT DEFAULT '',
          fewShotPrompt           TEXT DEFAULT '',
          scopePrompt             TEXT DEFAULT '',
          exemplarConversation    TEXT DEFAULT '',
          allowGroups             INTEGER DEFAULT 0,
          autoTagNewLead          INTEGER DEFAULT 0,
          defaultLeadTagId        TEXT DEFAULT '',
          targetMode              TEXT DEFAULT 'all',
          excludedTagIds          TEXT DEFAULT '[]',
          allowedTagIds           TEXT DEFAULT '[]',
          adminCooldownMinutes    INTEGER DEFAULT 15,
          debounceSeconds         INTEGER DEFAULT 3,
          updatedAt               TEXT DEFAULT (datetime('now'))
        );
      `);
      this.db.prepare("INSERT OR IGNORE INTO ai_settings (id) VALUES ('default');").run();
      const aiCols = this.db.prepare("PRAGMA table_info('ai_settings');").all().map(c => c.name);
      if (!aiCols.includes('allowGroups'))          this.db.exec("ALTER TABLE ai_settings ADD COLUMN allowGroups INTEGER DEFAULT 0;");
      if (!aiCols.includes('debounceSeconds'))      this.db.exec("ALTER TABLE ai_settings ADD COLUMN debounceSeconds INTEGER DEFAULT 3;");
      if (!aiCols.includes('apiKeyEncrypted'))      this.db.exec("ALTER TABLE ai_settings ADD COLUMN apiKeyEncrypted TEXT DEFAULT '';");
      if (!aiCols.includes('fallbackApiKeyEncrypted')) this.db.exec("ALTER TABLE ai_settings ADD COLUMN fallbackApiKeyEncrypted TEXT DEFAULT '';");
    } catch (err) {
      logger.warn(`Migration notice: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // CRM Information
  // ---------------------------------------------------------------------------
  getCrmInfo(threadId) {
    if (!threadId) return {};
    const stmt = this.db.prepare('SELECT phone, email, address, needs, notes FROM conversations WHERE id = ?');
    const res = stmt.get(threadId);
    return res || { phone: '', email: '', address: '', needs: '', notes: '' };
  }

  saveCrmInfo(threadId, { phone = '', email = '', address = '', needs = '', notes = '' } = {}) {
    if (!threadId) return;
    this.upsertConversation({ id: threadId, name: threadId });
    const stmt = this.db.prepare(`
      UPDATE conversations 
      SET phone = ?, email = ?, address = ?, needs = ?, notes = ?, updatedAt = datetime('now')
      WHERE id = ?
    `);
    stmt.run(phone.trim(), email.trim(), address.trim(), needs.trim(), notes.trim(), threadId);
    return this.getCrmInfo(threadId);
  }

  // ---------------------------------------------------------------------------
  // Conversations & Messages
  // ---------------------------------------------------------------------------

  upsertConversation(conv) {
    if (!conv || !conv.id) return;

    const existing = this.getConversation(conv.id);
    const name = conv.name !== undefined ? conv.name : (existing?.name || conv.id);
    const avatar = conv.avatar !== undefined ? conv.avatar : (existing?.avatar || '');
    const isGroup = conv.isGroup ? 1 : 0;
    
    // Protect lastTime & lastMessage from being overwritten backwards by older historical messages
    let lastMessage = conv.lastMessage !== undefined ? String(conv.lastMessage) : (existing?.lastMessage || '');
    let lastTime = conv.lastTime !== undefined ? String(conv.lastTime) : (existing?.lastTime || new Date().toISOString());

    if (existing?.lastTime && conv.lastTime) {
      if (new Date(conv.lastTime) < new Date(existing.lastTime)) {
        // Keep existing newer lastTime and lastMessage
        lastTime = existing.lastTime;
        lastMessage = existing.lastMessage || lastMessage;
      }
    }

    const unreadCount = Number(conv.unreadCount !== undefined ? conv.unreadCount : (existing?.unreadCount ?? 0));
    const updatedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, name, avatar, isGroup, lastMessage, lastTime, unreadCount, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        avatar = CASE WHEN excluded.avatar != '' THEN excluded.avatar ELSE conversations.avatar END,
        isGroup = excluded.isGroup,
        lastMessage = CASE WHEN excluded.lastMessage != '' THEN excluded.lastMessage ELSE conversations.lastMessage END,
        lastTime = excluded.lastTime,
        unreadCount = excluded.unreadCount,
        updatedAt = excluded.updatedAt
    `);

    stmt.run(conv.id, name, avatar, isGroup, lastMessage, lastTime, unreadCount, updatedAt);
  }

  getConversation(id) {
    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    const result = stmt.get(id);
    if (!result) return null;
    return {
      ...result,
      isGroup: Boolean(result.isGroup)
    };
  }

  getCustomer(id) {
    return this.getConversation(id);
  }

  getConversations({ search = '', filter = 'all', tagId = '' } = {}) {
    let sql = `
      SELECT DISTINCT c.* FROM conversations c
    `;
    const params = [];

    if (tagId && tagId !== 'all') {
      sql += ` INNER JOIN conversation_tags ct ON ct.threadId = c.id AND ct.tagId = ?`;
      params.push(tagId);
    }

    sql += ` WHERE 1=1`;

    if (search && search.trim()) {
      sql += ` AND (c.name LIKE ? OR c.id LIKE ? OR c.lastMessage LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (filter === 'personal') {
      sql += ` AND c.isGroup = 0`;
    } else if (filter === 'group') {
      sql += ` AND c.isGroup = 1`;
    } else if (filter === 'unread') {
      sql += ` AND c.unreadCount > 0`;
    }

    sql += ` ORDER BY c.updatedAt DESC`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map(r => ({
      ...r,
      isGroup: Boolean(r.isGroup)
    }));
  }

  markAsRead(threadId) {
    if (!threadId) return;
    const stmt = this.db.prepare('UPDATE conversations SET unreadCount = 0 WHERE id = ?');
    stmt.run(threadId);
  }

  addMessage(msg, { silent = false, isHistory = false, countUnread = null } = {}) {
    if (!msg || !msg.threadId) return null;

    const id = String(msg.id || crypto.randomUUID());
    const threadId = String(msg.threadId);
    const senderId = String(msg.senderId || '');
    const senderName = String(msg.senderName || '');
    const text = String(msg.text || '').trim();
    const isSelf = msg.isSelf ? 1 : 0;
    const isBot = msg.isBot ? 1 : 0;
    const timestamp = msg.timestamp || new Date().toISOString();
    const mediaType = String(msg.mediaType || 'text');
    const mediaUrl = String(msg.mediaUrl || '');
    const quoteText = String(msg.quoteText || '');
    const quoteSender = String(msg.quoteSender || '');
    const reactions = String(msg.reactions || '');
    const cliMsgId = String(msg.cliMsgId || '');
    const status = String(msg.status || 'sent');
    const isRecalled = msg.isRecalled ? 1 : 0;

    // Check if message already exists in DB
    const existingMsg = this.db.prepare('SELECT id FROM messages WHERE id = ?').get(id);
    const isNew = !existingMsg;

    const existing = this.getConversation(threadId);

    // Only increment unreadCount for genuinely new incoming real-time messages (not silent, not history, not self, not bot)
    let newUnread = existing?.unreadCount ?? 0;
    const shouldIncrement = (countUnread !== null)
      ? Boolean(countUnread)
      : (!silent && !isHistory && isNew && !isSelf && !isBot);

    if (shouldIncrement) {
      newUnread = (existing?.unreadCount || 0) + 1;
    }

    // Ensure parent conversation record exists before inserting message for FOREIGN KEY constraints
    this.upsertConversation({
      id: threadId,
      name: existing?.name || senderName || threadId,
      isGroup: msg.isGroup !== undefined ? msg.isGroup : (existing?.isGroup || false),
      lastMessage: text || (mediaType === 'image' ? '[Hình ảnh]' : (mediaType === 'sticker' ? '[Sticker]' : '[Tin nhắn]')),
      lastTime: timestamp,
      unreadCount: newUnread
    });

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages 
        (id, threadId, senderId, senderName, text, isSelf, isBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(id, threadId, senderId, senderName, text, isSelf, isBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled);

    const savedMsg = {
      id,
      threadId,
      senderId,
      senderName,
      text,
      isSelf: Boolean(isSelf),
      isBot: Boolean(isBot),
      timestamp,
      mediaType,
      mediaUrl,
      quoteText,
      quoteSender,
      reactions,
      cliMsgId,
      status,
      isRecalled: Boolean(isRecalled)
    };

    if (!silent) {
      this.emit('newMessage', savedMsg);
    }

    return savedMsg;
  }

  getMessages(threadId, { limit = 50, before = null } = {}) {
    let sql = 'SELECT * FROM (SELECT * FROM messages WHERE threadId = ?';
    const params = [threadId];

    if (before) {
      sql += ' AND timestamp < (SELECT timestamp FROM messages WHERE id = ?)';
      params.push(before);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC';
    params.push(Number(limit));

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map(r => ({
      ...r,
      isSelf: Boolean(r.isSelf),
      isBot: Boolean(r.isBot),
      mediaType: r.mediaType || 'text',
      mediaUrl: r.mediaUrl || '',
      quoteText: r.quoteText || '',
      quoteSender: r.quoteSender || '',
      reactions: r.reactions || '',
      cliMsgId: r.cliMsgId || '',
      status: r.status || 'sent',
      isRecalled: Boolean(r.isRecalled)
    }));
  }

  getMessage(id) {
    if (!id) return null;
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    const r = stmt.get(id);
    if (!r) return null;
    return {
      ...r,
      isSelf: Boolean(r.isSelf),
      isBot: Boolean(r.isBot),
      mediaType: r.mediaType || 'text',
      mediaUrl: r.mediaUrl || '',
      quoteText: r.quoteText || '',
      quoteSender: r.quoteSender || '',
      reactions: r.reactions || '',
      cliMsgId: r.cliMsgId || '',
      status: r.status || 'sent',
      isRecalled: Boolean(r.isRecalled)
    };
  }

  updateMessageReaction(msgId, emoji) {
    if (!msgId) return null;
    const stmt = this.db.prepare('UPDATE messages SET reactions = ? WHERE id = ?');
    stmt.run(String(emoji || ''), String(msgId));
    const updated = this.getMessage(msgId);
    if (updated) {
      this.emit('messageReaction', { msgId, reaction: emoji, threadId: updated.threadId });
    }
    return updated;
  }

  updateMessagesStatus(msgIds, status = 'delivered') {
    if (!Array.isArray(msgIds) || msgIds.length === 0) return;
    const placeholders = msgIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`UPDATE messages SET status = ? WHERE id IN (${placeholders})`);
    stmt.run(status, ...msgIds);
  }

  markMessageRecalled(msgId) {
    if (!msgId) return null;
    const stmt = this.db.prepare(`
      UPDATE messages 
      SET isRecalled = 1, text = '[Tin nhắn đã được thu hồi]' 
      WHERE id = ?
    `);
    stmt.run(String(msgId));

    const msg = this.getMessage(msgId);
    if (msg) {
      const conv = this.getConversation(msg.threadId);
      if (conv) {
        this.upsertConversation({
          ...conv,
          lastMessage: '[Tin nhắn đã được thu hồi]'
        });
      }
      this.emit('messageRecalled', { msgId: String(msgId), threadId: msg.threadId });
    }
    return msg;
  }

  onNewMessage(callback) {
    this.on('newMessage', callback);
  }

  // ---------------------------------------------------------------------------
  // Tags (Customer Labels)
  // ---------------------------------------------------------------------------

  getTags() {
    let rows = this.db.prepare(`
      SELECT t.*, COUNT(ct.threadId) as customerCount 
      FROM tags t 
      LEFT JOIN conversation_tags ct ON ct.tagId = t.id 
      GROUP BY t.id 
      ORDER BY t.name ASC
    `).all();

    if (rows.length === 0) {
      this.upsertTag({ id: 'tag_vip', name: 'VIP Gold', color: '#eab308', description: 'Khách hàng VIP' });
      this.upsertTag({ id: 'tag_hot', name: 'Kèo Thơm', color: '#10b981', description: 'Cơ hội chốt cao' });
      this.upsertTag({ id: 'tag_bds', name: 'BĐS Tiềm Năng', color: '#38bdf8', description: 'Khách quan tâm BĐS' });
      this.upsertTag({ id: 'tag_new', name: 'Khách Mới', color: '#a855f7', description: 'Khách mới tương tác' });

      rows = this.db.prepare(`
        SELECT t.*, COUNT(ct.threadId) as customerCount 
        FROM tags t 
        LEFT JOIN conversation_tags ct ON ct.tagId = t.id 
        GROUP BY t.id 
        ORDER BY t.name ASC
      `).all();
    }

    return rows;
  }

  getTag(id) {
    const stmt = this.db.prepare('SELECT * FROM tags WHERE id = ?');
    return stmt.get(id);
  }

  upsertTag({ id, name, color = '#38bdf8', description = '' }) {
    const tagId = id || `tag_${crypto.randomUUID().substring(0, 8)}`;
    const stmt = this.db.prepare(`
      INSERT INTO tags (id, name, color, description)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        color = excluded.color,
        description = excluded.description
    `);
    stmt.run(tagId, name.trim(), color, description.trim());
    return this.getTag(tagId);
  }

  deleteTag(id) {
    const stmt = this.db.prepare('DELETE FROM tags WHERE id = ?');
    return stmt.run(id);
  }

  getConversationTags(threadId) {
    const stmt = this.db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN conversation_tags ct ON ct.tagId = t.id
      WHERE ct.threadId = ?
      ORDER BY t.name ASC
    `);
    return stmt.all(threadId);
  }

  addConversationTag(threadId, tagId) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO conversation_tags (threadId, tagId)
      VALUES (?, ?)
    `);
    return stmt.run(threadId, tagId);
  }

  removeConversationTag(threadId, tagId) {
    const stmt = this.db.prepare(`
      DELETE FROM conversation_tags WHERE threadId = ? AND tagId = ?
    `);
    return stmt.run(threadId, tagId);
  }

  // ---------------------------------------------------------------------------
  // Quick Messages (Templates)
  // ---------------------------------------------------------------------------

  getQuickMessages() {
    const stmt = this.db.prepare('SELECT * FROM quick_messages ORDER BY shortcut ASC');
    return stmt.all();
  }

  getQuickMessage(id) {
    const stmt = this.db.prepare('SELECT * FROM quick_messages WHERE id = ?');
    return stmt.get(id);
  }

  upsertQuickMessage({ id, shortcut, customerQuestion = '', title = '', content, mediaUrl = '', mediaType = '', mediaName = '' }) {
    const qId = id || `qm_${crypto.randomUUID().substring(0, 8)}`;
    const cleanShortcut = (shortcut || '').startsWith('/') ? shortcut : `/${shortcut || ''}`;
    const cleanTitle = title || customerQuestion || cleanShortcut;

    // If updating, cleanup unreferenced media files
    const existing = this.getQuickMessage(qId);
    if (existing && existing.mediaUrl && existing.mediaUrl !== mediaUrl) {
      this._cleanupMediaDiff(existing.mediaUrl, mediaUrl);
    }

    const stmt = this.db.prepare(`
      INSERT INTO quick_messages (id, shortcut, customerQuestion, title, content, mediaUrl, mediaType, mediaName)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        shortcut = excluded.shortcut,
        customerQuestion = excluded.customerQuestion,
        title = excluded.title,
        content = excluded.content,
        mediaUrl = excluded.mediaUrl,
        mediaType = excluded.mediaType,
        mediaName = excluded.mediaName
    `);
    stmt.run(
      qId,
      cleanShortcut.trim(),
      (customerQuestion || '').trim(),
      cleanTitle.trim(),
      (content || '').trim(),
      (mediaUrl || '').trim(),
      (mediaType || '').trim(),
      (mediaName || '').trim()
    );
    return this.getQuickMessage(qId);
  }

  deleteQuickMessage(id) {
    const existing = this.getQuickMessage(id);
    if (existing && existing.mediaUrl) {
      const urls = this._extractMediaUrls(existing.mediaUrl);
      for (const u of urls) {
        this._cleanupMediaFile(u);
      }
    }
    const stmt = this.db.prepare('DELETE FROM quick_messages WHERE id = ?');
    return stmt.run(id);
  }

  _extractMediaUrls(val) {
    if (!val) return [];
    if (typeof val === 'string' && val.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          return parsed.map(item => (typeof item === 'string' ? item : item?.mediaUrl)).filter(Boolean);
        }
      } catch (_) {}
    }
    return [String(val).trim()].filter(Boolean);
  }

  _cleanupMediaDiff(oldVal, newVal) {
    const oldUrls = this._extractMediaUrls(oldVal);
    const newUrls = new Set(this._extractMediaUrls(newVal));
    for (const u of oldUrls) {
      if (!newUrls.has(u)) {
        this._cleanupMediaFile(u);
      }
    }
  }

  _cleanupMediaFile(mediaUrl) {
    try {
      if (!mediaUrl) return;
      const filename = path.basename(mediaUrl);
      const filePath = path.resolve('data/uploads/quick-msg', filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`🗑️ Cleaned up quick message media file: ${filename}`);
      }
    } catch (err) {
      logger.warn(`Failed to cleanup quick message media file: ${err.message}`);
    }
  }



  // ---------------------------------------------------------------------------
  // Campaigns & Persistent Queue
  // ---------------------------------------------------------------------------

  _extractCampaignMedia(campaign) {
    if (!campaign) return [];
    if (Array.isArray(campaign.mediaUrls)) return campaign.mediaUrls;
    try {
      return JSON.parse(campaign.mediaUrls || '[]');
    } catch (_) {
      return [];
    }
  }

  _cleanupCampaignMediaDiff(oldItems = [], newItems = []) {
    try {
      const getFilename = (item) => {
        if (!item) return '';
        const url = typeof item === 'string' ? item : (item.mediaUrl || '');
        return path.basename(url || '');
      };
      const oldFiles = (Array.isArray(oldItems) ? oldItems : []).map(getFilename).filter(Boolean);
      const newFiles = new Set((Array.isArray(newItems) ? newItems : []).map(getFilename).filter(Boolean));

      for (const fn of oldFiles) {
        if (!newFiles.has(fn)) {
          const targetPath = path.resolve('data/uploads/campaigns', fn);
          if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
            logger.info(`🗑️ Cleaned up campaign media file: ${fn}`);
          }
        }
      }
    } catch (err) {
      logger.warn(`Error cleaning up campaign media files: ${err.message}`);
    }
  }

  getCampaigns() {
    const stmt = this.db.prepare('SELECT * FROM campaigns ORDER BY createdAt DESC');
    const rows = stmt.all();
    return rows.map(r => ({
      ...r,
      mediaUrls: this._extractCampaignMedia(r),
      targetTagIds: typeof r.targetTagIds === 'string' ? (JSON.parse(r.targetTagIds || '[]')) : (r.targetTagIds || [])
    }));
  }

  getCampaign(id) {
    const stmt = this.db.prepare('SELECT * FROM campaigns WHERE id = ?');
    const r = stmt.get(id);
    if (!r) return null;
    return {
      ...r,
      mediaUrls: this._extractCampaignMedia(r),
      targetTagIds: typeof r.targetTagIds === 'string' ? (JSON.parse(r.targetTagIds || '[]')) : (r.targetTagIds || [])
    };
  }

  createCampaign({
    id,
    name,
    description = '',
    message,
    mediaUrls = [],
    targetType = 'all',
    targetTagIds = [],
    targetKeyword = '',
    scheduleType = 'manual',
    scheduleTime = '08:30',
    scheduleMode = 'scheduled',
    startDate = '',
    recurrence = 'once',
    nextRunAt = null,
    isEnabled = 0,
    delayMinMs = 10000,
    delayMaxMs = 25000,
    batchSize = 25,
    batchPauseMs = 180000
  }) {
    const campId = id || `camp_${crypto.randomUUID().substring(0, 8)}`;
    const mediaUrlsStr = typeof mediaUrls === 'string' ? mediaUrls : JSON.stringify(mediaUrls || []);
    const targetTagIdsStr = typeof targetTagIds === 'string' ? targetTagIds : JSON.stringify(targetTagIds || []);

    const stmt = this.db.prepare(`
      INSERT INTO campaigns (
        id, name, description, message, mediaUrls, targetType, targetTagIds, targetKeyword,
        scheduleType, scheduleTime, scheduleMode, startDate, recurrence, nextRunAt,
        isEnabled, status, delayMinMs, delayMaxMs, batchSize, batchPauseMs,
        createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    stmt.run(
      campId,
      name.trim(),
      (description || '').trim(),
      message.trim(),
      mediaUrlsStr,
      targetType || 'all',
      targetTagIdsStr,
      (targetKeyword || '').trim(),
      scheduleType || 'manual',
      scheduleTime || '08:30',
      scheduleMode || 'scheduled',
      startDate || '',
      recurrence || 'once',
      nextRunAt || null,
      isEnabled ? 1 : 0,
      Number(delayMinMs) || 10000,
      Number(delayMaxMs) || 25000,
      Number(batchSize) || 25,
      Number(batchPauseMs) || 180000
    );

    return this.getCampaign(campId);
  }

  updateCampaign(id, {
    name,
    description,
    message,
    mediaUrls,
    targetType,
    targetTagIds,
    targetKeyword,
    scheduleType,
    scheduleTime,
    scheduleMode,
    startDate,
    recurrence,
    nextRunAt,
    isEnabled,
    delayMinMs,
    delayMaxMs,
    batchSize,
    batchPauseMs
  }) {
    const old = this.getCampaign(id);
    if (!old) return null;

    if (mediaUrls !== undefined) {
      this._cleanupCampaignMediaDiff(old.mediaUrls, mediaUrls);
    }

    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description.trim()); }
    if (message !== undefined) { updates.push('message = ?'); params.push(message.trim()); }
    if (mediaUrls !== undefined) {
      updates.push('mediaUrls = ?');
      params.push(typeof mediaUrls === 'string' ? mediaUrls : JSON.stringify(mediaUrls || []));
    }
    if (targetType !== undefined) { updates.push('targetType = ?'); params.push(targetType); }
    if (targetTagIds !== undefined) {
      updates.push('targetTagIds = ?');
      params.push(typeof targetTagIds === 'string' ? targetTagIds : JSON.stringify(targetTagIds || []));
    }
    if (targetKeyword !== undefined) { updates.push('targetKeyword = ?'); params.push(targetKeyword.trim()); }
    if (scheduleType !== undefined) { updates.push('scheduleType = ?'); params.push(scheduleType); }
    if (scheduleTime !== undefined) { updates.push('scheduleTime = ?'); params.push(scheduleTime); }
    if (scheduleMode !== undefined) { updates.push('scheduleMode = ?'); params.push(scheduleMode); }
    if (startDate !== undefined) { updates.push('startDate = ?'); params.push(startDate); }
    if (recurrence !== undefined) { updates.push('recurrence = ?'); params.push(recurrence); }
    if (nextRunAt !== undefined) { updates.push('nextRunAt = ?'); params.push(nextRunAt); }
    if (isEnabled !== undefined) { updates.push('isEnabled = ?'); params.push(isEnabled ? 1 : 0); }
    if (delayMinMs !== undefined) { updates.push('delayMinMs = ?'); params.push(Number(delayMinMs) || 10000); }
    if (delayMaxMs !== undefined) { updates.push('delayMaxMs = ?'); params.push(Number(delayMaxMs) || 25000); }
    if (batchSize !== undefined) { updates.push('batchSize = ?'); params.push(Number(batchSize) || 25); }
    if (batchPauseMs !== undefined) { updates.push('batchPauseMs = ?'); params.push(Number(batchPauseMs) || 180000); }

    updates.push("updatedAt = datetime('now')");

    if (updates.length > 0) {
      const sql = `UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`;
      params.push(id);
      this.db.prepare(sql).run(...params);
    }

    return this.getCampaign(id);
  }

  deleteCampaign(id) {
    const old = this.getCampaign(id);
    if (old) {
      this._cleanupCampaignMediaDiff(old.mediaUrls, []);
    }
    this.db.prepare('DELETE FROM campaign_queue WHERE campaignId = ?').run(id);
    this.db.prepare('DELETE FROM campaign_logs WHERE campaignId = ?').run(id);
    this.db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    return true;
  }

  toggleCampaign(id, isEnabled) {
    const val = isEnabled ? 1 : 0;
    this.db.prepare("UPDATE campaigns SET isEnabled = ?, updatedAt = datetime('now') WHERE id = ?").run(val, id);
    return this.getCampaign(id);
  }

  updateCampaignStatus(id, { status, totalCount, sentCount, failedCount, lastRunAt }) {
    let sql = 'UPDATE campaigns SET ';
    const updates = [];
    const params = [];

    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (totalCount !== undefined) { updates.push('totalCount = ?'); params.push(totalCount); }
    if (sentCount !== undefined) { updates.push('sentCount = ?'); params.push(sentCount); }
    if (failedCount !== undefined) { updates.push('failedCount = ?'); params.push(failedCount); }
    if (lastRunAt !== undefined) { updates.push('lastRunAt = ?'); params.push(lastRunAt); }

    if (updates.length === 0) return;
    updates.push("updatedAt = datetime('now')");
    sql += updates.join(', ') + ' WHERE id = ?';
    params.push(id);

    this.db.prepare(sql).run(...params);
  }

  getCampaignTargets({ targetType = 'all', targetTagIds = [], targetKeyword = '' } = {}) {
    let sql = `
      SELECT DISTINCT c.id as threadId, c.name as customerName, c.isGroup 
      FROM conversations c
      INNER JOIN messages m ON m.threadId = c.id
    `;
    const params = [];

    let parsedTags = [];
    if (Array.isArray(targetTagIds)) {
      parsedTags = targetTagIds.filter(Boolean);
    } else if (typeof targetTagIds === 'string' && targetTagIds.trim()) {
      try {
        const p = JSON.parse(targetTagIds);
        parsedTags = Array.isArray(p) ? p.filter(Boolean) : [targetTagIds];
      } catch (_) {
        parsedTags = [targetTagIds];
      }
    }

    if (parsedTags.length > 0 && !parsedTags.includes('all')) {
      const placeholders = parsedTags.map(() => '?').join(',');
      sql += ` INNER JOIN conversation_tags ct ON ct.threadId = c.id AND ct.tagId IN (${placeholders})`;
      params.push(...parsedTags);
    }

    if (targetType === 'direct') {
      sql += ` WHERE c.isGroup = 0`;
    } else if (targetType === 'group') {
      sql += ` WHERE c.isGroup = 1`;
    } else {
      sql += ` WHERE 1=1`;
    }

    if (targetKeyword && targetKeyword.trim()) {
      const kw = `%${targetKeyword.trim()}%`;
      sql += ` AND (c.name LIKE ? OR c.phone LIKE ? OR m.text LIKE ?)`;
      params.push(kw, kw, kw);
    }

    return this.db.prepare(sql).all(...params);
  }

  initCampaignQueue(campaignId, targets) {
    this.db.prepare('DELETE FROM campaign_queue WHERE campaignId = ?').run(campaignId);
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO campaign_queue (id, campaignId, threadId, customerName, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);

    for (const t of targets) {
      insertStmt.run(`q_${crypto.randomUUID().substring(0, 8)}`, campaignId, t.threadId, t.customerName || 'Khách hàng');
    }
  }

  getNextQueueItem(campaignId) {
    const stmt = this.db.prepare(`
      SELECT * FROM campaign_queue WHERE campaignId = ? AND status = 'pending' LIMIT 1
    `);
    return stmt.get(campaignId);
  }

  updateQueueItem(id, { status, error = '' }) {
    const stmt = this.db.prepare(`
      UPDATE campaign_queue 
      SET status = ?, error = ?, sentAt = datetime('now') 
      WHERE id = ?
    `);
    stmt.run(status, error, id);
  }

  logCampaignSend({ campaignId, threadId, customerName, sentContent, status, error = '' }) {
    const stmt = this.db.prepare(`
      INSERT INTO campaign_logs (id, campaignId, threadId, customerName, sentContent, status, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(`log_${crypto.randomUUID().substring(0, 8)}`, campaignId, threadId, customerName, sentContent, status, error);
  }

  getCampaignLogs(campaignId) {
    const stmt = this.db.prepare(`
      SELECT * FROM campaign_logs WHERE campaignId = ? ORDER BY sentAt DESC LIMIT 100
    `);
    return stmt.all(campaignId);
  }

  getCampaignSentToday(campaignId = null) {
    let sql = `SELECT COUNT(*) as count FROM campaign_logs WHERE status = 'success' AND date(sentAt) = date('now')`;
    const params = [];
    if (campaignId) {
      sql += ' AND campaignId = ?';
      params.push(campaignId);
    }
    const res = this.db.prepare(sql).get(...params);
    return res ? res.count : 0;
  }

  // ---------------------------------------------------------------------------
  // AI Settings & Automation Suite
  // ---------------------------------------------------------------------------
  getAiSettings(id = 'default') {
    let row = this.db.prepare('SELECT * FROM ai_settings WHERE id = ?').get(id);
    if (!row) {
      this.db.prepare("INSERT OR IGNORE INTO ai_settings (id) VALUES (?)").run(id);
      row = this.db.prepare('SELECT * FROM ai_settings WHERE id = ?').get(id);
    }
    return row || {
      id: 'default',
      isEnabled: 0,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      baseUrl: '',
      apiKeyEncrypted: '',
      timeoutMs: 15000,
      fallbackEnabled: 0,
      fallbackProvider: 'openai',
      fallbackModel: 'deepseek-chat',
      fallbackBaseUrl: 'https://api.deepseek.com/v1',
      fallbackApiKeyEncrypted: '',
      fallbackTimeoutMs: 12000,
      soulPrompt: '',
      memoryPrompt: '',
      fewShotPrompt: '',
      scopePrompt: '',
      exemplarConversation: '',
      allowGroups: 0,
      autoTagNewLead: 0,
      defaultLeadTagId: '',
      targetMode: 'all',
      excludedTagIds: '[]',
      allowedTagIds: '[]',
      adminCooldownMinutes: 15,
      debounceSeconds: 3
    };
  }

  saveAiSettings(data, id = 'default') {
    const current = this.getAiSettings(id);
    const updated = { ...current, ...data };
    
    const stmt = this.db.prepare(`
      INSERT INTO ai_settings (
        id, isEnabled, provider, model, baseUrl, apiKeyEncrypted, timeoutMs,
        fallbackEnabled, fallbackProvider, fallbackModel, fallbackBaseUrl, fallbackApiKeyEncrypted, fallbackTimeoutMs,
        soulPrompt, memoryPrompt, fewShotPrompt, scopePrompt, exemplarConversation,
        allowGroups, autoTagNewLead, defaultLeadTagId, targetMode, excludedTagIds, allowedTagIds,
        adminCooldownMinutes, debounceSeconds, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        isEnabled = excluded.isEnabled,
        provider = excluded.provider,
        model = excluded.model,
        baseUrl = excluded.baseUrl,
        apiKeyEncrypted = excluded.apiKeyEncrypted,
        timeoutMs = excluded.timeoutMs,
        fallbackEnabled = excluded.fallbackEnabled,
        fallbackProvider = excluded.fallbackProvider,
        fallbackModel = excluded.fallbackModel,
        fallbackBaseUrl = excluded.fallbackBaseUrl,
        fallbackApiKeyEncrypted = excluded.fallbackApiKeyEncrypted,
        fallbackTimeoutMs = excluded.fallbackTimeoutMs,
        soulPrompt = excluded.soulPrompt,
        memoryPrompt = excluded.memoryPrompt,
        fewShotPrompt = excluded.fewShotPrompt,
        scopePrompt = excluded.scopePrompt,
        exemplarConversation = excluded.exemplarConversation,
        allowGroups = excluded.allowGroups,
        autoTagNewLead = excluded.autoTagNewLead,
        defaultLeadTagId = excluded.defaultLeadTagId,
        targetMode = excluded.targetMode,
        excludedTagIds = excluded.excludedTagIds,
        allowedTagIds = excluded.allowedTagIds,
        adminCooldownMinutes = excluded.adminCooldownMinutes,
        debounceSeconds = excluded.debounceSeconds,
        updatedAt = datetime('now')
    `);

    stmt.run(
      id,
      updated.isEnabled ? 1 : 0,
      updated.provider || 'gemini',
      updated.model || 'gemini-2.5-flash',
      updated.baseUrl || '',
      updated.apiKeyEncrypted || '',
      Number(updated.timeoutMs || 15000),
      updated.fallbackEnabled ? 1 : 0,
      updated.fallbackProvider || 'openai',
      updated.fallbackModel || 'deepseek-chat',
      updated.fallbackBaseUrl || '',
      updated.fallbackApiKeyEncrypted || '',
      Number(updated.fallbackTimeoutMs || 12000),
      updated.soulPrompt || '',
      updated.memoryPrompt || '',
      updated.fewShotPrompt || '',
      updated.scopePrompt || '',
      typeof updated.exemplarConversation === 'object' ? JSON.stringify(updated.exemplarConversation) : (updated.exemplarConversation || ''),
      updated.allowGroups ? 1 : 0,
      updated.autoTagNewLead ? 1 : 0,
      updated.defaultLeadTagId || '',
      updated.targetMode || 'all',
      typeof updated.excludedTagIds === 'string' ? updated.excludedTagIds : JSON.stringify(updated.excludedTagIds || []),
      typeof updated.allowedTagIds === 'string' ? updated.allowedTagIds : JSON.stringify(updated.allowedTagIds || []),
      Number(updated.adminCooldownMinutes ?? 15),
      Number(updated.debounceSeconds ?? 3)
    );

    return this.getAiSettings(id);
  }

  getLastAdminMessageTime(threadId) {
    if (!threadId) return 0;
    const row = this.db.prepare(`
      SELECT timestamp FROM messages 
      WHERE threadId = ? AND isSelf = 1 AND isBot = 0 
      ORDER BY timestamp DESC LIMIT 1
    `).get(threadId);
    return row?.timestamp ? new Date(row.timestamp).getTime() : 0;
  }

  setConversationAi(threadId, enabled) {
    if (!threadId) return null;
    const val = enabled ? 1 : 0;
    this.upsertConversation({ id: threadId, name: threadId });
    this.db.prepare(`UPDATE conversations SET aiEnabled = ?, updatedAt = datetime('now') WHERE id = ?`).run(val, threadId);
    return this.getConversation(threadId);
  }
}

export const localStore = new LocalStore();
