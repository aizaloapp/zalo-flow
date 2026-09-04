import axios from 'axios';
import { BaseAdapter } from './base-adapter.js';
import { localStore } from '../utils/local-store.js';
import { logger } from '../utils/logger.js';
import { decryptSecret } from '../utils/ai-crypto.js';

export const CURATED_MODELS = {
  gemini: [
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash (Khuyên dùng - Siêu nhanh, Chuẩn Google)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
  ],
  deepseek: [
    { id: 'deepseek-chat', name: 'DeepSeek V3 (Chat) — Cực kỳ thông minh & Rẻ' },
    { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Lập luận sâu)' }
  ],
  zai: [
    { id: 'glm-5.3-flash', name: 'Z.AI GLM-5.3 Flash (Khuyên dùng - Siêu nhanh)' },
    { id: 'glm-4-flash', name: 'Z.AI GLM-4 Flash (Miễn phí & Siêu nhanh)' },
    { id: 'glm-4-plus', name: 'Z.AI GLM-4 Plus (Bán hàng nâng cao)' },
    { id: 'glm-4-air', name: 'Z.AI GLM-4 Air' },
    { id: 'glm-4-long', name: 'Z.AI GLM-4 Long' }
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq - Phản hồi < 1s)' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B (Groq)' }
  ],
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Nhanh & Ổn định)' },
    { id: 'gpt-4o', name: 'GPT-4o (Toàn năng)' }
  ],
  openrouter: [
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash via OpenRouter' },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 via OpenRouter' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B via OpenRouter' }
  ],
  ollama: [
    { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B (Tiếng Việt xuất sắc - Chạy Offline)' },
    { id: 'llama3.2:3b', name: 'Llama 3.2 3B (Siêu nhẹ offline)' }
  ]
};

export class AiAgentAdapter extends BaseAdapter {
  constructor(options = {}) {
    super('ai_agent');
    this.localStore = options.localStore || localStore;
    this.sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
    this._inboundBuffers = new Map(); // Map<threadId, string[]>
    this._debounceTimers = new Map(); // Map<threadId, NodeJS.Timeout>
  }

  isConfigured() {
    const settings = this.localStore.getAiSettings();
    const primaryKey = this._resolveApiKey(settings.apiKeyEncrypted);
    return Boolean(settings?.isEnabled && (primaryKey || settings.provider === 'ollama'));
  }

  /**
   * Resolve plaintext API key from encrypted DB storage or environment variables
   */
  _resolveApiKey(encryptedKey, envVar = 'AI_API_KEY') {
    if (encryptedKey) {
      const decrypted = decryptSecret(encryptedKey, this.sessionSecret);
      if (decrypted) return decrypted;
    }
    return process.env[envVar] || '';
  }

