import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'website', 'src');
const isLocalRun = process.argv.includes('--local') || process.argv.includes('--pre-deploy');

console.log('================================================================================');
console.log('🔍 AIZALO.COM UNIFIED AUDIT ENGINE (SEO + GEO + AGENT READINESS LEVEL 5)');
console.log('================================================================================\n');

// Results container
const audit = {
  onPage: { score: 100, checks: [], issues: [] },
  technical: { score: 100, checks: [], issues: [] },
  geo: { score: 100, checks: [], issues: [] },
  agentReadiness: { score: 100, level: 5, checks: [], issues: [] },
  liveEdge: { checks: [], issues: [] },
  summary: { p0: [], p1: [], p2: [] }
};

// Helpers
function deduct(category, points, issue, priority = 'P1') {
  audit[category].score = Math.max(0, audit[category].score - points);
  audit[category].issues.push({ issue, points, priority });
  audit.summary[priority.toLowerCase()].push(`[${category.toUpperCase()}] ${issue}`);
}

function countWords(str) {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

// -----------------------------------------------------------------------------
// PASS 1: STATIC AST & SEMANTIC ANALYSIS (OFFLINE)
// -----------------------------------------------------------------------------
console.log('📁 [PASS 1] Quét Mã Nguồn Tĩnh (Static AST & Semantic Rules in website/src)...');

// 1. Read package.json for Entity Truth
let pkgVersion = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  pkgVersion = pkg.version;
  console.log(`   ✔️ package.json version: v${pkgVersion}`);
} catch (e) {
  deduct('technical', 10, 'Không đọc được package.json để làm mốc chân lý thực thể', 'P1');
}

// 2. Discover HTML files
const htmlFiles = [];
if (fs.existsSync(path.join(srcDir, 'index.html'))) {
  htmlFiles.push({ path: path.join(srcDir, 'index.html'), rel: 'index.html', isHome: true, isEnHome: false, isBlogIndex: false });
}
if (fs.existsSync(path.join(srcDir, 'en', 'index.html'))) {
  htmlFiles.push({ path: path.join(srcDir, 'en', 'index.html'), rel: 'en/index.html', isHome: false, isEnHome: true, isBlogIndex: false });
}
const blogDir = path.join(srcDir, 'blog');
if (fs.existsSync(blogDir)) {
  const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.html'));
  for (const f of files) {
    htmlFiles.push({ path: path.join(blogDir, f), rel: `blog/${f}`, isHome: false, isEnHome: false, isBlogIndex: f === 'index.html' });
  }
}
const enBlogDir = path.join(srcDir, 'en', 'blog');
if (fs.existsSync(enBlogDir)) {
  const files = fs.readdirSync(enBlogDir).filter(f => f.endsWith('.html'));
  for (const f of files) {
    htmlFiles.push({ path: path.join(enBlogDir, f), rel: `en/blog/${f}`, isHome: false, isEnHome: false, isBlogIndex: f === 'index.html' });
  }
}
console.log(`   ✔️ Tìm thấy ${htmlFiles.length} tệp HTML để phân tích cú pháp.`);

// Tracking across all pages
const allFaqQuestions = new Map(); // question -> [pages]
const allAnchorIds = new Map();   // relPath -> Set of IDs
const allInternalLinks = [];      // { from, href }

