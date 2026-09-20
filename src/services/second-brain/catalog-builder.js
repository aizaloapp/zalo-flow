import fs from 'node:fs';
import path from 'node:path';

/**
 * Sanitize nội dung cho ô trong bảng Markdown
 */
export function escapeTableCell(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

/**
 * Line-by-Line YAML Frontmatter Parser siêu nhẹ, an toàn trước ReDoS.
 */
export function parseFrontmatter(content) {
  if (typeof content !== 'string') {
    return { metadata: {}, body: '', hasFrontmatter: false };
  }

  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { metadata: {}, body: content, hasFrontmatter: false };
  }

  const metadata = {};
  let closingIndex = -1;
  let currentKey = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '---') {
      closingIndex = i;
      break;
    }

    // Xử lý block list: - item
    if (trimmed.startsWith('- ') && currentKey) {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
      if (!Array.isArray(metadata[currentKey])) {
        metadata[currentKey] = [];
      }
      metadata[currentKey].push(val);
      continue;
    }

    // Xử lý key: value
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let rawVal = line.slice(colonIdx + 1).trim();
      currentKey = key;

      if (!rawVal) {
        metadata[key] = [];
        continue;
      }

      // Xử lý inline array: [a, b, c]
      if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        const inner = rawVal.slice(1, -1).trim();
        metadata[key] = inner
          ? inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
          : [];
        continue;
      }

      rawVal = rawVal.replace(/^["']|["']$/g, '');
      metadata[key] = rawVal;
    }
  }

  if (closingIndex === -1) {
    return { metadata: {}, body: content, hasFrontmatter: false };
  }

  const body = lines.slice(closingIndex + 1).join('\n').trim();
  return { metadata, body, hasFrontmatter: true };
}

/**
 * Ghép metadata và body Markdown thành chuẩn có YAML Frontmatter
 */
export function stringifyWithFrontmatter(metadata = {}, body = '') {
  const metaLines = ['---'];
  for (const [key, val] of Object.entries(metadata)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      const items = val.map(v => String(v).replace(/"/g, '\\"')).join(', ');
      metaLines.push(`${key}: [${items}]`);
    } else {
      const strVal = String(val).replace(/"/g, '\\"');
      metaLines.push(`${key}: "${strVal}"`);
    }
  }
  metaLines.push('---');
  metaLines.push('');
  return `${metaLines.join('\n')}\n${body.trim()}\n`;
}

/**
 * Ghi file nguyên tử trên Windows an toàn có Retry 3 lần chống EBUSY/EPERM
 */
export function safeAtomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');

  const delays = [50, 100, 200];
  let lastErr = null;

  for (let i = 0; i <= delays.length; i++) {
    try {
      fs.renameSync(tmpPath, targetPath);
      return;
    } catch (err) {
      lastErr = err;
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && i < delays.length) {
        const waitTill = Date.now() + delays[i];
        while (Date.now() < waitTill) { /* sync busy wait */ }
      } else {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        throw err;
      }
    }
  }

  throw lastErr;
}

/**
 * CatalogBuilder — Tự động quét và tổng hợp Master Catalog, Virtual Graph cho Vault
 */
export class CatalogBuilder {
  constructor(options = {}) {
    this.logger = options.logger || console;
  }

  /**
   * Trích xuất các liên kết [[wikilinks]] trong nội dung Markdown
   * @param {string} content
   * @returns {string[]}
   */
  extractWikilinks(content) {
    if (!content || typeof content !== 'string') return [];
    const matches = content.match(/\[\[(.*?)\]\]/g);
    if (!matches) return [];

    const links = new Set();
    for (const m of matches) {
      let raw = m.slice(2, -2).trim();
      if (raw.includes('|')) {
        raw = raw.split('|')[0].trim();
      }
      if (raw) links.add(raw);
    }
    return Array.from(links);
  }

