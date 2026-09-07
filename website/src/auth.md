# auth.md

This document specifies the agent registration and authentication flow for Zalo-Flow client endpoints.

---

## Agent Registration

- **Audience:** Autonomous AI Agents, LLMs, and MCP Clients.
- **Registration Endpoint:** `POST /api/agent/register`
- **Provisioning Endpoint:** `https://aizalo.com/auth.md`
- **Supported Methods:** `bearer_token`, `personal_access_token`, `anonymous`
- **Credential Provisioning:** Agents register by submitting their agent identity to the local client registration endpoint or via administrative provisioning in Desktop Settings (**Settings > API & Integrations > Access Tokens**).

---

## OAuth Protected Resource Metadata

- **Resource Server:** `https://aizalo.com`
- **Authorization Server:** `https://aizalo.com`
- **Bearer Methods Supported:** `header`
- **Scopes Supported:**
  - `messages:read`: Read conversation message history and unread status
  - `messages:send`: Dispatch text messages, quote replies, and media attachments
  - `contacts:read`: Query contact profiles, search conversations, and read tags
  - `campaigns:manage`: Trigger, pause, or query automated remarketing campaigns
  - `system:status`: Check client connectivity, heartbeat, and queue status

---

## Authentication Scheme

All authenticated requests to Zalo-Flow endpoints must include the `Authorization` header:

```http
Authorization: Bearer <YOUR_ACCESS_TOKEN>
```

---

## Rate Limiting & Safety Guardrails

All outbound operations are throttled to ensure account safety and prevent flooding:
- **Rate Limit:** Maximum 20 outgoing requests per minute (spaced by at least 3 seconds).
- **Flood Guard:** High-frequency inbound traffic is buffered automatically.
- **Status Codes:**
  - `200 OK`: Request succeeded.
  - `401 Unauthorized`: Token is missing or invalid.
  - `403 Forbidden`: Token lacks the required scope for the endpoint.
  - `429 Too Many Requests`: Rate limit exceeded. Agents should back off exponentially.

---

## Discovery & Machine-Readable Artifacts

- **API Catalog:** `https://aizalo.com/.well-known/api-catalog`
- **OpenAPI 3.1 Specification:** `https://aizalo.com/openapi.json`
- **MCP Server Card:** `https://aizalo.com/.well-known/mcp.json`
- **A2A Agent Card:** `https://aizalo.com/.well-known/agent-card.json`
- **LLM Summary:** `https://aizalo.com/llms.txt`
