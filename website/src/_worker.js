function prefersMarkdown(acceptHeader) {
  if (!acceptHeader || !acceptHeader.includes("text/markdown")) return false;
  const parts = acceptHeader.split(',').map(p => p.trim());
  let qMarkdown = 0;
  let qHtml = 0;
  for (const part of parts) {
    const [type, ...params] = part.split(';').map(s => s.trim());
    let q = 1.0;
    for (const param of params) {
      if (param.startsWith('q=')) {
        const val = parseFloat(param.slice(2));
        if (!isNaN(val)) q = val;
      }
    }
    if (type === 'text/markdown') qMarkdown = Math.max(qMarkdown, q);
    if (type === 'text/html' || type === 'application/xhtml+xml') qHtml = Math.max(qHtml, q);
  }
  return qMarkdown > 0 && qMarkdown >= qHtml;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // First-Party Event Tracker Proxy (Hide Traks Worker account & bypass AdBlockers)
    if (url.pathname === "/api/event" || url.pathname === "/api/event/") {
      return fetch("https://traks-collect.dragonfarm2509.workers.dev/api/event", {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
    }

    // 301 Redirect Map for AI-hallucinated / legacy 404 paths observed in Traks Analytics
    const REDIRECT_MAP = {
      "/blog/cach-xuat-danh-sach-ban-be-zalo": "https://aizalo.com/blog/zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh",
      "/blog/huong-dan-thiet-lap-tro-ly-ky-thuat-zalo-flow": "https://aizalo.com/blog/huong-dan-cach-tao-chatbot-zalo-ca-nhan",
      "/giai-phap/master-inbox": "https://aizalo.com/blog/zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh",
      "/contact-us": "https://aizalo.com/about"
    };
    const normalizedPath = url.pathname.replace(/\/+$/, "").replace(/\.html$/, "");
    if (REDIRECT_MAP[normalizedPath]) {
      return Response.redirect(REDIRECT_MAP[normalizedPath], 301);
    }

    // RapidAPI & OpenAPI Cloud Sandbox Gateway (100% Uptime, <20ms Edge Response)
    const apiPath = url.pathname.replace(/\/+$/, "");
    if (
      apiPath === "/api/system/status" ||
      apiPath.startsWith("/api/system/") ||
      apiPath === "/api/conversations" ||
      apiPath.startsWith("/api/conversations/") ||
      apiPath.startsWith("/api/messages/") ||
      apiPath.startsWith("/api/campaigns/")
    ) {
      const corsHeaders = {
        "Content-Type": "application/json; charset=utf-8",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-RapidAPI-Key, X-RapidAPI-Host, X-RapidAPI-User, X-RapidAPI-Proxy-Secret",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "no-store",
        "Vary": "Authorization"
      };

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const authHeader = (request.headers.get("Authorization") || "").trim();
      const isRapidProxy = Boolean(
        request.headers.get("X-RapidAPI-Key") ||
        request.headers.get("X-RapidAPI-Host") ||
        request.headers.get("X-RapidAPI-User") ||
        request.headers.get("X-RapidAPI-Proxy-Secret")
      );
      const isDemoQuery = url.searchParams.get("demo") === "1";

      if (!authHeader && !isRapidProxy && !isDemoQuery) {
        return new Response(JSON.stringify({
          error: "unauthorized",
          sandbox: true,
          message: "Missing Authorization Bearer token. Pass 'Bearer demo' for Cloud Sandbox testing, or generate your Personal Access Token (PAT) inside the Zalo-Flow Local Client.",
          download_url: "https://aizalo.com",
          docs_url: "https://aizalo.com/blog/huong-dan-cach-tao-chatbot-zalo-ca-nhan"
        }, null, 2), { status: 401, headers: corsHeaders });
      }

      const isGetOrHead = request.method === "GET" || request.method === "HEAD";

      if (apiPath === "/api/system/status") {
        if (!isGetOrHead) {
          return new Response(JSON.stringify({ error: "method_not_allowed", allowed: ["GET", "HEAD"] }), {
            status: 405,
            headers: { ...corsHeaders, "Allow": "GET, HEAD, OPTIONS" }
          });
        }
        const payload = JSON.stringify({
          connected: true,
          sandbox: true,
          mode: "cloud_sandbox_preview",
          userName: "Zalo-Flow AI Assistant (Sandbox)",
          userId: "zf_84909123456",
          uptimeSeconds: 86420,
          antiBanArchitecture: {
            tokenBucketMinDelaySeconds: 3,
            maxMessagesPerMinute: 20,
            selfEchoShield: true,
            inboundFloodDetector: true
          },
          supportedModels: ["gemini-2.5-flash", "deepseek-chat", "gpt-4o-mini", "ollama-local"],
          licenseNotice: "MIT with Commons Clause — For educational, technical research, and personal automation purposes only. Strictly no spam.",
          clientDownloadUrl: "https://aizalo.com",
          documentationUrl: "https://aizalo.com/blog/huong-dan-cach-tao-chatbot-zalo-ca-nhan"
        }, null, 2);
        return new Response(request.method === "HEAD" ? null : payload, { status: 200, headers: corsHeaders });
      }

      if (apiPath === "/api/conversations") {
        if (!isGetOrHead) {
          return new Response(JSON.stringify({ error: "method_not_allowed", allowed: ["GET", "HEAD"] }), {
            status: 405,
            headers: { ...corsHeaders, "Allow": "GET, HEAD, OPTIONS" }
          });
        }
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 50);
        const sampleConversations = [
          {
            threadId: "zalo_thread_1001",
            name: "Nguyễn Minh Anh (Khách VIP)",
            isGroup: false,
            unreadCount: 1,
            lastMessage: "Shop gửi giúp mình bảng giá sỉ qua Zalo nhé!",
            tags: ["vip", "lead-moi", "chatwoot-synced"]
          },
          {
            threadId: "zalo_thread_1002",
            name: "Nhóm Hỗ Trợ Kỹ Thuật Zalo-Flow",
            isGroup: true,
            unreadCount: 0,
            lastMessage: "Bot AI đã tự động phản hồi câu hỏi cài đặt trong 1.2 giây.",
            tags: ["support", "ai-auto-reply"]
          }
        ].slice(0, limit);

        const payload = JSON.stringify(sampleConversations, null, 2);
        return new Response(request.method === "HEAD" ? null : payload, { status: 200, headers: corsHeaders });
      }

      if (apiPath === "/api/messages/send") {
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ error: "method_not_allowed", allowed: ["POST"] }), {
            status: 405,
            headers: { ...corsHeaders, "Allow": "POST, OPTIONS" }
          });
        }
        let body = {};
        const rawText = await request.text();
        if (rawText.trim()) {
          try {
            body = JSON.parse(rawText);
          } catch (_) {
            return new Response(JSON.stringify({ error: "invalid_json", message: "Request body must be valid JSON." }), { status: 400, headers: corsHeaders });
          }
        }
        return new Response(JSON.stringify({
          success: true,
          sandbox: true,
          delivered: false,
          mode: "cloud_sandbox_preview",
          msgId: "zf_msg_" + Date.now(),
          cliMsgId: "cli_" + Date.now(),
          threadId: body.threadId || "zalo_thread_1001",
          antiBanStatus: "passed_token_bucket_3s",
          note: "Sandbox simulation only (delivered=false). To dispatch live personal Zalo messages with AES-256 local session encryption, run Zalo-Flow Desktop/Docker client from https://aizalo.com"
        }, null, 2), { status: 200, headers: corsHeaders });
      }

      if (apiPath === "/api/campaigns/broadcast") {
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ error: "method_not_allowed", allowed: ["POST"] }), {
            status: 405,
            headers: { ...corsHeaders, "Allow": "POST, OPTIONS" }
          });
        }
        let body = {};
        const rawText = await request.text();
        if (rawText.trim()) {
          try {
            body = JSON.parse(rawText);
          } catch (_) {
            return new Response(JSON.stringify({ error: "invalid_json", message: "Request body must be valid JSON." }), { status: 400, headers: corsHeaders });
          }
        }
        return new Response(JSON.stringify({
          success: true,
          sandbox: true,
          delivered: false,
          mode: "cloud_sandbox_preview",
          tagId: body.tagId || "vip",
          queuedCount: 12,
          estimatedSpacingSeconds: body.delaySeconds || 5,
          note: "Sandbox simulation only (delivered=false). Broadcasts on Zalo-Flow Local Client only target existing CRM threads tagged by the user (zero cold spam).",
          documentationUrl: "https://aizalo.com/blog/cach-gui-tin-nhan-tu-dong-tren-zalo-khong-bi-khoa"
        }, null, 2), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({
        error: "endpoint_not_found",
        sandbox: true,
        message: "Supported Cloud Sandbox endpoints: GET /api/system/status, GET /api/conversations, POST /api/messages/send, POST /api/campaigns/broadcast",
        openapi_spec: "https://aizalo.com/openapi.json",
        download_url: "https://aizalo.com"
      }, null, 2), { status: 404, headers: corsHeaders });
    }

    const accept = request.headers.get("Accept") || "";
    const userAgent = request.headers.get("User-Agent") || "";

    // Real-Time Logging for AI Bots in Cloudflare Pages Functions Logs
    const isAiBot = /PerplexityBot|GPTBot|ChatGPT-User|ClaudeBot|anthropic-ai|Google-Extended|Applebot-Extended|CCBot|Bytespider|cohere-ai/i.test(userAgent);
    if (isAiBot) {
      console.log(`🤖 [AIZALO_BOT_ACCESS] Path: ${url.pathname} | Bot: ${userAgent.slice(0, 80)} | Accept: ${accept}`);
    }

    // Triệt tiêu mã 308 redirect của Pages cho các request mang đuôi .html (trả về 200 OK trực tiếp)
    if (url.pathname.endsWith(".html") && url.pathname !== "/index.html") {
      const cleanPath = url.pathname.replace(/\.html$/, "");
      const cleanUrl = new URL(cleanPath + url.search, request.url);
      return env.ASSETS.fetch(new Request(cleanUrl, request));
    }

    // If client specifically requests text/markdown (Content Negotiation for AI Agents with q-factor check)
    if (prefersMarkdown(accept) && (!url.pathname.includes(".") || url.pathname.endsWith(".html"))) {
      // Pick markdown source (llms.txt for overview or full version)
      const targetMd = url.pathname.includes("/blog/") ? "/llms-full.txt" : "/llms.txt";
      const mdResponse = await env.ASSETS.fetch(new URL(targetMd, request.url));
      const markdown = await mdResponse.text();

      return new Response(markdown, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
          "Vary": "Accept",
          "Cache-Control": "public, max-age=3600",
          "Content-Signal": "search=yes, ai-train=yes, ai-input=yes",
          "Link": '</llms.txt>; rel="describedby"; type="text/markdown", </.well-known/api-catalog>; rel="service-desc"'
        }
      });
    }

    // Default: Serve normal static assets via Cloudflare Pages
    return env.ASSETS.fetch(request);
  }
};
