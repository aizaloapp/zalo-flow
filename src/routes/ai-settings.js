import express from 'express';
import dns from 'dns';
import { requireAuth } from '../middleware/auth.js';
import { localStore } from '../utils/local-store.js';
import { aiAgentAdapter, CURATED_MODELS, isKeyCompatible, GOLDEN_WIKI_TEMPLATE } from '../adapters/ai-agent.js';
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

// Helper an toàn: Phân giải API Key hiệu lực, khử key rác không tương thích và kế thừa key chính khi cùng provider
function resolveEffectiveKey({ provider, apiKey, isFallback, primaryProvider, primaryApiKey, settings }) {
  const targetProvider = provider || (isFallback ? settings.fallbackProvider : settings.provider) || 'gemini';
  const effectivePrimary = primaryProvider || settings.provider || 'gemini';
  const isSameProvider = targetProvider === effectivePrimary;

  let cleanInputKey = (apiKey || '').trim().replace(/^["']|["']$/g, '');
  if (cleanInputKey && isKeyCompatible(cleanInputKey, targetProvider)) {
    return { key: cleanInputKey, targetProvider };
  }

  if (isFallback) {
    // 1. Kiểm tra key dự phòng riêng đã lưu trong DB (Bảo vệ người dùng dùng 2 tài khoản riêng)
    if (settings.fallbackApiKeyEncrypted) {
      const savedFallbackKey = decryptSecret(settings.fallbackApiKeyEncrypted);
      if (savedFallbackKey && isKeyCompatible(savedFallbackKey, targetProvider)) {
        return { key: savedFallbackKey, targetProvider };
      }
    }
    // 2. Kiểm tra biến môi trường dự phòng
    if (process.env.AI_FALLBACK_API_KEY && isKeyCompatible(process.env.AI_FALLBACK_API_KEY, targetProvider)) {
      return { key: process.env.AI_FALLBACK_API_KEY, targetProvider };
    }
    // 3. Nếu cùng nhà cung cấp (hoặc Form UI đang chọn cùng provider): Kế thừa key chính
    if (isSameProvider) {
      const cleanPrimaryKey = (primaryApiKey || '').trim().replace(/^["']|["']$/g, '');
      if (cleanPrimaryKey && isKeyCompatible(cleanPrimaryKey, targetProvider)) {
        return { key: cleanPrimaryKey, targetProvider };
      }
      if (settings.apiKeyEncrypted) {
        const savedPrimaryKey = decryptSecret(settings.apiKeyEncrypted);
        if (savedPrimaryKey && isKeyCompatible(savedPrimaryKey, targetProvider)) {
          return { key: savedPrimaryKey, targetProvider };
        }
      }
      if (process.env.AI_API_KEY && isKeyCompatible(process.env.AI_API_KEY, targetProvider)) {
        return { key: process.env.AI_API_KEY, targetProvider };
      }
    }
    return { key: '', targetProvider };
  } else {
    // Primary Key resolution
    if (cleanInputKey && isKeyCompatible(cleanInputKey, targetProvider)) {
      return { key: cleanInputKey, targetProvider };
    }
    if (settings.apiKeyEncrypted) {
      const savedPrimaryKey = decryptSecret(settings.apiKeyEncrypted);
      if (savedPrimaryKey && isKeyCompatible(savedPrimaryKey, targetProvider)) {
        return { key: savedPrimaryKey, targetProvider };
      }
    }
    if (process.env.AI_API_KEY && isKeyCompatible(process.env.AI_API_KEY, targetProvider)) {
      return { key: process.env.AI_API_KEY, targetProvider };
    }
    return { key: '', targetProvider };
  }
}

// Helper an toàn: Phân giải Base URL tránh trường hợp default URL của provider cũ (như DeepSeek) bị áp vào provider mới (như OpenRouter)
function resolveEffectiveBaseUrl(customUrl, provider) {
  const trimmed = (customUrl || '').trim();
  if (!trimmed) return '';
  const standardUrls = {
    deepseek: 'api.deepseek.com',
    zai: 'api.z.ai',
    groq: 'api.groq.com',
    openrouter: 'openrouter.ai',
    ollama: 'localhost:11434'
  };
  for (const [p, domain] of Object.entries(standardUrls)) {
    if (trimmed.includes(domain) && provider !== p) {
      // URL thuộc về provider khác -> Bỏ qua để adapter tự dùng default URL của target provider!
      return '';
    }
  }
  return trimmed;
}

// -----------------------------------------------------------------------------
// POST /api/ai/test-connection — Live Ping / Latency Test
// -----------------------------------------------------------------------------
router.post('/ai/test-connection', requireAuth, async (req, res) => {
  try {
    const { provider, model, apiKey, baseUrl, isFallback, primaryProvider, primaryApiKey } = req.body || {};
    const settings = localStore.getAiSettings();
    const { key: resolvedKey, targetProvider } = resolveEffectiveKey({
      provider,
      apiKey,
      isFallback,
      primaryProvider,
      primaryApiKey,
      settings
    });

    if (targetProvider !== 'ollama' && !resolvedKey) {
      return res.status(400).json({
        status: 'error',
        error: isFallback 
          ? `Nhà cung cấp dự phòng (${targetProvider.toUpperCase()}) chưa có API Key hợp lệ tương thích. Vui lòng nhập API Key cho ${targetProvider.toUpperCase()} vào ô bên dưới!`
          : `Chưa có API Key cho ${targetProvider.toUpperCase()}. Vui lòng nhập API Key trước khi kiểm tra!`
      });
    }

    const defaultModel = targetProvider === 'gemini' ? 'gemini-2.0-flash' : (targetProvider === 'zai' ? 'glm-5.3-flash' : 'deepseek-chat');
    const targetModel = model || (isFallback ? settings.fallbackModel : settings.model) || defaultModel;

    const rawBaseUrl = baseUrl || (isFallback ? settings.fallbackBaseUrl : settings.baseUrl);
    const resolvedBaseUrl = resolveEffectiveBaseUrl(rawBaseUrl, targetProvider);

    const testResult = await aiAgentAdapter.testConnection({
      provider: targetProvider,
      model: targetModel,
      apiKey: resolvedKey,
      baseUrl: resolvedBaseUrl
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
    const { provider = 'gemini', apiKey, baseUrl, isFallback, primaryProvider, primaryApiKey } = req.body || {};
    const settings = localStore.getAiSettings();
    const { key: resolvedKey, targetProvider } = resolveEffectiveKey({
      provider,
      apiKey,
      isFallback,
      primaryProvider,
      primaryApiKey,
      settings
    });

    const rawBaseUrl = baseUrl || (isFallback ? settings.fallbackBaseUrl : settings.baseUrl);
    const resolvedBaseUrl = resolveEffectiveBaseUrl(rawBaseUrl, targetProvider);

    const scanResult = await aiAgentAdapter.fetchLiveModels({
      provider: targetProvider,
      apiKey: resolvedKey,
      baseUrl: resolvedBaseUrl
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
// Helper: Chuyển đổi các định dạng URL phổ biến sang dạng Raw/Export Text
// -----------------------------------------------------------------------------
export function normalizeWikiUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') return '';
  let url = inputUrl.trim();

  // 1. GitHub Blob -> Raw
  const ghBlobRegex = /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)$/i;
  const ghMatch = url.match(ghBlobRegex);
  if (ghMatch) {
    return `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}/${ghMatch[4]}`;
  }

  // 2. GitHub Gist -> Raw
  const gistRegex = /^https?:\/\/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)(?:\/raw)?$/i;
  const gistMatch = url.match(gistRegex);
  if (gistMatch) {
    return `https://gist.githubusercontent.com/${gistMatch[1]}/${gistMatch[2]}/raw`;
  }

  // 3. Pastebin -> Raw
  const pastebinRegex = /^https?:\/\/(?:www\.)?pastebin\.com\/(?!raw\/)([a-zA-Z0-9]+)$/i;
  const pbMatch = url.match(pastebinRegex);
  if (pbMatch) {
    return `https://pastebin.com/raw/${pbMatch[1]}`;
  }

  // 4. Google Docs Export
  const gdocRegex = /^https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)(?:\/.*)?$/i;
  const gdocMatch = url.match(gdocRegex);
  if (gdocMatch) {
    return `https://docs.google.com/document/d/${gdocMatch[1]}/export?format=txt`;
  }

  return url;
}

/**
 * Kiểm tra địa chỉ IP có thuộc dải mạng nội bộ / loopback / dành riêng không
 */
export function isPrivateOrReservedIp(ip) {
  if (!ip || typeof ip !== 'string') return true;

  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }

  if (ip === '::1' || ip === '::' || ip.toLowerCase().startsWith('fe80:') || ip.toLowerCase().startsWith('fc00:') || ip.toLowerCase().startsWith('fd')) {
    return true;
  }

  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;

  return false;
}

/**
 * Kiểm tra an toàn cho Egress URL (Chống SSRF đa tầng)
 */
export async function isSafeEgressUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: 'Chỉ chấp nhận giao thức http: hoặc https:' };
    }

    if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
      return { safe: false, reason: `Cổng ${parsed.port} không được phép truy cập vì lý do an toàn mạng.` };
    }

    if (parsed.username || parsed.password) {
      return { safe: false, reason: 'URL không được chứa thông tin xác thực (username/password).' };
    }

    const host = parsed.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.lan') ||
      host.includes('127.0.0.1')
    ) {
      return { safe: false, reason: 'Không được phép truy cập địa chỉ localhost hoặc mạng nội bộ.' };
    }

    let records = [];
    try {
      records = await dns.promises.lookup(host, { all: true });
    } catch (dnsErr) {
      return { safe: false, reason: `Không thể phân giải tên miền: ${dnsErr.message}` };
    }

    if (!records || records.length === 0) {
      return { safe: false, reason: 'Không tìm thấy địa chỉ IP cho tên miền này.' };
    }

    for (const record of records) {
      if (isPrivateOrReservedIp(record.address)) {
        return { safe: false, reason: `Địa chỉ IP (${record.address}) thuộc dải mạng nội bộ hoặc bị hạn chế.` };
      }
    }

    return { safe: true, parsedUrl: parsed };
  } catch (err) {
    return { safe: false, reason: `Định dạng URL không hợp lệ: ${err.message}` };
  }
}

