import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TFRetriever } from './tf-retriever.js';
import { DocumentIndexer } from './document-indexer.js';
import { CatalogBuilder, safeAtomicWrite, stringifyWithFrontmatter, parseFrontmatter } from './catalog-builder.js';
import { KnowledgeSynthesizer, sanitizeSlug, computeContentHash } from './synthesizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Đơn giản hóa Mutex bất đồng bộ nhẹ thuần CPU (Zero Dependency)
 */
class SimpleAsyncMutex {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  async acquire() {
    if (!this._locked) {
      this._locked = true;
      return () => this.release();
    }

    return new Promise(resolve => {
      this._queue.push(() => {
        this._locked = true;
        resolve(() => this.release());
      });
    });
  }

  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    } else {
      this._locked = false;
    }
  }
}

/**
 * VaultManager — Quản trị viên trung tâm điều phối đa Vault, LRU Eviction & Dynamic RAG
 */
export class VaultManager {
  constructor(options = {}) {
    this.baseVaultsDir = options.baseVaultsDir
      ? path.resolve(process.cwd(), options.baseVaultsDir)
      : path.resolve(process.cwd(), 'data', 'vaults');

    this.maxHotProfiles = options.maxHotProfiles ?? 5; // Giới hạn tối đa 5 profile hot trong RAM
    this.loadedVaults = new Map(); // profileId -> { retriever, indexer, vaultDir, lastAccessed }
    this.mutexes = new Map(); // profileId -> SimpleAsyncMutex
    this.synthesizer = new KnowledgeSynthesizer();
    this.catalogBuilder = new CatalogBuilder();
    this.store = options.store || null;

    if (!fs.existsSync(this.baseVaultsDir)) {
      fs.mkdirSync(this.baseVaultsDir, { recursive: true });
    }
  }

  setStore(store) {
    this.store = store;
  }

  /**
   * Lấy Mutex cho profileId
   */
  getMutex(profileId = 'default') {
    const key = String(profileId || 'default');
    if (!this.mutexes.has(key)) {
      this.mutexes.set(key, new SimpleAsyncMutex());
    }
    return this.mutexes.get(key);
  }

