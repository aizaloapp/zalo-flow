# Changelog

Mọi thay đổi đáng chú ý của dự án **Zalo-Flow** sẽ được ghi chép lại trong tài liệu này.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), và dự án này tuân thủ [Semantic Versioning](https://semver.org/lang/vi/).

---

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