  /**
   * Handle incoming message from Zalo Web
   */
  async handleInbound(ctx) {
    if (!ctx || ctx.isSelf || ctx.isBot || !ctx.text || !ctx.threadId) {
      return;
    }

    const settings = this.localStore.getAiSettings();
    if (!settings || !settings.isEnabled) {
      return;
    }

    // 1. Check thread-specific AI toggle
    const conv = this.localStore.getConversation(ctx.threadId);
    if (conv && conv.aiEnabled === 0) {
      logger.debug(`[AI Agent] Skipped thread ${ctx.threadId} (aiEnabled=0)`);
      return;
    }

    // 2. Check Group permission (Strict Guardrail)
    if (ctx.isGroup && !settings.allowGroups) {
      return;
    }

    // 3. Target Scope Filtering (Blacklist / Whitelist)
    const threadTags = this.localStore.getConversationTags ? this.localStore.getConversationTags(ctx.threadId).map(t => t.id) : (this.localStore.getCustomerTags ? this.localStore.getCustomerTags(ctx.threadId).map(t => t.id) : []);
    let excludedTags = [];
    let allowedTags = [];
    try {
      excludedTags = typeof settings.excludedTagIds === 'string' ? JSON.parse(settings.excludedTagIds || '[]') : (settings.excludedTagIds || []);
      allowedTags = typeof settings.allowedTagIds === 'string' ? JSON.parse(settings.allowedTagIds || '[]') : (settings.allowedTagIds || []);
    } catch {}

    if (settings.targetMode === 'blacklist' && excludedTags.length > 0) {
      const isBlacklisted = threadTags.some(tagId => excludedTags.includes(tagId));
      if (isBlacklisted) {
        logger.info(`🎯 [AI Filter] Thread ${ctx.threadId} matches Blacklist tags. Skipping AI.`);
        return;
      }
    } else if (settings.targetMode === 'whitelist' && allowedTags.length > 0) {
      const isWhitelisted = threadTags.some(tagId => allowedTags.includes(tagId));
      if (!isWhitelisted) {
        logger.info(`🎯 [AI Filter] Thread ${ctx.threadId} not in Whitelist tags. Skipping AI.`);
        return;
      }
    }

    // 4. Smart Cooldown Guard (Admin replied recently)
    const cooldownMins = Number(settings.adminCooldownMinutes ?? 15);
    if (cooldownMins > 0) {
      const lastAdminTime = this.localStore.getLastAdminMessageTime(ctx.threadId);
      if (lastAdminTime) {
        const adminTimestamp = typeof lastAdminTime === 'number' ? lastAdminTime : new Date(lastAdminTime).getTime();
        const diffMs = Date.now() - adminTimestamp;
        if (diffMs < cooldownMins * 60 * 1000) {
          const remainingMins = Math.ceil((cooldownMins * 60 * 1000 - diffMs) / 60000);
          logger.info(`⏳ [AI Smart Cooldown] Admin replied recently. Bot AI paused for ${ctx.threadId} (${remainingMins}m remaining).`);
          return;
        }
      }
    }

    // 5. Auto-tag new leads
    if (settings.autoTagNewLead && settings.defaultLeadTagId && threadTags.length === 0) {
      try {
        if (typeof this.localStore.addTagToConversation === 'function') {
          this.localStore.addTagToConversation(ctx.threadId, settings.defaultLeadTagId);
        } else if (typeof this.localStore.addTagToCustomer === 'function') {
          this.localStore.addTagToCustomer(ctx.threadId, settings.defaultLeadTagId);
        }
        logger.info(`🏷️ [AI Auto-Tag] Tagged new lead ${ctx.threadId} with tag: ${settings.defaultLeadTagId}`);
      } catch (err) {
        logger.warn(`Could not auto-tag thread ${ctx.threadId}: ${err.message}`);
      }
    }

    // 6. Inbound Debounce Buffer (Aggregates rapid multi-line user messages)
    const debounceSec = Math.max(1, Number(settings.debounceSeconds ?? 3));
    const threadId = ctx.threadId;

    if (!this._inboundBuffers.has(threadId)) {
      this._inboundBuffers.set(threadId, []);
    }
    this._inboundBuffers.get(threadId).push(ctx.text);

    if (this._debounceTimers.has(threadId)) {
      clearTimeout(this._debounceTimers.get(threadId));
    }

    const timer = setTimeout(async () => {
      this._debounceTimers.delete(threadId);
      const buffer = this._inboundBuffers.get(threadId) || [];
      this._inboundBuffers.delete(threadId);

      if (buffer.length === 0) return;
      const aggregatedText = buffer.join('\n');

      await this._processAutoReply({
        threadId,
        incomingText: aggregatedText,
        isGroup: ctx.isGroup,
        client: ctx.client,
        senderName: ctx.senderName || ''
      });
    }, debounceSec * 1000);

    this._debounceTimers.set(threadId, timer);
  }

  /**
   * Process and dispatch AI auto-reply
   */
  async _processAutoReply({ threadId, incomingText, isGroup, client, senderName = '' }) {
    try {
      const settings = this.localStore.getAiSettings();
      if (!settings || !settings.isEnabled) return;

      // Extract Customer CRM Profile & Tags for context awareness
      const conv = this.localStore.getConversation(threadId);
      const customer = typeof this.localStore.getCustomer === 'function' ? this.localStore.getCustomer(threadId) : conv;
      const tags = (typeof this.localStore.getConversationTags === 'function' ? this.localStore.getConversationTags(threadId) : []) || [];
      const tagNames = tags.map(t => t.name).join(', ');

      const customerContext = {
        name: senderName || conv?.name || customer?.name || '',
        phone: conv?.phone || customer?.phone || '',
        tags: tagNames,
        notes: conv?.notes || customer?.notes || '',
        isGroup: Boolean(isGroup)
      };

      // Compile System Prompt with 4 Layers + Customer Context
      const systemPrompt = this.compilePrompt(settings, customerContext);

      // Get recent conversation history (last 10 messages) for Multi-turn context
      // Note: localStore.getMessages already returns chronological order (ASC: oldest -> newest).
      // Filter out the current incoming message to prevent duplicating it in history and userMessage.
      const rawHistory = this.localStore.getMessages(threadId, { limit: 10 }) || [];
      const history = rawHistory.filter(m => m.text !== incomingText);

      logger.info(`🧠 [AI Engine] Generating reply for ${threadId} (Context: ${history.length} msgs, Customer: "${customerContext.name || 'Khách'}") via ${settings.provider}:${settings.model}...`);

      const replyText = await this.callModelWithFallback(systemPrompt, history, incomingText, settings, { senderName: customerContext.name });

      if (replyText && replyText.trim()) {
        const cleanedReply = this.cleanForZalo(replyText);
        if (client && typeof client.sendMessage === 'function') {
          await client.sendMessage(threadId, cleanedReply, isGroup, {
            isBot: true,
            senderName: 'Bot AI (Tự động)'
          });
          logger.info(`✅ [AI Auto-Reply] Sent to ${threadId}: "${cleanedReply.substring(0, 45)}..."`);
        }
      }
    } catch (err) {
      logger.error(`❌ [AI Engine Error] Auto-reply failed for ${threadId}: ${err.message}`);
    }
  }

