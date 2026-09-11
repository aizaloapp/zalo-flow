# 🌐 WEBSITE & PORTAL AGENTS.MD — QUY CHUẨN CỔNG THÔNG TIN CỘNG ĐỒNG AIZALO.COM

> **Sứ mệnh:** Cổng thông tin mã nguồn mở, Landing Page cộng đồng, Blog kỹ thuật và tài liệu AI Crawlers cho Zalo-Flow.  
> **Địa chỉ chính thức:** `https://aizalo.com/` (Cloudflare Pages: `aizalo-portal`).  
> **Mã nguồn:** Thư mục `website/src/` -> Lệnh biên dịch: `powershell website/build.ps1` -> Thư mục triển khai: `website/dist/`.

---

## 🏛️ 1. Bản Đồ Hạ Tầng Phân Tách (Domain & Topology Separation)

1. **Cổng Thông Tin Cộng Đồng (`https://aizalo.com/`):**
   - **Nguồn:** `website/src/` -> Build: `powershell website/build.ps1` -> Dist: `website/dist/`.
   - **Hạ tầng:** Cloudflare Pages (Project: `aizalo-portal`).
   - **Thành phần:** Landing page, Blog cẩm nang (`/blog/`), tài liệu AI Crawlers (`llms.txt`, `llms-full.txt` gắn `X-Robots-Tag: noindex`).
2. **SaaS Platform (`https://app.aizalo.com/`):**
   - **Hạ tầng:** Cloudflare Worker (`zalo-gatekeeper`) kết hợp Cloudflare D1/KV.
   - **Ranh giới cách ly 100%:** TUYỆT ĐỐI KHÔNG sửa đổi, xóa mã nguồn, can thiệp D1 schema hay cấu hình của `app.aizalo.com` khi làm việc trên repo này.
3. **Phần Mềm Zalo-Flow Cục Bộ (`localhost:3000`):**
   - Node.js >= 22.5.0, SQLite cục bộ, bộ cài Windows 1-Click (`.exe`).

---

## ⚡ 2. Zero-Downtime Worker-to-Pages Domain Cutover Invariant

Khi chuyển giao hoặc cấu hình tên miền chính (`aizalo.com`) sang Cloudflare Pages mà vẫn duy trì dịch vụ SaaS (`app.aizalo.com`) trên Worker:
1. Tuyệt đối KHÔNG xóa Worker script hoặc can thiệp vào bản ghi của `app.aizalo.com`.
2. **Quy tắc phân cấp định tuyến (Worker Routes Precedence):**  
   Worker Routes luôn có độ ưu tiên ghi đè cao hơn Cloudflare Pages. BẮT BUỘC phải gỡ bỏ bản ghi Custom Domain khỏi Worker (`DELETE /workers/domains/{id}`) VÀ xóa sạch Worker Route `aizalo.com/*` trên Zone (`DELETE /zones/{id}/workers/routes/{id}`). Tuyệt đối không để tồn tại Worker Route cho `aizalo.com/*` trên Zone. Chỉ duy trì duy nhất Route `app.aizalo.com/*`.
3. Khai báo tên miền vào Cloudflare Pages (`POST /pages/projects/{project}/domains`) và thiết lập bản ghi CNAME trỏ về `<project>.pages.dev` kèm bật Cloudflare Proxy (🟧).
4. Mọi thông tin xác thực Cloudflare lấy từ Bitwarden Vault BẮT BUỘC phải khóa Vault ngay lập tức (`bw lock`) và xóa sạch biến môi trường phiên (`BW_SESSION`, `BW_PASSWORD`) khỏi bộ nhớ sau khi hoàn tất. *(Gốc: Rule 44)*

---

## 🔍 3. Chiến Lược Từ Khóa SEO & GEO Thực Nghiệm (DataForSEO Invariants)

