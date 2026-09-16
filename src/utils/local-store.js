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
      CREATE TABLE IF NOT EXISTS accounts (
        accountUid   TEXT PRIMARY KEY,
        displayName  TEXT NOT NULL DEFAULT '',
        avatar       TEXT DEFAULT '',
        phone        TEXT DEFAULT '',
        sessionFile  TEXT DEFAULT '',
        isDefault    INTEGER DEFAULT 0,
        status       TEXT DEFAULT 'offline',
        createdAt    TEXT DEFAULT (datetime('now')),
        updatedAt    TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT NOT NULL,
        accountUid  TEXT NOT NULL DEFAULT 'default',
        name        TEXT NOT NULL DEFAULT '',
        avatar      TEXT DEFAULT '',
        isGroup     INTEGER DEFAULT 0,
        lastMessage TEXT DEFAULT '',
        lastTime    TEXT DEFAULT '',
        unreadCount INTEGER DEFAULT 0,
        isPinned    INTEGER DEFAULT 0,
        channel     TEXT DEFAULT 'personal',
        oaId        TEXT DEFAULT '',
        isFollower  INTEGER DEFAULT 0,
        lastUserMessageTime INTEGER DEFAULT NULL,
        customerPhone TEXT DEFAULT '',
        aiEnabled   INTEGER DEFAULT 1,
        phone       TEXT DEFAULT '',
        email       TEXT DEFAULT '',
        address     TEXT DEFAULT '',
        needs       TEXT DEFAULT '',
        notes       TEXT DEFAULT '',
        updatedAt   TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (accountUid, id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT NOT NULL,
        accountUid  TEXT NOT NULL DEFAULT 'default',
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
        channel     TEXT DEFAULT 'personal',
        oaMsgId     TEXT DEFAULT '',
        PRIMARY KEY (accountUid, id)
      );

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
        botAliases              TEXT DEFAULT '',
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

          -- 2. Conversation Tags (Many-to-Many Shared Across Accounts)
          CREATE TABLE IF NOT EXISTS conversation_tags (
            threadId    TEXT NOT NULL,
            tagId       TEXT NOT NULL,
            createdAt   TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (threadId, tagId),
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
      if (!convColumns.includes('isPinned')) this.db.exec("ALTER TABLE conversations ADD COLUMN isPinned INTEGER DEFAULT 0;");
      if (!convColumns.includes('channel')) this.db.exec("ALTER TABLE conversations ADD COLUMN channel TEXT DEFAULT 'personal';");
      if (!convColumns.includes('oaId')) this.db.exec("ALTER TABLE conversations ADD COLUMN oaId TEXT DEFAULT '';");
      if (!convColumns.includes('isFollower')) this.db.exec("ALTER TABLE conversations ADD COLUMN isFollower INTEGER DEFAULT 0;");
      if (!convColumns.includes('lastUserMessageTime')) this.db.exec("ALTER TABLE conversations ADD COLUMN lastUserMessageTime INTEGER DEFAULT NULL;");
      if (!convColumns.includes('customerPhone')) this.db.exec("ALTER TABLE conversations ADD COLUMN customerPhone TEXT DEFAULT '';");

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
      if (!msgColumns.includes('channel')) {
        this.db.exec("ALTER TABLE messages ADD COLUMN channel TEXT DEFAULT 'personal';");
      }
      if (!msgColumns.includes('oaMsgId')) {
        this.db.exec("ALTER TABLE messages ADD COLUMN oaMsgId TEXT DEFAULT '';");
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
          botAliases              TEXT DEFAULT '',
          autoTagNewLead          INTEGER DEFAULT 0,
          defaultLeadTagId        TEXT DEFAULT '',
          targetMode              TEXT DEFAULT 'all',
          excludedTagIds          TEXT DEFAULT '[]',
          allowedTagIds           TEXT DEFAULT '[]',
          adminCooldownMinutes    INTEGER DEFAULT 15,
          debounceSeconds         INTEGER DEFAULT 3,
          wikiSourceUrl           TEXT DEFAULT '',
          updatedAt               TEXT DEFAULT (datetime('now'))
        );
      `);
      this.db.prepare("INSERT OR IGNORE INTO ai_settings (id) VALUES ('default');").run();
      const aiCols = this.db.prepare("PRAGMA table_info('ai_settings');").all().map(c => c.name);
      if (!aiCols.includes('allowGroups'))          this.db.exec("ALTER TABLE ai_settings ADD COLUMN allowGroups INTEGER DEFAULT 0;");
      if (!aiCols.includes('botAliases'))           this.db.exec("ALTER TABLE ai_settings ADD COLUMN botAliases TEXT DEFAULT '';");
      if (!aiCols.includes('debounceSeconds'))      this.db.exec("ALTER TABLE ai_settings ADD COLUMN debounceSeconds INTEGER DEFAULT 3;");
      if (!aiCols.includes('apiKeyEncrypted'))      this.db.exec("ALTER TABLE ai_settings ADD COLUMN apiKeyEncrypted TEXT DEFAULT '';");
      if (!aiCols.includes('fallbackApiKeyEncrypted')) this.db.exec("ALTER TABLE ai_settings ADD COLUMN fallbackApiKeyEncrypted TEXT DEFAULT '';");
      if (!aiCols.includes('wikiSourceUrl'))        this.db.exec("ALTER TABLE ai_settings ADD COLUMN wikiSourceUrl TEXT DEFAULT '';");

      // Multi-Profile AI Suite Table & Reconciliation
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ai_profiles (
          id                   TEXT PRIMARY KEY,
          name                 TEXT NOT NULL,
          icon                 TEXT DEFAULT '🤖',
          description          TEXT DEFAULT '',
          isDefault            INTEGER DEFAULT 0,
          model                TEXT DEFAULT '',
          temperature          REAL DEFAULT 0.7,
          soulPrompt           TEXT DEFAULT '',
          memoryPrompt         TEXT DEFAULT '',
          fewShotPrompt        TEXT DEFAULT '',
          exemplarConversation TEXT DEFAULT '',
          scopePrompt          TEXT DEFAULT '',
          wikiSourceUrl        TEXT DEFAULT '',
          createdAt            TEXT DEFAULT (datetime('now')),
          updatedAt            TEXT DEFAULT (datetime('now'))
        );
      `);

      // Auto-Migration: If ai_profiles is empty, migrate current ai_settings into 'default' profile
      const profileCount = this.db.prepare("SELECT COUNT(*) as count FROM ai_profiles;").get()?.count || 0;
      if (profileCount === 0) {
        const currentAi = this.db.prepare("SELECT * FROM ai_settings WHERE id = 'default'").get() || {};
        this.db.prepare(`
          INSERT OR IGNORE INTO ai_profiles (
            id, name, icon, description, isDefault, model, temperature,
            soulPrompt, memoryPrompt, fewShotPrompt, exemplarConversation, scopePrompt, wikiSourceUrl, createdAt, updatedAt
          ) VALUES (
            'default', 'Trợ Lý Mặc Định', '🤖', 'Hồ sơ mặc định được chuyển đổi tự động từ AI Suite', 1, '', 0.7,
            ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
          );
        `).run(
          currentAi.soulPrompt || '',
          currentAi.memoryPrompt || '',
          currentAi.fewShotPrompt || '',
          currentAi.exemplarConversation || '',
          currentAi.scopePrompt || '',
          currentAi.wikiSourceUrl || ''
        );
        logger.info('✅ [Multi-Profile Migration] Successfully seeded default AI profile from existing ai_settings!');
      }

      // Scheduled Messages (1-1 Direct In-Thread Scheduling) Table & Indexes
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_messages (
          id           TEXT PRIMARY KEY,
          threadId     TEXT NOT NULL,
          customerName TEXT DEFAULT '',
          message      TEXT NOT NULL,
          mediaUrl     TEXT DEFAULT '',
          mediaName    TEXT DEFAULT '',
          scheduledAt  INTEGER NOT NULL,
          status       TEXT DEFAULT 'pending',
          error        TEXT DEFAULT '',
          sentAt       INTEGER DEFAULT NULL,
          createdAt    INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_sched_thread ON scheduled_messages(threadId, status);
        CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_messages(status, scheduledAt);
      `);

      const schedCols = this.db.prepare("PRAGMA table_info('scheduled_messages');").all().map(c => c.name);
      if (!schedCols.includes('mediaUrl'))  this.db.exec("ALTER TABLE scheduled_messages ADD COLUMN mediaUrl TEXT DEFAULT '';");
      if (!schedCols.includes('mediaName')) this.db.exec("ALTER TABLE scheduled_messages ADD COLUMN mediaName TEXT DEFAULT '';");

      // Zalo Official Account (OA) Settings Table & System Configs
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS oa_settings (
          id                      TEXT PRIMARY KEY DEFAULT 'default',
          oaId                    TEXT DEFAULT '',
          name                    TEXT DEFAULT '',
          avatar                  TEXT DEFAULT '',
          appId                   TEXT DEFAULT '',
          secretKeyEncrypted      TEXT DEFAULT '',
          accessTokenEncrypted    TEXT DEFAULT '',
          refreshTokenEncrypted   TEXT DEFAULT '',
          expiresAt               INTEGER DEFAULT 0,
          isEnabled               INTEGER DEFAULT 0,
          isAiAutoReply           INTEGER DEFAULT 0,
          updatedAt               TEXT DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO oa_settings (id, isEnabled) VALUES ('default', 0);

        CREATE TABLE IF NOT EXISTS system_configs (
          key       TEXT PRIMARY KEY,
          value     TEXT DEFAULT '',
          updatedAt TEXT DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO system_configs (key, value) VALUES ('onboarding_status', 'pending');
      `);

      // Cleanup: Sửa tận gốc các hội thoại rỗng bị gán timestamp giả khi khởi tạo
      this.db.exec("UPDATE conversations SET lastTime = NULL WHERE (lastMessage = '' OR lastMessage IS NULL) AND lastTime IS NOT NULL;");

      // -----------------------------------------------------------------------
      // Multi-Account Suite: Accounts Table & Composite Primary Keys
      // -----------------------------------------------------------------------
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          accountUid   TEXT PRIMARY KEY,
          displayName  TEXT NOT NULL DEFAULT '',
          avatar       TEXT DEFAULT '',
          phone        TEXT DEFAULT '',
          sessionFile  TEXT DEFAULT '',
          isDefault    INTEGER DEFAULT 0,
          status       TEXT DEFAULT 'offline',
          createdAt    TEXT DEFAULT (datetime('now')),
          updatedAt    TEXT DEFAULT (datetime('now'))
        );
      `);

      const accCols = this.db.prepare("PRAGMA table_info('accounts');").all().map(c => c.name);
      if (!accCols.includes('aiProfileId')) {
        this.db.exec("ALTER TABLE accounts ADD COLUMN aiProfileId TEXT DEFAULT 'default';");
      }

      // Detach obsolete foreign keys from conversation_tags and scheduled_messages
      try {
        const ctFks = this.db.prepare("PRAGMA foreign_key_list('conversation_tags');").all();
        if (ctFks.some(f => f.table === 'conversations')) {
          this.db.exec('PRAGMA foreign_keys = OFF;');
          this.db.exec(`
            CREATE TABLE conversation_tags_v5 (
              threadId    TEXT NOT NULL,
              tagId       TEXT NOT NULL,
              createdAt   TEXT DEFAULT (datetime('now')),
              PRIMARY KEY (threadId, tagId),
              FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
            );
            INSERT OR IGNORE INTO conversation_tags_v5 (threadId, tagId, createdAt)
            SELECT threadId, tagId, createdAt FROM conversation_tags;
            DROP TABLE conversation_tags;
            ALTER TABLE conversation_tags_v5 RENAME TO conversation_tags;
          `);
          this.db.exec('PRAGMA foreign_keys = ON;');
        }
      } catch {}

      try {
        const smFks = this.db.prepare("PRAGMA foreign_key_list('scheduled_messages');").all();
        if (smFks.some(f => f.table === 'conversations')) {
          this.db.exec('PRAGMA foreign_keys = OFF;');
          this.db.exec(`
            CREATE TABLE scheduled_messages_v5 (
              id           TEXT PRIMARY KEY,
              threadId     TEXT NOT NULL,
              message      TEXT NOT NULL,
              mediaUrl     TEXT DEFAULT '',
              mediaName    TEXT DEFAULT '',
              scheduledAt  INTEGER NOT NULL,
              status       TEXT DEFAULT 'pending',
              error        TEXT DEFAULT '',
              sentAt       INTEGER DEFAULT NULL,
              createdAt    INTEGER DEFAULT (strftime('%s', 'now') * 1000)
            );
            INSERT OR IGNORE INTO scheduled_messages_v5 (id, threadId, message, mediaUrl, mediaName, scheduledAt, status, error, sentAt, createdAt)
            SELECT id, threadId, message, mediaUrl, mediaName, scheduledAt, status, error, sentAt, createdAt FROM scheduled_messages;
            DROP TABLE scheduled_messages;
            ALTER TABLE scheduled_messages_v5 RENAME TO scheduled_messages;
            CREATE INDEX IF NOT EXISTS idx_sched_thread ON scheduled_messages(threadId, status);
            CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_messages(status, scheduledAt);
          `);
          this.db.exec('PRAGMA foreign_keys = ON;');
        }
      } catch {}

      const campColsAll = this.db.prepare("PRAGMA table_info('campaigns');").all().map(c => c.name);
      if (!campColsAll.includes('accountUid')) {
        this.db.exec("ALTER TABLE campaigns ADD COLUMN accountUid TEXT DEFAULT '';");
      }

      // Check if conversations has composite primary key (accountUid, id)
      const convTableInfo = this.db.prepare("PRAGMA table_info('conversations');").all();
      const hasAccountUidCol = convTableInfo.some(c => c.name === 'accountUid');
      if (!hasAccountUidCol) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN accountUid TEXT DEFAULT 'default';");
      }
      if (!convTableInfo.some(c => c.name === 'aiProfileId')) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN aiProfileId TEXT DEFAULT NULL;");
      }
      const msgTableInfo = this.db.prepare("PRAGMA table_info('messages');").all();
      const hasMsgAccountUid = msgTableInfo.some(c => c.name === 'accountUid');
      if (!hasMsgAccountUid) {
        this.db.exec("ALTER TABLE messages ADD COLUMN accountUid TEXT DEFAULT 'default';");
      }

      const pkCols = this.db.prepare("PRAGMA table_info('conversations');").all().filter(c => c.pk > 0);
      const isCompositePk = pkCols.length >= 2 && pkCols.some(c => c.name === 'accountUid');

      if (!isCompositePk) {
        logger.info('🔄 [Multi-Account Migration] Upgrading conversations and messages to Composite Primary Key (accountUid, id)...');
        this.db.exec('PRAGMA foreign_keys = OFF;');
        this.db.exec('BEGIN IMMEDIATE;');
        try {
          // 1. Rebuild conversations
          this.db.exec(`
            CREATE TABLE conversations_v5 (
              id          TEXT NOT NULL,
              accountUid  TEXT NOT NULL DEFAULT 'default',
              name        TEXT NOT NULL DEFAULT '',
              avatar      TEXT DEFAULT '',
              isGroup     INTEGER DEFAULT 0,
              lastMessage TEXT DEFAULT '',
              lastTime    TEXT DEFAULT '',
              unreadCount INTEGER DEFAULT 0,
              isPinned    INTEGER DEFAULT 0,
              channel     TEXT DEFAULT 'personal',
              oaId        TEXT DEFAULT '',
              isFollower  INTEGER DEFAULT 0,
              lastUserMessageTime INTEGER DEFAULT NULL,
              customerPhone TEXT DEFAULT '',
              aiEnabled   INTEGER DEFAULT 1,
              aiProfileId TEXT DEFAULT NULL,
              phone       TEXT DEFAULT '',
              email       TEXT DEFAULT '',
              address     TEXT DEFAULT '',
              needs       TEXT DEFAULT '',
              notes       TEXT DEFAULT '',
              updatedAt   TEXT DEFAULT (datetime('now')),
              PRIMARY KEY (accountUid, id)
            );

            INSERT OR IGNORE INTO conversations_v5 (
              id, accountUid, name, avatar, isGroup, lastMessage, lastTime, unreadCount, isPinned, channel, oaId, isFollower, lastUserMessageTime, customerPhone, aiEnabled, aiProfileId, phone, email, address, needs, notes, updatedAt
            )
            SELECT 
              id, COALESCE(NULLIF(accountUid, ''), 'default'), name, avatar, isGroup, lastMessage, lastTime, unreadCount, isPinned, channel, oaId, isFollower, lastUserMessageTime, customerPhone, aiEnabled, NULL, phone, email, address, needs, notes, updatedAt
            FROM conversations;

            DROP TABLE conversations;
            ALTER TABLE conversations_v5 RENAME TO conversations;
            CREATE INDEX IF NOT EXISTS idx_conv_account ON conversations(accountUid, isPinned DESC, updatedAt DESC);

            -- 2. Rebuild messages
            CREATE TABLE messages_v5 (
              id          TEXT NOT NULL,
              accountUid  TEXT NOT NULL DEFAULT 'default',
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
              channel     TEXT DEFAULT 'personal',
              oaMsgId     TEXT DEFAULT '',
              PRIMARY KEY (accountUid, id)
            );

            INSERT OR IGNORE INTO messages_v5 (
              id, accountUid, threadId, senderId, senderName, text, isSelf, isBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled, channel, oaMsgId
            )
            SELECT 
              id, COALESCE(NULLIF(accountUid, ''), 'default'), threadId, senderId, senderName, text, isSelf, isBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled, channel, oaMsgId
            FROM messages;

            DROP TABLE messages;
            ALTER TABLE messages_v5 RENAME TO messages;
            CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(accountUid, threadId, timestamp DESC);
          `);

          this.db.exec('COMMIT;');
          logger.info('✅ [Multi-Account Migration] Successfully upgraded to Composite Primary Keys without data loss!');
        } catch (migErr) {
          this.db.exec('ROLLBACK;');
          logger.error(`❌ [Multi-Account Migration] Rebuild failed: ${migErr.message}`);
          throw migErr;
        } finally {
          this.db.exec('PRAGMA foreign_keys = ON;');
        }
      }

      // Auto-detect and link existing data to primary account
      const selfMsg = this.db.prepare("SELECT senderId, senderName FROM messages WHERE isSelf = 1 AND senderId != '' LIMIT 1").get();
      if (selfMsg && selfMsg.senderId) {
        const primaryUid = String(selfMsg.senderId);
        const primaryName = selfMsg.senderName || 'Phan Lê Khoa';
        
        this.db.prepare(`
          INSERT OR IGNORE INTO accounts (accountUid, displayName, sessionFile, isDefault, status)
          VALUES (?, ?, 'zalo_default', 1, 'offline')
        `).run(primaryUid, primaryName);

        this.db.prepare("UPDATE conversations SET accountUid = ? WHERE accountUid = 'default' OR accountUid = ''").run(primaryUid);
        this.db.prepare("UPDATE messages SET accountUid = ? WHERE accountUid = 'default' OR accountUid = ''").run(primaryUid);
      }

    } catch (err) {
      logger.warn(`Migration notice: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Account Management Suite (Multi-Account Parallel Architecture)
  // ---------------------------------------------------------------------------
  getAccounts() {
    return this.db.prepare('SELECT * FROM accounts ORDER BY isDefault DESC, createdAt ASC').all().map(acc => ({
      ...acc,
      isDefault: Boolean(acc.isDefault)
    }));
  }

  getAccount(accountUid) {
    if (!accountUid) return null;
    const row = this.db.prepare('SELECT * FROM accounts WHERE accountUid = ?').get(String(accountUid));
    if (!row) return null;
    return {
      ...row,
      isDefault: Boolean(row.isDefault)
    };
  }

  getDefaultAccount() {
    const row = this.db.prepare('SELECT * FROM accounts WHERE isDefault = 1 LIMIT 1').get()
      || this.db.prepare('SELECT * FROM accounts LIMIT 1').get();
    if (!row) return null;
    return {
      ...row,
      isDefault: Boolean(row.isDefault)
    };
  }

  upsertAccount(acc) {
    if (!acc || !acc.accountUid) return null;
    const accountUid = String(acc.accountUid);
    const existing = this.getAccount(accountUid);
    const displayName = acc.displayName !== undefined ? acc.displayName : (existing?.displayName || 'Zalo User');
    const avatar = acc.avatar !== undefined ? acc.avatar : (existing?.avatar || '');
    const phone = acc.phone !== undefined ? acc.phone : (existing?.phone || '');
    const sessionFile = acc.sessionFile !== undefined ? acc.sessionFile : (existing?.sessionFile || `zalo_${accountUid}`);
    const isDefault = acc.isDefault !== undefined ? (acc.isDefault ? 1 : 0) : (existing?.isDefault ? 1 : 0);
    const status = acc.status !== undefined ? acc.status : (existing?.status || 'offline');
    const aiProfileId = acc.aiProfileId !== undefined ? acc.aiProfileId : (existing?.aiProfileId || 'default');
    const updatedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO accounts (accountUid, displayName, avatar, phone, sessionFile, isDefault, status, aiProfileId, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(accountUid) DO UPDATE SET
        displayName = excluded.displayName,
        avatar = CASE WHEN excluded.avatar != '' THEN excluded.avatar ELSE accounts.avatar END,
        phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE accounts.phone END,
        sessionFile = CASE WHEN excluded.sessionFile != '' THEN excluded.sessionFile ELSE accounts.sessionFile END,
        isDefault = excluded.isDefault,
        status = excluded.status,
        aiProfileId = CASE WHEN excluded.aiProfileId != '' THEN excluded.aiProfileId ELSE accounts.aiProfileId END,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(accountUid, displayName, avatar, phone, sessionFile, isDefault, status, aiProfileId, updatedAt);
    return this.getAccount(accountUid);
  }

  deleteAccount(accountUid, { deleteData = false } = {}) {
    if (!accountUid) return false;
    const uid = String(accountUid);
    if (deleteData) {
      this.db.prepare('DELETE FROM conversation_tags WHERE threadId IN (SELECT id FROM conversations WHERE accountUid = ?)').run(uid);
      this.db.prepare('DELETE FROM messages WHERE accountUid = ?').run(uid);
      this.db.prepare('DELETE FROM conversations WHERE accountUid = ?').run(uid);
    }
    this.db.prepare('DELETE FROM accounts WHERE accountUid = ?').run(uid);
    return true;
  }

  setDefaultAccount(accountUid) {
    if (!accountUid) return;
    this.db.prepare('UPDATE accounts SET isDefault = 0').run();
    this.db.prepare("UPDATE accounts SET isDefault = 1, updatedAt = datetime('now') WHERE accountUid = ?").run(String(accountUid));
  }

  updateAccountStatus(accountUid, status) {
    if (!accountUid) return;
    this.db.prepare("UPDATE accounts SET status = ?, updatedAt = datetime('now') WHERE accountUid = ?").run(String(status), String(accountUid));
  }

  // ---------------------------------------------------------------------------
  // CRM Information
  // ---------------------------------------------------------------------------
  getCrmInfo(threadId, accountUid = null) {
    if (!threadId) return {};
    let stmt;
    let res;
    if (accountUid && accountUid !== 'all') {
      stmt = this.db.prepare('SELECT name, phone, email, address, needs, notes FROM conversations WHERE id = ? AND accountUid = ?');
      res = stmt.get(threadId, accountUid);
    } else {
      stmt = this.db.prepare('SELECT name, phone, email, address, needs, notes FROM conversations WHERE id = ? ORDER BY updatedAt DESC LIMIT 1');
      res = stmt.get(threadId);
    }
    return res || { name: '', phone: '', email: '', address: '', needs: '', notes: '' };
  }

  saveCrmInfo(threadId, { name = '', phone = '', email = '', address = '', needs = '', notes = '' } = {}, accountUid = null) {
    if (!threadId) return;
    const resolvedAccountUid = accountUid || this.getDefaultAccount()?.accountUid || 'default';
    this.upsertConversation({ id: threadId, name: threadId, accountUid: resolvedAccountUid });
    const current = this.getConversation(threadId, resolvedAccountUid);
    const finalName = name && name.trim() ? name.trim() : (current?.name || threadId);
    const stmt = this.db.prepare(`
      UPDATE conversations 
      SET name = ?, phone = ?, email = ?, address = ?, needs = ?, notes = ?, updatedAt = datetime('now')
      WHERE id = ? AND accountUid = ?
    `);
    stmt.run(finalName, phone.trim(), email.trim(), address.trim(), needs.trim(), notes.trim(), threadId, resolvedAccountUid);
    return this.getCrmInfo(threadId, resolvedAccountUid);
  }

  // ---------------------------------------------------------------------------
  // Conversations & Messages
  // ---------------------------------------------------------------------------

  upsertConversation(conv) {
    if (!conv || !conv.id) return;

    const accountUid = String(conv.accountUid || this.getDefaultAccount()?.accountUid || 'default');
    const existing = this.getConversation(conv.id, accountUid);
    const name = conv.name !== undefined ? conv.name : (existing?.name || conv.id);
    const avatar = conv.avatar !== undefined ? conv.avatar : (existing?.avatar || '');
    const isGroup = (existing?.isGroup || conv.isGroup) ? 1 : 0;
    
    // Protect lastTime & lastMessage from being overwritten backwards by older historical messages
    let lastMessage = conv.lastMessage !== undefined ? String(conv.lastMessage) : (existing?.lastMessage || '');
    let lastTime = conv.lastTime !== undefined ? (conv.lastTime ? String(conv.lastTime) : null) : (existing?.lastTime || null);

    if (existing?.lastTime && conv.lastTime) {
      if (existing.lastMessage && String(existing.lastMessage).trim()) {
        if (new Date(conv.lastTime) < new Date(existing.lastTime)) {
          lastTime = existing.lastTime;
          lastMessage = existing.lastMessage || lastMessage;
        }
      }
    }

    const unreadCount = Number(conv.unreadCount !== undefined ? conv.unreadCount : (existing?.unreadCount ?? 0));
    const channel = conv.channel !== undefined ? conv.channel : (existing?.channel || 'personal');
    const oaId = conv.oaId !== undefined ? conv.oaId : (existing?.oaId || '');
    const isFollower = conv.isFollower !== undefined ? (conv.isFollower ? 1 : 0) : (existing?.isFollower ?? 0);
    const lastUserMessageTime = conv.lastUserMessageTime !== undefined ? conv.lastUserMessageTime : (existing?.lastUserMessageTime ?? null);
    const customerPhone = conv.customerPhone !== undefined ? conv.customerPhone : (existing?.customerPhone || '');
    const updatedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, accountUid, name, avatar, isGroup, lastMessage, lastTime, unreadCount, channel, oaId, isFollower, lastUserMessageTime, customerPhone, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(accountUid, id) DO UPDATE SET
        name = excluded.name,
        avatar = CASE WHEN excluded.avatar != '' THEN excluded.avatar ELSE conversations.avatar END,
        isGroup = CASE WHEN conversations.isGroup = 1 THEN 1 ELSE excluded.isGroup END,
        lastMessage = CASE WHEN excluded.lastMessage != '' THEN excluded.lastMessage ELSE conversations.lastMessage END,
        lastTime = CASE WHEN excluded.lastTime IS NOT NULL THEN excluded.lastTime ELSE conversations.lastTime END,
        unreadCount = excluded.unreadCount,
        channel = CASE WHEN excluded.channel != '' THEN excluded.channel ELSE conversations.channel END,
        oaId = CASE WHEN excluded.oaId != '' THEN excluded.oaId ELSE conversations.oaId END,
        isFollower = excluded.isFollower,
        lastUserMessageTime = CASE WHEN excluded.lastUserMessageTime IS NOT NULL THEN excluded.lastUserMessageTime ELSE conversations.lastUserMessageTime END,
        customerPhone = CASE WHEN excluded.customerPhone != '' THEN excluded.customerPhone ELSE conversations.customerPhone END,
        updatedAt = excluded.updatedAt
    `);

    stmt.run(conv.id, accountUid, name, avatar, isGroup, lastMessage, lastTime, unreadCount, channel, oaId, isFollower, lastUserMessageTime, customerPhone, updatedAt);
  }

  setConversationGroupState(threadId, isGroup, accountUid = null) {
    if (!threadId) return;
    const val = isGroup ? 1 : 0;
    if (accountUid && accountUid !== 'all') {
      this.db.prepare("UPDATE conversations SET isGroup = ?, updatedAt = datetime('now') WHERE id = ? AND accountUid = ?").run(val, String(threadId), String(accountUid));
    } else {
      this.db.prepare("UPDATE conversations SET isGroup = ?, updatedAt = datetime('now') WHERE id = ?").run(val, String(threadId));
    }
  }

  updateConversationIdentity(id, { name = '', avatar = '' } = {}, accountUid = null) {
    if (!id) return null;
    const existing = this.getConversation(id, accountUid);
    if (!existing) return null;

    // Chỉ cập nhật name nếu tên hiện tại là UID số thuần túy hoặc đang trống
    const isCurrentNameUid = !existing.name || /^\d{10,25}$/.test(existing.name.trim());
    const newName = (isCurrentNameUid && name && name.trim()) ? name.trim() : existing.name;
    const newAvatar = (avatar && avatar.trim()) ? avatar.trim() : existing.avatar;

    if (newName !== existing.name || newAvatar !== existing.avatar) {
      if (accountUid && accountUid !== 'all') {
        this.db.prepare(`
          UPDATE conversations 
          SET name = ?, avatar = ?, updatedAt = datetime('now')
          WHERE id = ? AND accountUid = ?
        `).run(newName, newAvatar, id, accountUid);

        if (newName !== existing.name) {
          this.db.prepare(`
            UPDATE messages 
            SET senderName = ? 
            WHERE threadId = ? AND accountUid = ? AND (senderName = ? OR senderName = '' OR senderName IS NULL)
          `).run(newName, id, accountUid, id);
        }
      } else {
        this.db.prepare(`
          UPDATE conversations 
          SET name = ?, avatar = ?, updatedAt = datetime('now')
          WHERE id = ?
        `).run(newName, newAvatar, id);

        if (newName !== existing.name) {
          this.db.prepare(`
            UPDATE messages 
            SET senderName = ? 
            WHERE threadId = ? AND (senderName = ? OR senderName = '' OR senderName IS NULL)
          `).run(newName, id, id);
        }
      }

      const updated = this.getConversation(id, accountUid);
      this.emit('conversationUpdated', updated);
      return updated;
    }
    return existing;
  }

  reconcileGroupsWithGroundTruth(validGroupIds = new Set(), accountUid = null) {
    if (!validGroupIds || validGroupIds.size === 0) return 0;
    let currentGroups;
    if (accountUid && accountUid !== 'all') {
      currentGroups = this.db.prepare('SELECT id, accountUid FROM conversations WHERE isGroup = 1 AND accountUid = ?').all(accountUid);
    } else {
      currentGroups = this.db.prepare('SELECT id, accountUid FROM conversations WHERE isGroup = 1').all();
    }
    let healedCount = 0;
    const updateStmt = this.db.prepare("UPDATE conversations SET isGroup = 0, updatedAt = datetime('now') WHERE id = ? AND accountUid = ?");
    for (const row of currentGroups) {
      if (!validGroupIds.has(String(row.id))) {
        updateStmt.run(row.id, row.accountUid);
        healedCount++;
      }
    }
    return healedCount;
  }

  getConversation(id, accountUid = null) {
    if (!id) return null;
    let stmt;
    let result;
    if (accountUid && accountUid !== 'all') {
      stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ? AND accountUid = ?');
      result = stmt.get(String(id), String(accountUid));
    } else {
      stmt = this.db.prepare("SELECT * FROM conversations WHERE id = ? ORDER BY CASE WHEN accountUid != 'default' THEN 0 ELSE 1 END, updatedAt DESC LIMIT 1");
      result = stmt.get(String(id));
    }
    if (!result) return null;
    return {
      ...result,
      isGroup: Boolean(result.isGroup),
      isPinned: Boolean(result.isPinned)
    };
  }

  getCustomer(id, accountUid = null) {
    return this.getConversation(id, accountUid);
  }

  getConversations({ accountUid = '', search = '', filter = 'all', status = 'all', tagId = '', limit = 50, offset = 0 } = {}) {
    let sql = `
      SELECT DISTINCT c.* FROM conversations c
    `;
    const params = [];

    if (tagId && tagId !== 'all') {
      sql += ` INNER JOIN conversation_tags ct ON ct.threadId = c.id AND ct.tagId = ?`;
      params.push(tagId);
    }

    sql += ` WHERE 1=1`;

    if (accountUid && accountUid !== 'all') {
      sql += ` AND (c.accountUid = ? OR (c.accountUid = 'default' AND NOT EXISTS (SELECT 1 FROM conversations c2 WHERE c2.id = c.id AND c2.accountUid = ?)))`;
      params.push(accountUid, accountUid);
    }

    if (search && search.trim()) {
      sql += ` AND (c.name LIKE ? OR c.id LIKE ? OR c.lastMessage LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (filter === 'personal') {
      sql += ` AND (c.channel = 'personal' OR c.channel IS NULL) AND c.isGroup = 0`;
    } else if (filter === 'group') {
      sql += ` AND (c.channel = 'personal' OR c.channel IS NULL) AND c.isGroup = 1`;
    } else if (filter === 'oa') {
      sql += ` AND c.channel = 'oa'`;
    }

    if (status === 'unread' || filter === 'unread') {
      sql += ` AND c.unreadCount > 0`;
    }

    // Pinned first, then active conversations with real messages, then sorted by lastTime DESC, then updatedAt DESC
    sql += ` ORDER BY c.isPinned DESC, (CASE WHEN c.lastTime IS NOT NULL AND c.lastMessage != '' AND c.lastMessage IS NOT NULL THEN 1 ELSE 0 END) DESC, c.lastTime DESC, c.updatedAt DESC`;

    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
    const safeOffset = Math.max(0, Number(offset) || 0);

    sql += ` LIMIT ? OFFSET ?`;
    params.push(safeLimit, safeOffset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    if (rows.length === 0) return [];

    // Two-step Batch Fetching for Tag Dots (Zero N+1 Query Invariant)
    const threadIds = rows.map(r => r.id);
    const placeholders = threadIds.map(() => '?').join(',');
    const tagRows = this.db.prepare(`
      SELECT ct.threadId, t.id, t.name, t.color
      FROM conversation_tags ct
      INNER JOIN tags t ON t.id = ct.tagId
      WHERE ct.threadId IN (${placeholders})
      ORDER BY t.name ASC
    `).all(...threadIds);

    const tagMap = new Map();
    for (const tr of tagRows) {
      if (!tagMap.has(tr.threadId)) tagMap.set(tr.threadId, []);
      tagMap.get(tr.threadId).push({ id: tr.id, name: tr.name, color: tr.color });
    }

    return rows.map(r => ({
      ...r,
      isGroup: Boolean(r.isGroup),
      isPinned: Boolean(r.isPinned),
      tags: tagMap.get(r.id) || []
    }));
  }

  markAsRead(threadId, accountUid = null) {
    if (!threadId) return;
    if (accountUid && accountUid !== 'all') {
      this.db.prepare('UPDATE conversations SET unreadCount = 0 WHERE id = ? AND accountUid = ?').run(threadId, accountUid);
    } else {
      this.db.prepare('UPDATE conversations SET unreadCount = 0 WHERE id = ?').run(threadId);
    }
  }

  markAsUnread(threadId, accountUid = null) {
    if (!threadId) return;
    if (accountUid && accountUid !== 'all') {
      this.db.prepare('UPDATE conversations SET unreadCount = 1 WHERE id = ? AND accountUid = ?').run(threadId, accountUid);
    } else {
      this.db.prepare('UPDATE conversations SET unreadCount = 1 WHERE id = ?').run(threadId);
    }
  }

  setConversationPinned(threadId, isPinned, accountUid = null) {
    if (!threadId) return { success: false, error: 'missing_thread_id' };
    const shouldPin = Boolean(isPinned);
    if (shouldPin) {
      let checkStmt;
      if (accountUid && accountUid !== 'all') {
        checkStmt = this.db.prepare('SELECT COUNT(*) as count FROM conversations WHERE isPinned = 1 AND accountUid = ?');
        const { count } = checkStmt.get(accountUid) || { count: 0 };
        if (count >= 5) return { success: false, error: 'limit_reached' };
      } else {
        checkStmt = this.db.prepare('SELECT COUNT(*) as count FROM conversations WHERE isPinned = 1');
        const { count } = checkStmt.get() || { count: 0 };
        if (count >= 5) return { success: false, error: 'limit_reached' };
      }
    }
    if (accountUid && accountUid !== 'all') {
      this.db.prepare('UPDATE conversations SET isPinned = ? WHERE id = ? AND accountUid = ?').run(shouldPin ? 1 : 0, threadId, accountUid);
    } else {
      this.db.prepare('UPDATE conversations SET isPinned = ? WHERE id = ?').run(shouldPin ? 1 : 0, threadId);
    }
    return { success: true, isPinned: shouldPin };
  }

  deleteConversation(threadId, accountUid = null) {
    if (!threadId) return;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      if (accountUid && accountUid !== 'all') {
        this.db.prepare('DELETE FROM conversation_tags WHERE threadId = ?').run(threadId);
        this.db.prepare('DELETE FROM messages WHERE threadId = ? AND accountUid = ?').run(threadId, accountUid);
        this.db.prepare("DELETE FROM campaign_queue WHERE threadId = ? AND status = 'pending'").run(threadId);
        this.db.prepare('DELETE FROM conversations WHERE id = ? AND accountUid = ?').run(threadId, accountUid);
      } else {
        this.db.prepare('DELETE FROM conversation_tags WHERE threadId = ?').run(threadId);
        this.db.prepare('DELETE FROM messages WHERE threadId = ?').run(threadId);
        this.db.prepare("DELETE FROM campaign_queue WHERE threadId = ? AND status = 'pending'").run(threadId);
        this.db.prepare('DELETE FROM conversations WHERE id = ?').run(threadId);
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  addMessage(msg, { silent = false, isHistory = false, countUnread = null } = {}) {
    if (!msg || !msg.threadId) return null;

    const id = String(msg.id || crypto.randomUUID());
    const accountUid = String(msg.accountUid || this.getDefaultAccount()?.accountUid || 'default');
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
    const existingMsg = this.db.prepare('SELECT id, isBot FROM messages WHERE id = ? AND accountUid = ?').get(id, accountUid)
      || this.db.prepare('SELECT id, isBot FROM messages WHERE id = ?').get(id);
    const isNew = !existingMsg;
    const finalIsBot = (msg.isBot ? 1 : 0) || (existingMsg?.isBot ? 1 : 0);

    const existing = this.getConversation(threadId, accountUid);

    // Only increment unreadCount for genuinely new incoming real-time messages (not silent, not history, not self, not bot)
    let newUnread = existing?.unreadCount ?? 0;
    const shouldIncrement = (countUnread !== null)
      ? Boolean(countUnread)
      : (!silent && !isHistory && isNew && !isSelf && !finalIsBot);

    if (shouldIncrement) {
      newUnread = (existing?.unreadCount || 0) + 1;
    }

    const channel = msg.channel || existing?.channel || 'personal';
    const oaMsgId = String(msg.oaMsgId || '');
    const isCustomerOaMsg = !isSelf && channel === 'oa';

    // Ensure parent conversation record exists before inserting message
    this.upsertConversation({
      id: threadId,
      accountUid,
      name: existing?.name || senderName || threadId,
      isGroup: Boolean(existing?.isGroup || msg.isGroup),
      lastMessage: text || (mediaType === 'image' ? '[Hình ảnh]' : (mediaType === 'sticker' ? '[Sticker]' : (mediaType === 'contact' ? '[Danh thiếp]' : '[Tin nhắn]'))),
      lastTime: timestamp,
      unreadCount: newUnread,
      channel: channel,
      oaId: msg.oaId || existing?.oaId || '',
      isFollower: msg.isFollower !== undefined ? msg.isFollower : existing?.isFollower,
      lastUserMessageTime: isCustomerOaMsg ? Date.now() : existing?.lastUserMessageTime,
      customerPhone: msg.customerPhone || existing?.customerPhone || ''
    });

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages 
        (id, accountUid, threadId, senderId, senderName, text, isSelf, isBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled, channel, oaMsgId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertStmt.run(id, accountUid, threadId, senderId, senderName, text, isSelf, finalIsBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled, channel, oaMsgId);

    const savedMsg = {
      id,
      accountUid,
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
      isRecalled: Boolean(isRecalled),
      channel,
      oaMsgId,
      isGroup: Boolean(existing?.isGroup || msg.isGroup),
      conversationName: existing?.name || senderName || threadId,
      conversationAvatar: existing?.avatar || ''
    };

    if (!silent) {
      this.emit('newMessage', savedMsg);
    }

    return savedMsg;
  }

  addMessagesBatch(messages, defaultAccountUid = null) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages 
        (id, accountUid, threadId, senderId, senderName, text, isSelf, isBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const savedMessages = [];
    const threadUpdates = new Map();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      for (const msg of messages) {
        if (!msg || !msg.threadId) continue;
        const id = String(msg.id || crypto.randomUUID());
        const accountUid = String(msg.accountUid || defaultAccountUid || this.getDefaultAccount()?.accountUid || 'default');
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

        insertStmt.run(id, accountUid, threadId, senderId, senderName, text, isSelf, isBot, timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled);

        savedMessages.push({
          id, accountUid, threadId, senderId, senderName, text, isSelf: Boolean(isSelf), isBot: Boolean(isBot),
          timestamp, mediaType, mediaUrl, quoteText, quoteSender, reactions, cliMsgId, status, isRecalled: Boolean(isRecalled)
        });

        const key = `${accountUid}:${threadId}`;
        const currentLatest = threadUpdates.get(key);
        if (!currentLatest || new Date(timestamp) > new Date(currentLatest.lastTime || 0)) {
          threadUpdates.set(key, {
            id: threadId,
            accountUid,
            lastMessage: text || (mediaType === 'image' ? '[Hình ảnh]' : (mediaType === 'sticker' ? '[Sticker]' : (mediaType === 'contact' ? '[Danh thiếp]' : '[Tin nhắn]'))),
            lastTime: timestamp,
            isGroup: Boolean(msg.isGroup)
          });
        }
      }

      for (const update of threadUpdates.values()) {
        this.upsertConversation(update);
      }

      this.db.exec('COMMIT;');
    } catch (err) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      throw err;
    }

    return savedMessages;
  }

  getMessages(threadId, { limit = 50, before = null, accountUid = null } = {}) {
    let sql = 'SELECT * FROM (SELECT * FROM messages WHERE threadId = ?';
    const params = [threadId];

    if (accountUid && accountUid !== 'all') {
      sql += " AND (accountUid = ? OR accountUid = 'default')";
      params.push(accountUid);
    }

    if (before) {
      sql += ' AND timestamp < (SELECT timestamp FROM messages WHERE id = ?';
      if (accountUid && accountUid !== 'all') {
        sql += " AND (accountUid = ? OR accountUid = 'default')";
        params.push(before, accountUid);
      } else {
        params.push(before);
      }
      sql += ')';
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

  getMessage(id, accountUid = null) {
    if (!id) return null;
    let stmt;
    let r;
    if (accountUid && accountUid !== 'all') {
      stmt = this.db.prepare('SELECT * FROM messages WHERE id = ? AND accountUid = ?');
      r = stmt.get(id, accountUid);
    } else {
      stmt = this.db.prepare('SELECT * FROM messages WHERE id = ? LIMIT 1');
      r = stmt.get(id);
    }
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
  // Scheduled Messages (1-1 Direct In-Thread Scheduling)
  // ---------------------------------------------------------------------------
  getActiveScheduledMessage(threadId) {
    if (!threadId) return null;
    const stmt = this.db.prepare(`
      SELECT * FROM scheduled_messages
      WHERE threadId = ? AND status IN ('pending', 'processing', 'paused_by_reply', 'missed')
      ORDER BY scheduledAt ASC LIMIT 1
    `);
    return stmt.get(threadId) || null;
  }

  getScheduledMessageById(id) {
    if (!id) return null;
    const stmt = this.db.prepare('SELECT * FROM scheduled_messages WHERE id = ?');
    return stmt.get(id) || null;
  }

  createScheduledMessage({ id, threadId, customerName = '', message = '', mediaUrl = '', mediaName = '', scheduledAt }) {
    if (!threadId || (!message && !mediaUrl) || !scheduledAt) {
      throw new Error('threadId, scheduledAt và ít nhất nội dung hoặc hình ảnh là bắt buộc');
    }
    const finalId = id || crypto.randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO scheduled_messages (id, threadId, customerName, message, mediaUrl, mediaName, scheduledAt, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `);
    stmt.run(
      finalId,
      threadId,
      (customerName || '').trim(),
      (message || '').trim(),
      (mediaUrl || '').trim(),
      (mediaName || '').trim(),
      Number(scheduledAt),
      now
    );
    const created = this.getScheduledMessageById(finalId);
    this.emit('scheduledMessageUpdated', created);
    return created;
  }

  updateScheduledMessage(id, updates = {}) {
    const existing = this.getScheduledMessageById(id);
    if (!existing) return null;

    const fields = [];
    const values = [];

    if (updates.message !== undefined) {
      fields.push('message = ?');
      values.push(updates.message.trim());
    }
    if (updates.mediaUrl !== undefined) {
      fields.push('mediaUrl = ?');
      values.push((updates.mediaUrl || '').trim());
    }
    if (updates.mediaName !== undefined) {
      fields.push('mediaName = ?');
      values.push((updates.mediaName || '').trim());
    }
    if (updates.scheduledAt !== undefined) {
      fields.push('scheduledAt = ?');
      values.push(Number(updates.scheduledAt));
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }
    if (updates.sentAt !== undefined) {
      fields.push('sentAt = ?');
      values.push(Number(updates.sentAt));
    }

    if (fields.length === 0) return existing;

    values.push(id);
    const sql = `UPDATE scheduled_messages SET ${fields.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...values);

    const updated = this.getScheduledMessageById(id);
    this.emit('scheduledMessageUpdated', updated);
    return updated;
  }

  cancelScheduledMessage(id) {
    return this.updateScheduledMessage(id, { status: 'cancelled' });
  }

  pauseScheduledMessageByReply(threadId) {
    const active = this.getActiveScheduledMessage(threadId);
    if (active && active.status === 'pending') {
      const updated = this.updateScheduledMessage(active.id, { status: 'paused_by_reply' });
      logger.info(`⏸️ [Scheduled Message] Auto-paused schedule ${active.id} for thread ${threadId} due to inbound customer reply`);
      return updated;
    }
    return null;
  }

  resumeScheduledMessage(id) {
    const existing = this.getScheduledMessageById(id);
    if (existing && existing.status === 'paused_by_reply') {
      return this.updateScheduledMessage(id, { status: 'pending' });
    }
    return existing;
  }

  claimDueScheduledMessages(nowMs, limit = 10) {
    try {
      this.db.exec('BEGIN TRANSACTION;');
      const stmtSelect = this.db.prepare(`
        SELECT * FROM scheduled_messages
        WHERE status = 'pending' AND scheduledAt <= ?
        ORDER BY scheduledAt ASC
        LIMIT ?
      `);
      const dueItems = stmtSelect.all(nowMs, limit);
      if (dueItems.length === 0) {
        this.db.exec('COMMIT;');
        return [];
      }

      const stmtUpdate = this.db.prepare(`
        UPDATE scheduled_messages
        SET status = 'processing'
        WHERE id = ? AND status = 'pending'
      `);

      const claimed = [];
      for (const item of dueItems) {
        const res = stmtUpdate.run(item.id);
        if (res.changes > 0) {
          claimed.push({ ...item, status: 'processing' });
        }
      }
      this.db.exec('COMMIT;');
      return claimed;
    } catch (err) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      logger.error(`[LocalStore] claimDueScheduledMessages error: ${err.message}`);
      return [];
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
      timeoutMs: 35000,
      fallbackEnabled: 0,
      fallbackProvider: 'openai',
      fallbackModel: 'deepseek-chat',
      fallbackBaseUrl: 'https://api.deepseek.com/v1',
      fallbackApiKeyEncrypted: '',
      fallbackTimeoutMs: 30000,
      soulPrompt: '',
      memoryPrompt: '',
      fewShotPrompt: '',
      scopePrompt: '',
      exemplarConversation: '',
      allowGroups: 0,
      botAliases: '',
      autoTagNewLead: 0,
      defaultLeadTagId: '',
      targetMode: 'all',
      excludedTagIds: '[]',
      allowedTagIds: '[]',
      adminCooldownMinutes: 15,
      debounceSeconds: 3,
      wikiSourceUrl: ''
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
        allowGroups, botAliases, autoTagNewLead, defaultLeadTagId, targetMode, excludedTagIds, allowedTagIds,
        adminCooldownMinutes, debounceSeconds, wikiSourceUrl, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, datetime('now')
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
        botAliases = excluded.botAliases,
        autoTagNewLead = excluded.autoTagNewLead,
        defaultLeadTagId = excluded.defaultLeadTagId,
        targetMode = excluded.targetMode,
        excludedTagIds = excluded.excludedTagIds,
        allowedTagIds = excluded.allowedTagIds,
        adminCooldownMinutes = excluded.adminCooldownMinutes,
        debounceSeconds = excluded.debounceSeconds,
        wikiSourceUrl = excluded.wikiSourceUrl,
        updatedAt = datetime('now')
    `);

    stmt.run(
      id,
      updated.isEnabled ? 1 : 0,
      updated.provider || 'gemini',
      updated.model || 'gemini-2.5-flash',
      updated.baseUrl || '',
      updated.apiKeyEncrypted || '',
      Number(updated.timeoutMs || 35000),
      updated.fallbackEnabled ? 1 : 0,
      updated.fallbackProvider || 'openai',
      updated.fallbackModel || 'deepseek-chat',
      updated.fallbackBaseUrl || '',
      updated.fallbackApiKeyEncrypted || '',
      Number(updated.fallbackTimeoutMs || 30000),
      updated.soulPrompt || '',
      updated.memoryPrompt || '',
      updated.fewShotPrompt || '',
      updated.scopePrompt || '',
      typeof updated.exemplarConversation === 'object' ? JSON.stringify(updated.exemplarConversation) : (updated.exemplarConversation || ''),
      updated.allowGroups ? 1 : 0,
      updated.botAliases || '',
      updated.autoTagNewLead ? 1 : 0,
      updated.defaultLeadTagId || '',
      updated.targetMode || 'all',
      typeof updated.excludedTagIds === 'string' ? updated.excludedTagIds : JSON.stringify(updated.excludedTagIds || []),
      typeof updated.allowedTagIds === 'string' ? updated.allowedTagIds : JSON.stringify(updated.allowedTagIds || []),
      Number(updated.adminCooldownMinutes ?? 15),
      Number(updated.debounceSeconds ?? 3),
      updated.wikiSourceUrl || ''
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

  // ---------------------------------------------------------------------------
  // Multi-Profile AI Suite (Personas, Wiki Second Brain & Contextual Routing)
  // ---------------------------------------------------------------------------
  getAiProfiles() {
    return this.db.prepare('SELECT * FROM ai_profiles ORDER BY isDefault DESC, createdAt ASC').all().map(p => ({
      ...p,
      isDefault: Boolean(p.isDefault)
    }));
  }

  getAiProfile(id) {
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM ai_profiles WHERE id = ?').get(String(id));
    if (!row) return null;
    return {
      ...row,
      isDefault: Boolean(row.isDefault)
    };
  }

  getDefaultAiProfile() {
    const row = this.db.prepare('SELECT * FROM ai_profiles WHERE isDefault = 1 LIMIT 1').get()
      || this.db.prepare("SELECT * FROM ai_profiles WHERE id = 'default' LIMIT 1").get()
      || this.db.prepare('SELECT * FROM ai_profiles LIMIT 1').get();
    if (!row) return null;
    return {
      ...row,
      isDefault: Boolean(row.isDefault)
    };
  }

  saveAiProfile(data) {
    if (!data) return null;
    const id = data.id || `profile_${Date.now()}`;
    const existing = this.getAiProfile(id);

    const name = data.name !== undefined ? String(data.name).trim() : (existing?.name || 'Hồ Sơ Mới');
    const icon = data.icon !== undefined ? String(data.icon).trim() : (existing?.icon || '🤖');
    const description = data.description !== undefined ? String(data.description).trim() : (existing?.description || '');
    const isDefault = data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : (existing?.isDefault ? 1 : 0);
    const model = data.model !== undefined ? String(data.model).trim() : (existing?.model || '');
    const temperature = data.temperature !== undefined ? Number(data.temperature) : (existing?.temperature ?? 0.7);
    const soulPrompt = data.soulPrompt !== undefined ? String(data.soulPrompt) : (existing?.soulPrompt || '');
    const memoryPrompt = data.memoryPrompt !== undefined ? String(data.memoryPrompt) : (existing?.memoryPrompt || '');
    const fewShotPrompt = data.fewShotPrompt !== undefined ? String(data.fewShotPrompt) : (existing?.fewShotPrompt || '');
    const exemplarConversation = data.exemplarConversation !== undefined 
      ? (typeof data.exemplarConversation === 'object' ? JSON.stringify(data.exemplarConversation) : String(data.exemplarConversation))
      : (existing?.exemplarConversation || '');
    const scopePrompt = data.scopePrompt !== undefined ? String(data.scopePrompt) : (existing?.scopePrompt || '');
    const wikiSourceUrl = data.wikiSourceUrl !== undefined ? String(data.wikiSourceUrl).trim() : (existing?.wikiSourceUrl || '');

    // Nếu đặt làm default, bỏ cờ default của các profile khác
    if (isDefault) {
      this.db.prepare('UPDATE ai_profiles SET isDefault = 0').run();
    }

    this.db.prepare(`
      INSERT INTO ai_profiles (
        id, name, icon, description, isDefault, model, temperature,
        soulPrompt, memoryPrompt, fewShotPrompt, exemplarConversation, scopePrompt, wikiSourceUrl, updatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        icon = excluded.icon,
        description = excluded.description,
        isDefault = excluded.isDefault,
        model = excluded.model,
        temperature = excluded.temperature,
        soulPrompt = excluded.soulPrompt,
        memoryPrompt = excluded.memoryPrompt,
        fewShotPrompt = excluded.fewShotPrompt,
        exemplarConversation = excluded.exemplarConversation,
        scopePrompt = excluded.scopePrompt,
        wikiSourceUrl = excluded.wikiSourceUrl,
        updatedAt = datetime('now')
    `).run(
      id, name, icon, description, isDefault, model, temperature,
      soulPrompt, memoryPrompt, fewShotPrompt, exemplarConversation, scopePrompt, wikiSourceUrl
    );

    return this.getAiProfile(id);
  }

  deleteAiProfile(id) {
    if (!id || id === 'default') {
      throw new Error('Không thể xóa Profile mặc định của hệ thống.');
    }
    const profile = this.getAiProfile(id);
    if (!profile) return false;
    if (profile.isDefault) {
      throw new Error('Không thể xóa Profile đang được đặt làm mặc định.');
    }

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // Self-Healing Deletion: Cập nhật tài khoản về default, hội thoại về NULL
      this.db.prepare("UPDATE accounts SET aiProfileId = 'default' WHERE aiProfileId = ?").run(id);
      this.db.prepare('UPDATE conversations SET aiProfileId = NULL WHERE aiProfileId = ?').run(id);
      this.db.prepare('DELETE FROM ai_profiles WHERE id = ?').run(id);
      this.db.exec('COMMIT;');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  setDefaultAiProfile(id) {
    if (!id) return null;
    const profile = this.getAiProfile(id);
    if (!profile) return null;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare('UPDATE ai_profiles SET isDefault = 0').run();
      this.db.prepare('UPDATE ai_profiles SET isDefault = 1, updatedAt = datetime(\'now\') WHERE id = ?').run(id);
      this.db.exec('COMMIT;');
      return this.getAiProfile(id);
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  assignAccountAiProfile(accountUid, aiProfileId) {
    if (!accountUid) return null;
    const targetProfileId = aiProfileId || 'default';
    this.db.prepare('UPDATE accounts SET aiProfileId = ?, updatedAt = datetime(\'now\') WHERE accountUid = ?').run(targetProfileId, String(accountUid));
    return this.getAccount(accountUid);
  }

  assignConversationAiProfile(accountUid, threadId, aiProfileId) {
    if (!threadId) return null;
    const profileVal = aiProfileId ? String(aiProfileId) : null;
    if (accountUid && accountUid !== 'all') {
      this.db.prepare(`
        UPDATE conversations 
        SET aiProfileId = ?, updatedAt = datetime('now') 
        WHERE id = ? AND accountUid = ?
      `).run(profileVal, String(threadId), String(accountUid));
    } else {
      this.db.prepare(`
        UPDATE conversations 
        SET aiProfileId = ?, updatedAt = datetime('now') 
        WHERE id = ?
      `).run(profileVal, String(threadId));
    }
    return this.getConversation(threadId, accountUid);
  }

  resolveAiProfileForContext({ threadId, accountUid } = {}) {
    // Tier 1: Thread-specific override
    if (threadId) {
      const conv = this.getConversation(threadId, accountUid);
      if (conv && conv.aiProfileId) {
        const customProfile = this.getAiProfile(conv.aiProfileId);
        if (customProfile) return customProfile;
      }
    }

    // Tier 2: Account-specific binding
    if (accountUid) {
      const acc = this.getAccount(accountUid);
      if (acc && acc.aiProfileId) {
        const accProfile = this.getAiProfile(acc.aiProfileId);
        if (accProfile) return accProfile;
      }
    }

    // Tier 3: Global default fallback (với cơ chế chống Dangling pointer)
    return this.getDefaultAiProfile() || {
      id: 'default',
      name: 'Trợ Lý Mặc Định',
      icon: '🤖',
      isDefault: true,
      model: '',
      temperature: 0.7,
      soulPrompt: '',
      memoryPrompt: '',
      fewShotPrompt: '',
      exemplarConversation: '',
      scopePrompt: '',
      wikiSourceUrl: ''
    };
  }

  /**
   * Dọn dẹp an toàn khi đổi tài khoản Zalo (Clean Switch Account)
   * Whitelist bảo vệ tuyệt đối:
   * - CHỈ XÓA: conversations, messages, conversation_tags
   * - TUYỆT ĐỐI GIỮ NGUYÊN: ai_settings, ai_profiles, tags, quick_messages, campaigns
   * - HỦY: các bản ghi pending trong campaign_queue và tắt isEnabled của campaigns (Anti-ban)
   */
  cleanSwitchAccountData() {
    try {
      this.db.exec('BEGIN TRANSACTION;');
      
      // 1. Hủy queue chiến dịch cũ đang pending để chống spam tài khoản lạ (Anti-Ban Guard C2)
      this.db.prepare("DELETE FROM campaign_queue WHERE status = 'pending'").run();
      this.db.prepare("UPDATE campaigns SET isEnabled = 0").run();
      
      // Hủy lịch hẹn 1-1 đang chờ để tránh gửi nhầm khách từ tài khoản mới
      this.db.prepare("DELETE FROM scheduled_messages WHERE status IN ('pending', 'processing', 'paused_by_reply')").run();
      
      // 2. Xóa các bảng hội thoại cá nhân (CÔ LẬP TUYỆT ĐỐI channel = 'personal', BẢO TOÀN DỮ LIỆU OA V4.1)
      this.db.prepare("DELETE FROM conversation_tags WHERE threadId IN (SELECT id FROM conversations WHERE channel = 'personal' OR channel IS NULL)").run();
      this.db.prepare("DELETE FROM messages WHERE channel = 'personal' OR channel IS NULL").run();
      this.db.prepare("DELETE FROM conversations WHERE channel = 'personal' OR channel IS NULL").run();
      
      this.db.exec('COMMIT;');
      
      // 3. Checkpoint WAL để giải phóng file DB
      try {
        this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      } catch {}

      logger.info('[LocalStore] Clean switch account completed safely. AI settings, tags, campaigns and OA channels are preserved.');
      this.emit('data_cleaned');
      return true;
    } catch (err) {
      try { this.db.exec('ROLLBACK;'); } catch {}
      logger.error(`[LocalStore] Failed to clean switch account data: ${err.message}`);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Zalo Official Account (OA) Settings Suite
  // ---------------------------------------------------------------------------
  getOaSettings(id = 'default') {
    let row = this.db.prepare('SELECT * FROM oa_settings WHERE id = ?').get(id);
    if (!row) {
      this.db.prepare("INSERT OR IGNORE INTO oa_settings (id) VALUES (?)").run(id);
      row = this.db.prepare('SELECT * FROM oa_settings WHERE id = ?').get(id);
    }
    return row || {
      id: 'default',
      oaId: '',
      name: '',
      avatar: '',
      appId: '',
      secretKeyEncrypted: '',
      accessTokenEncrypted: '',
      refreshTokenEncrypted: '',
      expiresAt: 0,
      isEnabled: 0,
      isAiAutoReply: 0
    };
  }

  saveOaSettings(data, id = 'default') {
    const current = this.getOaSettings(id);
    const cleanData = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v !== undefined && v !== '') cleanData[k] = v;
    }
    const updated = { ...current, ...cleanData };
    const stmt = this.db.prepare(`
      INSERT INTO oa_settings (
        id, oaId, name, avatar, appId, secretKeyEncrypted,
        accessTokenEncrypted, refreshTokenEncrypted, expiresAt,
        isEnabled, isAiAutoReply, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        oaId = excluded.oaId,
        name = excluded.name,
        avatar = excluded.avatar,
        appId = excluded.appId,
        secretKeyEncrypted = excluded.secretKeyEncrypted,
        accessTokenEncrypted = excluded.accessTokenEncrypted,
        refreshTokenEncrypted = excluded.refreshTokenEncrypted,
        expiresAt = excluded.expiresAt,
        isEnabled = excluded.isEnabled,
        isAiAutoReply = excluded.isAiAutoReply,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(
      id,
      updated.oaId || '',
      updated.name || '',
      updated.avatar || '',
      updated.appId || '',
      updated.secretKeyEncrypted || '',
      updated.accessTokenEncrypted || '',
      updated.refreshTokenEncrypted || '',
      Number(updated.expiresAt || 0),
      updated.isEnabled ? 1 : 0,
      updated.isAiAutoReply ? 1 : 0
    );
    return this.getOaSettings(id);
  }

  updateOaTokens({ accessTokenEncrypted, refreshTokenEncrypted, expiresAt }, id = 'default') {
    const stmt = this.db.prepare(`
      UPDATE oa_settings
      SET accessTokenEncrypted = ?, refreshTokenEncrypted = ?, expiresAt = ?, updatedAt = datetime('now')
      WHERE id = ?
    `);
    stmt.run(accessTokenEncrypted || '', refreshTokenEncrypted || '', Number(expiresAt || 0), id);
    return this.getOaSettings(id);
  }

  deleteOaSettings(id = 'default') {
    this.db.prepare('DELETE FROM oa_settings WHERE id = ?').run(id);
    this.db.prepare("INSERT OR IGNORE INTO oa_settings (id, isEnabled) VALUES (?, 0)").run(id);
    this.db.prepare("UPDATE oa_settings SET isEnabled = 0, oaId = '', name = '', appId = '', secretKeyEncrypted = '', accessTokenEncrypted = '', refreshTokenEncrypted = '', expiresAt = 0 WHERE id = ?").run(id);
    return true;
  }

  purgeOaData(id = 'default') {
    this.db.prepare("DELETE FROM conversation_tags WHERE threadId IN (SELECT id FROM conversations WHERE channel = 'oa')").run();
    this.db.prepare("DELETE FROM messages WHERE threadId IN (SELECT id FROM conversations WHERE channel = 'oa') OR threadId LIKE 'oa_%'").run();
    this.db.prepare("DELETE FROM conversations WHERE channel = 'oa'").run();
    this.deleteOaSettings(id);
    this.setSystemConfig('onboarding_status', 'personal_only');
    return true;
  }

  // ---------------------------------------------------------------------------
  // System Configs Suite
  // ---------------------------------------------------------------------------
  getSystemConfig(key, defaultValue = '') {
    if (!key) return defaultValue;
    const row = this.db.prepare('SELECT value FROM system_configs WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  }

  setSystemConfig(key, value) {
    if (!key) return false;
    const stmt = this.db.prepare(`
      INSERT INTO system_configs (key, value, updatedAt)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(String(key), String(value));
    return true;
  }
}

export const localStore = new LocalStore();