  /**
   * Xác định đường dẫn thư mục Vault của Profile
   */
  getVaultDir(profileId = 'default') {
    const cleanId = sanitizeSlug(String(profileId || 'default'));
    const dir = path.join(this.baseVaultsDir, cleanId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Lấy hoặc nạp Vault vào RAM với LRU Eviction Guard (Trần RAM 350MB)
   */
  getVault(profileId = 'default') {
    const key = String(profileId || 'default');

    if (this.loadedVaults.has(key)) {
      const v = this.loadedVaults.get(key);
      v.lastAccessed = Date.now();
      return v;
    }

    // LRU Eviction: Nếu vượt quá maxHotProfiles, giải phóng profile ít dùng nhất
    if (this.loadedVaults.size >= this.maxHotProfiles) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.loadedVaults.entries()) {
        if (v.lastAccessed < oldestTime) {
          oldestTime = v.lastAccessed;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const evicted = this.loadedVaults.get(oldestKey);
        evicted.retriever.clear();
        this.loadedVaults.delete(oldestKey);
      }
    }

    const vaultDir = this.getVaultDir(key);
    const retriever = new TFRetriever();
    const indexer = new DocumentIndexer();

    // Nạp toàn bộ tài liệu hiện có vào BM25 index
    indexer.indexDirectory(vaultDir, retriever);

    // Kiểm tra và tự động Auto-Migrate dữ liệu cũ nếu Vault rỗng
    this._autoMigrateLegacyData(key, vaultDir, retriever, indexer);

    const vaultEntry = {
      profileId: key,
      vaultDir,
      retriever,
      indexer,
      lastAccessed: Date.now()
    };

    this.loadedVaults.set(key, vaultEntry);
    return vaultEntry;
  }

  /**
   * Tự động di trú dữ liệu memoryPrompt & fewShot cũ sang file Markdown nếu Vault rỗng
   */
  _autoMigrateLegacyData(profileId, vaultDirOrProfile, retriever, indexer) {
    try {
      let vaultDir = vaultDirOrProfile;
      let profile = null;

      if (typeof vaultDirOrProfile === 'object' && vaultDirOrProfile !== null) {
        profile = vaultDirOrProfile;
        vaultDir = this.getVaultDir(profileId);
      } else {
        if (!this.store) return;
        vaultDir = String(vaultDirOrProfile || this.getVaultDir(profileId));
        profile = (typeof this.store.getAiProfile === 'function' ? this.store.getAiProfile(profileId) : null)
          || (typeof this.store.getAiSettings === 'function' ? this.store.getAiSettings() : null);
      }

      if (!profile) return;

      const files = fs.readdirSync(vaultDir).filter(f => f.endsWith('.md') && f !== 'index.md');
      if (files.length > 0) return; // Đã có bài viết, không migrate

      const targetRetriever = retriever || this.getVault(profileId).retriever;
      const targetIndexer = indexer || this.getVault(profileId).indexer;

      // 1. Migrate memoryPrompt -> legacy-memory.md
      const memText = (profile.memoryPrompt || '').trim();
      if (memText) {
        const legacyPath = path.join(vaultDir, 'legacy-memory.md');
        const content = stringifyWithFrontmatter({
          title: 'Sổ Tay Dữ Liệu Chuyển Tiếp (Legacy Memory)',
          date_added: new Date().toISOString().split('T')[0],
          summary: 'Dữ liệu tri thức tự động chuyển tiếp từ cấu hình cũ',
          tags: ['legacy', 'chuyen-tiep']
        }, `# SỔ TAY TRI THỨC CHUYỂN TIẾP\n\n${memText}`);

        safeAtomicWrite(legacyPath, content);
        if (targetIndexer && targetRetriever) {
          targetIndexer.hotReloadArticle(legacyPath, content, targetRetriever);
        }
      }

      // 2. Migrate exemplarConversation -> mau-hoi-thoai.md
      const fewShot = profile.exemplarConversation;
      if (fewShot) {
        let dialogueText = '';
        if (typeof fewShot === 'string' && fewShot.trim()) {
          try {
            const parsed = JSON.parse(fewShot);
            if (Array.isArray(parsed)) {
              dialogueText = parsed.map(m => `- **${m.role === 'user' ? 'Khách' : 'Bot'}:** ${m.text}`).join('\n');
            } else {
              dialogueText = fewShot.trim();
            }
          } catch {
            dialogueText = fewShot.trim();
          }
        }

        if (dialogueText) {
          const fewShotPath = path.join(vaultDir, 'mau-hoi-thoai.md');
          const content = stringifyWithFrontmatter({
            title: 'Mẫu Hội Thoại Tư Vấn Tiêu Biểu',
            date_added: new Date().toISOString().split('T')[0],
            type: 'conversation-example',
            summary: 'Các mẫu hội thoại tư vấn thực tế mẫu mực',
            tags: ['mau-chat', 'few-shot']
          }, `# MẪU HỘI THOẠI TƯ VẤN THỰC TẾ\n\n${dialogueText}`);

          safeAtomicWrite(fewShotPath, content);
          if (targetIndexer && targetRetriever) {
            targetIndexer.hotReloadArticle(fewShotPath, content, targetRetriever);
          }
        }
      }

      // Sinh catalog index.md ban đầu
      this.catalogBuilder.rebuildCatalog(vaultDir);
    } catch {}
  }

  /**
   * Truy vấn trích xuất ngữ cảnh RAG cho tin nhắn của khách hàng (<3ms, BM25 in-memory)
   */
  queryContext(profileId, queryText, options = {}) {
    if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
      return null;
    }

    try {
      const vault = this.getVault(profileId);
      const limit = options.limit ?? options.topK ?? 3;
      const minScore = options.minScore ?? 0.2;
      const matches = vault.retriever.query(queryText, { limit, minScore });

      if (!matches || matches.length === 0) {
        return null;
      }

      const snippet = matches
        .map((m, idx) => `[TÀI LIỆU #${idx + 1} - ${m.title} (Độ khớp: ${(m.score * 100).toFixed(1)}%)]\n${m.content}`)
        .join('\n\n---\n\n');

      return {
        hasContext: true,
        matched: true,
        matches,
        topScore: matches[0].score,
        contextSnippet: snippet,
        contextText: snippet
      };
    } catch {
      return null;
    }
  }

