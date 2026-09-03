# 🗺️ Zalo-Flow Community Research Roadmap

> **Sứ mệnh:** Xây dựng một framework mã nguồn mở chuẩn mực, an toàn và siêu nhẹ (< 100MB RAM) để kết nối Zalo cá nhân với các hệ thống Webhook, CRM và AI Agents phục vụ nghiên cứu kỹ thuật.

---

## 🎯 Giai Đoạn 1: Củng Cố Nền Tảng Cốt Lõi (ĐÃ HOÀN THÀNH ✅)

- [x] **Core Invariants & Security:**
  - [x] Mã hóa phiên đăng nhập và API Key bằng chuẩn nhị phân AES-256-CBC.
  - [x] Hệ thống phòng vệ Anti-Ban 3 lớp: Token Bucket Rate Limiter (3s/tin), Self-Echo Shield (30s buffer), Flood Detector (mute 60s).
  - [x] Bảo vệ giới hạn bộ nhớ: Process RSS RAM < 100MB (Thực tế: ~55MB).
- [x] **Omnichannel Sync:**
  - [x] Chatwoot CRM 2-Way Sync (Tin đến tự đồng bộ lên Inbox, tư vấn viên gõ Chatwoot tự gửi về Zalo).
  - [x] 1-Click Bulk Deep-Sync trực tiếp qua WebSocket Zalo (350ms spacing, SSE live progress).
  - [x] Unread Guard: Loại bỏ lỗi nhảy số tin nhắn chưa đọc ảo khi khởi động lại server.
- [x] **AI Agent Intelligence:**
  - [x] Universal AI Provider (Gemini Native, OpenAI, Groq, Ollama) với Auto-Fallback Shield.
  - [x] Few-Shot Learning 1-Click từ lịch sử chat thực tế.
  - [x] Nén ảnh thông minh HTML5 Canvas (< 0.2s) trên trình duyệt trước khi upload.
- [x] **Test Integrity:** Bộ test suite 20/20 PASS 100%.

---

## 🚀 Giai Đoạn 2: Mở Rộng Hệ Sinh Thái Adapter (ĐANG TRIỂN KHAI 🔄)

- [ ] **Generic Webhook Adapter:**
  - [ ] Hỗ trợ bắn Inbound Message Webhook ra ngoài theo định dạng chuẩn JSON cho mọi nền tảng tự động hóa.
  - [ ] Nhận Outbound Webhook để gửi tin nhắn/ảnh ngược lại Zalo.
- [ ] **No-Code Automation Bridges:**
  - [ ] Mẫu template kết nối với **n8n** (Node.js workflow).
  - [ ] Mẫu template kết nối với **Dify.ai** (LLM App builder).
  - [ ] Mẫu template kết nối với **Flowise / LangChain**.
  - [ ] Mẫu template kết nối với **Make.com / Zapier**.
- [ ] **Data Portability (Xuất/Nhập Dữ Liệu):**
  - [ ] Hỗ trợ xuất và nhập danh sách Tin Nhắn Nhanh (Quick Messages) và Thẻ Phân Loại (Tags) dưới dạng tệp JSON chia sẻ.

---

## 🌐 Giai Đoạn 3: Tối Ưu Hóa Hạ Tầng Tiết Kiệm Năng Lượng & IoT (KẾ HOẠCH TIẾP THEO 📋)

- [ ] **Low-Power IoT Deployment:**
  - [ ] Docker Image siêu nhẹ tối ưu hóa cho **Raspberry Pi (ARM64 / ARMv7)**.
  - [ ] Hướng dẫn cài đặt 1-Click trên **Synology NAS (Container Manager)**.
  - [ ] Add-on tích hợp vào **Home Assistant** để nhận thông báo nhà thông minh qua Zalo.
- [ ] **CLI One-Command Setup:**
  - [ ] Cải tiến lệnh `npx zalo-flow` để hỗ trợ wizard cấu hình tương tác hoàn chỉnh không cần clone repo.
- [ ] **Cross-Platform Desktop Companion (Tùy chọn):**
  - [ ] Giao diện khay hệ thống (System Tray) siêu nhẹ hiển thị trạng thái kết nối bot.

---

## 🤝 Cách Tham Gia Đóng Góp

Bạn muốn đề xuất tính năng mới hoặc tham gia phát triển một mục trong Roadmap?
1. Mở một **[Feature Request Issue](https://github.com/aizaloapp/zalo-flow/issues)**.
2. Đọc hướng dẫn viết Adapter tại **[CONTRIBUTING.md](CONTRIBUTING.md)**.
3. Tham gia thảo luận kỹ thuật tại **[GitHub Discussions](https://github.com/aizaloapp/zalo-flow/discussions)**.
