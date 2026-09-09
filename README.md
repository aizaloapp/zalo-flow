<div align="center">

# ⚡ Zalo-Flow

### The Open-Source Automation & Omnichannel Webhook Framework for Personal Zalo
**Nền tảng mã nguồn mở phục vụ Học tập, Nghiên cứu Kiến trúc Webhook & Tự động hóa AI cá nhân**

<p align="center">
  <b>🇻🇳 Tiếng Việt</b> • <a href="README.en.md">🇬🇧 English</a>
</p>

[![License: Non-Commercial (MIT + Commons Clause)](https://img.shields.io/badge/License-MIT%20%2B%20Commons%20Clause-blue.svg)](LICENSE)
[![Purpose: Education & Research](https://img.shields.io/badge/Purpose-Education%20%26%20Research-orange.svg)](DISCLAIMER.md)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org)
[![CI Quality Gate](https://github.com/aizaloapp/zalo-flow/actions/workflows/ci.yml/badge.svg)](https://github.com/aizaloapp/zalo-flow/actions/workflows/ci.yml)
[![Anti-Leak & Secret Scan](https://github.com/aizaloapp/zalo-flow/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/aizaloapp/zalo-flow/actions/workflows/secret-scan.yml)
[![Memory Footprint](https://img.shields.io/badge/RAM-%3C%20100MB-success.svg)](test/test-all.js)
[![Tests Passing](https://img.shields.io/badge/Tests-32%2F32%20Passing-brightgreen.svg)](test/test-all.js)
[![Docker Ready](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](docker-compose.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<p align="center">
  <a href="https://aizalo.com"><img src="https://img.shields.io/badge/🌐_Website_Chính_Thức-aizalo.com-0068FF?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Official Website"/></a>
  <a href="https://zalo.me/g/mcihan713"><img src="https://img.shields.io/badge/💬_Cộng_Đồng_Hỗ_Trợ-Nhóm_Zalo-0088FF?style=for-the-badge&logo=zalo&logoColor=white" alt="Zalo Community"/></a>
  <a href="https://aizalo.com/blog/"><img src="https://img.shields.io/badge/📚_Cẩm_Nang-Bài_Viết_Hướng_Dẫn-FF6B00?style=for-the-badge" alt="Blog Tutorials"/></a>
</p>

[🌐 Website](https://aizalo.com) • [📚 Cẩm Nang Kỹ Thuật](https://aizalo.com/blog/) • [💬 Nhóm Zalo](https://zalo.me/g/mcihan713) • [Tính Năng](#-tính-năng-nổi-bật) • [Tải Về Windows](#-tải-về-cài-đặt-1-click-cho-windows) • [Kiến Trúc](#-kiến-trúc-hệ-thống) • [Cài Đặt Nhanh](#-cài-đặt-nhanh-trong-3-phút) • [Anti-Ban](#-hệ-thống-phòng-vệ-anti-ban-3-lớp)

<br/>

### 📥 Tải Về Cài Đặt 1-Click Cho Windows

Không cần biết Git, không cần cài Node.js, không cần mở màn hình đen Terminal:

[![Tải Bản Cài Đặt Windows](https://img.shields.io/badge/Windows-Download%20Setup%20v1.0.7%20(.exe)-0068FF?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/aizaloapp/zalo-flow/releases/latest)

> 💡 **Tải về chạy ngay:** Bấm nút ở trên để tải file **`ZaloFlow-Setup-v1.0.7.exe`** (Chỉ **24.2MB**). Cài đặt trong 30 giây là có ngay icon Zalo-Flow ngoài Desktop!

</div>

---

> ⚠️ **TUYÊN BỐ PHÁP LÝ & MIỄN TRỪ TRÁCH NHIỆM (LEGAL DISCLAIMER):**
> 
> 1. **Mục đích học tập & nghiên cứu kỹ thuật:** Dự án `Zalo-Flow` là phần mềm mã nguồn mở độc lập, **chỉ phục vụ mục đích học tập, nghiên cứu kiến trúc phần mềm (Webhook, Adapter Pattern, Realtime Stream) và tự động hóa cá nhân**. Dự án **KHÔNG** thuộc sở hữu, ủy quyền hoặc tài trợ bởi Công ty Cổ phần VNG hay ứng dụng Zalo.
> 2. **Chính sách cấm Spam (Zero-Tolerance Anti-Spam Policy):** Nghiêm cấm tuyệt đối mọi hành vi sử dụng phần mềm để gửi tin nhắn rác hàng loạt, spam quảng cáo, quấy rối hoặc các hành vi vi phạm pháp luật và Điều khoản sử dụng của Zalo.
> 3. **Tuyên bố miễn trừ trách nhiệm:** Tác giả và những người đóng góp **không chịu bất kỳ trách nhiệm nào** đối với bất kỳ rủi ro, tổn thất hoặc vi phạm nào phát sinh từ việc sử dụng phần mềm của người dùng cuối. **Luôn sử dụng tài khoản phụ để thử nghiệm.**
> 
> 👉 Chi tiết xem tại văn bản chính thức: [DISCLAIMER.md](DISCLAIMER.md).

---

## 🌟 Tính Năng Nổi Bật

- 👥 **Phòng Thủ Nhóm Chat & Nhận Diện Mention 3 Cấp Độ (Mới ở v1.0.7):** Tự động lọc sạch 100% tin nhắn nhóm không gọi tên bot (Fast-path 0ms, 0 token, 0 RAM). Nhận diện tag chuẩn Zalo (`mentions`), ký hiệu `@tên` gõ tay và xưng hô tiếng Việt có neo đầu câu (`Khoa ơi`, `Bot ơi`). Tự động Quote trích dẫn câu hỏi của thành viên, cô lập hàng đợi theo từng người hỏi và trang bị lá chắn chống spam token (Per-user Cooldown 10s).
- 🎨 **Giao Diện Sáng & Tối (Light & Dark Mode) 1-Click:** Chuyển đổi linh hoạt giữa Dark Mode công nghệ và Light Mode dịu mắt chuẩn phong cách Zalo PC, tự động lưu cấu hình và triệt tiêu hoàn toàn hiện tượng chớp nháy (Anti-FOUC).
- 💬 **Typography & Trải Nghiệm Chat Chuẩn Zalo PC:** Kích thước chữ 14px (`0.88rem`), khoảng cách dòng `line-height: 1.45`, bo góc `12px` và padding `9px 13px` tinh gọn, thân quen như ứng dụng Zalo Desktop nguyên bản.
- 📲 **Đồng Bộ Tin Nhắn Điện Thoại (Multi-Device Outbound Sync):** Gửi tin nhắn, ảnh, file từ ứng dụng Zalo trên điện thoại tự động đồng bộ tức thì về Zalo-Flow mà không gây lặp phản xạ (Self-Echo Isolation).
- 🧠 **Bộ Não Điều Khiển AI 5 Tabs (Local-First Architecture):**
  - **Tab 1: Nhân Cách (SOUL):** Tùy biến phong cách trợ lý, 3 Presets (Thân thiện, B2B, Support), học mẫu **Few-Shot Exemplar 1-Click** từ hội thoại thực tế.
  - **Tab 2: Trí Nhớ & Tri Thức (MEMORY):** Nhúng Second Brain Wiki Karpathy và tự động trích xuất cặp Hỏi - Đáp từ Tin Nhắn Nhanh (`quick_messages`).
  - **Tab 3: Mô Hình & Dự Phòng (BRAIN):** Hỗ trợ Universal LLM (Gemini 2.5 Flash/Pro Native, OpenAI, DeepSeek V3/R1, Groq, Ollama Offline) kèm **Auto-Fallback Shield** (chống lỗi 429/timeout).
  - **Tab 4: Ranh Giới (SCOPE):** Lọc theo Nhóm/Cá nhân, Smart Cooldown (tự tắt bot khi Admin vừa nhắn tin), Whitelist/Blacklist theo Thẻ Tag.
  - **Tab 5: Giả Lập (SIMULATOR):** Sân chơi Sandbox kiểm tra phản xạ Bot AI trực tiếp trên giao diện web.
- 📖 **Mini Second Brain Wiki Viewer (Karpathy LLM-Wiki):** Tự động biên dịch cấu hình AI thành tài liệu Markdown hoàn chỉnh, tính toán tokens tiếng Việt với hệ số 3.0 và hỗ trợ xem trước 1-Click trên Web UI.
- 🚀 **Siêu Nhẹ (< 100MB RAM) & Tự Chữa Lành (Self-Healing Memory Guard):** Không cần mở Chromium ngầm. Canh gác RAM tự động: xả mềm 5 Map stores tại 263MB, tự khởi động lại êm ái tại 350MB trong 1.5s kèm flush SQLite WAL và drain hàng đợi (tối ưu cho tài khoản lớn > 1.000 bạn bè/nhóm).
- 🖼️ **Nén Ảnh Thông Minh HTML5 Canvas (< 0.2s):** Tự động nén ảnh smartphone dung lượng lớn (15MB - 50MB) về chuẩn Zalo HD 2560px/90% (~1.5MB) trực tiếp trên client trước khi upload.
- 🔄 **1-Click Bulk Deep-Sync:** Tải toàn bộ lịch sử trò chuyện gốc trực tiếp qua Zalo WebSocket với khoảng nghỉ an toàn 350ms/người và thanh tiến trình thời gian thực.
- 💬 **Live Chat & CRM Dashboard:** Quản lý hội thoại 2 chiều, thẻ khách hàng (Tags), tin nhắn mẫu (Quick Messages) và chiến dịch Remarketing gửi kèm tệp đính kèm.
- 🔌 **Đồng Bộ Chatwoot 2 Chiều:**
  - **Inbound:** Tin nhắn Zalo $\rightarrow$ Đồng bộ tức thì lên Chatwoot Inbox.
  - **Outbound:** Tư vấn viên trả lời trên Chatwoot $\rightarrow$ Gửi trực tiếp về Zalo của khách hàng.
- 🛡️ **Hệ Thống Phòng Vệ Anti-Ban 3 Lớp:** Token Bucket Rate Limiter (kèm `drainAll()`), Self-Echo Shield (30s buffer) và Flood Detector.
- 🔒 **Mã Hóa AES-256-CBC:** Lưu trữ cookie phiên đăng nhập và API Keys an toàn dưới dạng nhị phân mã hóa cục bộ.

---

## 🏛️ Kiến Trúc Hệ Thống

```
               ┌──────────────────────────────────────────────────────────┐
               │                  KHÁCH HÀNG / USER                       │
               └─────────────────────────────┬────────────────────────────┘
                                             │ (Nhắn tin Zalo 1-1 / Nhóm)
                                             ▼
                                 ┌───────────────────────┐
                                 │      ZALO WEB         │
                                 │  (chat.zalo.me via    │
                                 │        zca-js)        │
                                 └───────────┬───────────┘
                                             │ (Inbound Event)
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ZALO-FLOW ENGINE (Node.js)                            │
│                                                                                 │
│  [Anti-Ban Shield] ── [Session AES-256] ── [Web Dashboard: localhost:3000]     │
│         │                                               │                       │
│         ├──► [Rate Limiter (3s/tin)]                    ├──► [LocalStore SQLite]│
│         ├──► [Self-Echo Shield (30s)]                   └──► [Canvas Compressor]│
│         └──► [Flood Muting (60s)]                                               │
│                                                                                 │
│               ┌───────────────────────┬───────────────────────┐                 │
│               │   Chatwoot 2-Way      │    Direct AI Engine   │                 │
│               │   Inbound / Outbound  │   (Gemini/Ollama/...) │                 │
│               └───────────────────────┴───────────────────────┘                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Cài Đặt Nhanh Trong 3 Phút
> 📌 **Yêu cầu môi trường:** Node.js >= 22.5.0 (khuyến nghị Node 22 LTS hoặc Node 24) hoặc Docker.

### Cách 1: Sử Dụng CLI Setup Wizard (Khuyến Nghị)

```bash
# 1. Clone repository
git clone https://github.com/aizaloapp/zalo-flow.git
cd zalo-flow

# 2. Cài đặt dependencies và chạy Wizard cấu hình tương tác
npm install
npm run init

# 3. Khởi chạy hệ thống
npm start
```

### Cách 2: Sử Dụng Docker Compose

```bash
# 1. Tạo file cấu hình từ mẫu
cp .env.example .env

# 2. Chạy container ngầm
docker compose up -d

# 3. Mở trình duyệt quét mã QR đăng nhập
# 👉 http://localhost:3000
```

---

## 🔌 Hướng Dẫn Tích Hợp Chatwoot

1. Trên Chatwoot CRM, tạo một **API Channel Inbox** mới.
2. Điền thông tin kết nối vào file `.env`:
   ```bash
   CHATWOOT_API_URL=https://app.chatwoot.com
   CHATWOOT_API_TOKEN=your_chatwoot_user_token
   CHATWOOT_ACCOUNT_ID=1
   CHATWOOT_INBOX_ID=123
   ```
3. Cấu hình Webhook trên Chatwoot trỏ về: `http://IP-SERVER-CUA-BAN:3000/api/webhook/chatwoot` với sự kiện `message_created`.

---

## 🛡️ Hệ Thống Phòng Vệ Anti-Ban 3 Lớp

| Cơ chế | Cách hoạt động | Lợi ích bảo vệ |
| :--- | :--- | :--- |
| **Token Bucket Rate Limiter** | Tự động giãn cách $\ge$ 3 giây giữa mỗi tin nhắn phát đi, tối đa 20 tin/phút. | Triệt tiêu nguy cơ máy chủ phát hiện hành vi gửi tin tự động tốc độ cao. |
| **Self-Echo Shield** | Bộ đệm thời gian thực 30 giây ghi nhớ nội dung tin nhắn bot vừa phát đi. | Chống 100% hiện tượng bot tự nhận tin của chính mình và lặp lại vô tận. |
| **Flood Detector** | Theo dõi lưu lượng tin nhắn đến theo từng người gửi. Nếu > 5 tin trong 3 giây $\rightarrow$ Mute tạm thời 60 giây. | Bảo vệ tiến trình bot không bị treo khi gặp tấn công spam tin nhắn. |
| **Client Canvas Compression** | Tự động nén ảnh phía client (< 0.2s) về mức ~1MB - 2MB trước khi upload. | Giữ RAM máy chủ Node.js luôn < 100MB và tăng tốc độ gửi ảnh tức thì. |

---

## 📚 Cẩm Nang Hướng Dẫn & Tài Liệu Kỹ Thuật (Official Guides)

Các bài viết nghiên cứu chuyên sâu được phát hành chính thức tại Cổng thông tin [aizalo.com/blog/](https://aizalo.com/blog/):

- 🛡️ [Cách Gửi Tin Nhắn Tự Động Trên Zalo Không Bị Khóa (Bí Quyết Anti-Ban 3 Lớp)](https://aizalo.com/blog/cach-gui-tin-nhan-tu-dong-tren-zalo-khong-bi-khoa.html)
- ⚡ [Hướng Dẫn Cách Tạo Chatbot Zalo Cá Nhân Miễn Phí Trong 3 Phút](https://aizalo.com/blog/huong-dan-cach-tao-chatbot-zalo-ca-nhan.html)
- 🧠 [Tích Hợp AI Gemini & DeepSeek Vào Zalo Cá Nhân (Tự Động Bóc Tách Danh Thiếp)](https://aizalo.com/blog/tich-hop-ai-gemini-deepseek-vao-zalo-ca-nhan.html)
- 💼 [Zalo CRM Là Gì? Giải Pháp Quản Lý Tin Nhắn Khách Hàng CSKH 2026](https://aizalo.com/blog/zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh.html)
- 🤖 [Tài Liệu Tóm Tắt Cho AI Crawlers & LLM Agents (`llms.txt`)](https://aizalo.com/llms.txt)

---

## 🗺️ Lộ Trình Nghiên Cứu Cộng Đồng (Community Research Roadmap)

Chúng tôi trân trọng mời cộng đồng lập trình viên cùng tham gia nghiên cứu và hoàn thiện các module:

- [x] **Core Invariants:** Bộ test suite 20/20 PASS 100%, RAM < 100MB, mã hóa phiên AES-256.
- [x] **Chatwoot 2-Way Sync:** Đồng bộ hội thoại và tin nhắn 2 chiều.
- [x] **Universal AI Engine:** Tích hợp Gemini Native, OpenAI, Groq, Ollama với Auto-Fallback Shield.
- [ ] **Community Adapters:**
  - [ ] Adapter kết nối **n8n / Dify.ai / Flowise / Make** qua Generic Webhook.
  - [ ] Adapter cầu nối **Telegram Bot Bridge**.
- [ ] **IoT & Low-Power Deployment:** Tối ưu hóa cài đặt 1-Click trên **Raspberry Pi, Home Assistant & Synology NAS**.
- [ ] **Data Portability:** Tính năng Xuất / Nhập (Export / Import) kho kịch bản tin nhắn mẫu và thẻ tag dưới dạng tệp JSON.

---

## 🤝 Đóng Góp & Trao Đổi Kỹ Thuật

Mọi đóng góp (Pull Request, Báo lỗi, Đề xuất cải tiến kiến trúc) đều được hoan nghênh nhiệt liệt vì mục tiêu học thuật chung:

- 📖 Đọc hướng dẫn đóng góp code: [CONTRIBUTING.md](CONTRIBUTING.md)
- 🗺️ Xem chi tiết lộ trình: [ROADMAP.md](ROADMAP.md)
- 💬 Thảo luận & Hỏi đáp kỹ thuật: [GitHub Discussions](https://github.com/aizaloapp/zalo-flow/discussions)
- 🐛 Báo cáo lỗi: [GitHub Issues](https://github.com/aizaloapp/zalo-flow/issues)
- 📜 Giấy phép: [MIT License with Commons Clause (Phi thương mại)](LICENSE) (Miễn phí cho nghiên cứu, học tập cá nhân & phi thương mại)