/**
 * Safe fetch URL with manual redirect following and bounded size guard (< 64KB)
 */
async function fetchWikiContentWithGuard(initialUrl, maxRedirects = 3) {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    const safety = await isSafeEgressUrl(currentUrl);
    if (!safety.safe) {
      throw new Error(`[Bảo mật SSRF] ${safety.reason}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let res;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'ZaloFlow-WikiIngest/1.0 (Mozilla/5.0 compatible; +https://aizalo.com)',
          'Accept': 'text/plain, text/markdown, text/*, */*'
        },
        redirect: 'manual',
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        throw new Error('Yêu cầu tải URL quá thời gian chờ (Timeout 10s).');
      }
      throw fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    if ([301, 302, 307, 308].includes(res.status)) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        throw new Error('Chuyển hướng (Redirect) quá nhiều lần (vượt quá 3 lần).');
      }
      const location = res.headers.get('location');
      if (!location) {
        throw new Error('Phản hồi chuyển hướng thiếu trường Location.');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      throw new Error(`Không thể tải nội dung từ URL (HTTP ${res.status}: ${res.statusText})`);
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') && !contentType.includes('markdown')) {
      throw new Error('URL trả về trang web HTML thông thường. Vui lòng cung cấp liên kết Raw Markdown hoặc Plain Text (ví dụ raw.githubusercontent.com, pastebin.com/raw...).');
    }

    const MAX_BYTES = 65536;
    let totalBytes = 0;
    const chunks = [];

    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > MAX_BYTES) {
            reader.cancel();
            controller.abort();
            throw new Error('Tài liệu vượt quá dung lượng cho phép (tối đa 64KB). Vui lòng rút gọn tài liệu để tối ưu bộ nhớ AI.');
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const buffer = Buffer.concat(chunks);
    let text = buffer.toString('utf-8');
    text = text.replace(/^\uFEFF/, '');

    if (/<(?:!doctype\s+html|html)[\s>]/i.test(text.substring(0, 300))) {
      throw new Error('Tài liệu tải về chứa mã nguồn HTML. Vui lòng kiểm tra lại liên kết Raw.');
    }

    return {
      text,
      finalUrl: currentUrl,
      charCount: text.length,
      bytes: totalBytes
    };
  }

  throw new Error('Không thể tải URL sau các lượt chuyển hướng.');
}

// -----------------------------------------------------------------------------
// GET /api/ai/wiki-template — Get Golden AI Knowledge Template
// -----------------------------------------------------------------------------
router.get('/ai/wiki-template', requireAuth, (req, res) => {
  res.json({
    status: 'success',
    template: GOLDEN_WIKI_TEMPLATE
  });
});

// -----------------------------------------------------------------------------
// POST /api/ai/wiki-fetch-url — Ingest Knowledge from Universal Markdown URL
// -----------------------------------------------------------------------------
router.post('/ai/wiki-fetch-url', requireAuth, async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'Vui lòng cung cấp đường dẫn URL hợp lệ.' });
    }

    const normalizedUrl = normalizeWikiUrl(url);
    const result = await fetchWikiContentWithGuard(normalizedUrl);

    logger.info(`🌐 [Mini Second Brain Wiki] Fetched ${result.charCount} chars from ${normalizedUrl}`);

    res.json({
      status: 'success',
      rawMarkdown: result.text,
      normalizedUrl,
      charCount: result.charCount,
      estimatedTokens: Math.round(result.charCount / 3.0)
    });
  } catch (err) {
    logger.warn(`[Wiki Fetch Error] ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/ai/wiki-apply — Apply & Sync Raw Markdown to Mini Second Brain Wiki
// -----------------------------------------------------------------------------
router.post('/ai/wiki-apply', requireAuth, (req, res) => {
  try {
    const { markdown, replaceQna = false, wikiSourceUrl = '' } = req.body || {};
    if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
      return res.status(400).json({ error: 'Nội dung Markdown không được để trống.' });
    }

    const current = localStore.getAiSettings() || {};
    const parsed = aiAgentAdapter.parseWikiMarkdown(markdown, current);
    const toUpdate = {};
    const updatedFields = [];

    if (wikiSourceUrl) {
      toUpdate.wikiSourceUrl = wikiSourceUrl.trim();
    }

    if (parsed.soul) {
      toUpdate.soulPrompt = parsed.soul;
      updatedFields.push('SOUL (Giọng điệu)');
    }
    if (parsed.memory) {
      toUpdate.memoryPrompt = parsed.memory;
      updatedFields.push(parsed.recognizedSections?.isFreeForm ? 'MEMORY (Tài liệu tự do)' : 'MEMORY (Bảng giá/Tri thức)');
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

// -----------------------------------------------------------------------------
// POST /api/ai/suggest — Generate Contextual Reply Suggestions for Extension & Chat
// -----------------------------------------------------------------------------
router.post('/ai/suggest', requireAuth, async (req, res) => {
  try {
    const { lastMessage = '', customerName = '', context = '' } = req.body || {};
    if (!lastMessage || typeof lastMessage !== 'string' || !lastMessage.trim()) {
      return res.status(400).json({ error: 'Nội dung tin nhắn khách hàng (lastMessage) không được để trống.' });
    }

    const settings = localStore.getAiSettings();
    if (!settings) {
      return res.status(400).json({ error: 'Chưa cấu hình AI Settings trong Zalo-Flow.' });
    }

    const soul = settings.soulPrompt || 'Bạn là chuyên viên tư vấn bán hàng & CSKH Zalo chuyên nghiệp, thân thiện, trả lời tự nhiên bằng tiếng Việt.';
    const memory = settings.memoryPrompt || '';
    const nameStr = customerName ? `Khách hàng tên là: "${customerName}".` : '';

    const systemPrompt = `### [BỐI CẢNH & NHÂN CÁCH]:
${soul}

### [TRI THỨC & SẢN PHẨM]:
${memory || 'Tư vấn thông tin dịch vụ, giải đáp thắc mắc của khách hàng.'}

### [NHIỆM VỤ CỦA BẠN]:
${nameStr}
Hãy đọc tin nhắn của khách hàng và đưa ra chính xác 3 gợi ý câu trả lời ngắn gọn (1-3 câu) theo 3 phong cách:
1. "Lịch sự": Lịch sự, nhã nhặn, tôn trọng khách hàng.
2. "Thân thiện": Tươi vui, gần gũi, khéo léo gợi mở tư vấn hoặc hỗ trợ chốt đơn.
3. "Ngắn gọn": Rõ ràng, trực diện, xác nhận nhanh thông tin.

BẮT BUỘC ĐỊNH DẠNG:
Chỉ trả về JSON thuần túy theo đúng cấu trúc sau (không kèm markdown \`\`\`json, không kèm giải thích):
{
  "suggestions": [
    { "style": "Lịch sự", "text": "Nội dung phản hồi lịch sự..." },
    { "style": "Thân thiện", "text": "Nội dung phản hồi thân thiện..." },
    { "style": "Ngắn gọn", "text": "Nội dung phản hồi ngắn gọn..." }
  ]
}`;

    const userMessage = `${context ? `[Ngữ cảnh gần nhất]: ${context}\n` : ''}[Khách hàng vừa nhắn]: ${lastMessage.trim()}`;

    const rawResponse = await aiAgentAdapter.callModelWithFallback(
      systemPrompt,
      [],
      userMessage,
      settings
    );

    let suggestions = [];
    try {
      const cleaned = (rawResponse || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.suggestions)) {
        suggestions = parsed.suggestions.map(s => ({
          style: s.style || 'Gợi ý',
          text: aiAgentAdapter.cleanForZalo(s.text || '')
        }));
      }
    } catch {
      // Fallback nếu model trả về văn bản thường
      suggestions = [
        { style: 'Gợi ý', text: aiAgentAdapter.cleanForZalo(rawResponse || '') }
      ];
    }

    res.json({
      status: 'success',
      data: { suggestions }
    });
  } catch (err) {
    logger.error(`[AI Suggest] Failed to generate suggestions: ${err.message}`);
    res.status(500).json({ error: `Lỗi sinh gợi ý AI: ${err.message}` });
  }
});

export default router;