1. **Bộ từ khóa Trang chủ (`aizalo.com`):**
   - **Từ khóa cốt lõi (H1 & Title):**  
     `chat bot zalo` (480 – 880 vol/tháng, KD 8/100 cực thấp),  
     `bot zalo` (320 – 390 vol/tháng),  
     `chatbot zalo cá nhân` (110 – 140 vol/tháng, intent kích hoạt **Google AI Overview Rank 1**),  
     `zalo crm` (170 – 390 vol/tháng, xu hướng tăng 10x).
   - **Quy chuẩn Meta:** Thẻ Title, H1 và OG Image BẮT BUỘC chứa các từ khóa này để duy trì vị thế xếp hạng.
2. **Cụm chủ đề Vệ tinh Blog (`/blog/`):**
   - Bài 1 (`cach-gui-tin-nhan-tu-dong-tren-zalo-khong-bi-khoa.html`): `gửi tin nhắn tự động trên zalo`, `anti-ban zalo` (User intent: sợ khóa nick).
   - Bài 2 (`huong-dan-cach-tao-chatbot-zalo-ca-nhan.html`): `cách tạo chatbot zalo cá nhân`, `tạo bot zalo` (User intent: cài đặt nhanh không cần code).
   - Bài 3 (`tich-hop-ai-gemini-deepseek-vao-zalo-ca-nhan.html`): `tích hợp ai vào zalo`, `chatbot gemini zalo`, `deepseek zalo` (User intent: AI thông minh).
    - Bài 4 (`zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh.html`): `zalo crm`, `quản lý tin nhắn cskh zalo`, `chatwoot zalo` (User intent: bán hàng & đội ngũ).
    - Bài 5 (`cach-hen-gio-gui-tin-nhan-zalo-ca-nhan-tu-dong.html`): `hẹn giờ gửi tin nhắn zalo`, `lên lịch gửi tin nhắn zalo cá nhân` (User intent: chăm sóc khách hàng 1-1, hẹn giờ tự động).
3. **Nguyên tắc GEO (Generative Engine Optimization):**
   - BẮT BUỘC duy trì tệp `llms.txt` (tóm tắt cho AI Crawlers) và `llms-full.txt` (toàn văn kèm gắn `X-Robots-Tag: noindex`).
   - Đoạn văn bản định nghĩa ngắn 40-60 từ (Quotable Snippets) và bảng so sánh trên trang chủ phải luôn rõ ràng, cô đọng để các AI search engine (ChatGPT, Perplexity, Gemini, Claude) dễ dàng trích dẫn trực tiếp.

---

## 🎨 4. Chuẩn Kỹ Thuật Blog & Mục Lục Tương Tác (TOC Invariants)

1. **Hardcoded Semantic Headings ID (Anti-Client-Slug Invariant):**
   - Tuyệt đối KHÔNG dùng Client-side JavaScript để tự sinh thuộc tính `id` cho các thẻ tiêu đề bài viết blog.
   - Mọi thẻ `<h2>`, `<h3>` BẮT BUỘC phải được gán sẵn thuộc tính `id` chuẩn tiếng Việt không dấu ngắn gọn (`id="huong-dan-cai-dat"`) ngay trong mã nguồn HTML tĩnh.
   - *Mục đích:* Bảo đảm khả năng Deep Linking tức thì từ URL có hash (`#anchor`) ngay khi mở trang, đồng thời giúp Googlebot thu thập chính xác Anchor Sitelinks.
2. **Anti-Flicker Scrollspy Lock:**
   - Khi xây dựng Scrollspy bằng `IntersectionObserver`, BẮT BUỘC phải trang bị cơ chế khóa bắt sự kiện (debounce/lock ~800ms) khi người dùng nhấp vào một liên kết mục lục.
   - *Mục đích:* Triệt tiêu hiện tượng các mục trung gian bị sáng đèn chớp nhoáng (flickering) trong lúc màn hình đang cuộn mượt tới vị trí được chọn.
