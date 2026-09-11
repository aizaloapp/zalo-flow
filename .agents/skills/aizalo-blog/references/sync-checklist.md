# Ma Trận Đồng Bộ 7 Điểm Chạm (Sync Checklist)

> **Quy tắc bất biến:** Mỗi khi xuất bản một bài viết blog mới, Agent **BẮT BUỘC** phải rà soát và cập nhật đủ 7 vị trí sau trước khi được phép chạy lệnh build.

| Điểm Chạm | Tệp Cần Chỉnh Sửa | Thao Tác Bắt Buộc | Mục Đích |
| :--- | :--- | :--- | :--- |
| **1. Danh mục Blog** | `website/src/blog/index.html` | Thêm thẻ `<a class="card blog-card">` mới lên vị trí đầu tiên của `.grid-2`. | Hiển thị bài viết mới cho người dùng ghé thăm. |
| **2. Lưới liên kết 2 chiều** | `website/src/blog/<bai-cu>.html` | Mở ít nhất 2 bài cũ có chủ đề liên quan: chèn 1 Callout dẫn link sang bài mới VÀ cập nhật `"dateModified": "YYYY-MM-DD"`. | Bơm PageRank, triệt tiêu Orphan Page, kích hoạt Content Freshness. |
| **3. Sơ đồ trang web** | `website/src/sitemap.xml` | Thêm thẻ `<url>` của bài mới (`priority: 0.85`) VÀ cập nhật `<lastmod>` của cả Trang chủ (`/`) lẫn Trang blog (`/blog/`). | Báo hiệu cho Googlebot quét bài mới ngay trong ngày. |
| **4. AI Knowledge Hub** | `website/src/guide.md` & `website/src/wiki.md` | **Lọc có điều kiện (Conditional Sync):**<br>• *Tính năng Zalo-Flow:* Thêm tóm tắt, FAQ kèm Deep-Link và mẫu chat Few-Shot.<br>• *Mẹo chung/Case study:* Bỏ qua (chống Prompt Bloat). | Cập nhật tri thức cho Bot AI khi người dùng bấm "Cập Nhật URL" mà không làm phình System Prompt. |
| **5. AI Search Engines** | `website/src/llms.txt` & `website/src/llms-full.txt` | Thêm link bài viết mới vào `llms.txt` và thêm câu hỏi/đáp chuyên sâu vào cuối `llms-full.txt`. | Tối ưu GEO cho ChatGPT Search, Perplexity, Gemini, Claude. |
| **6. Chuẩn Dual-Tier CTA** | Bài blog mới | Khóa cứng Navbar (`🤖 Thử Bot Zalo AI`), Floating Badge & CTA Box (`🤖 Trải Nghiệm Thử Bot Zalo AI`) trỏ về `https://zalo.me/0373315784`. | Tối ưu phễu chuyển đổi 1-1, loại bỏ ma sát nhóm Zalo. |
| **7. Bản build phân phối** | `website/dist/` | Chạy lệnh build tĩnh để đồng bộ toàn bộ file từ `website/src/` sang `website/dist/`. | Sẵn sàng deploy lên Cloudflare Pages mà không bị lệch file. |
