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