3. **CTA Box Semantic Isolation:**
   - Các khối kêu gọi hành động (CTA Box), hộp trợ giúp cộng đồng hoặc khảo sát ở cuối bài viết TUYỆT ĐỐI KHÔNG dùng thẻ tiêu đề `<h2>` hoặc `<h3>` mà phải dùng `<div class="cta-title">` hoặc inline style.
   - *Mục đích:* Bảo toàn cây phả hệ ngữ nghĩa (Semantic Hierarchy) thuần khiết cho các công cụ tìm kiếm và ngăn chặn việc parser mục lục gom nhầm nút CTA vào danh sách đọc.
4. **Build Script Asset Synchronization:**
   - Khi bổ sung bất kỳ tệp script (`.js`) hoặc asset tĩnh mới nào trong `website/src/`, tệp `website/build.ps1` BẮT BUỘC phải có lệnh sao chép tường minh sang `website/dist/` trước khi chạy lệnh deploy Cloudflare Pages.
5. **Topical Internal Link Mesh & Freshness Invariant:**
   - Khi xuất bản bài viết blog mới, Agent BẮT BUỘC thực hiện liên kết 2 chiều:
     (1) Bài mới trỏ về Trang chủ, `guide.md` và các bài cũ liên quan;
     (2) Mở ít nhất 2 bài viết cũ có chủ đề liên quan để chèn khối Callout dẫn link ngược vào bài mới (Inbound Links);
     (3) Cập nhật trường `"dateModified": "YYYY-MM-DD"` trong Schema JSON-LD của các bài cũ để kích hoạt tín hiệu Content Freshness.
   - Cập nhật thẻ `<url>` trong `sitemap.xml` kèm làm mới `<lastmod>` cho cả `/` và `/blog/`.
6. **Anti-TOC Breakage & Semantic Isolation Invariant:**
   - Script `blog-toc.js` tự động quét tất cả thẻ `h2, h3` bên trong `.article-body`.
   - TUYỆT ĐỐI KHÔNG sử dụng thẻ `<h2>` hoặc `<h3>` bên trong các khối phụ trợ như CTA Box, GEO Direct Answer Box, Key Takeaways Box, hay Author Bio.
   - Các tiêu đề khối phụ trợ BẮT BUỘC dùng `<div class="cta-title">`, `<div class="geo-answer-label">` hoặc `<p><strong>...</strong></p>` để bảo toàn tính thuần khiết của cây phả hệ mục lục.
