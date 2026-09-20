import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CatalogBuilder, safeAtomicWrite, parseFrontmatter, stringifyWithFrontmatter } from './catalog-builder.js';

/**
 * Tính mã băm SHA-256 của chuỗi hoặc tệp để làm khóa lạc quan (Optimistic Lock).
 */
export function computeContentHash(content) {
  if (!content) return '';
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Sanitize slug đảm bảo an toàn tuyệt đối chống path traversal và lỗi Windows NTFS
 */
export function sanitizeSlug(rawSlug) {
  if (!rawSlug || typeof rawSlug !== 'string') return 'bai-viet-moi';
  const clean = rawSlug
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return clean || 'bai-viet-moi';
}

/**
 * Trích xuất chuỗi JSON an toàn từ phản hồi của LLM
 */
export function extractJsonFromLlmReply(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  try {
    return JSON.parse(rawText.trim());
  } catch {}

  const codeBlockMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {}
  }

  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(rawText.substring(firstBrace, lastBrace + 1).trim());
    } catch {}
  }

  return null;
}

export class KnowledgeSynthesizer {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.catalogBuilder = new CatalogBuilder({ logger: this.logger });
  }

  /**
   * Single-Pass Pre-retrieval RAG & Chưng cất tri thức qua AI Gateway.
   */
  async synthesize({
    text,
    instruction = '',
    imageBase64,
    mimeType = 'image/png',
    source = 'quick_capture',
    currentSoul = '',
    currentScope = '',
    retriever,
    vaultDir,
    llmCaller
  }) {
    let cleanText = (text || '').trim();
    const cleanInstruction = (instruction || '').trim();

    // 1. Kiểm tra an toàn Payload ảnh base64 (Max 5MB)
    if (imageBase64) {
      const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
      if (!allowedMimes.includes(mimeType.toLowerCase())) {
        throw new Error(`Định dạng ảnh không được hỗ trợ: ${mimeType}. Chỉ chấp nhận PNG, JPEG, WebP.`);
      }

      const approxBytes = Math.round((imageBase64.length * 3) / 4);
      if (approxBytes > 5 * 1024 * 1024) {
        throw new Error(`Dung lượng ảnh vượt quá giới hạn 5MB (${(approxBytes / 1024 / 1024).toFixed(1)}MB). Vui lòng nén ảnh trước khi dán.`);
      }
    }

    if (!cleanText && !imageBase64 && !cleanInstruction) {
      throw new Error('Vui lòng cung cấp nội dung tài liệu, hình ảnh hoặc câu Prompt lời dặn cho AI.');
    }
    if (!cleanText && imageBase64) {
      cleanText = cleanInstruction || 'Trích xuất và chưng cất toàn bộ thông tin, bảng giá, danh mục sản phẩm hoặc phong cách tư vấn từ hình ảnh này vào Sổ tay bán hàng.';
    }
    if (!llmCaller || typeof llmCaller !== 'function') {
      throw new Error('LLM Caller chưa sẵn sàng trong hệ thống.');
    }

    // 2. Pre-retrieval: Lấy Top 3 bài viết liên quan nhất từ Vault
    let relevantSnippets = [];
    if (retriever) {
      try {
        const queryText = cleanInstruction ? `${cleanInstruction} ${cleanText.slice(0, 300)}` : cleanText;
        const matches = retriever.query(queryText, { limit: 3, minScore: 0.1 });
        relevantSnippets = matches.map((m, idx) => ({
          idx: idx + 1,
          title: m.title,
          sourceFile: m.sourceFile,
          content: m.content
        }));
      } catch (err) {
        this.logger.warn?.(`⚠️ [Synthesizer] Lỗi truy vấn BM25 pre-retrieval: ${err.message}`);
      }
    }

    // 3. Liệt kê danh sách các tệp hiện có trong Vault để AI chọn slug
    let existingSlugs = [];
    if (vaultDir && fs.existsSync(vaultDir)) {
      try {
        existingSlugs = fs
          .readdirSync(vaultDir)
          .filter(f => f.endsWith('.md') && f !== 'index.md')
          .map(f => f.replace(/\.md$/, ''));
      } catch {}
    }

    // 4. Đóng gói System Prompt chuẩn mực cho Knowledge Synthesizer
    const systemPrompt = `Bạn là Senior Knowledge Architect và Chuyên Gia Huấn Luyện AI Bán Hàng của doanh nghiệp.
Nhiệm vụ của bạn là đọc một mẩu thông tin mới (ý tưởng, chính sách, tài liệu tải lên, ảnh chụp bảng giá/menu, ảnh chụp màn hình đoạn chat tư vấn thực tế), kết hợp với LỜI DẶN / YÊU CẦU PROMPT CỤ THỂ của người dùng để phân luồng kép:
1. SỔ TAY BÁN HÀNG (Wiki Markdown): Lưu trữ sự thật, giá cả, thông số, chính sách, danh mục sản phẩm.
2. CÁCH XƯNG HÔ & TƯ VẤN (SOUL Prompt): Quy tắc ứng xử, thái độ, xưng hô, dặn dò kịch bản trả lời khách hàng.

NGUYÊN TẮC BẮT BUỘC:
1. ƯU TIÊN LỜI DẶN / YÊU CẦU (PROMPT) CỦA NGƯỜI DÙNG:
   - Nếu người dùng có yêu cầu cụ thể (ví dụ: "chỉ trích xuất bảng giá", "cập nhật vào bài viết bang-gia", "học cách xưng hô đưa vào SOUL"), bạn BẮT BUỘC phải tập trung thực hiện chính xác chỉ thị đó.
2. ĐỐI SOÁT XUNG ĐỘT (Conflict Guard):
   - Soi chiếu thông tin mới với RANH GIỚI & ĐIỀU CẤM KỴ (SCOPE) và các bài viết liên quan.
   - Nếu phát hiện mâu thuẫn (Ví dụ: quy định mới vi phạm điều cấm, hoặc đè giá cũ vô căn cứ), ghi rõ cảnh báo vào mảng "conflicts".
3. TÁI SỬ DỤNG BÀI VIẾT (Incremental Compilation):
   - Nếu thông tin mới thuộc về một chủ đề đã có trong danh sách bài viết liên quan, hãy chọn action "UPDATE_EXISTING", chọn target_slug tương ứng và chèn/sửa vào đúng vị trí một cách hài hòa.
   - Nếu là chủ đề hoàn toàn mới, chọn action "CREATE_NEW", đặt tên slug ngắn gọn dạng kebab-case không dấu (Ví dụ: "chinh-sach-bao-hanh", "bang-gia-combo").
   - Nếu là ảnh chụp đoạn chat tư vấn mẫu, trích xuất phong cách xưng hô vào SOUL và các dữ kiện giá cả vào bài viết tương ứng.
4. FORMAT KARPATHY WIKI & OBSIDIAN FRONTMATTER:
   - Bài viết Markdown BẮT BUỘC có phần mở đầu YAML Frontmatter chuẩn chỉnh cho Obsidian:
---
title: "Tiêu Đề Bài Viết Rõ Ràng"
date_added: "${new Date().toISOString().split('T')[0]}"
summary: "Tóm tắt ngắn gọn 1-2 câu"
tags: [the1, the2]
---
   - Không được dùng định dạng JSON trong thân bài, thân bài là Markdown sạch.
5. ĐỊNH DẠNG ĐẦU RA BẮT BUỘC (Strict JSON Output):
   - Phản hồi của bạn BẮT BUỘC là 1 đối tượng JSON duy nhất (không có bất kỳ lời chào nào bên ngoài JSON), tuân theo cấu trúc sau:
{
  "action": "CREATE_NEW" | "UPDATE_EXISTING" | "MODIFY_SOUL",
  "target_slug": "ten-file-kebab-case",
  "title": "Tiêu Đề Bài Viết",
  "markdown_content": "---\\ntitle: ...\\n---\\n# Nội dung bài viết...",
  "diff_summary": "Tóm tắt 1 câu những thay đổi hoặc bài viết mới được tạo ra",
  "conflicts": ["Cảnh báo xung đột nếu có, để trống nếu không có"],
  "soul_update": "Nếu có quy tắc xưng hô mới cần bổ sung vào SOUL, ghi chuỗi quy tắc cần thêm ở đây, nếu không có thì để null"
}`;

    const promptSection = cleanInstruction
      ? `=== LỜI DẶN / YÊU CẦU PROMPT CỦA NGƯỜI DÙNG ===\n${cleanInstruction}\n\n`
      : `=== LỜI DẶN / YÊU CẦU PROMPT CỦA NGƯỜI DÙNG ===\nĐọc, phân tích toàn bộ dữ liệu/hình ảnh đính kèm và chưng cất vào Sổ tay bán hàng hoặc SOUL.\n\n`;

    const userPrompt = `${promptSection}=== NỘI DUNG TÀI LIỆU / DỮ LIỆU ĐÍNH KÈM ===
${cleanText || '(Không có văn bản đính kèm - Phân tích từ hình ảnh được tải lên)'}

=== RANH GIỚI & ĐIỀU CẤM HIỆN TẠI (SCOPE) ===
${currentScope || 'Chưa thiết lập'}

=== PHONG CÁCH & XƯNG HÔ HIỆN TẠI (SOUL) ===
${currentSoul || 'Chưa thiết lập'}

=== CÁC BÀI VIẾT LIÊN QUAN NHẤT TRONG SỔ TAY HIỆN CÓ ===
${relevantSnippets.length > 0
  ? relevantSnippets.map(s => `[Bài #${s.idx}: ${s.title} (${s.sourceFile})]\n${s.content.slice(0, 800)}...`).join('\n\n---\n\n')
  : 'Kho tri thức hiện đang trống hoặc chưa có bài nào liên quan.'}

=== DANH SÁCH SLUG HIỆN CÓ TRONG VAULT ===
${existingSlugs.length > 0 ? existingSlugs.join(', ') : 'Chưa có bài viết nào.'}

Hãy phân tích và trả về đối tượng JSON theo đúng cấu trúc quy định.`;

    let llmResponseText = '';
    try {
      llmResponseText = await llmCaller({
        systemPrompt,
        userPrompt,
        imageBase64,
        mimeType
      });
    } catch (err) {
      throw new Error(`Gọi LLM để chưng cất tri thức thất bại: ${err.message}`);
    }

    const parsed = extractJsonFromLlmReply(llmResponseText);
    if (!parsed || !parsed.action) {
      throw new Error('Mô hình AI không trả về cấu trúc JSON hợp lệ cho bản chưng cất tri thức.');
    }

    const cleanSlug = sanitizeSlug(parsed.target_slug || parsed.title || 'bai-viet-moi');
    parsed.target_slug = cleanSlug;

    // Lấy nội dung hiện tại của file (nếu là UPDATE_EXISTING) để tính expectedHash
    let currentFileContent = '';
    let currentHash = '';
    const targetFilePath = path.join(vaultDir, `${cleanSlug}.md`);
    if (fs.existsSync(targetFilePath)) {
      currentFileContent = fs.readFileSync(targetFilePath, 'utf8');
      currentHash = computeContentHash(currentFileContent);
    }

    return {
      action: parsed.action,
      targetSlug: cleanSlug,
      title: parsed.title || cleanSlug,
      markdownContent: parsed.markdown_content || '',
      diffSummary: parsed.diff_summary || 'Cập nhật tri thức mới',
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
      soulUpdate: parsed.soul_update || null,
      currentHash,
      isNew: !fs.existsSync(targetFilePath)
    };
  }

  /**
   * Áp dụng Diff vào Vault với đầy đủ 4 tầng bảo vệ:
   * 1. Optimistic Lock (SHA-256)
   * 2. SQLite Snapshot trong wiki_revisions
   * 3. Atomic Write an toàn trên Windows
   * 4. Hot re-index vào BM25
   */
  async applyDiff({
    profileId = 'default',
    slug,
    title,
    content,
    proposedContent,
    expectedHash,
    summary = '',
    source = 'ai_synthesizer',
    vaultDir,
    store,
    retriever,
    indexer
  }) {
    const rawContent = content || proposedContent;
    if (!slug || !rawContent) {
      throw new Error('Slug và nội dung bài viết không được để trống.');
    }

    const cleanSlug = sanitizeSlug(slug);
    const filePath = path.join(vaultDir, `${cleanSlug}.md`);

    // 1. Chốt chặn Optimistic Lock (Khóa lạc quan)
    if (fs.existsSync(filePath)) {
      const existingContent = fs.readFileSync(filePath, 'utf8');
      const actualHash = computeContentHash(existingContent);
      if (expectedHash && expectedHash !== actualHash) {
        throw new Error(`Xung đột dữ liệu (Optimistic Lock): Bài viết "${cleanSlug}" đã bị thay đổi bởi phiên khác trước khi lưu. Vui lòng tải lại bài viết.`);
      }
    }

    // 2. Đảm bảo có YAML Frontmatter hợp lệ
    let finalContent = rawContent;
    const { hasFrontmatter, metadata, body } = parseFrontmatter(rawContent);
    if (!hasFrontmatter) {
      finalContent = stringifyWithFrontmatter({
        title: title || cleanSlug,
        date_added: new Date().toISOString().split('T')[0],
        summary: summary || body.slice(0, 100).replace(/[\r\n]+/g, ' ').trim()
      }, body || content);
    }

    const newHash = computeContentHash(finalContent);

    // 3. Ghi file nguyên tử có retry
    safeAtomicWrite(filePath, finalContent);

    // 4. Lưu snapshot vào SQLite bảng wiki_revisions
    let revisionId = null;
    if (store && typeof store.recordWikiRevision === 'function') {
      try {
        const rev = store.recordWikiRevision({
          profileId,
          slug: cleanSlug,
          title: title || cleanSlug,
          content: finalContent,
          contentHash: newHash,
          summary,
          source
        });
        revisionId = rev?.id || null;
      } catch (err) {
        this.logger.warn?.(`⚠️ [Synthesizer] Không thể lưu wiki revision vào SQLite: ${err.message}`);
      }
    }

    // 5. Nạp nóng vào BM25 Retriever
    if (indexer && retriever) {
      try {
        indexer.hotReloadArticle(filePath, finalContent, retriever);
      } catch (err) {
        this.logger.warn?.(`⚠️ [Synthesizer] Không thể nạp nóng BM25: ${err.message}`);
      }
    }

    // 6. Cập nhật Virtual Catalog / index.md
    try {
      this.catalogBuilder.rebuildCatalog(vaultDir);
    } catch {}

    return {
      status: 'success',
      slug: cleanSlug,
      title: title || cleanSlug,
      contentHash: newHash,
      revisionId,
      filePath
    };
  }

  /**
   * Hoàn tác (Rollback) bài viết về revision trong quá khứ
   */
  async rollbackRevision({
    revisionId,
    vaultDir,
    store,
    retriever,
    indexer
  }) {
    if (!store || typeof store.getWikiRevisionById !== 'function') {
      throw new Error('LocalStore chưa hỗ trợ tra cứu revision.');
    }

    const rev = store.getWikiRevisionById(revisionId);
    if (!rev) {
      throw new Error(`Không tìm thấy bản ghi revision #${revisionId}`);
    }

    const cleanSlug = sanitizeSlug(rev.slug);
    const filePath = path.join(vaultDir, `${cleanSlug}.md`);

    // Ghi nội dung cũ đè lại vào file (Bảo toàn Frontmatter)
    let finalContent = rev.content;
    const { hasFrontmatter, metadata, body } = parseFrontmatter(rev.content);
    if (!hasFrontmatter) {
      // Đọc tags từ file hiện tại nếu có
      let existingTags = [];
      if (fs.existsSync(filePath)) {
        try {
          const currentFile = fs.readFileSync(filePath, 'utf8');
          const currentParsed = parseFrontmatter(currentFile);
          if (Array.isArray(currentParsed.metadata.tags)) {
            existingTags = currentParsed.metadata.tags;
          }
        } catch {}
      }

      finalContent = stringifyWithFrontmatter({
        title: rev.title || cleanSlug,
        date_added: new Date().toISOString().split('T')[0],
        summary: `Khôi phục từ revision #${revisionId}`,
        tags: existingTags
      }, body || rev.content);
    }

    safeAtomicWrite(filePath, finalContent);

    // Lưu một revision mới đánh dấu thao tác hoàn tác
    const newHash = computeContentHash(finalContent);
    if (typeof store.recordWikiRevision === 'function') {
      store.recordWikiRevision({
        profileId: rev.profileId,
        slug: cleanSlug,
        title: rev.title,
        content: rev.content,
        contentHash: newHash,
        summary: `Hoàn tác về phiên bản #${revisionId} (${rev.createdAt})`,
        source: 'rollback'
      });
    }

    // Nạp nóng lại BM25
    if (indexer && retriever) {
      indexer.hotReloadArticle(filePath, rev.content, retriever);
    }

    try {
      this.catalogBuilder.rebuildCatalog(vaultDir);
    } catch {}

    return {
      status: 'success',
      slug: cleanSlug,
      title: rev.title,
      restoredFromId: revisionId
    };
  }
}
