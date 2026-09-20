import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { vaultManager } from '../services/second-brain/vault-manager.js';
import { KnowledgeSynthesizer, sanitizeSlug } from '../services/second-brain/synthesizer.js';
import { decryptSecret } from '../utils/ai-crypto.js';
import { aiAgentAdapter } from '../adapters/ai-agent.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// GET /api/ai/vault/stats — Thống kê Vault theo Profile
// -----------------------------------------------------------------------------
router.get('/ai/vault/stats', requireAuth, async (req, res) => {
  try {
    const profileId = String(req.query.profileId || 'default').trim();
    const stats = await vaultManager.getVaultStats(profileId);
    res.json({ status: 'success', data: stats });
  } catch (err) {
    logger.error(`[AiVault] Error getting stats: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /api/ai/vault/files — Danh sách bài viết trong Vault
// -----------------------------------------------------------------------------
router.get('/ai/vault/files', requireAuth, async (req, res) => {
  try {
    const profileId = String(req.query.profileId || 'default').trim();
    const articles = await vaultManager.listArticles(profileId);
    res.json({ status: 'success', data: articles });
  } catch (err) {
    logger.error(`[AiVault] Error listing files: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /api/ai/vault/file — Xem chi tiết bài viết
// -----------------------------------------------------------------------------
router.get('/ai/vault/file', requireAuth, async (req, res) => {
  try {
    const profileId = String(req.query.profileId || 'default').trim();
    const slug = String(req.query.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ error: 'Thiếu tham số slug bài viết' });
    }

    const article = await vaultManager.getArticle(profileId, slug);
    if (!article) {
      return res.status(404).json({ error: 'Không tìm thấy bài viết' });
    }

    res.json({ status: 'success', data: article });
  } catch (err) {
    logger.error(`[AiVault] Error reading file: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/vault/file — Tạo mới hoặc chỉnh sửa bài viết thủ công
// -----------------------------------------------------------------------------
router.post('/api/ai/vault/file', requireAuth, async (req, res) => {
  try {
    const { profileId = 'default', slug, title, content, summary, tags, source = 'manual_editor' } = req.body || {};
    if (!content && content !== '') {
      return res.status(400).json({ error: 'Nội dung bài viết không được để trống' });
    }

    const result = await vaultManager.saveArticle({
      profileId: String(profileId).trim(),
      slug: slug ? String(slug).trim() : undefined,
      title: title ? String(title).trim() : undefined,
      content: String(content),
      summary: summary ? String(summary).trim() : 'Lưu từ trình soạn thảo',
      tags: Array.isArray(tags) ? tags : [],
      source
    });

    res.json({ status: 'success', data: result });
  } catch (err) {
    logger.error(`[AiVault] Error saving file: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// DELETE /api/ai/vault/file — Xóa bài viết
// -----------------------------------------------------------------------------
router.delete('/api/ai/vault/file', requireAuth, async (req, res) => {
  try {
    const profileId = String(req.query.profileId || req.body?.profileId || 'default').trim();
    const slug = String(req.query.slug || req.body?.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ error: 'Thiếu tham số slug bài viết cần xóa' });
    }

    const result = await vaultManager.deleteArticle(profileId, slug);
    res.json({ status: 'success', data: result });
  } catch (err) {
    logger.error(`[AiVault] Error deleting file: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/vault/synthesize — Cửa Sổ Dạy Bot Học Nhanh (AI Synthesizer Proposal)
// -----------------------------------------------------------------------------
router.post('/ai/vault/synthesize', requireAuth, async (req, res) => {
  try {
    const { profileId = 'default', text = '', image = null, autoApply = false } = req.body || {};
    const cleanProfileId = String(profileId).trim();

    if (!text && !image) {
      return res.status(400).json({ error: 'Vui lòng cung cấp văn bản hoặc hình ảnh để dạy Bot' });
    }

    // Bảo mật & Tài nguyên: Kiểm tra kích thước ảnh base64 (Max 5MB decoded)
    if (image && typeof image === 'string') {
      const match = image.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
      if (!match) {
        return res.status(400).json({ error: 'Định dạng hình ảnh không hợp lệ (hỗ trợ PNG, JPEG, WEBP base64)' });
      }
      const rawBase64 = match[2];
      const approxBytes = Math.ceil((rawBase64.length * 3) / 4);
      if (approxBytes > 5 * 1024 * 1024) {
        return res.status(413).json({ error: 'Kích thước hình ảnh vượt quá giới hạn 5MB cho phép' });
      }
    }

    // Lấy thông số AI Model & Key từ settings / profile
    const engineSettings = localStore.getAiSettings() || {};
    const profile = localStore.getAiProfile(cleanProfileId) || {};
    const provider = engineSettings.provider || 'gemini';
    const model = profile.model || engineSettings.model || 'gemini-2.5-flash';
    const baseUrl = engineSettings.baseUrl || '';
    const rawApiKey = engineSettings.apiKeyEncrypted 
      ? decryptSecret(engineSettings.apiKeyEncrypted) 
      : (process.env.AI_API_KEY || '');

    if (!rawApiKey && provider !== 'ollama') {
      return res.status(400).json({ 
        error: 'Chưa cấu hình API Key trong Cài Đặt AI. Vui lòng nạp API Key trước khi dạy Bot.' 
      });
    }

    const vaultDir = vaultManager.getVaultDir(cleanProfileId);
    const retriever = await vaultManager.getRetriever(cleanProfileId);

    // Xây dựng llmCaller đa năng kết nối trực tiếp với aiAgentAdapter
    const llmCaller = async ({ systemPrompt, userPrompt, imageBase64, mimeType }) => {
      const images = imageBase64 ? [{ base64: imageBase64, mimeType: mimeType || 'image/png' }] : [];
      return await aiAgentAdapter.callProvider({
        provider,
        model,
        apiKey: rawApiKey,
        baseUrl,
        systemPrompt,
        history: [],
        userMessage: userPrompt,
        images,
        timeoutMs: 45000
      });
    };

    // Tách phần ghi chú/lời dặn (instruction) và nội dung tệp (documentContent)
    const rawInputText = String(text || '').trim();
    const promptInstruction = String(req.body?.instruction || req.body?.prompt || '').trim();
    const imagePayload = image || (req.body?.imageBase64 || null);

    // Kích hoạt KnowledgeSynthesizer
    const proposal = await vaultManager.synthesizer.synthesize({
      profileId: cleanProfileId,
      text: rawInputText,
      instruction: promptInstruction,
      imageBase64: imagePayload,
      mimeType: req.body?.mimeType || 'image/png',
      vaultDir,
      retriever,
      llmCaller,
      currentSoul: profile.soulPrompt || engineSettings.soulPrompt || '',
      currentScope: profile.scopePrompt || engineSettings.scopePrompt || ''
    });

    // Nếu người dùng chọn autoApply và không có xung đột cần duyệt
    if (autoApply && proposal && !proposal.conflictFound) {
      if (proposal.routing === 'soul') {
        // Cập nhật SOUL trực tiếp vào Profile
        localStore.updateAiProfile(cleanProfileId, {
          soulPrompt: proposal.proposedContent
        });
        return res.json({
          status: 'success',
          data: {
            ...proposal,
            applied: true,
            appliedMessage: 'Đã tự động cập nhật Giọng Điệu & SOUL thành công!'
          }
        });
      } else {
        // Áp dụng vào Wiki Vault
        const indexer = await vaultManager.getIndexer(cleanProfileId);
        const resolvedSlug = proposal.slug || proposal.targetSlug;
        const resolvedContent = proposal.proposedContent || proposal.markdownContent;
        const applyResult = await vaultManager.synthesizer.applyDiff({
          profileId: cleanProfileId,
          slug: resolvedSlug,
          title: proposal.title,
          content: resolvedContent,
          proposedContent: resolvedContent,
          expectedHash: proposal.expectedHash || proposal.currentHash,
          summary: proposal.summary || proposal.diffSummary,
          source: proposal.source || 'quick_teach_auto',
          vaultDir,
          store: localStore,
          retriever,
          indexer
        });

        return res.json({
          status: 'success',
          data: {
            ...proposal,
            applied: true,
            applyResult
          }
        });
      }
    }

    res.json({ status: 'success', data: proposal });
  } catch (err) {
    logger.error(`[AiVault] Error in synthesize: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/vault/apply-diff — Xác nhận duyệt áp dụng đề xuất (Diff) vào Vault / SOUL
// -----------------------------------------------------------------------------
router.post('/ai/vault/apply-diff', requireAuth, async (req, res) => {
  try {
    const {
      profileId = 'default',
      slug,
      title,
      proposedContent,
      expectedHash = null,
      summary = 'Duyệt đề xuất tri thức từ AI',
      source = 'quick_teach_confirmed',
      routing = 'wiki'
    } = req.body || {};

    const cleanProfileId = String(profileId).trim();

    if (routing === 'soul') {
      localStore.updateAiProfile(cleanProfileId, {
        soulPrompt: proposedContent
      });
      return res.json({
        status: 'success',
        data: {
          routing: 'soul',
          profileId: cleanProfileId,
          message: 'Đã cập nhật Giọng Điệu & SOUL thành công!'
        }
      });
    }

    if (!slug || !proposedContent) {
      return res.status(400).json({ error: 'Thiếu thông tin slug hoặc nội dung đề xuất' });
    }

    const vaultDir = vaultManager.getVaultDir(cleanProfileId);
    const retriever = await vaultManager.getRetriever(cleanProfileId);
    const indexer = await vaultManager.getIndexer(cleanProfileId);

    const result = await vaultManager.synthesizer.applyDiff({
      profileId: cleanProfileId,
      slug: String(slug).trim(),
      title: title ? String(title).trim() : undefined,
      content: String(proposedContent),
      proposedContent: String(proposedContent),
      expectedHash,
      summary: String(summary),
      source,
      vaultDir,
      store: localStore,
      retriever,
      indexer
    });

    res.json({ status: 'success', data: result });
  } catch (err) {
    logger.error(`[AiVault] Error applying diff: ${err.message}`);
    const statusCode = err.message?.includes('Xung đột ghi đè') ? 409 : 500;
    res.status(statusCode).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /api/ai/vault/revisions — Lịch sử thay đổi (Snapshots)
// -----------------------------------------------------------------------------
router.get('/ai/vault/revisions', requireAuth, (req, res) => {
  try {
    const profileId = String(req.query.profileId || 'default').trim();
    const slug = req.query.slug ? String(req.query.slug).trim() : null;
    const limit = Number(req.query.limit || 50);

    const revisions = localStore.getWikiRevisions(profileId, slug, limit);
    res.json({ status: 'success', data: revisions });
  } catch (err) {
    logger.error(`[AiVault] Error getting revisions: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/vault/rollback — Hoàn tác 1-Click về phiên bản quá khứ
// -----------------------------------------------------------------------------
router.post('/ai/vault/rollback', requireAuth, async (req, res) => {
  try {
    const { profileId = 'default', revisionId } = req.body || {};
    if (!revisionId) {
      return res.status(400).json({ error: 'Thiếu mã revisionId cần hoàn tác' });
    }

    const cleanProfileId = String(profileId).trim();
    const vaultDir = vaultManager.getVaultDir(cleanProfileId);
    const retriever = await vaultManager.getRetriever(cleanProfileId);
    const indexer = await vaultManager.getIndexer(cleanProfileId);

    const result = await vaultManager.synthesizer.rollbackRevision({
      revisionId: Number(revisionId),
      vaultDir,
      store: localStore,
      retriever,
      indexer
    });

    res.json({ status: 'success', data: result });
  } catch (err) {
    logger.error(`[AiVault] Error during rollback: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /api/ai/vault/graph — Lấy sơ đồ liên kết tri thức (Nodes & Links)
// -----------------------------------------------------------------------------
router.get('/ai/vault/graph', requireAuth, async (req, res) => {
  try {
    const profileId = String(req.query.profileId || 'default').trim();
    const graph = await vaultManager.getGraph(profileId);
    res.json({ status: 'success', data: graph });
  } catch (err) {
    logger.error(`[AiVault] Error getting graph: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/vault/query — Thử nghiệm tra cứu BM25 Context
// -----------------------------------------------------------------------------
router.post('/ai/vault/query', requireAuth, async (req, res) => {
  try {
    const { profileId = 'default', query = '', topK = 3, minScore = 0.2 } = req.body || {};
    const cleanProfileId = String(profileId).trim();

    const result = await vaultManager.queryContext(cleanProfileId, String(query || ''), {
      topK: Number(topK) || 3,
      minScore: Number(minScore) || 0.2
    });

    res.json({ status: 'success', data: result });
  } catch (err) {
    logger.error(`[AiVault] Error querying vault: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
