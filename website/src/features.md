# Zalo-Flow (AIzalo Community Edition) — Features Specification

> **Platform:** Zalo-Flow (Open-Source Community Edition)  
> **Official Website:** https://aizalo.com/ | **English:** https://aizalo.com/en/  
> **Repository:** https://github.com/aizaloapp/zalo-flow  
> **Current Version:** v1.5.0 (AI Resilience & Stability Suite)  
> **License:** MIT License with Commons Clause Condition v1.0 (Non-Commercial, Educational & Research Only)  
> **Affiliation:** 100% independent project developed by the AIzalo Community. Not affiliated with, endorsed by, or sponsored by VNG Corporation or Zalo.

---

## 🏛️ System Architecture Overview

Zalo-Flow is a **Local-First, Privacy-Preserving Automation Gateway** that connects personal Zalo accounts with modern CRM platforms (Chatwoot), generic webhooks (n8n, Dify, Flowise, Make), and Large Language Models (LLMs) including Google Gemini, DeepSeek, OpenAI, and Ollama.

```
[ Zalo Personal Account (zca-js protocol) ]
                    ▲
                    │ (Inbound / Outbound encrypted)
                    ▼
[ Zalo-Flow Gateway (Node.js 22 + SQLite WAL) ]
   ├── Anti-Ban 3-Tier Shield (RateLimiter, SelfEchoShield, FloodDetector)
   ├── AI Resilience Suite (Smart Chunking, Per-Thread Lock, Universal Fallback)
   ├── Local AES-256-CBC Encryption Engine
   └── Memory Watchdog (< 350MB ceiling)
                    ▲
                    │ (Realtime Sync & Webhook)
                    ▼
[ Chatwoot CRM / LLM Providers / Chrome Extension Companion / Web Dashboard ]
```

---

## 🚀 Detailed Features & Capabilities

### 1. 🛡️ 3-Tier Anti-Ban & Account Protection Engine
- **Token Bucket Rate Limiter:** Strictly enforces an outbound message pacing of $\ge 3$ seconds per message and a hard cap of 20 messages per minute per account to avoid triggering algorithmic spam flags.
- **Self-Echo Shield:** Real-time 30-second sliding buffer that suppresses self-reflection loops when outbound messages synchronize back from other mobile devices.
- **Inbound Flood Detector:** Automatically mutes rapid message bursts (> 5 messages in 3 seconds from a single sender) for 60 seconds to prevent denial-of-service (DoS) states.
- **Ground-Truth Group Reconciliation:** Directly validates group metadata against `getAllGroups()` to prevent misclassifying 1-on-1 contacts as groups.

### 2. 🤖 AI Resilience & Stability Suite (v1.5.0)
- **Smart Message Chunking:** Long AI responses exceeding 1750 characters are automatically split into natural semantic sections `(Phần X/Y)`, maintaining an outbound gap $\ge 1.2$s, with media/quotes attached strictly to the first chunk.
- **Per-Thread Concurrency Lock (`_activeWorkers`):** Prevents race conditions and duplicate token costs when a customer sends rapid consecutive inquiries; extra questions are queued in `_threadInboundBuffers` and processed sequentially.
- **Universal Auto-Fallback:** Automatically failovers between primary and backup LLM providers (Gemini ⇄ DeepSeek, Z.AI, OpenAI, Ollama) on HTTP 429, 500, 502, 503, network drops, or revoked keys.
- **Scoped Graceful Rescue:** Sends a polite, customizable rescue notice to 1-on-1 private contacts if both AI providers encounter persistent failure (disabled in group chats with a 5-minute per-thread cooldown).
- **Smart Human Takeover Engine:** Immediately halts bot responses when an admin intervenes from either mobile Zalo (`message.isSelf`) or the Web UI (`sendMessage`), cancelling pending chunks in real time.
- **Friend Event Regex Guard:** Intercepts and filters automatic system friend notices before forwarding payloads to the AI Adapter.

### 3. 👁️ Multimodal AI Vision
- Automatically parses and interprets images (invoices, receipts, order screenshots, technical diagrams, handwritten notes) sent via Zalo.
- Features an **Override Directive De-biasing Layer** to eliminate assistant refusal and polite biases while strictly respecting corporate persona guidelines.
- Built-in 4MB memory guard preventing heap exhaustion when processing large image buffers.

### 4. ⏰ Scheduled In-Thread Messaging (1-on-1 Hẹn Giờ)
- Allows agents to schedule personalized follow-up messages and attachments for individual contacts.
- Includes an **Inbound Reply Auto-Pause Guard**: automatically cancels or pauses scheduled messages the moment the customer sends a response, eliminating awkward delayed messages.

### 5. 👥 Multi-Account Pool & Isolated AI Profiles
- Concurrently runs up to 3 personal Zalo accounts on a single machine with under 150MB total RAM consumption.
- Staggered boot sequence (3-second gap) protecting CPU and memory during system launch.
- Each account can be assigned distinct AI profiles, prompt guidelines, system souls, and knowledge bases while sharing tags and remarketing templates.

### 6. 🔄 2-Way Chatwoot CRM Synchronization
- Real-time bidirectional message, image, and document sync between Zalo and Chatwoot CRM inboxes.
- Multi-agent collaboration: human staff can reply directly inside Chatwoot while Zalo-Flow transparently handles the dispatch.

### 7. 🎯 Remarketing Campaigns & Dynamic Spintax
- Segment-based bulk messaging based on customer tags.
- Built-in Spintax engine `{Xin chào|Chào bạn|Hello}` randomizing message phrasing to prevent duplicate content detection.
- Includes a 1-to-1 Test Dispatch feature with zero database pollution (Delta = 0).

### 8. 🧩 Chrome Extension Companion (AIzalo Flow Companion)
- Official Chrome Web Store extension for desktop browser users (`chat.zalo.me`).
- Real-time unread message counter badge, desktop notifications, quick message template shooter, and direct dashboard launcher without switching tabs.

---

## 📊 Technical Specifications & Hardware Matrix

| Parameter | Specification | Notes |
| :--- | :--- | :--- |
| **Runtime** | Node.js >= 22.5.0 (ES Modules) | Tested on Windows 10/11, macOS, Linux, Docker |
| **Core Protocol** | `zca-js: 2.1.2` | Frozen dependency for protocol stability |
| **Database** | SQLite3 in WAL mode | Zero external database server required |
| **RAM Footprint** | 80MB – 150MB typical | Hard memory watchdog capped at 350MB (Docker 512MB) |
| **Encryption** | AES-256-CBC | All sessions, cookies, and tokens encrypted with `SESSION_SECRET` |
| **Host Binding** | `127.0.0.1` (Localhost Loopback) | Auto-detects Docker (`/.dockerenv`) to bind `0.0.0.0` safely |
| **Distribution** | Windows 1-Click Installer (`.exe` ~24.5MB) | Includes portable Node.js runtime and VBScript background launcher |
| **AI Providers** | Gemini, DeepSeek, OpenAI, Ollama | Configurable via Web UI with encrypted key storage |

---

## 🔗 Related Resources

- **Main Website:** https://aizalo.com/
- **Full Specification (AI Crawlers):** https://aizalo.com/llms-full.txt
- **AI Agent Overview:** https://aizalo.com/llms.txt
- **Agent Instructions:** https://aizalo.com/.well-known/agent-instructions.md
- **API Catalog:** https://aizalo.com/openapi.json
- **Documentation & User Guide:** https://aizalo.com/guide