  /**
   * Clean and normalize raw text for Zalo Mobile and Desktop chat
   * Zalo chat does not render Markdown (*, **, #, `), so convert them to clean mobile text
   */
  cleanForZalo(text) {
    if (!text) return '';
    let cleaned = String(text);

    // 1. Convert markdown headers (### Header -> 📌 Header)
    cleaned = cleaned.replace(/^#{1,6}\s*(.+)$/gm, '\n📌 $1');

    // 2. Headings on their own line wrapped in ** (e.g. **Bước 1: Chuẩn bị**) -> 🔹 Bước 1: Chuẩn bị
    cleaned = cleaned.replace(/^\s*\*\*(Bước \d+[^:*]*[:*]*)\*\*\s*$/gim, '\n🔹 $1');
    cleaned = cleaned.replace(/^\s*\*\*([^*\n]+)\*\*\s*$/gm, '\n🔹 $1');

    // 3. Remove inline bold **text** or __text__
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');

    // 4. Remove inline italic *text* or _text_
    cleaned = cleaned.replace(/(^|[^\s*])\*([^*\n]+)\*([^\s*]|$)/g, '$1$2$3');
    cleaned = cleaned.replace(/(^|[^_\w])_([^_]+)_([^_\w]|$)/g, '$1$2$3');

    // 5. Code blocks ```lang\ncode\n``` -> code
    cleaned = cleaned.replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1');

    // 6. Inline code `code` -> code
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // 7. Markdown links [text](url) -> text (url)
    cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '$1 ($2)');

    // 8. Normalize multiple empty lines to max 2 newlines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
  }

  /**
   * Compile System Prompt with 4 Layers: SOUL + MEMORY (with Q&A) + FEW-SHOT + SCOPE + CUSTOMER CONTEXT
   */
  compilePrompt(customSettings = null, customerContext = null) {
    let settings = customSettings;
    if (!settings || typeof settings !== 'object') {
      settings = this.localStore.getAiSettings() || {};
    }
    const soul = settings.soulPrompt?.trim() || `Bạn là chuyên viên tư vấn khách hàng Zalo chuyên nghiệp, thân thiện, trả lời ngắn gọn, đúng trọng tâm và tự nhiên bằng tiếng Việt.`;
    
    // Auto-inject Q&A pairs from Quick Messages into Memory
    let qnaSection = '';
    try {
      const quickMsgs = this.localStore.getQuickMessages() || [];
      const qnaPairs = quickMsgs.filter(q => q.customerQuestion && q.customerQuestion.trim());
      if (qnaPairs.length > 0) {
        qnaSection = '\n\n### [BẢNG CÂU HỎI & TRẢ LỜI THƯỜNG GẶP (Q&A)]:\n' + 
          qnaPairs.map((q, idx) => `${idx + 1}. Hỏi: "${q.customerQuestion.trim()}"\n   Trả lời chuẩn: "${q.content.trim()}"`).join('\n\n');
      }
    } catch {}

    const memory = (settings.memoryPrompt?.trim() || '') + qnaSection;
    
    let fewShot = '';
    if (settings.exemplarConversation) {
      try {
        const parsed = typeof settings.exemplarConversation === 'string' 
          ? JSON.parse(settings.exemplarConversation) 
          : settings.exemplarConversation;
        if (Array.isArray(parsed) && parsed.length > 0) {
          fewShot = '\n\n### [MẪU HỘI THOẠI THỰC TẾ TIÊU BIỂU (FEW-SHOT EXEMPLAR)]:\n' + 
            parsed.map(m => `${m.role === 'user' ? 'Khách' : 'Tư vấn viên'}: ${m.text}`).join('\n');
        } else if (typeof parsed === 'string' && parsed.trim()) {
          fewShot = `\n\n### [MẪU HỘI THOẠI THỰC TẾ TIÊU BIỂU (FEW-SHOT EXEMPLAR)]:\n${parsed.trim()}`;
        }
      } catch {
        if (typeof settings.exemplarConversation === 'string' && settings.exemplarConversation.trim()) {
          fewShot = `\n\n### [MẪU HỘI THOẠI THỰC TẾ TIÊU BIỂU (FEW-SHOT EXEMPLAR)]:\n${settings.exemplarConversation.trim()}`;
        }
      }
    }

    let customerInfoSection = '';
    if (customerContext && (customerContext.name || customerContext.tags || customerContext.notes)) {
      customerInfoSection = `\n\n### [THÔNG TIN ĐỐI TƯỢNG ĐANG TRÒ CHUYỆN]:
- Tên khách hàng: ${customerContext.name || 'Chưa xác định (xưng hô lịch sự)'}
- Thẻ phân loại CRM: ${customerContext.tags || 'Chưa gắn thẻ'}
- Ghi chú CRM: ${customerContext.notes || 'Không có'}
- Môi trường: ${customerContext.isGroup ? 'Nhóm trò chuyện Zalo' : 'Tin nhắn riêng cá nhân 1-1'}`;
    }

    const scope = settings.scopePrompt?.trim() || `QUY TẮC PHẠM VI (SCOPE & BOUNDARIES):
1. Tuyệt đối không bịa đặt số tài khoản ngân hàng, giá tiền hoặc chính sách chưa được cung cấp trong phần TRI THỨC.
2. Nếu không có thông tin, hãy lịch sự thông báo sẽ nhờ nhân viên liên hệ lại hỗ trợ sớm nhất.
3. Không xưng hô robot, giữ câu từ ngắn gọn, phù hợp với văn hóa nhắn tin Zalo (1-3 câu/tin nhắn).`;

    const formatRules = `
### [QUY TẮC ĐỊNH DẠNG TIN NHẮN ZALO (BẮT BUỘC)]:
1. Ứng dụng Zalo KHÔNG hỗ trợ hiển thị Markdown. TUYỆT ĐỐI KHÔNG dùng các ký tự markdown như: dấu sao đôi (**chữ in đậm**), dấu sao đơn (*chữ nghiêng*), dấu gạch dưới (__chữ__), dấu thăng (### Tiêu đề), hay dấu backtick (\`code\`).
2. Khi muốn NHẤN MẠNH từ khóa hoặc làm nổi bật tiêu đề, hãy:
   - VIẾT HOA TỪ KHÓA QUAN TRỌNG (ví dụ: BƯỚC 1: CHUẨN BỊ, LƯU Ý, HOÀN TOÀN MIỄN PHÍ).
   - Sử dụng các biểu tượng icon sinh động ở đầu dòng (ví dụ: 🔹 Bước 1, 👉 Chú ý, 💡 Mẹo nhỏ).
3. Luôn xuống dòng thoáng giữa các đoạn, dùng gạch đầu dòng (-) hoặc (•) cho các danh sách liệt kê để tin nhắn trên điện thoại Zalo dễ đọc nhất.`;

    return `### [GIỌNG ĐIỆU & NHÂN CÁCH (SOUL)]:
${soul}

### [TRI THỨC & BẢNG GIÁ (MEMORY)]:
${memory || 'Chưa có thông tin bổ sung.'}
${fewShot}${customerInfoSection}

### [RANH GIỚI & ĐIỀU CẤM KỴ (SCOPE)]:
${scope}
${formatRules}`;
  }

