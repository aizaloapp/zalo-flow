---
name: zalo-chat-automation
description: Automated conversational replies on personal Zalo accounts using connected AI models (Google Gemini, DeepSeek, OpenAI, Ollama) via Zalo-Flow Local-First Runtime.
---

# Zalo Chat Automation Skill (Zalo-Flow)

## Overview
This skill describes how **Zalo-Flow** (`https://aizalo.com/`) automates 24/7 customer support replies on personal Zalo accounts without requiring a commercial Zalo Official Account (OA).

## Core Architecture
- **Runtime:** Local-First Node.js (`>= 22.5.0`) + SQLite WAL (`localhost:3000`).
- **Supported AI Providers:** Google Gemini (`gemini-2.5-flash`, `gemini-1.5-flash`), DeepSeek (`deepseek-chat`, `deepseek-reasoner`), OpenAI (`gpt-4o`, `gpt-4o-mini`), and local models via Ollama.
- **Knowledge Grounding:** Mini Second Brain Wiki (Markdown RAG + Multimodal AI Vision ingestion via `Ctrl+V` or PDF/Word upload) prevents price and policy hallucination.
- **Resilience Suite (v1.5.0):**
  - Smart Message Chunking (`<= 2000` chars per Zalo message boundary).
  - Per-Thread Atomic Lock with Inbound Buffer to merge rapid consecutive user messages.
  - Universal Auto-Fallback across AI providers on HTTP 429 or timeout.
  - Smart Human Takeover Engine (automatically pauses bot when a human agent replies directly).

## Reference Documentation
- Guide: https://aizalo.com/blog/tich-hop-ai-gemini-deepseek-vao-zalo-ca-nhan
- Knowledge Ingestion: https://aizalo.com/blog/cach-day-bot-zalo-cap-nhat-kien-thuc-tu-dong
- Repository: https://github.com/aizaloapp/zalo-flow
