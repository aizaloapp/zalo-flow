import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { aiAgentAdapter, CURATED_MODELS } from '../adapters/ai-agent.js';
import { encryptSecret, decryptSecret, maskApiKey } from '../utils/ai-crypto.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// GET /api/ai/settings — Retrieve AI Settings (Masked secrets)
// -----------------------------------------------------------------------------
router.get('/ai/settings', requireAuth, (req, res) => {
  try {
    const raw = localStore.getAiSettings();
    const primaryDecrypted = raw.apiKeyEncrypted ? decryptSecret(raw.apiKeyEncrypted) : (process.env.AI_API_KEY || '');
    const fallbackDecrypted = raw.fallbackApiKeyEncrypted ? decryptSecret(raw.fallbackApiKeyEncrypted) : (process.env.AI_FALLBACK_API_KEY || '');

    const safeSettings = {
      ...raw,
      hasApiKey: Boolean(primaryDecrypted),
      maskedApiKey: maskApiKey(primaryDecrypted),
      hasFallbackApiKey: Boolean(fallbackDecrypted),
      maskedFallbackApiKey: maskApiKey(fallbackDecrypted),
      // Zero-leak: do not return encrypted raw strings to browser
      apiKeyEncrypted: undefined,
      fallbackApiKeyEncrypted: undefined
    };

    res.json({ status: 'success', data: safeSettings });
  } catch (err) {
    logger.error(`Error reading AI settings: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/settings — Save AI Settings (Encrypts new secrets)
// -----------------------------------------------------------------------------
router.post('/ai/settings', requireAuth, (req, res) => {
  try {
    const payload = req.body || {};
    const current = localStore.getAiSettings();

    const toSave = { ...payload };

    // Encrypt primary API Key if a new one is provided
    if (payload.apiKey && typeof payload.apiKey === 'string' && payload.apiKey.trim()) {
      toSave.apiKeyEncrypted = encryptSecret(payload.apiKey.trim());
    } else if (payload.apiKey === '') {
      toSave.apiKeyEncrypted = '';
    } else {
      toSave.apiKeyEncrypted = current.apiKeyEncrypted;
    }
    delete toSave.apiKey;

    // Encrypt fallback API Key if a new one is provided
    if (payload.fallbackApiKey && typeof payload.fallbackApiKey === 'string' && payload.fallbackApiKey.trim()) {
      toSave.fallbackApiKeyEncrypted = encryptSecret(payload.fallbackApiKey.trim());
    } else if (payload.fallbackApiKey === '') {
      toSave.fallbackApiKeyEncrypted = '';
    } else {
      toSave.fallbackApiKeyEncrypted = current.fallbackApiKeyEncrypted;
    }
    delete toSave.fallbackApiKey;

    const saved = localStore.saveAiSettings(toSave);
    logger.info(`✅ [AI Settings] Updated AI suite configuration (Provider: ${saved.provider}:${saved.model}, Enabled: ${saved.isEnabled})`);

    const primaryDecrypted = saved.apiKeyEncrypted ? decryptSecret(saved.apiKeyEncrypted) : (process.env.AI_API_KEY || '');
    const fallbackDecrypted = saved.fallbackApiKeyEncrypted ? decryptSecret(saved.fallbackApiKeyEncrypted) : (process.env.AI_FALLBACK_API_KEY || '');

    res.json({
      status: 'success',
      data: {
        ...saved,
        hasApiKey: Boolean(primaryDecrypted),
        maskedApiKey: maskApiKey(primaryDecrypted),
        hasFallbackApiKey: Boolean(fallbackDecrypted),
        maskedFallbackApiKey: maskApiKey(fallbackDecrypted),
        apiKeyEncrypted: undefined,
        fallbackApiKeyEncrypted: undefined
      }
    });
  } catch (err) {
    logger.error(`Error saving AI settings: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/test-connection — Live Ping / Latency Test
// -----------------------------------------------------------------------------
router.post('/ai/test-connection', requireAuth, async (req, res) => {
  try {
    const { provider, model, apiKey, baseUrl, isFallback } = req.body || {};
    const settings = localStore.getAiSettings();

    const targetProvider = provider || (isFallback ? settings.fallbackProvider : settings.provider) || 'gemini';
    const isSameProvider = targetProvider === (settings.provider || 'gemini');

    let resolvedKey = apiKey?.trim();
    if (!resolvedKey) {
      if (isFallback) {
        if (settings.fallbackApiKeyEncrypted) {
          resolvedKey = decryptSecret(settings.fallbackApiKeyEncrypted);
        } else if (process.env.AI_FALLBACK_API_KEY) {
          resolvedKey = process.env.AI_FALLBACK_API_KEY;
        } else if (isSameProvider) {
          resolvedKey = settings.apiKeyEncrypted ? decryptSecret(settings.apiKeyEncrypted) : (process.env.AI_API_KEY || '');
        }
      } else {
        resolvedKey = settings.apiKeyEncrypted ? decryptSecret(settings.apiKeyEncrypted) : (process.env.AI_API_KEY || '');
      }
    }

    if (resolvedKey) {
      resolvedKey = resolvedKey.replace(/^["']|["']$/g, '').trim();
    }

    if (targetProvider !== 'ollama' && !resolvedKey) {
      return res.status(400).json({
        status: 'error',
        error: isFallback 
          ? `Nhà cung cấp dự phòng (${targetProvider.toUpperCase()}) khác nhà cung cấp chính (${(settings.provider || '').toUpperCase()}) nên không thể dùng chung key. Vui lòng nhập API Key riêng cho ${targetProvider.toUpperCase()} vào ô bên dưới!`
          : `Chưa có API Key cho ${targetProvider.toUpperCase()}. Vui lòng nhập API Key trước khi kiểm tra!`
      });
    }

    const defaultModel = targetProvider === 'gemini' ? 'gemini-2.0-flash' : (targetProvider === 'zai' ? 'glm-5.3-flash' : 'deepseek-chat');
    const targetModel = model || (isFallback ? settings.fallbackModel : settings.model) || defaultModel;

    const testResult = await aiAgentAdapter.testConnection({
      provider: targetProvider,
      model: targetModel,
      apiKey: resolvedKey,
      baseUrl: baseUrl || (isFallback ? settings.fallbackBaseUrl : settings.baseUrl)
    });

    res.json(testResult);
  } catch (err) {
    logger.warn(`AI Test Connection failed: ${err.message}`);
    res.status(400).json({ status: 'error', error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/scan-models — Live Model Scanner with Fallback to Curated
// -----------------------------------------------------------------------------
router.post('/ai/scan-models', requireAuth, async (req, res) => {
  try {
    const { provider = 'gemini', apiKey, baseUrl, isFallback } = req.body || {};
    const settings = localStore.getAiSettings();

    const targetProvider = provider || (isFallback ? settings.fallbackProvider : settings.provider) || 'gemini';
    const isSameProvider = targetProvider === (settings.provider || 'gemini');

    let resolvedKey = apiKey?.trim();
    if (!resolvedKey) {
      if (isFallback) {
        if (settings.fallbackApiKeyEncrypted) {
          resolvedKey = decryptSecret(settings.fallbackApiKeyEncrypted);
        } else if (process.env.AI_FALLBACK_API_KEY) {
          resolvedKey = process.env.AI_FALLBACK_API_KEY;
        } else if (isSameProvider) {
          resolvedKey = settings.apiKeyEncrypted ? decryptSecret(settings.apiKeyEncrypted) : (process.env.AI_API_KEY || '');
        }
      } else {
        resolvedKey = settings.apiKeyEncrypted ? decryptSecret(settings.apiKeyEncrypted) : (process.env.AI_API_KEY || '');
      }
    }

    if (resolvedKey) {
      resolvedKey = resolvedKey.replace(/^["']|["']$/g, '').trim();
    }

    const scanResult = await aiAgentAdapter.fetchLiveModels({
      provider: targetProvider,
      apiKey: resolvedKey,
      baseUrl: baseUrl || (isFallback ? settings.fallbackBaseUrl : settings.baseUrl)
    });

    res.json({
      status: 'success',
      data: scanResult.models,
      isLive: scanResult.isLive,
      count: scanResult.count || scanResult.models.length
    });
  } catch (err) {
    logger.warn(`AI Scan Models failed: ${err.message}`);
    res.json({
      status: 'success',
      data: CURATED_MODELS[req.body?.provider || 'gemini'] || CURATED_MODELS.gemini,
      isLive: false
    });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/simulate — Interactive Simulator Playground (Tab 5)
// -----------------------------------------------------------------------------
router.post('/ai/simulate', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required for simulation' });
    }

    const settings = localStore.getAiSettings();
    const systemPrompt = aiAgentAdapter.compilePrompt(settings);

    const reply = await aiAgentAdapter.callModelWithFallback(
      systemPrompt,
      history,
      message.trim(),
      settings
    );

    res.json({
      status: 'success',
      reply: reply.trim()
    });
  } catch (err) {
    logger.error(`AI Simulation error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET & POST /api/ai/wiki-preview — Mini Second Brain Wiki Preview & Stats
// -----------------------------------------------------------------------------
router.get('/ai/wiki-preview', requireAuth, (req, res) => {
  try {
    const settings = localStore.getAiSettings() || {};
    const wikiMarkdown = aiAgentAdapter.compileWikiView(settings);
    const rawPrompt = aiAgentAdapter.compilePrompt(settings);
    const stats = aiAgentAdapter.getWikiStats(wikiMarkdown, settings);
    res.json({
      status: 'success',
      data: {
        wikiMarkdown,
        rawPrompt,
        stats
      }
    });
  } catch (err) {
    logger.error(`Error generating wiki view: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

router.post('/ai/wiki-preview', requireAuth, (req, res) => {
  try {
    const draft = req.body;
    // Audit Fix I3: Validation bắt buộc cho draftSettings
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      return res.status(400).json({ error: 'draftSettings must be a valid JSON object' });
    }

    const current = localStore.getAiSettings() || {};
    const merged = { ...current, ...draft };

    const wikiMarkdown = aiAgentAdapter.compileWikiView(merged);
    const rawPrompt = aiAgentAdapter.compilePrompt(merged);
    const stats = aiAgentAdapter.getWikiStats(wikiMarkdown, merged);

    res.json({
      status: 'success',
      data: {
        wikiMarkdown,
        rawPrompt,
        stats
      }
    });
  } catch (err) {
    logger.error(`Error generating draft wiki view: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/wiki-apply — Apply & Sync Raw Markdown to Mini Second Brain Wiki
// -----------------------------------------------------------------------------
router.post('/ai/wiki-apply', requireAuth, (req, res) => {
  try {
    const { markdown, replaceQna = false } = req.body || {};
    if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
      return res.status(400).json({ error: 'Nội dung Markdown không được để trống.' });
    }

    const parsed = aiAgentAdapter.parseWikiMarkdown(markdown);
    const toUpdate = {};
    const updatedFields = [];

    if (parsed.soul) {
      toUpdate.soulPrompt = parsed.soul;
      updatedFields.push('SOUL (Giọng điệu)');
    }
    if (parsed.memory) {
      toUpdate.memoryPrompt = parsed.memory;
      updatedFields.push('MEMORY (Bảng giá/Tri thức)');
    }
    if (parsed.scope) {
      toUpdate.scopePrompt = parsed.scope;
      updatedFields.push('SCOPE (Ranh giới & Cấm kỵ)');
    }
    if (parsed.fewShot) {
      toUpdate.exemplarConversation = parsed.fewShot;
      updatedFields.push('Few-Shot (Mẫu chat)');
    }

    // Save AI Settings to SQLite
    const saved = localStore.saveAiSettings(toUpdate);

    // Sync Q&A Pairs into Quick Messages
    let qnaSyncedCount = 0;
    if (parsed.qnaPairs && parsed.qnaPairs.length > 0) {
      const existingQuickMsgs = localStore.getQuickMessages() || [];
      
      if (replaceQna) {
        for (const qm of existingQuickMsgs) {
          if (qm.customerQuestion) {
            localStore.deleteQuickMessage(qm.id);
          }
        }
      }

      parsed.qnaPairs.forEach((pair) => {
        const questionClean = pair.question.trim();
        const answerClean = pair.answer.trim();

        // Check if question already exists in quick_messages
        const existing = (localStore.getQuickMessages() || []).find(
          qm => qm.customerQuestion && qm.customerQuestion.trim().toLowerCase() === questionClean.toLowerCase()
        );

        if (existing) {
          localStore.upsertQuickMessage({
            id: existing.id,
            shortcut: existing.shortcut,
            customerQuestion: questionClean,
            title: existing.title || questionClean,
            content: answerClean,
            mediaUrl: existing.mediaUrl || '',
            mediaType: existing.mediaType || '',
            mediaName: existing.mediaName || ''
          });
          qnaSyncedCount++;
        } else {
          const count = (localStore.getQuickMessages() || []).length + 1;
          const shortcut = `/qna_${count}`;
          localStore.upsertQuickMessage({
            shortcut,
            customerQuestion: questionClean,
            title: questionClean,
            content: answerClean
          });
          qnaSyncedCount++;
        }
      });
      updatedFields.push(`Q&A (${qnaSyncedCount} câu hỏi đáp)`);
    }

    // Re-compile view & compute stats
    const freshWikiMarkdown = aiAgentAdapter.compileWikiView(saved);
    const stats = aiAgentAdapter.getWikiStats(freshWikiMarkdown, saved);

    logger.info(`✅ [Mini Second Brain Wiki] Applied raw markdown. Updated fields: ${updatedFields.join(', ')}`);

    res.json({
      status: 'success',
      message: updatedFields.length > 0
        ? `Đã đồng bộ thành công: ${updatedFields.join(', ')}`
        : 'Đã phân tích Markdown nhưng không tìm thấy trường thay đổi mới.',
      data: {
        updatedFields,
        qnaSyncedCount,
        parsed,
        savedSettings: {
          soulPrompt: saved.soulPrompt,
          memoryPrompt: saved.memoryPrompt,
          scopePrompt: saved.scopePrompt,
          exemplarConversation: saved.exemplarConversation
        },
        wikiMarkdown: freshWikiMarkdown,
        stats
      }
    });
  } catch (err) {
    logger.error(`Error applying wiki markdown: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});


// -----------------------------------------------------------------------------
// POST /api/ai/extract-exemplar — 1-Click Extract Real Chat to Few-Shot Sample
// -----------------------------------------------------------------------------
router.post('/ai/extract-exemplar', requireAuth, (req, res) => {
  try {
    const { threadId, limit = 15 } = req.body || {};
    if (!threadId) {
      return res.status(400).json({ error: 'threadId is required' });
    }

    const rawMsgs = localStore.getMessages(threadId, { limit: Math.min(Number(limit) || 15, 30) }) || [];
    const ordered = rawMsgs.reverse();

    const dialogue = [];
    for (const m of ordered) {
      if (!m.text || m.text.startsWith('[Tin nhắn đã được thu hồi]')) continue;
      dialogue.push({
        role: m.isSelf ? 'assistant' : 'user',
        text: m.text.trim()
      });
    }

    res.json({
      status: 'success',
      data: dialogue
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/save-exemplar & DELETE /api/ai/exemplar
// -----------------------------------------------------------------------------
router.post('/ai/save-exemplar', requireAuth, (req, res) => {
  try {
    const { exemplarConversation } = req.body || {};
    const saved = localStore.saveAiSettings({ exemplarConversation });
    res.json({ status: 'success', data: saved.exemplarConversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/ai/exemplar', requireAuth, (req, res) => {
  try {
    const saved = localStore.saveAiSettings({ exemplarConversation: '' });
    res.json({ status: 'success', data: saved.exemplarConversation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/conversations/:threadId/toggle-ai — Per-Thread AI Toggle
// -----------------------------------------------------------------------------
router.post('/conversations/:threadId/toggle-ai', requireAuth, (req, res) => {
  try {
    const { threadId } = req.params;
    const conv = localStore.getConversation(threadId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const targetVal = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : (conv.aiEnabled === 0 ? true : false);
    const updated = localStore.setConversationAi(threadId, targetVal);

    logger.info(`⚡ [AI Per-Thread] Toggled AI for thread ${threadId}: ${targetVal ? 'ON' : 'OFF'}`);
    res.json({ status: 'success', data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