  /**
   * Format comprehensive Mini Second Brain Wiki specifically for Admin Visual Inspection
   * (Audit Fix C1: Keeps compilePrompt intact for LLM execution, separate Wiki viewer for Human)
   */
  compileWikiView(customSettings = null) {
    let settings = customSettings;
    if (!settings || typeof settings !== 'object') {
      settings = this.localStore.getAiSettings() || {};
    }

    const provider = settings.provider || 'gemini';
    const model = settings.model || 'gemini-2.5-flash';
    const fallback = settings.fallbackEnabled 
      ? `${settings.fallbackProvider || 'deepseek'}:${settings.fallbackModel || 'deepseek-chat'}` 
      : 'Không kích hoạt';

    const soul = settings.soulPrompt?.trim() || '';
    const memory = settings.memoryPrompt?.trim() || '';
    const scope = settings.scopePrompt?.trim() || '';

    // Extract Q&A Pairs from Quick Messages
    let qnaSection = '_Chưa có câu hỏi đáp nào trong mục Tin Nhắn Nhanh._';
    try {
      const quickMsgs = this.localStore.getQuickMessages() || [];
      const qnaPairs = quickMsgs.filter(q => q.customerQuestion && q.customerQuestion.trim());
      if (qnaPairs.length > 0) {
        qnaSection = qnaPairs.map((q, idx) => 
          `**${idx + 1}. Khách hỏi:** "${q.customerQuestion.trim()}"\n   **👉 Trả lời chuẩn:** "${q.content.trim()}"`
        ).join('\n\n');
      }
    } catch {}

    // Extract Few-Shot Exemplar
    let fewShotSection = '_Chưa có đoạn chat mẫu thực tế nào được chọn._';
    if (settings.exemplarConversation) {
      try {
        const parsed = typeof settings.exemplarConversation === 'string'
          ? JSON.parse(settings.exemplarConversation)
          : settings.exemplarConversation;
        if (Array.isArray(parsed) && parsed.length > 0) {
          fewShotSection = parsed.map(m => 
            `- **${m.role === 'user' ? 'Khách' : 'Tư vấn viên (Shop)'}:** ${m.text}`
          ).join('\n');
        } else if (typeof parsed === 'string' && parsed.trim()) {
          fewShotSection = parsed.trim();
        }
      } catch {
        if (typeof settings.exemplarConversation === 'string' && settings.exemplarConversation.trim()) {
          fewShotSection = settings.exemplarConversation.trim();
        }
      }
    }

    return `# 🧠 MINI SECOND BRAIN WIKI — HỆ TRI THỨC AI
> **Trạng thái:** ${settings.isEnabled ? '🟢 Đang Bật Tự Động Trả Lời' : '⚪ Đang Tắt'}  
> **Mô hình chính:** \`${provider}:${model}\` | **Dự phòng (Fallback):** \`${fallback}\`  
> **Quy chuẩn:** Markdown Karpathy / Obsidian Local-First Knowledge Base

---

## 🎭 1. Giọng Điệu & Nhân Cách Cốt Lõi (SOUL)
${soul || '_Chưa thiết lập giọng điệu riêng (hệ thống sẽ áp dụng văn phong tư vấn lịch sự, thân thiện mặc định)._'}

---

## 📚 2. Tri Thức Sản Phẩm & Bảng Giá Dịch Vụ (MEMORY)
${memory || '_Chưa có dữ liệu bảng giá, chính sách hay thông số sản phẩm._'}

---

## ❓ 3. Bách Khoa Câu Hỏi & Trả Lời Chuẩn Mực (Q&A Knowledge Base)
${qnaSection}

---

## 💬 4. Mẫu Hội Thoại Thực Tế Tiêu Biểu (Few-Shot Exemplar)
${fewShotSection}

---

## 🛡️ 5. Ranh Giới, Quy Tắc & Điều Cấm Kỵ (Scope & Guardrails)
${scope || `1. Tuyệt đối không bịa đặt số tài khoản ngân hàng, giá tiền hoặc chính sách chưa được cung cấp.
2. Nếu không có thông tin, hãy lịch sự thông báo sẽ nhờ nhân viên liên hệ lại hỗ trợ sớm nhất.
3. Giữ câu từ ngắn gọn, phù hợp với văn hóa nhắn tin Zalo (1-3 câu/tin nhắn).`}
`;
  }

