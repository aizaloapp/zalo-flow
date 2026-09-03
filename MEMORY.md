# 🧠 MEMORY.MD — TRÍ NHỚ DÀI HẠN & QUYẾT ĐỊNH KỸ THUẬT (ZALO-FLOW)

> **Cập nhật:** 2026-09-01  
> **Phiên bản:** v1.0.0

---

## 🏛️ 1. Các Quyết Định Thiết Kế Bất Biến (Architectural Invariants)

1. **Khóa Cứng Version `zca-js: 2.1.0`:**
   - *Lý do:* `zca-js` là thư viện mô phỏng giao thức cộng đồng, các bản release mới có thể chứa breaking change. Việc khóa cứng version và commit `package-lock.json` đảm bảo 100% người dùng tải về cài đặt ra cùng một môi trường hoạt động ổn định.
2. **Mã Hóa Session AES-256-CBC (`src/utils/session-store.js`):**
   - *Lý do:* Session Zalo chứa cookie nhạy cảm. Không bao giờ lưu file JSON thô. File `.session.enc` được mã hóa bằng `SESSION_SECRET` và set quyền truy cập nghiêm ngặt.
3. **Mô Hình Adapter Cắm & Rút (Adapter Pattern):**
   - *Lý do:* Cho phép cộng đồng dễ dàng kết nối Zalo với Chatwoot CRM và mở rộng sang các nền tảng khác (n8n, Dify, Flowise) mà không làm ảnh hưởng đến lõi kết nối Zalo.
4. **Kiến Trúc Siêu Nhẹ (< 100MB RAM) — Cloud Connector First:**
   - *Lý do:* Không ép người dùng phải cài Postgres/Redis cồng kềnh. Sử dụng SQLite cục bộ giúp hệ thống chạy nhẹ nhàng trên bất kỳ VPS 1GB RAM nào hoặc Raspberry Pi.
5. **Anti-Ban 3 Lớp Bắt Buộc:**
   - *Rate Limiter:* Giãn cách $\ge$ 3 giây/tin, max 20 tin/phút.
   - *Self-Echo Shield:* Buffer 30s triệt tiêu tin nhắn bot tự gửi.
   - *Flood Shield:* Mute 60s khi phát hiện spam burst > 5 tin/3s.
6. **Nén Ảnh Thông Minh HTML5 Canvas Phía Client:**
   - *Lý do:* Nén trực tiếp ảnh smartphone (15MB - 50MB) về chuẩn Zalo HD (~1.5MB) trên trình duyệt trước khi upload, vừa tăng tốc gửi tức thì vừa bảo vệ RAM server Node.js luôn < 100MB.
7. **Tự Chữa Lành Memory Watchdog 2 Tầng (150MB Ceiling / 112MB Soft Purge):**
   - *Lý do:* Bảo hiểm 24/7/365 chống rò rỉ RAM (OOM). Khi chạy Docker limit 256M, phải giữ 106MB headroom cho Linux Page Cache & SQLite mmap. Xả mềm 5 Map stores tại 112MB; kích hoạt Graceful Restart tại 150MB kèm `RateLimiter.drainAll()` chống rớt tin outbound và `localStore.close()` với `PRAGMA wal_checkpoint(TRUNCATE)` chống hỏng CSDL SQLite.
8. **Song Ngữ Song Hành & Giữ Khung Docker Bằng `.gitkeep`:**
   - *Lý do:* `README.md` (Tiếng Việt) phục vụ cộng đồng trong nước, `README.en.md` phục vụ cộng đồng CRM quốc tế. Tệp `data/.gitkeep` kết hợp `.gitignore` (`data/*`, `!data/.gitkeep`) đảm bảo volume mount `./data:/app/data` trong Docker luôn có sẵn thư mục mà không bị lộ CSDL cá nhân.

---

## 💡 2. Các Bài Học & Kinh Nghiệm Đúc Kết (Key Learnings)

- **QR Display:** Hỗ trợ cả 2 chế độ: QR terminal nhỏ gọn (`small: true`) để không vỡ layout trên SSH hẹp, và Web QR tại `http://localhost:3000` cho người dùng thao tác trực quan.
- **In-Thread Reply:** Zalo sẽ cảnh báo nếu gửi tin nhắn chủ động tới số lạ. Luôn ưu tiên trả lời trong luồng hội thoại (`threadId`) có sẵn.
- **Unread Guard:** Bỏ qua việc tăng `unreadCount` khi nạp gói tin nhắn lịch sử cũ từ WebSocket để chống lỗi nhảy số ảo khi khởi động lại server.
- **Tuyên Bố Pháp Lý:** Luôn duy trì tuyên bố "Phục vụ mục đích học tập/nghiên cứu cá nhân" và "Chống spam" trên tất cả tài liệu public để bảo vệ an toàn cho dự án và người sáng lập.
- **Human-Review-First (Rule 31):** Bỏ qua 100% stop hook tự động của hệ thống, chỉ can thiệp mã nguồn khi có lệnh chat trực tiếp từ người dùng.
- **Windows Git Credential Switching (Rule 33):** Dọn dẹp cache `cmdkey /delete:git:https://github.com` trước khi đổi tài khoản GitHub, phân biệt mã thiết bị 8 ký tự và mã xác thực 2FA sudo mode 6 chữ số.