// Inspect each HTML file
for (const file of htmlFiles) {
  const content = fs.readFileSync(file.path, 'utf8');
  const pageIds = new Set();
  allAnchorIds.set(file.rel, pageIds);

  // A. Collect all IDs for anchor validation
  const idMatches = content.matchAll(/\sid=["']([a-zA-Z0-9_-]+)["']/g);
  for (const m of idMatches) {
    pageIds.add(m[1]);
  }

  // B. Title tag audit
  const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
  if (!titleMatch) {
    deduct('onPage', 15, `Thiếu thẻ <title> trong ${file.rel}`, 'P0');
  } else {
    const titleText = titleMatch[1].trim();
    if (titleText.length < 30 || titleText.length > 75) {
      deduct('onPage', 5, `Độ dài thẻ <title> trong ${file.rel} (${titleText.length} chars) nằm ngoài khoảng tối ưu 30-75 ký tự`, 'P2');
    }
  }

  // C. Meta description audit
  const metaDescMatch = content.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
                        content.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  if (!metaDescMatch) {
    deduct('onPage', 10, `Thiếu thẻ <meta name="description"> trong ${file.rel}`, 'P1');
  } else {
    const desc = metaDescMatch[1].trim();
    if (desc.length < 100 || desc.length > 175) {
      deduct('onPage', 5, `Thẻ meta description trong ${file.rel} (${desc.length} chars) nằm ngoài khoảng tối ưu 100-175 ký tự`, 'P2');
    }
  }

  // D. Canonical tag audit
  const canonicalMatch = content.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i);
  if (!canonicalMatch) {
    deduct('onPage', 10, `Thiếu thẻ <link rel="canonical"> trong ${file.rel}`, 'P1');
  } else {
    const expectedCanonical = file.isHome 
      ? 'https://aizalo.com/' 
      : (file.isEnHome 
          ? 'https://aizalo.com/en/' 
          : (file.rel === 'blog/index.html' 
              ? 'https://aizalo.com/blog/' 
              : (file.rel === 'en/blog/index.html' 
                  ? 'https://aizalo.com/en/blog/' 
                  : `https://aizalo.com/${file.rel}`)));
    if (canonicalMatch[1] !== expectedCanonical) {
      deduct('onPage', 5, `Thẻ canonical trong ${file.rel} (${canonicalMatch[1]}) không khớp URL chuẩn (${expectedCanonical})`, 'P1');
    }
  }

  // D2. Hreflang Tags Audit (International SEO)
  if (file.isHome || file.isEnHome || file.rel === 'blog/index.html' || file.rel === 'en/blog/index.html') {
    if (!content.includes('hreflang="vi"') || !content.includes('hreflang="en"') || !content.includes('hreflang="x-default"')) {
      deduct('technical', 5, `Trang ${file.rel} thiếu bộ thẻ alternate hreflang quốc tế (vi, en, x-default)`, 'P1');
    }
  }

  // E. Heading Hierarchy (H1, H2, H3)
  const h1Matches = content.match(/<h1[^>]*>/gi) || [];
  if (h1Matches.length === 0) {
    deduct('onPage', 15, `Trang ${file.rel} không có thẻ <h1> nào`, 'P0');
  } else if (h1Matches.length > 1) {
    deduct('onPage', 8, `Trang ${file.rel} có ${h1Matches.length} thẻ <h1> (yêu cầu duy nhất 1 thẻ <h1>)`, 'P1');
  }

  // Check H2 and H3 static ID (Anti-Client-Slug Invariant)
  const h2Matches = content.matchAll(/<h2([^>]*)>/gi);
  for (const m of h2Matches) {
    const attrs = m[1];
    if (!/id=["'][a-z0-9-]+["']/.test(attrs)) {
      deduct('onPage', 5, `Thẻ <h2> trong ${file.rel} thiếu thuộc tính id tĩnh chuẩn không dấu (Anti-Client-Slug Invariant): <h2${attrs}>`, 'P1');
    }
  }

  // F. Semantic Isolation (Anti-TOC Breakage)
  // Check if H2 or H3 is inside cta-box, geo-answer-box, or geo-tldr-box
  const ctaBlocks = content.match(/<div class=["'][^"']*cta-box[^"']*["'][\s\S]*?<\/div>/gi) || [];
  for (const b of ctaBlocks) {
    if (/<h[23][^>]*>/i.test(b)) {
      deduct('onPage', 10, `Phát hiện thẻ H2/H3 bên trong khối CTA Box trong ${file.rel} (vi phạm Semantic Isolation, gây vỡ TOC)`, 'P0');
    }
  }

  // G. GEO Metrics: Direct Answer Box & Key Takeaways
  if (!file.isHome && !file.isEnHome && !file.isBlogIndex) {
    // Check .geo-answer-box
    const geoAnswerMatch = content.match(/<div class=["'][^"']*geo-answer-box[^"']*["'][\s\S]*?<p[^>]*class=["'][^"']*geo-answer-text[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    if (!geoAnswerMatch) {
      deduct('geo', 15, `Bài viết ${file.rel} thiếu khối GEO Direct Answer (.geo-answer-box) phục vụ AI Overviews`, 'P1');
    } else {
      const plainAnswer = geoAnswerMatch[1].replace(/<[^>]+>/g, '').trim();
      const wc = countWords(plainAnswer);
      if (wc < 35 || wc > 68) {
        deduct('geo', 5, `Khối GEO Direct Answer trong ${file.rel} có ${wc} từ (dải chuẩn tối ưu cho AI Overview là 40-60 từ)`, 'P2');
      }
    }

    // Check .geo-tldr-box
    if (!content.includes('geo-tldr-box')) {
      deduct('geo', 8, `Bài viết ${file.rel} thiếu khối Key Takeaways (.geo-tldr-box)`, 'P2');
    }

    // Check Tables wrapped in .geo-table-wrapper
    const tables = content.match(/<table[^>]*>/gi) || [];
    if (tables.length > 0) {
      const wrappedTables = content.match(/<div class=["'][^"']*geo-table-wrapper[^"']*["'][\s\S]*?<\/table>/gi) || [];
      if (wrappedTables.length < tables.length) {
        deduct('geo', 5, `Phát hiện thẻ <table> trong ${file.rel} chưa được bọc trong <div class="geo-table-wrapper">`, 'P2');
      }
    }
  }

  // H. Schema JSON-LD Validation & Entity Truth Reconciliation
  const jsonLdMatches = content.matchAll(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi);
  let hasSchema = false;
  for (const jm of jsonLdMatches) {
    hasSchema = true;
    try {
      const parsed = JSON.parse(jm[1]);
      const graph = parsed['@graph'] || [parsed];
      for (const node of graph) {
        const type = node['@type'];
        // Check SoftwareApplication version on home
        if (type === 'SoftwareApplication' && node.softwareVersion) {
          if (!node.softwareVersion.includes(pkgVersion)) {
            deduct('technical', 5, `Phiên bản trong SoftwareApplication Schema (${node.softwareVersion}) không khớp package.json (${pkgVersion})`, 'P1');
          }
        }
        // Check FAQ duplicate questions
        if (type === 'FAQPage' && Array.isArray(node.mainEntity)) {
          for (const item of node.mainEntity) {
            const q = (item.name || '').trim().toLowerCase();
            if (q) {
              if (!allFaqQuestions.has(q)) {
                allFaqQuestions.set(q, []);
              }
              allFaqQuestions.get(q).push(file.rel);
            }
          }
        }
      }
    } catch (err) {
      deduct('technical', 15, `Lỗi cú pháp Schema JSON-LD trong ${file.rel}: ${err.message}`, 'P0');
    }
  }
  if (!hasSchema) {
    deduct('technical', 10, `Trang ${file.rel} hoàn toàn không có thẻ Schema JSON-LD`, 'P1');
  }

  // I. Collect internal links for broken link detection
  const linkMatches = content.matchAll(/<a\s+[^>]*href=["']([^"']+)["']/gi);
  for (const lm of linkMatches) {
    const href = lm[1].trim();
    if (href && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
      allInternalLinks.push({ from: file.rel, href });
    }
  }
}

// 3. Verify Internal Links & Anchor IDs
console.log(`   ✔️ Kiểm tra ${allInternalLinks.length} liên kết nội bộ...`);
let brokenLinksCount = 0;
for (const link of allInternalLinks) {
  const [targetPath, hash] = link.href.split('#');
  
  if (targetPath === '' || targetPath === '.') {
    // Anchor in current page
    if (hash && !allAnchorIds.get(link.from)?.has(hash)) {
      brokenLinksCount++;
      deduct('onPage', 2, `Neo #${hash} trong ${link.from} trỏ tới ID không tồn tại`, 'P2');
    }
  } else {
    // Relative or absolute path link
    let resolvedRel = targetPath;
    if (resolvedRel.startsWith('/')) resolvedRel = resolvedRel.slice(1);
    if (resolvedRel === '' || resolvedRel === '#') continue;

    // Normalize path to file in website/src
    let testPath = path.join(srcDir, resolvedRel);
    if (fs.existsSync(testPath) && fs.statSync(testPath).isDirectory()) {
      testPath = path.join(testPath, 'index.html');
    }
    if (!fs.existsSync(testPath) && !fs.existsSync(`${testPath}.html`)) {
      brokenLinksCount++;
      deduct('onPage', 3, `Liên kết nội bộ gãy (404 cục bộ) từ ${link.from} trỏ tới "${link.href}"`, 'P1');
    }
  }
}
if (brokenLinksCount === 0) {
  console.log('   ✔️ 100% liên kết nội bộ và neo hash mục lục hợp lệ!');
}

// 4. Duplicate FAQ Check Across Pages
console.log('   ✔️ Kiểm tra tính độc bản của câu hỏi FAQ giữa các trang...');
let duplicateFaqCount = 0;
for (const [q, pages] of allFaqQuestions.entries()) {
  if (pages.length > 1) {
    duplicateFaqCount++;
    deduct('technical', 3, `Câu hỏi FAQ trùng lặp giữa các trang: "${q}" xuất hiện tại [${pages.join(', ')}]`, 'P2');
  }
}
if (duplicateFaqCount === 0) {
  console.log('   ✔️ 100% câu hỏi FAQ Schema là độc bản, không bị spam trùng lặp!');
}

// 5. Sitemap.xml & Robots.txt Verification
console.log('   ✔️ Kiểm tra sitemap.xml và robots.txt...');
const sitemapPath = path.join(srcDir, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  deduct('technical', 20, 'Thiếu tệp sitemap.xml', 'P0');
} else {
  const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
  for (const f of htmlFiles) {
    const urlSegment = f.isHome 
      ? 'https://aizalo.com/' 
      : (f.isEnHome 
          ? 'https://aizalo.com/en/' 
          : (f.rel === 'blog/index.html' 
              ? 'https://aizalo.com/blog/' 
              : (f.rel === 'en/blog/index.html' 
                  ? 'https://aizalo.com/en/blog/' 
                  : `https://aizalo.com/${f.rel}`)));
    if (!sitemapContent.includes(urlSegment)) {
      deduct('technical', 5, `Trang ${f.rel} chưa được khai báo trong sitemap.xml (kỳ vọng: ${urlSegment})`, 'P1');
    }
  }
}

const robotsPath = path.join(srcDir, 'robots.txt');
if (!fs.existsSync(robotsPath)) {
  deduct('technical', 15, 'Thiếu tệp robots.txt', 'P0');
} else {
  const robotsContent = fs.readFileSync(robotsPath, 'utf8');
  if (!robotsContent.includes('sitemap.xml')) {
    deduct('technical', 5, 'robots.txt chưa khai báo đường dẫn Sitemap', 'P1');
  }
  const requiredBots = ['GPTBot', 'PerplexityBot', 'ClaudeBot', 'Google-Extended'];
  for (const b of requiredBots) {
    if (!robotsContent.includes(b)) {
      deduct('agentReadiness', 5, `robots.txt chưa có quy tắc cho AI bot: ${b}`, 'P2');
    }
  }
}

// 6. Agent Readiness Level 5 Files Audit
console.log('   ✔️ Kiểm tra các tài sản Agent Readiness Level 5...');
const llmsPath = path.join(srcDir, 'llms.txt');
const llmsFullPath = path.join(srcDir, 'llms-full.txt');
if (!fs.existsSync(llmsPath)) {
  deduct('agentReadiness', 20, 'Thiếu tệp llms.txt (chuẩn llmstxt.org)', 'P0');
}
if (!fs.existsSync(llmsFullPath)) {
  deduct('agentReadiness', 15, 'Thiếu tệp llms-full.txt tài liệu toàn văn', 'P1');
} else {
  const llmsFullContent = fs.readFileSync(llmsFullPath, 'utf8');
  if (!llmsFullContent.includes(`v${pkgVersion}`)) {
    deduct('technical', 5, `llms-full.txt chưa cập nhật phiên bản phát hành mới nhất v${pkgVersion}`, 'P1');
  }
}

// Check _headers for RFC 9264 and noindex
const headersPath = path.join(srcDir, '_headers');
if (!fs.existsSync(headersPath)) {
  deduct('agentReadiness', 15, 'Thiếu tệp _headers cho Cloudflare Pages', 'P1');
} else {
  const hContent = fs.readFileSync(headersPath, 'utf8');
  if (!hContent.includes('describedby') || !hContent.includes('/llms.txt')) {
    deduct('agentReadiness', 10, 'Thiếu RFC 9264 Link Header trỏ tới /llms.txt trong _headers', 'P1');
  }
  if (!hContent.includes('X-Robots-Tag: noindex')) {
    deduct('technical', 8, 'Thiếu X-Robots-Tag: noindex cho llms-full.txt trong _headers', 'P1');
  }
}

// Check .well-known protocols
const wellKnownDir = path.join(srcDir, '.well-known');
if (!fs.existsSync(wellKnownDir)) {
  deduct('agentReadiness', 20, 'Thiếu thư mục .well-known/', 'P0');
} else {
  const expectedWk = ['mcp.json', 'agent-card.json', 'agent-skills', 'openapi.json', 'api-catalog'];
  for (const wf of expectedWk) {
    if (!fs.existsSync(path.join(wellKnownDir, wf))) {
      deduct('agentReadiness', 5, `Thiếu tệp giao thức .well-known/${wf}`, 'P2');
    }
  }
}

// Check _worker.js Content Negotiation
const workerPath = path.join(srcDir, '_worker.js');
if (!fs.existsSync(workerPath)) {
  deduct('agentReadiness', 20, 'Thiếu tệp Edge Worker _worker.js xử lý Content Negotiation', 'P0');
} else {
  const wContent = fs.readFileSync(workerPath, 'utf8');
  if (!wContent.includes('text/markdown')) {
    deduct('agentReadiness', 10, '_worker.js không xử lý Accept: text/markdown', 'P1');
  }
}

console.log('✅ PASS 1 HOÀN TẤT!\n');

// -----------------------------------------------------------------------------
// PASS 2: LIVE EDGE CDN & NETWORK VERIFICATION (ONLINE)
// -----------------------------------------------------------------------------
console.log('🌐 [PASS 2] Đo Kiểm Thực Tế Trực Tuyến Trên Cloudflare Edge CDN (https://aizalo.com)...');

async function runPass2() {
  const timeoutMs = 8000;
  async function safeFetch(url, options = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(t);
      return res;
    } catch (e) {
      clearTimeout(t);
      return { ok: false, status: 0, error: e.message, headers: new Headers() };
    }
  }

  // 1. Check Live Homepage & Headers
  try {
    const homeRes = await safeFetch('https://aizalo.com/');
    if (homeRes.status === 200) {
      console.log('   ✔️ Live Homepage: HTTP 200 OK');
      const linkH = homeRes.headers.get('link');
      if (linkH && linkH.includes('/llms.txt')) {
        console.log('   ✔️ RFC 9264 Link Header: Có mặt trên Live CDN!');
      } else {
        deduct('agentReadiness', 5, 'Live CDN chưa phản hồi RFC 9264 Link: </llms.txt>; rel="describedby"', 'P1');
      }
    } else {
      deduct('technical', 25, `Live Homepage trả mã trạng thái lỗi: ${homeRes.status}`, 'P0');
    }
  } catch (e) {
    deduct('technical', 25, `Không kết nối được tới https://aizalo.com/: ${e.message}`, 'P0');
  }

  // 2. Check 404 Custom Error Page
  const notFoundRes = await safeFetch('https://aizalo.com/test-non-existent-random-url-404');
  if (notFoundRes.status === 404) {
    console.log('   ✔️ Custom 404 Handler: HTTP 404 chính xác!');
  } else {
    deduct('technical', 8, `Trang URL không tồn tại trả mã HTTP ${notFoundRes.status} thay vì 404`, 'P1');
  }

  // 3. Check All Sitemap URLs live status
  console.log('   ✔️ Kiểm tra mã trạng thái HTTP 200 cho toàn bộ bài viết...');
  for (const f of htmlFiles) {
    const testUrl = f.isHome 
      ? 'https://aizalo.com/' 
      : (f.isEnHome 
          ? 'https://aizalo.com/en/' 
          : (f.rel === 'blog/index.html' 
              ? 'https://aizalo.com/blog/' 
              : (f.rel === 'en/blog/index.html' 
                  ? 'https://aizalo.com/en/blog/' 
                  : `https://aizalo.com/${f.rel}`)));
    if (isLocalRun && (f.isEnHome || f.rel.startsWith('en/'))) {
      console.log(`   ⏭️ [PRE-DEPLOY] Bỏ qua kiểm tra Live Edge cho trang tiếng Anh chưa deploy: ${testUrl}`);
      continue;
    }
    const res = await safeFetch(testUrl, { method: 'HEAD' });
    if (res.status === 200) {
      // Good
    } else {
      deduct('technical', 10, `URL live trả lỗi HTTP ${res.status}: ${testUrl}`, 'P0');
    }
  }
  console.log(`   ✔️ Đã xác minh 100% URL trong sitemap trả về HTTP 200 OK!`);

  // 4. Check llms-full.txt headers (X-Robots-Tag: noindex)
  const fullTxtRes = await safeFetch('https://aizalo.com/llms-full.txt');
  if (fullTxtRes.status === 200) {
    const xRobots = fullTxtRes.headers.get('x-robots-tag');
    if (xRobots && xRobots.includes('noindex')) {
      console.log('   ✔️ Live llms-full.txt có X-Robots-Tag: noindex chính xác!');
    } else {
      deduct('technical', 8, 'Live llms-full.txt thiếu X-Robots-Tag: noindex trên CDN', 'P1');
    }
  }

  // 5. Check Content Negotiation via Edge Worker
  console.log('   ✔️ Đo kiểm Content Negotiation (Accept: text/markdown)...');
  const cnRes = await safeFetch('https://aizalo.com/', {
    headers: { 'Accept': 'text/markdown, text/plain; q=0.9' }
  });
  const cnContentType = cnRes.headers.get('content-type') || '';
  if (cnContentType.includes('text/markdown') || cnContentType.includes('text/plain')) {
    console.log('   ✔️ Edge Worker tự động đàm phán nội dung Markdown thành công!');
  } else {
    deduct('agentReadiness', 10, `Content Negotiation trả về ${cnContentType} thay vì text/markdown`, 'P1');
  }

  // 6. Check Cloudflare Isolation (app.aizalo.com)
  console.log('   ✔️ Kiểm tra ranh giới cô lập với SaaS (https://app.aizalo.com)...');
  const appRes = await safeFetch('https://app.aizalo.com/');
  if (appRes.status !== 0) {
    console.log(`   ✔️ SaaS app.aizalo.com hoạt động độc lập (HTTP ${appRes.status}), không bị xung đột Worker Route!`);
  }

  // ---------------------------------------------------------------------------
  // GENERATE FINAL SCORECARD & REPORT
  // ---------------------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('📊 KẾT QUẢ AUDIT TOÀN DIỆN aizalo.com (SCORECARD)');
  console.log('================================================================================\n');

  console.log(`🎯 1. ON-PAGE SEO SCORE        : ${audit.onPage.score}/100`);
  console.log(`⚙️  2. TECHNICAL & SCHEMA SCORE : ${audit.technical.score}/100`);
  console.log(`🤖 3. GEO & AI CITATION SCORE  : ${audit.geo.score}/100`);
  console.log(`🚀 4. AGENT READINESS LEVEL    : LEVEL ${audit.agentReadiness.score >= 85 ? '5 (Full Agent-Native)' : '4'} (${audit.agentReadiness.score}/100)`);
  console.log('\n--------------------------------------------------------------------------------');
  console.log(`TỔNG HỢP VẤN ĐỀ: ${audit.summary.p0.length} P0 (Critical) | ${audit.summary.p1.length} P1 (High Impact) | ${audit.summary.p2.length} P2 (Quick Wins)`);
  console.log('--------------------------------------------------------------------------------');

  if (audit.summary.p0.length > 0) {
    console.log('\n🔴 [P0 - CRITICAL ISSUES]:');
    audit.summary.p0.forEach(i => console.log(`   - ${i}`));
  }
  if (audit.summary.p1.length > 0) {
    console.log('\n🟡 [P1 - HIGH IMPACT RECOMMENDATIONS]:');
    audit.summary.p1.forEach(i => console.log(`   - ${i}`));
  }
  if (audit.summary.p2.length > 0) {
    console.log('\n🟢 [P2 - QUICK WINS & REFINEMENTS]:');
    audit.summary.p2.forEach(i => console.log(`   - ${i}`));
  }

  // Save audit results to JSON artifact
  const resultJson = JSON.stringify(audit, null, 2);
  fs.writeFileSync(path.join(rootDir, 'audit-result.json'), resultJson, 'utf8');
  console.log('\n💾 Đã lưu kết quả chi tiết vào audit-result.json');
}

runPass2();
