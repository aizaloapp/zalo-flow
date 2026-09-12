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

    // If client specifically requests text/markdown (Content Negotiation for AI Agents)
    if (accept.includes("text/markdown") && (!url.pathname.includes(".") || url.pathname.endsWith(".html"))) {
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
          "Link": '</llms.txt>; rel="alternate"; type="text/markdown", </llms-full.txt>; rel="alternate"; type="text/markdown", </.well-known/api-catalog>; rel="service-desc"'
        }
      });
    }

    // Default: Serve normal static assets via Cloudflare Pages
    return env.ASSETS.fetch(request);
  }
};
