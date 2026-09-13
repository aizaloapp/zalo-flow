# Changelog

Mọi thay đổi đáng chú ý của dự án **Zalo-Flow** sẽ được ghi chép lại trong tài liệu này.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), và dự án này tuân thủ [Semantic Versioning](https://semver.org/lang/vi/).

## [1.3.0] - 2026-09-13

### Added
- **Ghim Hội Thoại Lên Đỉnh (Pin to Top) & Giới Hạn Tối Đa 5 Cuộc Trò Chuyện:**
  - Cố định tối đa 5 cuộc trò chuyện quan trọng trên đỉnh sidebar với biểu tượng 📌 rõ nét theo đúng quy chuẩn Zalo PC / Zalo Web.
  - Cơ chế `Realtime Prepend Guard`: Tự động giữ vững thứ tự ghim khi có tin nhắn mới đến trong thời gian thực, không để tin nhắn từ hội thoại thông thường chèn đè lên các thẻ đã ghim.
- **Menu Ngữ Cảnh Chuột Phải & Nút Ba Chấm `...` (Context Menu):**
  - Hỗ trợ chuột phải vào bất kỳ thẻ hội thoại nào để mở ngay menu ngữ cảnh tại tọa độ con trỏ chuột.
  - Nút ba chấm `...` tự động hiển thị khi hover hoặc khi thẻ đang kích hoạt, ngăn chặn hoàn toàn xung đột click (`stopPropagation`).
  - Hệ thống tự động đóng menu an toàn khi cuộn danh sách (`scroll`), nhấn phím `Escape` hoặc nhấp chuột ra ngoài.
- **Phân Loại Thẻ Màu Trực Tiếp & Dãy Chấm Màu (Tag Dots):**
  - Submenu "Phân loại" cho phép gán/gỡ thẻ khách hàng 1-Click trực tiếp từ menu chuột phải mà không cần mở modal quản lý.
  - Tích hợp hiệu ứng lật chiều thông minh (`flip-left`) chống tràn mép màn hình.
  - Hiển thị trực quan tối đa 4 chấm màu thẻ phân loại ngay trên dòng tin nhắn xem trước ở sidebar.
- **Đánh Dấu Chưa Đọc / Đã Đọc & Xóa Hội Thoại Cục Bộ:**
  - Đánh dấu lại tin nhắn chưa đọc (badge 1) để nhắc nhở xử lý và theo dõi khách hàng.
  - Xóa hội thoại và tin nhắn cục bộ trong CSDL SQLite của Zalo-Flow an toàn mà không ảnh hưởng tới ứng dụng Zalo trên điện thoại.
- **Bộ Kiểm Thử & An Toàn Tuyệt Đối:**
  - Bổ sung Test Suite #45 (`test/test-pin-and-context-actions.js`), 100% 45/45 test suites pass.

---

## [1.2.0] - 2026-09-12

### Added
- **Kiến Trúc Đa Ngôn Ngữ Song Ngữ (Zero-Dependency i18n):**
  - Động cơ chuyển ngữ thuần không phụ thuộc thư viện ngoài với 148 khóa dịch chuẩn 1:1 giữa Tiếng Việt (VI) và Tiếng Anh (EN).
  - Áp dụng cơ chế *In-Place DOM Walk* cập nhật tức thì thuộc tính hiển thị `<50ms` mà không tải lại trang, bảo toàn 100% dữ liệu biểu mẫu đang nhập dở (*Zero Form Reset Invariant*).
  - Tích hợp bộ kiểm thử tự động Test Suite #43 (`test/test-i18n.js`) bảo đảm 100% tính toàn vẹn từ điển.
- **Tính Năng Ủng Hộ Zalo-Flow (Support / Donate Modal):**
  - Nút viền hồng thanh lịch dạng viên thuốc trên Top Header với hiệu ứng nhịp đập tim và hỗ trợ co giãn responsive trên màn hình nhỏ `< 960px`.
  - Modal 3 thẻ trực quan hỗ trợ các kênh: Ko-fi (`https://ko-fi.com/aizalo`), PayPal (`https://paypal.me/lekhoa288`) và MoMo (`0973947264`).
  - Mã QR vector SVG tĩnh lưu trữ cục bộ tại `public/assets/qr/` (Zero Network Overhead), sinh qua script tái sử dụng `scripts/generate-donate-qr.mjs`.
  - Nút sao chép thông tin 1-Click với cơ chế Fallback an toàn 2 tầng qua `document.execCommand('copy')` khi truy cập qua mạng LAN HTTP (`isSecureContext === false`).
  - Chuẩn hóa CSS Semantic Tokens riêng biệt cho Light Theme (`#e11d48` trên `#fff1f2`) và Dark Theme (`#fb7185`) đạt chuẩn tương phản cao WCAG AA.
- **Multer Safe Error Handling Middleware & Dual-Field Tolerance:**
  - Bọc an toàn các endpoint upload tệp (`src/routes/scheduled-messages.js`) bắt trọn `MulterError` trả về JSON 400 thay vì để Express trả HTML 500.
  - Phía backend dung nạp linh hoạt cả 2 tên trường `file` và `image`; phía frontend upload kiểm tra an toàn bằng `res.text() ➔ JSON.parse()`.

### Fixed
- **Khắc Phục Lỗi Cấu Trúc Lồng Thẻ Modal (Gstack Investigate):**
  - Đóng kín các thẻ `</div>` bị thiếu tại `modal-app-update` và `modal-zalo-login`, triệt tiêu hoàn toàn hiện tượng nuốt nhầm modal con vào modal cha.
  - Thiết lập `z-index: 10000;` cho các modal cấp cao nhất và hỗ trợ click ra ngoài backdrop để đóng nhanh.

---

## [1.1.0] - 2026-09-11

### Added
- **Khay Chờ Đính Kèm & Gộp Caption Ảnh (Pending Attachment Staging):**
  - Tải ảnh hoặc dán ảnh (`Ctrl + V`) không còn gửi tức thì; chuyển sang cơ chế staging xem trước thumbnail trên thanh `#attachment-preview-bar`.
  - Hỗ trợ gõ chữ và gửi đồng thời cả Ảnh + Chữ dính liền trong 1 tin nhắn duy nhất theo chuẩn Single-Image Caption Integration.
  - Fallback Guard thông minh: Phân tách gửi tin nhắn chữ trước rồi gửi tệp sau nếu có nhiều hơn 1 tệp hoặc chữ dài > 1000 ký tự.
  - Phân rã luồng Quote Reply + Ảnh mượt mà, chống rò rỉ RAM với `URL.revokeObjectURL()`, chống click đúp (Double-submit Race Condition).
- **Lên Lịch Hẹn Tin Nhắn 1-1 Theo Hội Thoại (In-Thread Scheduling):**
  - Hẹn giờ gửi tin nhắn văn bản và hình ảnh cho từng khách hàng cụ thể trực tiếp từ Live Chat.
  - Thanh ghim đếm ngược trực quan trên đỉnh khung chat kèm nút gửi ngay.
  - Tự động tạm dừng an toàn (Auto-Pause) khi khách hàng nhắn tin lại trước giờ hẹn chống spam ngô nghê.
- **Universal Wiki URL Ingestion & Golden Template (`src/routes/ai-settings.js`):**
  - Nạp tài liệu Markdown trực tiếp từ URL bên ngoài (`aizalo.com/guide.md`) qua HTTP request an toàn với SSRF Protection Shield.
  - Bộ phân tích Dual-Mode Parser: Tự động nhận diện cấu trúc Golden Template 5 phần hoặc tài liệu tự do Mode 2.
- **Tự Động Định Danh Khách Hàng Lạ (`public/app.js`, `src/routes/chat-actions.js`):**
  - Tự động truy vấn và phân giải tên thật kèm avatar từ Zalo API khi mở cuộc trò chuyện với khách lạ, loại bỏ triệt để dãy số UID thô.
- **Bộ Kiểm Thử Toàn Diện (41/41 Test Suites):**
  - Bổ sung Suite 41 kiểm thử toàn diện giao thức gửi ảnh có caption và cơ chế fallback guard.

---

## [1.0.9] - 2026-09-09

### Added
- **Mắt Thần Multimodal AI Vision (`src/adapters/ai-agent.js`):**
  - Tự động nhận diện chữ (OCR), đọc và phân tích chi tiết hình ảnh đính kèm (hóa đơn, biên lai, sản phẩm, tài liệu, ảnh chụp màn hình...) gửi qua Zalo.
  - Áp dụng kỹ thuật **Chỉ Thị Đè (Override Directive)**: Khử định kiến từ chối từ các câu trả lời cũ trong lịch sử chat mà vẫn bảo toàn 100% cấu trúc luân phiên `user` <-> `model`, triệt tiêu lỗi HTTP 400 của Google Gemini / OpenAI.
  - Tích hợp **Dynamic Vision Prompting** và nguyên tắc **Anti-Hallucination Guard**: Nếu ảnh mờ/lóa sáng/không rõ chữ, bot lịch sự nhờ khách chụp lại cận cảnh, tuyệt đối không đoán mò số tiền hay thông tin pháp lý.
  - Giới hạn kích thước ảnh tải về tối đa 4MB với `maxBodyLength` trong Axios để ngắt stream chunked lớn từ CDN, bảo đảm an toàn RAM < 100MB.

### Fixed
- **Đồng Bộ Phân Loại Nhóm Chuẩn Xác (Ground-Truth Group Reconciliation):**
  - Xóa bỏ thuật toán heuristic đếm tin nhắn phỏng đoán trong constructor của `LocalStore` (nguyên nhân gây nhận diện nhầm các tin nhắn cá nhân 1-1 thành nhóm).
  - Tích hợp hàm `reconcileGroupsWithGroundTruth`: Đồng bộ chính xác 100% trạng thái nhóm từ Zalo API (`getAllGroups()`). Mọi hội thoại không thuộc danh sách nhóm thật sẽ được tự động khôi phục về chat cá nhân (`isGroup: 0`).
  - Bổ sung phương thức `setConversationGroupState(threadId, isGroup)` trong `LocalStore` cho phép cập nhật trạng thái có chủ đích mà không bị khóa `ON CONFLICT` của `upsertConversation` chặn lại.
  - Bổ sung Test 35, 36, 37 trong `test/test-all.js` (37/37 test suites pass 100%).

## [1.0.8] - 2026-09-09

### Added
- Tối ưu hóa UI Dashboard, Spintax Engine và Campaign Test Dispatch Isolation.

## [1.0.7] - 2026-09-09

### Added
- **Phòng Thủ Nhóm Chat & Nhận Diện Mention 3 Cấp Độ (`src/utils/mention-detector.js`):**
  - Cấp 1 (Zalo Tag Protocol): Nhận diện tag chuẩn Zalo (`mentions.uid === botUid`), tự động bỏ qua các loại tag nhắc cả nhóm `@all` (`['0', '-1', 'all']`).
  - Cấp 2 (Ký hiệu `@` gõ tay): Nhận diện tiền tố `@` đứng liền trước tên (`@Khoa`, `@bot`, `@trợ lý`, `@amon`).
  - Cấp 3 (Vocative Xưng Hô Tiếng Việt): Nhận diện cụm xưng hô neo ở đầu câu (`Khoa ơi`, `Anh Khoa ơi`, `Bot ơi`, `Nhờ bot hỗ trợ...`).
  - Miễn nhiễm hoàn toàn với các từ khóa nằm giữa câu gây false-positive (`khoa vi phẫu`, `chuyên khoa`, `khoa học`, `ổ khóa`, `robot`, `bột giặt`).
  - Bóc tách danh tính bot động thông minh loại bỏ icon emoji, thẻ ngoặc `[VIP]`, `(Dev)` và bọc bảo vệ `escapeRegex` chống ReDoS.
  - Quoted Message Immunity: Chỉ quét text của tin nhắn hiện tại, loại trừ nội dung trích dẫn `quoteText`.
- **Tối Ưu Điều Phối AI & Token Shield (`src/adapters/ai-agent.js`):**
  - Fast-path 0ms/0 token/0 RAM: Bỏ qua lập tức mọi tin nhắn nhóm không gọi tên bot.
  - Per-User Group Cooldown: Giới hạn mỗi thành viên gọi bot tối đa 1 lần trong 10 giây để bảo vệ ví tiền API.
  - Sender-Isolated Debounce Buffer: Phân tách bộ đệm theo `${threadId}:${senderId}` triệt tiêu lỗi Starvation và gộp nhầm câu hỏi giữa các thành viên.
  - Auto-Quote Inbound Question: Tự động Quote lại tin nhắn của thành viên khi trả lời trong nhóm.
- **Chuẩn Hóa Zalo Client (`src/zalo-client.js`):**
  - Truyền tường minh `senderName` từ `onMessage` sang adapter.
  - Nâng cấp `sendMessage` hỗ trợ tham số `quote` đồng thời bảo toàn thuộc tính `isBot: true` và `quoteText` trong SQLite.
- **Cơ Sở Dữ Liệu & UI:**
  - Bổ sung cột `botAliases` vào bảng `ai_settings` trong SQLite qua `PRAGMA table_info` reconciliation.
  - Cập nhật giao diện Cài Đặt AI trên Dashboard với checkbox nhóm chat và ô nhập Biệt danh Bot tùy chọn.
- **Kiểm Thử:**
  - Bổ sung `test/test-mention-detector.js` (10/10 suites) và Test 32 trong `test/test-all.js` (32/32 tests pass 100%).

## [1.0.6] - 2026-09-08

### Added
- **Hệ Thống Giao Diện Sáng & Tối (Light & Dark Mode) 1-Click:**
  - Chuẩn hóa 17 CSS Variables semantic tokens, triệt tiêu toàn bộ màu tối ghi cứng.
  - Nhúng script Anti-FOUC đặt tại thẻ `<head>` loại bỏ hiện tượng nhấp nháy giao diện khi tải trang.
  - Bảo vệ độ tương phản cao (High-Contrast Guard) cho các phần tử active (`.conv-card.active`).
- **Typography & Ergonomics Chuẩn Zalo Desktop:**
  - Kích thước chữ bong bóng chat 14px (`0.88rem`), khoảng cách dòng `1.45`, bo góc `12px` và padding `9px 13px`.
- **Multi-Device Outbound Sync:**
  - Đồng bộ tức thì tin nhắn, ảnh, file gửi từ ứng dụng di động Zalo về Zalo-Flow Web Dashboard kèm Self-Echo Shield chặn lặp phản xạ.

## [1.0.0] - 2026-09-01

### Added
- **Core Invariants & Anti-Ban:**
  - Token Bucket Rate Limiter với cơ chế giãn cách an toàn $\ge$ 3 giây/tin nhắn (tối đa 20 tin/phút).
  - Self-Echo Shield với bộ đệm thời gian thực 30 giây triệt tiêu 100% vòng lặp bot tự nhận và trả lời tin nhắn của chính mình.
  - Flood Detector tự động phát hiện và mute tạm thời 60 giây khi bị spam burst (> 5 tin nhắn trong 3 giây).
  - Giới hạn bộ nhớ siêu nhẹ: Toàn bộ tiến trình duy trì Process RSS RAM < 100MB (Thực tế: ~55MB).
- **Omnichannel & Webhook Bridge:**
  - Chatwoot CRM 2-Way Sync: Tự động đồng bộ tin nhắn đến lên Chatwoot Inbox và gửi tin nhắn từ tư vấn viên ngược lại Zalo.
  - 1-Click Bulk Deep-Sync trực tiếp qua WebSocket Zalo với khoảng nghỉ an toàn 350ms/người và thanh tiến trình SSE.
  - Unread Guard: Bảo vệ `unreadCount` không bị nhảy số ảo khi nạp gói tin nhắn lịch sử cũ từ máy chủ Zalo.
- **AI Agent Intelligence & Second Brain Wiki:**
  - Universal AI Provider hỗ trợ Google Gemini Native, OpenAI, DeepSeek V3/R1, Groq, Ollama Offline.
  - Auto-Fallback Shield: Tự động chuyển sang model dự phòng khi gặp sự cố mạng hoặc lỗi giới hạn 429/timeout.
  - Few-Shot Learning 1-Click: Trích xuất mẫu đối thoại thực tế từ khách hàng để huấn luyện phong cách phản hồi của bot.
  - Mini Second Brain Wiki Viewer: Tự động biên dịch toàn bộ nhân cách SOUL, MEMORY bảng giá và cặp Q&A sang Markdown Karpathy với bộ đếm tokens tiếng Việt (hệ số 3.0).
- **Self-Healing Memory Watchdog Sentinel:**
  - Giám sát bộ nhớ 2 tầng: cảnh báo và xả mềm 5 Map stores tại 112MB, tự khởi động lại êm ái (Graceful Restart) sau 3 chu kỳ vượt 150MB (90s).
  - Tích hợp `RateLimiter.drainAll()` chống rớt tin outbound và `localStore.close()` với `wal_checkpoint(TRUNCATE)` bảo vệ toàn vẹn CSDL.
  - Hiển thị thông số RAM thời gian thực qua badge header trên Web UI.
- **Client-Side Smart Canvas Compression:**
  - Tự động nén ảnh chụp smartphone độ phân giải cao (15MB - 50MB) qua HTML5 Canvas trực tiếp trên trình duyệt (< 0.2s) về chuẩn Zalo HD 2560px/90% (~1.5MB) trước khi tải lên server.
- **Web UI & Security:**
  - Giao diện Web SPA Dashboard quản lý Live Chat, Thẻ Tag phân loại khách hàng, Tin nhắn mẫu nhanh và Chiến dịch Remarketing.
  - Modal Đăng Nhập Zalo Web QR Base64, tự động bắt sự kiện quét và hỗ trợ đổi tài khoản 1-click.
  - Mã hóa AES-256-CBC cho cookie phiên đăng nhập và API keys trên local disk.
- **Tài Liệu & Cộng Đồng:**
  - `README.md`, `README.en.md` (Song ngữ Việt - Anh), `DISCLAIMER.md` (Tuyên bố phi thương mại & miễn trừ trách nhiệm chống spam).
  - `CONTRIBUTING.md` (Hướng dẫn viết Adapter mới trong 30 dòng code), `ROADMAP.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
  - Bộ kiểm thử tự động 23/23 Unit Tests PASS 100%.