  /**
   * Parse / Decompile raw Markdown into structured sections (SOUL, MEMORY, Q&A, Few-Shot, SCOPE)
   */
  parseWikiMarkdown(rawMarkdown) {
    if (!rawMarkdown || typeof rawMarkdown !== 'string') {
      return {
        soul: '',
        memory: '',
        scope: '',
        fewShot: '',
        qnaPairs: [],
        recognizedSections: {
          hasSoul: false,
          hasMemory: false,
          hasScope: false,
          hasFewShot: false,
          qnaCount: 0
        }
      };
    }

    const lines = rawMarkdown.split(/\r?\n/);
    let currentSection = null;
    const sections = {
      soul: [],
      memory: [],
      qna: [],
      fewshot: [],
      scope: [],
      other: []
    };

    // Regex for recognizing headings (#, ##, ###)
    const headingRegex = /^#{1,3}\s+(.*)$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(headingRegex);

      if (match) {
        const title = match[1].toLowerCase();
        if (/soul|giọng\s*điệu|nhân\s*cách|vai\s*trò/i.test(title)) {
          currentSection = 'soul';
          continue;
        } else if (/memory|tri\s*thức|bảng\s*giá|sản\s*phẩm|thông\s*tin\s*sản\s*phẩm|chính\s*sách/i.test(title)) {
          currentSection = 'memory';
          continue;
        } else if (/q[&a]?a|câu\s*hỏi|hỏi\s*đáp|faq|bách\s*khoa\s*câu\s*hỏi/i.test(title)) {
          currentSection = 'qna';
          continue;
        } else if (/few[-_\s]*shot|mẫu\s*hội\s*thoại|chat\s*mẫu|ví\s*dụ\s*hội\s*thoại/i.test(title)) {
          currentSection = 'fewshot';
          continue;
        } else if (/scope|guardrail|ranh\s*giới|quy\s*tắc|điều\s*cấm|cấm\s*kỵ/i.test(title)) {
          currentSection = 'scope';
          continue;
        } else if (title.includes('mini second brain wiki') || title.includes('hệ tri thức ai')) {
          // Skip master document title
          currentSection = null;
          continue;
        }
      }

      if (currentSection) {
        // Skip horizontal separator lines right after heading if standalone
        if (line.trim() === '---') continue;
        sections[currentSection].push(line);
      } else {
        // Text before any recognized section or top block
        if (line.trim() && !line.startsWith('>') && line.trim() !== '---') {
          sections.other.push(line);
        }
      }
    }

    // Filter out default placeholder strings
    const cleanSectionText = (linesArr) => {
      const text = linesArr.join('\n').trim();
      if (
        text.startsWith('_Chưa thiết lập') ||
        text.startsWith('_Chưa có dữ liệu') ||
        text.startsWith('_Chưa có câu hỏi') ||
        text.startsWith('_Chưa có đoạn chat')
      ) {
        return '';
      }
      return text;
    };

    let soul = cleanSectionText(sections.soul);
    let memory = cleanSectionText(sections.memory);
    let scope = cleanSectionText(sections.scope);
    let fewShot = cleanSectionText(sections.fewshot);

    // If completely unstructured (no standard section headings), treat entire text as memory
    if (!soul && !memory && !scope && sections.qna.length === 0 && sections.other.length > 0) {
      memory = cleanSectionText(sections.other);
    }

    // Parse Q&A Pairs from sections.qna
    const qnaPairs = [];
    const qnaText = sections.qna.join('\n');

