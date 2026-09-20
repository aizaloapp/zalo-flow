import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import { ZaloClient, zaloClient } from '../zalo-client.js';
import { localStore } from './local-store.js';
import { logger } from './logger.js';

export class ZaloAccountManager extends EventEmitter {
  constructor({ maxConcurrent = 3, sessionsDir = null } = {}) {
    super();
    this.maxConcurrent = maxConcurrent;
    this.sessionsDir = sessionsDir || path.resolve(process.cwd(), 'sessions');
    this.clients = new Map(); // Map<accountUid, ZaloClient>
    this.loginFlows = new Map(); // Map<flowId, ZaloClient>
    this.inboundHandlers = [];
    this.activeAccountUid = null;
    this.isInitializing = false;
  }

  /**
   * Register global inbound handler across all accounts
   */
  onMessage(handler) {
    this.inboundHandlers.push(handler);
    for (const client of this.clients.values()) {
      client.onMessage(handler);
    }
  }

  /**
   * Staggered Boot Sequence: Initializes all saved accounts sequentially with anti-spike delay
   */
  async initializeAllAccounts({ onProgress = null } = {}) {
    if (this.isInitializing) return;
    this.isInitializing = true;
    logger.info('🚀 [AccountManager] Initializing Multi-Account Client Pool...');

    try {
      const savedAccounts = localStore.getAccounts();
      const sessionsDir = this.sessionsDir;

      // 1. Identify valid accounts to load (capped at maxConcurrent)
      let accountsToLoad = savedAccounts.slice(0, this.maxConcurrent);

      // Fallback: If accounts table is empty but sessions/zalo_default.enc exists
      if (accountsToLoad.length === 0) {
        const defaultSessionPath = path.join(sessionsDir, 'zalo_default.enc');
        if (fs.existsSync(defaultSessionPath)) {
          accountsToLoad = [{
            accountUid: 'default',
            displayName: 'Tài khoản chính',
            sessionFile: 'zalo_default',
            isDefault: true
          }];
        }
      }

      const total = accountsToLoad.length;
      logger.info(`📋 [AccountManager] Found ${total} account(s) to initialize (Limit: ${this.maxConcurrent}).`);

      const seenSessions = new Set();
      for (let i = 0; i < total; i++) {
        const acc = accountsToLoad[i];
        const sessionName = acc.sessionFile || `zalo_${acc.accountUid}`;
        if (seenSessions.has(sessionName)) {
          logger.warn(`⚠️ [Boot Sequence] Bỏ qua tài khoản ${acc.accountUid} (${acc.displayName || ''}) vì session '${sessionName}' đã được khởi tạo bởi tài khoản khác!`);
          continue;
        }
        seenSessions.add(sessionName);

        logger.info(`[Boot Sequence] (${i + 1}/${total}) Restoring session '${sessionName}' for UID: ${acc.accountUid}...`);

        if (typeof onProgress === 'function') {
          onProgress({
            current: i + 1,
            total,
            accountUid: acc.accountUid,
            displayName: acc.displayName
          });
        }

        const client = new ZaloClient({
          sessionName,
          accountUid: acc.accountUid !== 'default' ? acc.accountUid : ''
        });

        // Register handlers
        for (const handler of this.inboundHandlers) {
          client.onMessage(handler);
        }

        // Tự động cập nhật pool khi client đăng nhập thành công (kể cả quét QR sau đó)
        client.on('login_success', (profile) => {
          const newUid = profile?.userId || client.accountUid;
          if (newUid) {
            this.clients.set(newUid, client);
            if (!this.activeAccountUid || acc.isDefault) {
              this.activeAccountUid = newUid;
            }
            this.emit('pool_updated', this.getAllProfiles());
          }
        });

        try {
          await client.initialize();
          const resolvedUid = client.userProfile?.userId || acc.accountUid;
          this.clients.set(resolvedUid, client);

          if (!this.activeAccountUid || acc.isDefault) {
            this.activeAccountUid = resolvedUid;
          }

          if (client.isLoggedIn) {
            logger.info(`✅ [Boot Sequence] Account ${client.userProfile.displayName} (${resolvedUid}) online!`);
          }
        } catch (initErr) {
          logger.warn(`⚠️ [Boot Sequence] Failed to initialize account ${acc.accountUid}: ${initErr.message}`);
        }

        // Staggered delay of 3 seconds between accounts to avoid memory spike and Zalo rate limit
        if (i < total - 1) {
          logger.info('⏳ [Boot Sequence] Staggered pause 3s before initializing next account...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // If still no active account, pick the first connected
      if (!this.activeAccountUid && this.clients.size > 0) {
        this.activeAccountUid = this.clients.keys().next().value;
      }

      this.emit('pool_ready', this.getAllProfiles());
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Get specific client or active account client
   */
  getClient(accountUid = null) {
    if (accountUid && accountUid !== 'all') {
      const c = this.clients.get(String(accountUid));
      if (c) return c;
      if (zaloClient && (String(zaloClient.accountUid) === String(accountUid) || (zaloClient.isLoggedIn && !zaloClient.accountUid))) {
        return zaloClient;
      }
    }

    if (this.activeAccountUid && this.clients.has(this.activeAccountUid)) {
      return this.clients.get(this.activeAccountUid);
    }

    const defaultAcc = localStore.getDefaultAccount();
    if (defaultAcc && this.clients.has(defaultAcc.accountUid)) {
      return this.clients.get(defaultAcc.accountUid);
    }

    const firstClient = this.clients.values().next().value;
    if (firstClient) return firstClient;
    if (zaloClient && zaloClient.isLoggedIn) return zaloClient;
    return null;
  }

  /**
   * Check if any client is logged in
   */
  hasAnyLoggedIn() {
    for (const c of this.clients.values()) {
      if (c.isLoggedIn) return true;
    }
    return false;
  }

  /**
   * Start a non-disruptive QR login flow to add a secondary account
   * @param {Function} onQrUpdate
   */
  async startAddAccountFlow(onQrUpdate = null) {
    const activeCount = Array.from(this.clients.values()).filter(c => c.isLoggedIn).length;
    if (activeCount >= this.maxConcurrent) {
      throw new Error(`Đã đạt giới hạn tối đa ${this.maxConcurrent} tài khoản đăng nhập đồng thời trên hệ thống. Vui lòng đăng xuất bớt một tài khoản trước.`);
    }

    const flowId = `flow_${Date.now()}`;
    const tempSessionName = `zalo_add_${Date.now()}`;
    const client = new ZaloClient({ sessionName: tempSessionName });

    // Register all inbound handlers
    for (const handler of this.inboundHandlers) {
      client.onMessage(handler);
    }

    this.loginFlows.set(flowId, client);

    const profile = await client.requestNewQrLogin((updatedProfile) => {
      if (typeof onQrUpdate === 'function') {
        onQrUpdate({
          flowId,
          ...updatedProfile
        });
      }

      // When login succeeds
      if (client.isLoggedIn && client.userProfile?.userId) {
        const newUid = client.userProfile.userId;
        const newSessionName = `zalo_${newUid}`;

        // Rename temp session file to permanent UID session file
        const sessionsDir = this.sessionsDir;
        const oldFile = path.join(sessionsDir, `${tempSessionName}.enc`);
        const newFile = path.join(sessionsDir, `${newSessionName}.enc`);
        try {
          if (fs.existsSync(oldFile)) {
            fs.renameSync(oldFile, newFile);
            client.sessionName = newSessionName;
            client.accountUid = newUid;
          }
        } catch (renameErr) {
          logger.warn(`Could not rename session file: ${renameErr.message}`);
        }

        // Add to permanent pool
        this.clients.set(newUid, client);
        this.loginFlows.delete(flowId);

        localStore.upsertAccount({
          accountUid: newUid,
          displayName: client.userProfile.displayName,
          avatar: client.userProfile.avatar,
          sessionFile: newSessionName,
          status: 'online'
        });

        this.emit('account_added', { accountUid: newUid, profile: client.getAccountProfile() });
        this.emit('pool_updated', this.getAllProfiles());
      }
    });

    return {
      flowId,
      ...profile
    };
  }

  /**
   * Remove and logout a specific account cleanly
   */
  async removeAccount(accountUid, { cleanData = false } = {}) {
    if (!accountUid) return null;
    const uid = String(accountUid);
    const client = this.clients.get(uid);

    if (client) {
      await client.destroy();
      this.clients.delete(uid);
    }

    // Determine all possible session file candidates to clean up completely
    const acc = localStore.getAccount(uid);
    const sessionCandidates = new Set();
    if (acc?.sessionFile) sessionCandidates.add(acc.sessionFile);
    if (client?.sessionName) sessionCandidates.add(client.sessionName);
    sessionCandidates.add(`zalo_${uid}`);
    if (acc?.sessionFile === 'zalo_default' || acc?.isDefault) {
      sessionCandidates.add('zalo_default');
    }

    const sessionsDir = this.sessionsDir;
    for (const sName of sessionCandidates) {
      const sFile = path.join(sessionsDir, `${sName}.enc`);
      if (fs.existsSync(sFile)) {
        try {
          fs.unlinkSync(sFile);
          logger.info(`🗑️ [AccountManager] Removed session file: ${sName}.enc`);
        } catch (e) {
          logger.warn(`Could not remove session file ${sFile}: ${e.message}`);
        }
      }
    }

    localStore.deleteAccount(uid, { deleteData: cleanData });

    if (this.activeAccountUid === uid) {
      const remainingAccounts = localStore.getAccounts();
      this.activeAccountUid = remainingAccounts[0]?.accountUid || this.clients.keys().next().value || null;
    }

    this.emit('account_removed', { accountUid: uid });
    this.emit('pool_updated', this.getAllProfiles());

    return { success: true, activeAccountUid: this.activeAccountUid };
  }

  /**
   * Set active interacting account for UI
   */
  setActiveAccount(accountUid) {
    if (accountUid === 'all' || this.clients.has(String(accountUid)) || localStore.getAccount(accountUid)) {
      this.activeAccountUid = accountUid;
      this.emit('active_account_switched', { activeAccountUid: accountUid });
      return true;
    }
    return false;
  }

  /**
   * Get all registered accounts and their live status
   */
  getAllProfiles() {
    const dbAccounts = localStore.getAccounts();
    const profiles = [];

    for (const acc of dbAccounts) {
      let client = this.clients.get(acc.accountUid);
      if (!client && zaloClient && zaloClient.isLoggedIn) {
        const zUid = zaloClient.accountUid || (zaloClient.userProfile && zaloClient.userProfile.userId);
        if (String(zUid) === String(acc.accountUid) || (!zUid && acc.isDefault)) {
          client = zaloClient;
          this.clients.set(acc.accountUid, zaloClient);
        }
      }
      const isOnline = client ? client.isLoggedIn : false;
      const liveProfile = client ? client.getAccountProfile() : null;

      profiles.push({
        accountUid: acc.accountUid,
        displayName: liveProfile?.displayName || acc.displayName || 'Tài khoản Zalo',
        avatar: liveProfile?.avatar || acc.avatar || '',
        phone: acc.phone || '',
        isDefault: Boolean(acc.isDefault),
        aiProfileId: acc.aiProfileId || 'default',
        status: isOnline ? 'online' : 'offline',
        isLoggedIn: isOnline,
        friendCount: liveProfile?.friendCount || 0
      });
    }

    // Check if there are active clients not yet saved in db
    for (const [uid, client] of this.clients.entries()) {
      if (!profiles.some(p => String(p.accountUid) === String(uid))) {
        profiles.push({
          accountUid: uid,
          displayName: client.userProfile?.displayName || 'Tài khoản Zalo',
          avatar: client.userProfile?.avatar || '',
          phone: '',
          isDefault: false,
          aiProfileId: 'default',
          status: client.isLoggedIn ? 'online' : 'offline',
          isLoggedIn: client.isLoggedIn,
          friendCount: client.friendUids ? client.friendUids.size : 0
        });
      }
    }

    // Check if singleton zaloClient is logged in and not yet represented in profiles
    if (zaloClient && zaloClient.isLoggedIn) {
      const zUid = String(zaloClient.accountUid || (zaloClient.userProfile && zaloClient.userProfile.userId) || 'default');
      if (!profiles.some(p => String(p.accountUid) === zUid)) {
        const liveProfile = zaloClient.getAccountProfile();
        profiles.push({
          accountUid: zUid,
          displayName: liveProfile?.displayName || 'Tài khoản Zalo',
          avatar: liveProfile?.avatar || '',
          phone: liveProfile?.phone || '',
          isDefault: true,
          aiProfileId: 'default',
          status: 'online',
          isLoggedIn: true,
          friendCount: liveProfile?.friendCount || 0
        });
      }
    }

    if (!this.activeAccountUid) {
      const onlineAcc = profiles.find(p => p.isLoggedIn);
      if (onlineAcc) {
        this.activeAccountUid = onlineAcc.accountUid;
      }
    }

    return {
      activeAccountUid: this.activeAccountUid,
      totalActive: profiles.filter(p => p.isLoggedIn).length,
      maxConcurrent: this.maxConcurrent,
      accounts: profiles
    };
  }

  /**
   * Gracefully terminate all active clients and login flows
   */
  async destroyAll() {
    for (const client of this.clients.values()) {
      try {
        await client.destroy();
      } catch {}
    }
    this.clients.clear();
    for (const client of this.loginFlows.values()) {
      try {
        await client.destroy();
      } catch {}
    }
    this.loginFlows.clear();
  }
}

export const accountManager = new ZaloAccountManager();
