import fs from 'node:fs';
import path from 'node:path';

/**
 * DocumentIndexer — Bộ nạp và phân rã tài liệu (Document Chunker) cho Second Brain Vault.
 * Hỗ trợ các định dạng: Markdown (.md), JSON (.json bảng giá/sản phẩm) và Văn bản (.txt).
 */
export class DocumentIndexer {
  constructor(options = {}) {
    this.maxChunkChars = options.maxChunkChars ?? 1500; // Độ dài tối đa 1 chunk
  }

  /**
   * Quét và lập chỉ mục toàn bộ thư mục vault.
   * @param {string} dirPath - Đường dẫn thư mục vault
   * @param {object} retriever - Instance của TFRetriever
   * @returns {number} Tổng số chunk đã nạp
   */
  indexDirectory(dirPath, retriever) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      return 0;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let totalChunks = 0;

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.tmp') || entry.name === 'index.md') {
        continue;
      }
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalChunks += this.indexDirectory(fullPath, retriever);
      } else if (entry.isFile()) {
        totalChunks += this.indexFile(fullPath, retriever);
      }
    }

    return totalChunks;
  }

  /**
   * Lập chỉ mục cho một tệp tin cụ thể.
   * @param {string} filePath
   * @param {object} retriever
   * @returns {number} Số chunks tạo từ file này
   */
  indexFile(filePath, retriever) {
    if (!fs.existsSync(filePath)) return 0;

    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    if (fileName === 'index.md' || fileName.startsWith('.') || fileName.endsWith('.tmp')) {
      return 0;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    let chunks = [];

    if (ext === '.md') {
      chunks = this.parseMarkdown(content, fileName);
    } else if (ext === '.json') {
      chunks = this.parseJson(content, fileName);
    } else if (ext === '.txt') {
      chunks = this.parsePlainText(content, fileName);
    }

    for (const chunk of chunks) {
      retriever.addDocument(chunk);
    }

    return chunks.length;
  }

  /**
   * Cập nhật nóng 1 file vào bộ chỉ mục (Incremental Hot Reload).
   * Xóa các chunks cũ của file này và nạp chunks mới mà không tải lại toàn bộ vault.
   * @param {string} filePath
   * @param {string} [content]
   * @param {object} retriever
   * @returns {number} Số chunks được nạp
   */
  hotReloadArticle(filePath, content, retriever) {
    if (!retriever) return 0;
    const fileName = path.basename(filePath);
    if (fileName === 'index.md') return 0;

    const ext = path.extname(filePath).toLowerCase();

    // 1. Xóa các chunk cũ của file này
    if (typeof retriever.removeBySourceFile === 'function') {
      retriever.removeBySourceFile(fileName);
    }

    const text = content ?? (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '');
    if (!text) return 0;

    let chunks = [];
    if (ext === '.md') {
      chunks = this.parseMarkdown(text, fileName);
    } else if (ext === '.json') {
      chunks = this.parseJson(text, fileName);
    } else if (ext === '.txt') {
      chunks = this.parsePlainText(text, fileName);
    }

    for (const chunk of chunks) {
      retriever.addDocument(chunk);
    }

    return chunks.length;
  }

  /**
   * Phân rã tệp Markdown theo các tiêu đề (#, ##, ###).
   */
  parseMarkdown(content, fileName) {
    const rawLines = content.split(/\r?\n/);
    let startIndex = 0;
    // Bóc tách bỏ phần YAML Frontmatter để không làm ô nhiễm từ khóa BM25
    if (rawLines.length > 0 && rawLines[0].trim() === '---') {
      for (let i = 1; i < rawLines.length; i++) {
        if (rawLines[i].trim() === '---') {
          startIndex = i + 1;
          break;
        }
      }
    }
    const lines = startIndex > 0 ? rawLines.slice(startIndex) : rawLines;
    const chunks = [];

    let currentTitle = fileName.replace(/\.md$/i, '');
    let currentLines = [];
    let sectionIdx = 1;

    for (const line of lines) {
      const headerMatch = line.match(/^\\*(#{1,3})\s+(.+)$/);
      if (headerMatch) {
        if (currentLines.length > 0) {
          const body = currentLines.join('\n').trim();
          if (body) {
            chunks.push({
              id: `${fileName}#${sectionIdx}`,
              title: `${fileName} > ${currentTitle}`,
              content: body,
              sourceFile: fileName,
              metadata: { type: 'markdown_section', sectionIdx }
            });
            sectionIdx++;
          }
        }
        currentTitle = headerMatch[2].trim().replace(/^\\+/, '');
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    // Đẩy chunk cuối cùng
    if (currentLines.length > 0) {
      const body = currentLines.join('\n').trim();
      if (body) {
        chunks.push({
          id: `${fileName}#${sectionIdx}`,
          title: `${fileName} > ${currentTitle}`,
          content: body,
          sourceFile: fileName,
          metadata: { type: 'markdown_section', sectionIdx }
        });
      }
    }

    // Nếu bài viết quá ngắn hoặc không có heading, lưu thành 1 chunk duy nhất
    if (chunks.length === 0 && content.trim()) {
      chunks.push({
        id: `${fileName}#1`,
        title: fileName.replace(/\.md$/i, ''),
        content: content.trim(),
        sourceFile: fileName,
        metadata: { type: 'full_document' }
      });
    }

    return chunks;
  }

  /**
   * Phân rã tệp JSON (Bảng giá, danh mục sản phẩm).
   */
  parseJson(content, fileName) {
    try {
      const data = JSON.parse(content);
      const chunks = [];

      if (Array.isArray(data)) {
        data.forEach((item, idx) => {
          const title = item.name || item.title || item.sku || `${fileName} #${idx + 1}`;
          const body = Object.entries(item)
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join('\n');
          chunks.push({
            id: `${fileName}#${idx + 1}`,
            title: `${fileName} > ${title}`,
            content: body,
            sourceFile: fileName,
            metadata: { type: 'json_record', index: idx }
          });
        });
      } else if (typeof data === 'object' && data !== null) {
        Object.entries(data).forEach(([key, val], idx) => {
          const body = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
          chunks.push({
            id: `${fileName}#${key}`,
            title: `${fileName} > ${key}`,
            content: `${key}:\n${body}`,
            sourceFile: fileName,
            metadata: { type: 'json_key' }
          });
        });
      }

      return chunks;
    } catch {
      return this.parsePlainText(content, fileName);
    }
  }

  /**
   * Phân rã văn bản thô theo đoạn văn.
   */
  parsePlainText(content, fileName) {
    const paragraphs = content
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    return paragraphs.map((para, idx) => ({
      id: `${fileName}#${idx + 1}`,
      title: `${fileName} (Đoạn ${idx + 1})`,
      content: para,
      sourceFile: fileName,
      metadata: { type: 'plain_text_paragraph', paragraphIdx: idx + 1 }
    }));
  }
}