  /**
   * Quét toàn bộ Vault và trả về Virtual Catalog + Graph Data (Nodes & Edges)
   * Không bắt buộc ghi file index.md
   */
  getVirtualCatalog(vaultDir) {
    if (!fs.existsSync(vaultDir)) {
      return { articles: [], graph: { nodes: [], links: [] }, stats: { totalArticles: 0, totalSize: 0 } };
    }

    const files = fs.readdirSync(vaultDir)
      .filter(f => f.endsWith('.md') && f !== 'index.md' && !f.startsWith('.') && !f.endsWith('.tmp'));

    const articles = [];
    const nodes = [];
    const links = [];
    let totalSize = 0;

    for (const filename of files) {
      const filePath = path.join(vaultDir, filename);
      const stat = fs.statSync(filePath);
      totalSize += stat.size;

      const raw = fs.readFileSync(filePath, 'utf8');
      const { metadata, body } = parseFrontmatter(raw);
      const slug = filename.replace(/\.md$/i, '');
      const title = metadata.title || slug;
      const wikilinks = this.extractWikilinks(body);

      const art = {
        slug,
        filename,
        title,
        summary: metadata.summary || body.slice(0, 120).replace(/[\r\n]+/g, ' ').trim() + '...',
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
        dateAdded: metadata.date_added || new Date(stat.mtime).toISOString().split('T')[0],
        sizeBytes: stat.size,
        updatedAt: stat.mtimeMs,
        wikilinks
      };

      articles.push(art);

      nodes.push({
        id: slug,
        label: title,
        size: stat.size
      });

      for (const target of wikilinks) {
        links.push({
          source: slug,
          target
        });
      }
    }

    // Luôn có node trung tâm index nếu có bài viết
    if (articles.length > 0) {
      nodes.unshift({
        id: 'index',
        label: '⭐ Mục Lục Tổng Hợp',
        size: 1024,
        isMaster: true
      });
      // Nối các bài viết độc lập vào index nếu chưa có liên kết nào
      for (const a of articles) {
        if (!links.some(l => l.source === a.slug || l.target === a.slug)) {
          links.push({ source: 'index', target: a.slug });
        }
      }
    }

    return {
      articles,
      graph: { nodes: nodes.slice(0, 80), links: links.slice(0, 160) }, // Cap 80 nodes an toàn
      stats: {
        totalArticles: articles.length,
        totalSize,
        totalEstimatedTokens: Math.round(totalSize / 3.5)
      }
    };
  }

  /**
   * Tự động sinh file index.md vật lý trên đĩa
   */
  rebuildCatalog(vaultDir) {
    const { articles, stats } = this.getVirtualCatalog(vaultDir);
    if (!fs.existsSync(vaultDir)) return '';

    const lines = [
      '---',
      'title: "Mục Lục Tổng Hợp — Master Catalog"',
      `date_added: "${new Date().toISOString().split('T')[0]}"`,
      'status: "canonical"',
      'summary: "Mục lục toàn diện các bài viết trong Sổ tay bán hàng & Kho tri thức Zalo-Flow"',
      '---',
      '',
      '# 📚 Mục Lục Sổ Tay Bán Hàng & Tri Thức AI',
      '',
      `> **Tổng số bài viết:** ${stats.totalArticles} bài | **Dung lượng:** ${(stats.totalSize / 1024).toFixed(1)} KB`,
      '',
      '| Bài Viết | Tóm Tắt | Thẻ |',
      '| :--- | :--- | :--- |'
    ];

    for (const a of articles) {
      const tagStr = a.tags.length > 0 ? a.tags.map(t => `#${t}`).join(' ') : '—';
      lines.push(`| [[${a.slug}]] **${escapeTableCell(a.title)}** | ${escapeTableCell(a.summary)} | ${escapeTableCell(tagStr)} |`);
    }

    lines.push('');
    const content = lines.join('\n');
    const targetFile = path.join(vaultDir, 'index.md');

    try {
      safeAtomicWrite(targetFile, content);
      return content;
    } catch (err) {
      this.logger.warn(`⚠️ [CatalogBuilder] Không thể ghi index.md: ${err.message}`);
      return content;
    }
  }
}