7. **Pipeline Xuất Bản Chuyên Trách (`/aizalo-blog`):**
   - Mọi bài viết blog mới BẮT BUỘC được điều phối qua skill chuyên trách [`.agents/skills/aizalo-blog/SKILL.md`](file:///d:/A-Du-An/Zalo-Flow/.agents/skills/aizalo-blog/SKILL.md) để bảo đảm tuân thủ 100% các bước từ nghiên cứu DataForSEO, sinh ảnh SVG vector nhẹ < 5KB đến kiểm thử AST/Schema.

---

## 💎 5. Chuẩn Trải Nghiệm Đọc, Giảm Bounce Rate & Bộ Kiểm Định 2-Pass

1. **Nút Cuộn Đầu Trang Kèm Vòng Tròn Tiến Độ Đọc (Cloudflare-Style Scroll-To-Top):**
   - Mọi bài viết blog dài BẮT BUỘC nạp `blog-toc.js`.
   - Script tự động khởi tạo nút tròn 46px (`.scroll-top-btn`) với vòng viền SVG chạy tiến độ đọc từ 0% ➔ 100% bằng nét màu **Cyan Neon (`#00d2ff`)** theo thời gian thực (60 FPS qua `requestAnimationFrame`), góc bắt đầu từ 12 giờ (`transform: rotate(-90deg)`).
   - Nút chỉ hiện khi `scrollY > 280px`, xếp tầng mượt mà ở góc phải dưới (`bottom: 5.2rem; right: 1.5rem;`), tự động co giãn 42px và né thanh điều hướng trên di động (`safe-area-inset-bottom`).
2. **Khối Đề Xuất Bài Viết Liên Quan (Related Posts Grid 3 Cards & Bounce Rate Shield):**
   - Mọi bài viết blog BẮT BUỘC có khối `.related-posts-section` gồm 3 thẻ bài viết ngữ cảnh liên quan chặt chẽ nhất đặt ở chân trang (ngay sau nút CTA Box và trước thẻ `<footer>`).
   - Khối này BẮT BUỘC nằm bên ngoài thẻ `<article class="article-main">` và tiêu đề mang `h2 id="bai-viet-lien-quan"` để bảo đảm **Semantic Isolation** tuyệt đối, không làm ô nhiễm bộ sinh mục lục tự động `blog-toc.js`, đồng thời hạ tỷ lệ Bounce Rate và tăng sức mạnh mạng lưới liên kết nội bộ.
3. **Giới Hạn Vàng Độ Dài Title & GEO Quotable Snippet:**
   - **Thẻ `<title>` bài viết blog:** Kiểm soát nghiêm ngặt trong khoảng **50 – 70 ký tự** (bao gồm hậu tố thương hiệu `— AIzalo.com`) để tránh việc công cụ tìm kiếm cắt cụt hoặc tự ý viết lại (rewrite) tiêu đề trên SERP.
   - **Khối `.geo-answer-box`:** BẮT BUỘC chứa thẻ `<p class="geo-answer-text">` với độ dài nội dung đúng dải chuẩn **40 – 60 từ** để Google AI Overviews và các công cụ tìm kiếm AI (Perplexity, SearchGPT) bốc nguyên văn làm câu trả lời trích dẫn trực tiếp (Quotable Snippet) kèm link nguồn.
4. **Bộ Kiểm Định Thống Nhất 2-Pass (Unified Audit Engine Invariant):**
   - Trước mỗi lần bàn giao hoặc deploy lên Cloudflare Pages, Agent BẮT BUỘC thực thi:
     ```powershell
     node scripts/audit-aizalo.mjs
     ```
   - Xác nhận Pass 1 (Static AST/Schema/Links) và Pass 2 (Live Edge CDN, RFC 9264 describedby, Markdown Content Negotiation) đạt **100/100 tuyệt đối trên toàn bộ 4 trụ cột** (On-page SEO, Technical & Schema, GEO, Agent Readiness Level 5) với 0 P0, 0 P1, 0 P2.
5. **Phân Tầng Phễu Chuyển Đổi Dual-Tier & Bot Demo Routing (Invariant):**
   - **Tầng 1 (Conversion Hook / Trải Nghiệm Tức Thì):** Toàn bộ Navbar (`.btn-zalo`), Floating Badge cố định góc phải (`.floating-badge`), và nút phụ trong CTA Box (`.cta-box .btn-zalo`) BẮT BUỘC trỏ trực tiếp 1-1 tới số Zalo Bot Demo (`https://zalo.me/0373315784`).
     - Nhãn Navbar: `🤖 Thử Bot Zalo AI`
     - Nhãn Floating Badge & CTA Box: `🤖 Trải Nghiệm Thử Bot Zalo AI`
     - *Mục đích:* Triệt tiêu rào cản e ngại nhóm đông người, kích thích khách hàng bấm vào trò chuyện và tự mình kiểm chứng năng lực AI phản hồi trong 3 giây.
   - **Tầng 2 (Community Retention / Giao Lưu Kỹ Thuật):** Liên kết Nhóm Zalo (`https://zalo.me/g/mcihan713`) TUYỆT ĐỐI KHÔNG chiếm vị trí Conversion Hook chính. Chỉ duy trì ở khu vực chân trang (Footer) hoặc Section `#community` dành cho thành viên muốn thảo luận chuyên sâu.

