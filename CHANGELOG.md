# Changelog

Mọi thay đổi đáng chú ý của dự án **Zalo-Flow** sẽ được ghi chép lại trong tài liệu này.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), và dự án này tuân thủ [Semantic Versioning](https://semver.org/lang/vi/).

---

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