  /**
   * Lưu hoặc cập nhật 1 bài viết trong Vault có Mutex bảo vệ
   */
  async saveFile({ profileId = 'default', slug, title, content, summary = '', tags = [], expectedHash = null, source = 'manual_edit' }) {
    const mutex = this.getMutex(profileId);
    const release = await mutex.acquire();

    try {
      const cleanSlug = sanitizeSlug(slug);
      const vault = this.getVault(profileId);
      const filePath = path.join(vault.vaultDir, `${cleanSlug}.md`);

      // Kiểm tra Optimistic lock
      if (fs.existsSync(filePath)) {
        const existing = fs.readFileSync(filePath, 'utf8');
        const actualHash = computeContentHash(existing);
        if (expectedHash && expectedHash !== actualHash) {
          throw new Error(`Xung đột dữ liệu (Optimistic Lock): Bài viết "${cleanSlug}" đã bị thay đổi bởi phiên khác trước khi lưu. Vui lòng tải lại trang.`);
        }
      }

      let finalContent = content;
      const { hasFrontmatter, metadata, body } = parseFrontmatter(content);
      if (!hasFrontmatter) {
        let finalTags = Array.isArray(tags) && tags.length > 0 ? tags : [];
        if (finalTags.length === 0 && fs.existsSync(filePath)) {
          try {
            const oldParsed = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(oldParsed.metadata.tags) && oldParsed.metadata.tags.length > 0) {
              finalTags = oldParsed.metadata.tags;
            }
          } catch {}
        }

        finalContent = stringifyWithFrontmatter({
          title: title || cleanSlug,
          date_added: new Date().toISOString().split('T')[0],
          summary: summary || body.slice(0, 100).replace(/[\r\n]+/g, ' ').trim(),
          tags: finalTags
        }, body || content);
      }

      const newHash = computeContentHash(finalContent);
      safeAtomicWrite(filePath, finalContent);

      // Lưu revision vào SQLite
      let revisionId = null;
      if (this.store && typeof this.store.recordWikiRevision === 'function') {
        const rev = this.store.recordWikiRevision({
          profileId,
          slug: cleanSlug,
          title: title || cleanSlug,
          content: finalContent,
          contentHash: newHash,
          summary: summary || 'Chỉnh sửa bài viết',
          source
        });
        revisionId = rev?.id || null;
      }

      // Nạp nóng BM25
      vault.indexer.hotReloadArticle(filePath, finalContent, vault.retriever);
      this.catalogBuilder.rebuildCatalog(vault.vaultDir);

      return {
        status: 'success',
        slug: cleanSlug,
        title: title || cleanSlug,
        contentHash: newHash,
        revisionId
      };
    } finally {
      release();
    }
  }

  /**
   * Xóa 1 bài viết khỏi Vault
   */
  async deleteFile({ profileId = 'default', slug }) {
    const mutex = this.getMutex(profileId);
    const release = await mutex.acquire();

    try {
      const cleanSlug = sanitizeSlug(slug);
      const vault = this.getVault(profileId);
      const filePath = path.join(vault.vaultDir, `${cleanSlug}.md`);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      vault.retriever.removeBySourceFile(`${cleanSlug}.md`);
      this.catalogBuilder.rebuildCatalog(vault.vaultDir);

      return { status: 'success', slug: cleanSlug };
    } finally {
      release();
    }
  }

  /**
   * Tiện ích lấy Retriever cho Profile
   */
  async getRetriever(profileId = 'default') {
    return this.getVault(profileId).retriever;
  }

  /**
   * Tiện ích lấy Indexer cho Profile
   */
  async getIndexer(profileId = 'default') {
    return this.getVault(profileId).indexer;
  }

  /**
   * Liệt kê danh sách bài viết trong Vault
   */
  async listArticles(profileId = 'default') {
    const vault = this.getVault(profileId);
    const catalog = this.catalogBuilder.getVirtualCatalog(vault.vaultDir);
    return catalog.articles;
  }

  /**
   * Đọc chi tiết bài viết trong Vault
   */
  async getArticle(profileId = 'default', slug) {
    const cleanSlug = sanitizeSlug(slug);
    const vault = this.getVault(profileId);
    const filePath = path.join(vault.vaultDir, `${cleanSlug}.md`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const { metadata, body, hasFrontmatter } = parseFrontmatter(raw);
    const contentHash = computeContentHash(raw);

    return {
      slug: cleanSlug,
      title: metadata.title || cleanSlug,
      content: raw,
      body,
      frontmatter: metadata,
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      summary: metadata.summary || '',
      contentHash
    };
  }

  /**
   * Alias lưu bài viết
   */
  async saveArticle(args) {
    return this.saveFile(args);
  }

  /**
   * Alias xóa bài viết
   */
  async deleteArticle(profileId = 'default', slug) {
    return this.deleteFile({ profileId, slug });
  }

  /**
   * Lấy số liệu thống kê Vault theo Profile
   */
  async getVaultStats(profileId = 'default') {
    const vault = this.getVault(profileId);
    const catalog = this.catalogBuilder.getVirtualCatalog(vault.vaultDir);
    return {
      profileId,
      articleCount: catalog.stats.totalArticles,
      totalChunks: vault.retriever.docCount,
      storageSizeKb: (catalog.stats.totalSize / 1024).toFixed(1),
      estimatedTokens: catalog.stats.totalEstimatedTokens
    };
  }

  /**
   * Lấy sơ đồ liên kết tri thức (Knowledge Graph)
   */
  async getGraph(profileId = 'default') {
    const vault = this.getVault(profileId);
    const catalog = this.catalogBuilder.getVirtualCatalog(vault.vaultDir);
    const baseGraph = catalog.graph;

    // Bổ sung node thẻ (tag:xxx) nếu có
    const tagNodesMap = new Map();
    const tagLinks = [];

    for (const art of catalog.articles) {
      if (Array.isArray(art.tags)) {
        for (const tag of art.tags) {
          const tagId = `tag:${tag}`;
          if (!tagNodesMap.has(tagId)) {
            tagNodesMap.set(tagId, {
              id: tagId,
              label: `#${tag}`,
              isTag: true,
              size: 512
            });
          }
          tagLinks.push({
            source: art.slug,
            target: tagId
          });
        }
      }
    }

    const allNodes = [...baseGraph.nodes, ...Array.from(tagNodesMap.values())];
    const allLinks = [...baseGraph.links, ...tagLinks];

    return {
      nodes: allNodes.slice(0, 100),
      links: allLinks.slice(0, 200)
    };
  }

  /**
   * Hoàn tác revision
   */
  async rollbackRevision(profileId = 'default', revisionId) {
    const vault = this.getVault(profileId);
    return this.synthesizer.rollbackRevision({
      revisionId: Number(revisionId),
      vaultDir: vault.vaultDir,
      store: this.store,
      retriever: vault.retriever,
      indexer: vault.indexer
    });
  }
}

export const vaultManager = new VaultManager();