    // Matches:
    // **1. Khách hỏi:** "Câu hỏi" \n **👉 Trả lời chuẩn:** "Câu trả lời"
    // or Hỏi: ... \n Đáp: ...
    // or Q: ... \n A: ...
    const qnaBlockRegex = /(?:[-*•]\s*)?(?:\*\*|\*|\b)?(?:(?:\d+[\.\)]\s*)?(?:Khách\s*hỏi|Hỏi|Question|Q):?)\*?\*?\s*["“']?([^"\n\r”]+)["”']?\s*(?:\n|\r\n)+\s*(?:[-*•]\s*)?(?:\*\*|\*|\b)?(?:(?:👉\s*)?(?:Trả\s*lời\s*chuẩn|Trả\s*lời|Đáp|Answer|A):?)\*?\*?\s*["“']?([^"\n\r”]+)["”']?/gi;

    let qMatch;
    while ((qMatch = qnaBlockRegex.exec(qnaText)) !== null) {
      const q = (qMatch[1] || '').trim();
      const a = (qMatch[2] || '').trim();
      if (q && a && !q.startsWith('_Chưa có')) {
        qnaPairs.push({ question: q, answer: a });
      }
    }

    return {
      soul,
      memory,
      scope,
      fewShot,
      qnaPairs,
      recognizedSections: {
        hasSoul: Boolean(soul),
        hasMemory: Boolean(memory),
        hasScope: Boolean(scope),
        hasFewShot: Boolean(fewShot),
        qnaCount: qnaPairs.length
      }
    };
  }

  /**
   * Compute Knowledge Base Stats (Characters, Tokens with 3.0 ratio for Vietnamese, Q&A count)
   */
  getWikiStats(wikiMarkdown, settings = {}) {
    const text = wikiMarkdown || '';
    const charCount = text.length;
    // Hệ số 3.0 phù hợp cho tiếng Việt (Audit Fix I2)
    const estimatedTokens = Math.round(charCount / 3.0);

    let qnaCount = 0;
    try {
      const quickMsgs = this.localStore.getQuickMessages() || [];
      qnaCount = quickMsgs.filter(q => q.customerQuestion && q.customerQuestion.trim()).length;
    } catch {}

    const hasSoul = Boolean(settings.soulPrompt && settings.soulPrompt.trim());
    const hasMemory = Boolean(settings.memoryPrompt && settings.memoryPrompt.trim());
    const hasFewShot = Boolean(settings.exemplarConversation && (
      typeof settings.exemplarConversation === 'string' ? settings.exemplarConversation.trim() : Array.isArray(settings.exemplarConversation) && settings.exemplarConversation.length > 0
    ));
    const hasScope = Boolean(settings.scopePrompt && settings.scopePrompt.trim());
    const isEmpty = !hasSoul && !hasMemory && qnaCount === 0 && !hasFewShot;

    return {
      charCount,
      estimatedTokens,
      qnaCount,
      hasSoul,
      hasMemory,
      hasFewShot,
      hasScope,
      isEmpty,
      provider: settings.provider || 'gemini',
      model: settings.model || 'gemini-2.5-flash',
      fallbackEnabled: Boolean(settings.fallbackEnabled),
      fallbackProvider: settings.fallbackProvider || 'deepseek',
      fallbackModel: settings.fallbackModel || 'deepseek-chat'
    };
  }

  /**
   * Universal Multi-Model Caller with Auto-Fallback Shield
   */
  async callModelWithFallback(systemPrompt, history, userMessage, settings, extra = {}) {
    const primaryProvider = settings.provider || 'gemini';
    const primaryModel = settings.model || 'gemini-2.5-flash';
    const primaryKey = this._resolveApiKey(settings.apiKeyEncrypted, 'AI_API_KEY');
    const primaryBaseUrl = settings.baseUrl || '';
    const primaryTimeout = Math.max(Number(settings.timeoutMs || 35000), 35000);

    try {
      return await this.callProvider({
        provider: primaryProvider,
        model: primaryModel,
        apiKey: primaryKey,
        baseUrl: primaryBaseUrl,
        systemPrompt,
        history,
        userMessage,
        timeoutMs: primaryTimeout
      });
    } catch (primaryErr) {
      logger.warn(`⚠️ [AI Auto-Fallback Triggered] Primary model ${primaryProvider}:${primaryModel} failed: ${primaryErr.message}`);

      if (settings.fallbackEnabled) {
        const fallbackProvider = settings.fallbackProvider || 'deepseek';
        const fallbackModel = settings.fallbackModel || 'deepseek-chat';
        const isSameProvider = fallbackProvider === primaryProvider;
        const fallbackKey = this._resolveApiKey(settings.fallbackApiKeyEncrypted, 'AI_FALLBACK_API_KEY') || (isSameProvider ? primaryKey : '');
        const fallbackBaseUrl = settings.fallbackBaseUrl || '';
        const fallbackTimeout = Math.max(Number(settings.fallbackTimeoutMs || 30000), 30000);

        if (!fallbackKey && fallbackProvider !== 'ollama') {
          logger.warn(`⚠️ [AI Auto-Fallback] Bỏ qua Fallback: Nhà cung cấp dự phòng (${fallbackProvider}) khác nhà cung cấp chính (${primaryProvider}) và chưa được cài đặt API Key riêng.`);
          throw primaryErr;
        }

        logger.info(`🛡️ [AI Auto-Fallback] Switching to fallback provider: ${fallbackProvider}:${fallbackModel}...`);
        return await this.callProvider({
          provider: fallbackProvider,
          model: fallbackModel,
          apiKey: fallbackKey,
          baseUrl: fallbackBaseUrl,
          systemPrompt,
          history,
          userMessage,
          timeoutMs: fallbackTimeout
        });
      }

      throw primaryErr;
    }
  }

  /**
   * Low-level Universal Provider Dispatcher
   */
  async callProvider({ provider, model, apiKey, baseUrl, systemPrompt, history = [], userMessage, timeoutMs = 35000 }) {
    if (provider !== 'ollama' && !apiKey) {
      throw new Error(`API Key is required for AI Provider: ${provider}`);
    }

    if (provider === 'gemini') {
      return await this._callGeminiNative({ model, apiKey, systemPrompt, history, userMessage, timeoutMs });
    } else {
      return await this._callOpenAiCompatible({ provider, model, apiKey, baseUrl, systemPrompt, history, userMessage, timeoutMs });
    }
  }

  /**
   * Helper to extract friendly, detailed error message from axios response
   */
  _formatError(err, provider) {
    if (err.response?.data) {
      const data = err.response.data;
      if (typeof data === 'object') {
        const message = data.error?.message || data.message || data.msg || (typeof data.error === 'string' ? data.error : JSON.stringify(data));
        if (err.response.status === 429) {
          return `[Lỗi 429 Hạn mức / Quota]: ${message}\n👉 Hướng dẫn: Tài khoản của bạn đã hết hạn mức hoặc chưa nạp số dư cho model này. Nếu dùng Z.AI, hãy chuyển sang model miễn phí "Z.AI GLM-4 Flash" trong danh sách Model!`;
        }
        if (err.response.status === 401 || err.response.status === 403) {
          return `[Lỗi ${err.response.status} Xác thực]: ${message}\n👉 Vui lòng kiểm tra lại API Key.`;
        }
        return `[Lỗi ${err.response.status} từ ${provider}]: ${message}`;
      }
      return `[Lỗi ${err.response.status} từ ${provider}]: ${String(data).substring(0, 200)}`;
    }
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return `[Timeout]: Máy chủ ${provider} không phản hồi sau ${err.config?.timeout || 15000}ms.`;
    }
    return err.message || `Lỗi không xác định khi gọi ${provider}`;
  }

  /**
   * Google Gemini REST Native API
   */
  async _callGeminiNative({ model, apiKey, systemPrompt, history = [], userMessage, timeoutMs = 35000 }) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Chưa cung cấp API Key cho Google Gemini. Vui lòng lấy key miễn phí tại https://aistudio.google.com/app/apikey');
    }

    const cleanKey = apiKey.trim().replace(/^["']|["']$/g, '');
    if (!cleanKey.startsWith('AIzaSy')) {
      throw new Error(`[Lỗi định dạng API Key]: API Key của Google Gemini bắt buộc phải bắt đầu bằng "AIzaSy" (gồm 39 ký tự). Bạn đang nhập key không khớp với Google Gemini (hoặc do trình duyệt tự động điền mật khẩu). Vui lòng lấy API Key miễn phí tại https://aistudio.google.com/app/apikey`);
    }

    // Auto-map deprecated Gemini model names to the Google-recommended model
    let cleanModel = (model || 'gemini-3.6-flash').trim();
    if (cleanModel === 'gemini-2.0-flash') cleanModel = 'gemini-3.6-flash';
    if (cleanModel === 'gemini-2.0-flash-exp') cleanModel = 'gemini-3.6-flash';

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${cleanKey}`;

    const contents = [];
    for (const msg of history) {
      if (!msg.text) continue;
      const role = msg.isSelf ? 'model' : 'user';
      contents.push({
        role,
        parts: [{ text: msg.text }]
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const body = {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048
      }
    };

    try {
      const res = await axios.post(url, body, {
        timeout: timeoutMs,
        headers: { 'Content-Type': 'application/json' }
      });

      const candidate = res.data?.candidates?.[0];
      const textPart = candidate?.content?.parts?.[0]?.text;
      if (!textPart) {
        throw new Error('Gemini returned empty response text');
      }
      return textPart;
    } catch (err) {
      throw new Error(this._formatError(err, 'Gemini'));
    }
  }

  /**
   * OpenAI-Compatible Endpoint (OpenAI, DeepSeek, Z.AI, Groq, OpenRouter, Ollama)
   */
  async _callOpenAiCompatible({ provider, model, apiKey, baseUrl, systemPrompt, history = [], userMessage, timeoutMs = 35000 }) {
    const cleanKey = (apiKey || '').trim().replace(/^["']|["']$/g, '');
    if (provider !== 'ollama') {
      if (!cleanKey) {
        throw new Error(`API Key is required for AI Provider: ${provider}`);
      }
      if (cleanKey.startsWith('AIzaSy')) {
        throw new Error(`[Lỗi nhầm lẫn API Key]: Bạn đang nhập API Key của Google Gemini (bắt đầu bằng AIzaSy) vào nhà cung cấp ${provider.toUpperCase()}. Mỗi nhà cung cấp yêu cầu API Key riêng biệt!`);
      }
    }

    let endpoint = baseUrl?.trim();
    if (!endpoint) {
      if (provider === 'deepseek') endpoint = 'https://api.deepseek.com/v1';
      else if (provider === 'zai') endpoint = 'https://api.z.ai/api/coding/paas/v4';
      else if (provider === 'groq') endpoint = 'https://api.groq.com/openai/v1';
      else if (provider === 'openrouter') endpoint = 'https://openrouter.ai/api/v1';
      else if (provider === 'ollama') endpoint = 'http://localhost:11434/v1';
      else endpoint = 'https://api.openai.com/v1';
    }

    endpoint = endpoint.replace(/\/+$/, '');
    if (!endpoint.endsWith('/chat/completions')) {
      endpoint += '/chat/completions';
    }

    const messages = [
      { role: 'system', content: systemPrompt }
    ];

    for (const msg of history) {
      if (!msg.text) continue;
      messages.push({
        role: msg.isSelf ? 'assistant' : 'user',
        content: msg.text
      });
    }

    messages.push({
      role: 'user',
      content: userMessage
    });

    const headers = {
      'Content-Type': 'application/json'
    };
    if (cleanKey) {
      headers['Authorization'] = `Bearer ${cleanKey}`;
    }

    try {
      const res = await axios.post(endpoint, {
        model,
        messages,
        temperature: 0.7,
        max_tokens: 2048
      }, {
        headers,
        timeout: timeoutMs
      });

      const messageObj = res.data?.choices?.[0]?.message;
      let content = messageObj?.content || res.data?.choices?.[0]?.text;

      // Fallback for reasoning models if content was empty but reasoning completed
      if (!content && messageObj?.reasoning_content) {
        content = messageObj.reasoning_content;
      }

      if (!content || !content.trim()) {
        throw new Error(`${provider} returned empty response content (finish_reason: ${res.data?.choices?.[0]?.finish_reason || 'unknown'})`);
      }
      return content;
    } catch (err) {
      throw new Error(this._formatError(err, provider));
    }
  }

  /**
   * Test Connection / Live Ping
   */
  async testConnection({ provider, model, apiKey, baseUrl, timeoutMs = 10000 }) {
    const start = Date.now();
    const testPrompt = 'Bạn là AI trợ lý. Hãy chỉ trả lời duy nhất đúng 1 từ: PONG';
    const testUserMsg = 'Ping test connection';

    const response = await this.callProvider({
      provider,
      model,
      apiKey,
      baseUrl,
      systemPrompt: testPrompt,
      history: [],
      userMessage: testUserMsg,
      timeoutMs
    });

    const latencyMs = Date.now() - start;
    return {
      status: 'success',
      latencyMs,
      reply: response.trim()
    };
  }

  /**
   * Live Model Scanner (Quét Model Trực Tiếp Từ Nhà Cung Cấp)
   */
  async fetchLiveModels({ provider, apiKey, baseUrl, timeoutMs = 8000 }) {
    const cleanKey = (apiKey || '').trim().replace(/^["']|["']$/g, '');
    const curatedFallback = CURATED_MODELS[provider] || CURATED_MODELS.gemini;

    if (!cleanKey && provider !== 'ollama') {
      return { models: curatedFallback, isLive: false, reason: 'Chưa có API Key, hiển thị danh mục mặc định' };
    }

    try {
      if (provider === 'gemini') {
        const res = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`, {
          timeout: timeoutMs
        });
        const list = res.data?.models || [];
        const filtered = list
          .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
          .map(m => {
            const id = m.name.replace(/^models\//, '');
            const isFlash = id.includes('flash');
            const isPro = id.includes('pro');
            let badge = isFlash ? '⚡ Siêu nhanh' : (isPro ? '🧠 Tư duy sâu' : '');
            return {
              id,
              name: `${m.displayName || id}${badge ? ` (${badge})` : ''}`,
              isFlash
            };
          });

        if (filtered.length > 0) {
          // Sort flash models to the top
          filtered.sort((a, b) => (b.isFlash ? 1 : 0) - (a.isFlash ? 1 : 0));
          return { models: filtered, isLive: true, count: filtered.length };
        }
      } else {
        // OpenAI-compatible endpoint
        let endpoint = (baseUrl || '').trim();
        if (!endpoint) {
          if (provider === 'deepseek') endpoint = 'https://api.deepseek.com/v1';
          else if (provider === 'zai') endpoint = 'https://api.z.ai/api/coding/paas/v4';
          else if (provider === 'groq') endpoint = 'https://api.groq.com/openai/v1';
          else if (provider === 'openrouter') endpoint = 'https://openrouter.ai/api/v1';
          else if (provider === 'ollama') endpoint = 'http://localhost:11434/v1';
          else endpoint = 'https://api.openai.com/v1';
        }
        endpoint = endpoint.replace(/\/+$/, '') + '/models';

        const headers = {};
        if (cleanKey) headers['Authorization'] = `Bearer ${cleanKey}`;

        const res = await axios.get(endpoint, { headers, timeout: timeoutMs });
        const rawList = res.data?.data || res.data?.models || (Array.isArray(res.data) ? res.data : []);
        if (Array.isArray(rawList) && rawList.length > 0) {
          const list = rawList.map(m => {
            const id = typeof m === 'string' ? m : (m.id || m.name);
            return {
              id,
              name: id
            };
          });
          return { models: list, isLive: true, count: list.length };
        }
      }
    } catch (err) {
      logger.warn(`[Live Model Scan] Failed to scan models from ${provider}: ${err.message}. Falling back to curated list.`);
    }

    return { models: curatedFallback, isLive: false };
  }
}

export const aiAgentAdapter = new AiAgentAdapter();
