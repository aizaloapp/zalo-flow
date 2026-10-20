---
name: zalo-chat-automation
description: Automated conversational replies on personal Zalo accounts using connected AI models (Google Gemini, DeepSeek, OpenAI, Ollama) via Zalo-Flow Local-First Runtime.
version: 1.5.0
homepage: https://aizalo.com
metadata:
  openclaw:
    requires:
      env:
        - ZALO_FLOW_PAT
---

# Zalo Chat Automation Skill (Zalo-Flow)

## Overview
**Zalo-Flow** ([https://aizalo.com](https://aizalo.com)) is an open-source, local-first automation platform (MIT License with Commons Clause — for educational, technical research, and personal automation purposes only) that automates 24/7 customer support replies on personal Zalo accounts without requiring a commercial Zalo Official Account (OA).

## Core Architecture
- **Runtime:** Local-First Node.js (`>= 22.5.0`) + SQLite WAL (`http://localhost:3000`) with AES-256-CBC local session encryption.
- **Supported AI Providers:** Google Gemini (`gemini-2.5-flash`, `gemini-1.5-flash`), DeepSeek (`deepseek-chat`, `deepseek-reasoner`), OpenAI (`gpt-4o`, `gpt-4o-mini`), and local models via Ollama.
- **Knowledge Grounding:** Mini Second Brain Wiki (Markdown RAG + Multimodal AI Vision ingestion via `Ctrl+V` or PDF/Word upload) prevents price and policy hallucination.
- **Resilience Suite (v1.5.0):**
  - Smart Message Chunking (`<= 2000` chars per Zalo message boundary).
  - Per-Thread Atomic Lock with Inbound Buffer to merge rapid consecutive user messages.
  - Universal Auto-Fallback across AI providers on HTTP 429 or timeout.
  - Smart Human Takeover Engine (automatically pauses bot when a human agent replies directly).

## How to Get an API Key / Personal Access Token (PAT)
1. **Cloud Sandbox (Instant Test):** Pass `Authorization: Bearer demo` to test endpoints immediately against `https://aizalo.com`.
2. **Live Personal Zalo Instance:** Download the free 1-Click Installer or Docker runtime at [https://aizalo.com](https://aizalo.com), log in via QR code on `http://localhost:3000`, and copy your `ZALO_FLOW_PAT` from Settings.

## API Endpoints for Agents

### 1. Check System & Anti-Ban Status
```bash
curl -s -H "Authorization: Bearer demo" https://aizalo.com/api/system/status
```

### 2. List Active Zalo Conversations & CRM Tags
```bash
curl -s -H "Authorization: Bearer demo" "https://aizalo.com/api/conversations?limit=20"
```

### 3. Dispatch Anti-Ban Protected Zalo Message
```bash
curl -s -X POST https://aizalo.com/api/messages/send \
  -H "Authorization: Bearer demo" \
  -H "Content-Type: application/json" \
  -d '{"threadId": "zalo_thread_1001", "message": "Xin chào, trợ lý AI Zalo-Flow đã nhận được yêu cầu!", "isGroup": false}'
```

## Reference Documentation
- **Official Homepage & Download:** [https://aizalo.com](https://aizalo.com)
- **English Documentation:** [https://aizalo.com/en](https://aizalo.com/en)
- **Step-by-Step Chatbot Setup:** [https://aizalo.com/blog/huong-dan-cach-tao-chatbot-zalo-ca-nhan](https://aizalo.com/blog/huong-dan-cach-tao-chatbot-zalo-ca-nhan)
- **Gemini & DeepSeek Integration Guide:** [https://aizalo.com/blog/tich-hop-ai-gemini-deepseek-vao-zalo-ca-nhan](https://aizalo.com/blog/tich-hop-ai-gemini-deepseek-vao-zalo-ca-nhan)
- **Auto Knowledge Ingestion Guide:** [https://aizalo.com/blog/cach-day-bot-zalo-cap-nhat-kien-thuc-tu-dong](https://aizalo.com/blog/cach-day-bot-zalo-cap-nhat-kien-thuc-tu-dong)
- **RapidAPI Interactive Playground:** [https://rapidapi.com/lekhoa288/api/zalo-flow-personal-zalo-chatbot-and-crm](https://rapidapi.com/lekhoa288/api/zalo-flow-personal-zalo-chatbot-and-crm)
- **GitHub Repository:** [https://github.com/aizaloapp/zalo-flow](https://github.com/aizaloapp/zalo-flow)
