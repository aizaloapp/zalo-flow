<div align="center">

# ⚡ Zalo-Flow

### The Open-Source Automation & Omnichannel Webhook Gateway for Personal Zalo
**A lightweight, local-first bridge for Chatwoot CRM, AI Agent Auto-Reply & Self-Healing Automation**

<p align="center">
  <a href="README.md">🇻🇳 Tiếng Việt</a> • <b>🇬🇧 English</b>
</p>

[![License: Non-Commercial (MIT + Commons Clause)](https://img.shields.io/badge/License-MIT%20%2B%20Commons%20Clause-blue.svg)](LICENSE)
[![Purpose: Education & Research](https://img.shields.io/badge/Purpose-Education%20%26%20Research-orange.svg)](DISCLAIMER.md)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org)
[![CI Quality Gate](https://github.com/aizaloapp/zalo-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/aizaloapp/zalo-flow/actions/workflows/ci.yml)
[![Anti-Leak & Secret Scan](https://github.com/aizaloapp/zalo-flow/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/aizaloapp/zalo-flow/actions/workflows/secret-scan.yml)
[![Memory Footprint](https://img.shields.io/badge/RAM-%3C%20100MB-success.svg)](test/test-all.js)
[![Tests Passing](https://img.shields.io/badge/Tests-31%2F31%20Passing-brightgreen.svg)](test/test-all.js)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<p align="center">
  <a href="https://aizalo.com"><img src="https://img.shields.io/badge/🌐_Official_Website-aizalo.com-0068FF?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Official Website"/></a>
  <a href="https://zalo.me/g/mcihan713"><img src="https://img.shields.io/badge/💬_Community_Support-Zalo_Group-0088FF?style=for-the-badge&logo=zalo&logoColor=white" alt="Zalo Community"/></a>
  <a href="https://aizalo.com/blog/"><img src="https://img.shields.io/badge/📚_Knowledge_Base-Blog_Tutorials-FF6B00?style=for-the-badge" alt="Blog Tutorials"/></a>
</p>

[🌐 Website](https://aizalo.com) • [📚 Guides](https://aizalo.com/blog/) • [💬 Zalo Community](https://zalo.me/g/mcihan713) • [Features](#-key-features) • [Download Windows](#-1-click-windows-installer-for-everyone) • [Architecture](#-system-architecture) • [Quick Start](#-quick-start-in-3-minutes) • [Anti-Ban](#-3-layer-anti-ban-defense)

<br/>

### 📥 1-Click Windows Installer (For Everyone)

No Git, no Node.js installation, no command line terminals required:

[![Download Windows Setup](https://img.shields.io/badge/Windows-Download%20Setup%20v1.0.6%20(.exe)-0068FF?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/aizaloapp/zalo-flow/releases/latest)

> 💡 **Download & Run:** Click the button above to download **`ZaloFlow-Setup-v1.0.6.exe`** (Only **23.4MB**). Run the installer in 30 seconds to get your Zalo-Flow desktop assistant ready!

</div>

---

> ⚠️ **LEGAL DISCLAIMER & ANTI-SPAM POLICY:**
> 
> 1. **Educational & Academic Research Only:** `Zalo-Flow` is an independent open-source research project designed solely for **studying software architecture (Webhooks, Adapter Pattern, Realtime Event Streams) and personal automation**. This project is **NOT** affiliated with, authorized, or endorsed by VNG Corporation or Zalo.
> 2. **Zero-Tolerance Anti-Spam Policy:** It is strictly prohibited to use this software for bulk messaging, unsolicited spam, marketing harassment, or any actions violating Zalo's Terms of Service.
> 3. **Disclaimer of Liability:** The authors and contributors assume **no liability or responsibility** for any damages, account penalties, or legal repercussions resulting from user operation. **Always test with a secondary account.**
> 
> 👉 Full legal agreement: [DISCLAIMER.md](DISCLAIMER.md).

---

## 🌟 Key Features

- 🎨 **1-Click Light & Dark Mode:** Seamless toggle between sleek Dark Mode and native Zalo PC Light Mode with zero flash-of-unstyled-content (Anti-FOUC) and persistent preference caching.
- 💬 **Native Zalo PC Typography & Bubble Ergonomics:** Refined 14px (`0.88rem`) font sizing, `1.45` line-height, `12px` border radius, and ergonomic `9px 13px` bubble padding mirroring official Zalo Desktop UX.
- 📲 **Multi-Device Outbound Sync:** Messages, images, and files sent from mobile Zalo app seamlessly sync into Zalo-Flow in realtime with Self-Echo loop suppression.
- 🧠 **5-Tab AI Intelligence Suite (Local-First):**
  - **Tab 1: Persona (SOUL):** Assistant styling, 3 Presets (Friendly, B2B, Support), and **1-Click Few-Shot Exemplar Extraction** from real conversations.
  - **Tab 2: Memory & Knowledge (MEMORY):** Embeds Karpathy-style Second Brain Wiki & automatically extracts Q&A pairs from Quick Messages (`quick_messages`).
  - **Tab 3: Models & Redundancy (BRAIN):** Universal LLM connector (Google Gemini 2.5 Flash/Pro Native, OpenAI, DeepSeek V3/R1, Groq, Ollama Offline) with **0ms Auto-Fallback Shield** against 429 quota and timeout errors.
  - **Tab 4: Scope & Guardrails (SCOPE):** Group/Direct filter, Smart Cooldown (silences bot when human admin replies), and Lead Tag Whitelist/Blacklist.
  - **Tab 5: Simulator (SIMULATOR):** Sandbox playground to test Bot AI behavior and prompt compilation directly in the browser.
- 📖 **Mini Second Brain Wiki Viewer:** Automatically compiles AI personality, memory, and Q&A pairs into clean Karpathy Markdown with real-time Vietnamese token estimation (3.0x factor).
- 🚀 **Ultra-Lightweight (< 100MB RAM) & Self-Healing Memory Guard:**
  - Operates without headless Chrome/Puppeteer.
  - **2-Tier Memory Sentinel:** Soft purges 5 Map stores at 263MB, triggers **Graceful Self-Restart** if RAM sustains > 350MB for 90s, with SQLite WAL flushing and RateLimiter queue drainage. Auto-reconnects in 1.5s with zero QR re-scans.
- 🖼️ **Client-Side Smart Canvas Compression (< 0.2s):** Automatically compresses large phone camera photos (15MB - 50MB) via HTML5 Canvas directly in the user's browser down to crisp Zalo HD 2560px/90% (~1.5MB) before uploading.
- 🔄 **1-Click Bulk Deep-Sync Engine:** Downloads full native chat history directly via Zalo WebSocket with safe 350ms/contact spacing and real-time SSE progress bar.
- 💬 **Live Chat & CRM Dashboard:** Single-page app managing 2-way live conversations, customer tags, quick response templates, and scheduled remarketing broadcasts with attachments.
- 🔌 **Bidirectional Chatwoot CRM Synchronization:**
  - **Inbound:** Zalo messages $\rightarrow$ Instant sync to Chatwoot Inbox.
  - **Outbound:** Agent replies in Chatwoot $\rightarrow$ Delivered straight to customer's Zalo.
- 🛡️ **3-Layer Anti-Ban Defense:** Token Bucket Rate Limiter (with `drainAll()`), 30s Self-Echo Shield, and Flood Detector.
- 🔒 **AES-256-CBC Encryption:** Session cookies and AI API keys are persisted strictly in encrypted binary form.

---

## 🏛️ System Architecture

```
               ┌──────────────────────────────────────────────────────────┐
               │                     ZALO USER / CLIENT                   │
               └─────────────────────────────┬────────────────────────────┘
                                             │ (1-on-1 / Group messages)
                                             ▼
                                 ┌───────────────────────┐
                                 │   zca-js (v2.1.0)     │
                                 │   WebSocket Engine    │
                                 └───────────┬───────────┘
                                             │ (Raw Inbound Events)
                                             ▼
                                 ┌───────────────────────┐
                                 │  3-Layer Anti-Ban     │
                                 │  Shield & Dedupe      │
                                 └───────────┬───────────┘
                                             │ (Verified Clean Stream)
                                             ▼
                               ┌───────────────────────────┐
                               │     Express Core Server   │
                               │   (Port 3000 · REST & SSE)│
                               └─────────────┬─────────────┘
                                             │
             ┌───────────────────────────────┼───────────────────────────────┐
             ▼                               ▼                               ▼
  ┌─────────────────────┐        ┌───────────────────────┐       ┌───────────────────────┐
  │  SQLite LocalStore  │        │   Adapter Hub & Core  │       │  Web SPA Dashboard    │
  │  (WAL Mode / Sync)  │        │   - Chatwoot 2-Way    │       │  - Live Chat / CRM    │
  │  - Conversations    │        │   - Generic Webhooks  │       │  - Remarketing Queues │
  │  - Messages / Tags  │        │   - AI Agent Adapter  │       │  - 5-Tab AI Suite     │
  └─────────────────────┘        └───────────────────────┘       └───────────────────────┘
```

---

## ⚡ Quick Start in 3 Minutes

### Option A: Docker Compose (Recommended)

1. **Clone repository:**
   ```bash
   git clone https://github.com/aizaloapp/zalo-flow.git
   cd zalo-flow
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit SESSION_SECRET and port if needed
   ```

3. **Start container:**
   ```bash
   docker compose up -d
   ```

4. Open your browser at `http://localhost:3000` and scan the QR code to connect your personal Zalo account.

---

### Option B: Local Node.js (>= 22.5.0)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

3. **Run tests:**
   ```bash
   npm test
   ```

4. **Start server:**
   ```bash
   npm run dev
   ```

---

## 🔌 Chatwoot CRM Integration

1. Go to **Chatwoot Settings** $\rightarrow$ **Inboxes** $\rightarrow$ **Add Inbox** $\rightarrow$ Select **API Channel**.
2. Set Channel Name to `Zalo Cá Nhân` and create.
3. Add the Webhook URL in Chatwoot:
   ```
   http://YOUR_SERVER_IP:3000/api/webhook/chatwoot
   ```
4. Update your `.env` file:
   ```env
   CHATWOOT_API_URL=https://chatwoot.yourdomain.com
   CHATWOOT_API_TOKEN=your_chatwoot_user_token
   CHATWOOT_ACCOUNT_ID=1
   CHATWOOT_INBOX_ID=your_inbox_id
   ```
5. Restart Zalo-Flow. Inbound and outbound messages will synchronize seamlessly.

---

## 🛡️ 3-Layer Anti-Ban Defense

| Layer | Mechanism | Protection Scope |
| :--- | :--- | :--- |
| **Layer 1: Rate Limiter** | Token Bucket Algorithm | Enforces $\ge$ 3s spacing between outbound messages, capped at 20 msgs/min to avoid heuristic spam triggers. Includes `drainAll()` queue resolution. |
| **Layer 2: Self-Echo Shield** | 30-Second Hash Ring Buffer | Suppresses self-sent echo messages from WebSocket, preventing infinite loops. |
| **Layer 3: Flood Detector** | Inbound Frequency Analyzer | Temporarily mutes incoming message bursts (> 5 msgs in 3s) for 60 seconds to protect system responsiveness. |

---

## 📚 Knowledge Base & Technical Guides (Official Guides)

In-depth technical research and operational guides available at our community portal [aizalo.com/blog/](https://aizalo.com/blog/):

- 🛡️ [How to Automate Zalo Messaging Safely Without Getting Banned (3-Layer Anti-Ban Shield)](https://aizalo.com/blog/cach-gui-tin-nhan-tu-dong-tren-zalo-khong-bi-khoa.html)
- ⚡ [Quick Guide: Building a Personal Zalo Chatbot in 3 Minutes](https://aizalo.com/blog/huong-dan-cach-tao-chatbot-zalo-ca-nhan.html)
- 🧠 [Connecting Gemini & DeepSeek AI with Personal Zalo (Auto Contact Card Sanitization)](https://aizalo.com/blog/tich-hop-ai-gemini-deepseek-vao-zalo-ca-nhan.html)
- 💼 [What is Zalo CRM? The 2026 Omnichannel Customer Care Architecture](https://aizalo.com/blog/zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh.html)
- 🤖 [LLM Agent Discovery Manifest (`llms.txt`)](https://aizalo.com/llms.txt)

---

## 🧪 Testing & Verification

Run the comprehensive 23-scenario test suite:
```bash
npm test
```
- ✅ AES-256-CBC Session encryption
- ✅ 3-Layer Anti-ban guards
- ✅ SQLite Schema reconciliation & migrations
- ✅ Customer tags & cascading deletes
- ✅ Quick messages & Spintax engine
- ✅ Remarketing campaigns & recurrence queues
- ✅ AI Zero Plaintext Crypto & Prompt Compiler
- ✅ 1-Click Bulk Deep-Sync Engine
- ✅ Self-Healing Memory Guard & Graceful Shutdown Drain

---

## 📄 License & Contributing

Distributed under the **MIT License with Commons Clause Condition v1.0 (Non-Commercial)**. See [LICENSE](LICENSE) for details.  
Contributions, adapters, and bug reports are warmly welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).
