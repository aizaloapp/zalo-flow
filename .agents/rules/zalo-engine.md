# ⚡ GIAO THỨC ZALO, MEDIA & ANTI-BAN PROTOCOL

> **Tài liệu vệ tinh:** Kích hoạt khi Agent can thiệp vào `src/zalo/**`, `src/utils/zalo-client.js`, `src/utils/account-manager.js`, `src/routes/chat.js` hoặc các tác vụ gửi/nhận tin nhắn, xử lý media và chống khóa nick Zalo.

---

## 🏛️ 1. Bảng Ràng Buộc Kỹ Thuật (Constraint Table)

| Thành Phần | Điều Kiện Kích Hoạt | Hành Động BẮT BUỘC | Điều CẤM KỴ Tuyệt Đối (Invariant) |
| :--- | :--- | :--- | :--- |
| **Anti-Ban 3 Lớp** | Gửi tin nhắn outbound | Đi qua `RateLimiter` (giãn cách $\ge 3\text{s}$, max 20 tin/phút) và `SelfEchoShield` (30s buffer). | TUYỆT ĐỐI KHÔNG gửi cold outbound tới ID lạ; không gửi dồn dập vượt rate limit. |
| **Flood Inbound** | Khách nhắn liên tục | Nhận quá 5 tin trong 3s ➔ kích hoạt `FloodDetector` mute 60s. | Không phản hồi tự động trong thời gian đang bị mute. |
| **Dual-ID Binding** | Reactions, Undo/Recall, Trích dẫn Quote | BẮT BUỘC truyền đủ cả hai: `dest.data.msgId` và `dest.data.cliMsgId`. | TUYỆT ĐỐI KHÔNG gán `cliMsgId = msgId` vì sẽ làm app di động không thể ánh xạ. |
| **Media Dispatch** | Gửi ảnh / tệp qua `zca-js` | Gọi `api.sendMessage({ msg: '', attachments: paths }, threadId, type)`. Chuẩn hóa đường dẫn Windows sang POSIX: `.replace(/\\/g, '/')`. | KHÔNG gọi riêng lẻ `uploadAttachment()`; không để đường dẫn Windows dấu gạch chéo ngược `\`. |
| **Image Metadata** | Chuẩn bị tệp ảnh | Hàm `imageMetadataGetter` BẮT BUỘC trả về đủ `{ size, width, height }`. | Không bỏ trống width/height gây crash bộ dựng Zalo. |
| **Batch Attachments**| Gửi nhiều file đính kèm | Lưu thành từng bản ghi tin nhắn độc lập (`localStore.addMessage`, cách nhau +50ms). | Không gộp chung nhiều file vào 1 bản ghi làm lỗi thẻ hiển thị. |
| **Smart Caption** | Có đúng 1 ảnh + nội dung chữ $\le 1000$ ký tự | Gộp caption: gọi `uploadAttachment` truyền kèm `{ caption: personalizedMessage }`. | Khi có $> 1$ ảnh HOẶC text $> 1000$ ký tự: CẤM gộp, BẮT BUỘC gửi text trước, gửi file sau. |
| **Multi-Account** | Outbound trong concurrent pool | Phân giải client qua `getResolvedClient(req, threadId)` theo 3 tầng ưu tiên. | TUYỆT ĐỐI KHÔNG gọi trực tiếp instance mặc định `zaloClient`. |
| **Test Session Isolation** | Viết / Chạy Unit Test kiểm thử xóa tài khoản | BẮT BUỘC cô lập `sessionsDir` sang thư mục test riêng biệt (ví dụ: `data/test_sessions_isolation/`). | TUYỆT ĐỐI KHÔNG để test trỏ vào thư mục `sessions/` production làm xóa nhầm file session `.enc` thật của người dùng. |
| **Singleton ↔ Pool Sync** | Khôi phục session / Đăng nhập QR thành công | `zaloClient` BẮT BUỘC phát sự kiện `login_success` và tự động liên kết vào `accountManager.clients.set(uid, zaloClient)`, đồng thời broadcast `accounts_updated`. | TUYỆT ĐỐI KHÔNG để trạng thái đăng nhập của `zaloClient` bị cô lập khỏi `accountManager.getAllProfiles()`. |

---

## 🛡️ 2. Quy Chuẩn Xử Lý Danh Thiếp & Tệp Tin (Data Sanitization)

### 1. Contact Card Sanitization & Dual-Entity Isolation
- Khi nhận tin nhắn danh thiếp (`chat.contact`, `share_contact`, `view_profile`):
  - Lọc bỏ chuỗi JSON thô ra khỏi tên liên hệ (`isCleanName`).
  - Tự động trích xuất dự phòng `phone` (chuẩn hóa `+84` ➔ `0`) và nạp link ảnh mã QR vào `mediaUrl`.
  - **Dual-Entity Isolation Invariant:** Tuyệt đối không gộp `data.dName` (người gửi/chia sẻ) vào tên người trên danh thiếp (`title`/`name`) để tránh làm nhiễu ngữ cảnh hiểu của Bot AI.

### 2. Inbound File Resolution & Mobile Markdown Sanitization
- Tự động nhận diện tin nhắn tệp (`chat.file`, `sharefile` hoặc phần mở rộng tài liệu) để gán `type: 'file'` kèm phân giải `mediaUrl` cho nút tải xuống.
- Tin nhắn Bot AI gửi đi BẮT BUỘC đi qua `cleanForZalo(text)`:
  - Chuyển đổi `**tiêu đề**` thành biểu tượng trực quan (`🔹`, `•`).
  - Gỡ bỏ backticks thô để hiển thị đẹp mắt trên app di động.
  - Bot luôn dispatch kèm `isBot: true` và lưu đúng 1 bản ghi vào CSDL.

### 3. Zalo Real Profile Identity & SQLite Fallback
- Khi gọi `api.fetchAccountInfo()`, trích xuất theo thứ tự: `res?.profile?.displayName` ➔ `name` ➔ `zaloName` ➔ `userProfile.displayName`.
- Nếu API Zalo phản hồi chậm hoặc thiếu dữ liệu, BẮT BUỘC truy vấn ngược CSDL SQLite cục bộ (bảng `messages` theo UID) để lấy `senderName` và `avatar` thật của chính chủ.
- **Invariant:** TUYỆT ĐỐI KHÔNG ghi đè tên tạm bợ `Zalo User (...)` lên giao diện người dùng.

### 4. Stranger Auto-Identity Resolution & Name Protection
- Khi nhận tin nhắn từ người lạ chưa có trong danh bạ, hệ thống chủ động gọi phân giải thông tin định danh và cập nhật vào `conversations`.
- Khi người dùng đã đặt tên tùy biến gợi nhớ trong CRM Drawer, tuyệt đối không bị ghi đè bởi tên thô từ Zalo.

### 5. Singleton ↔ Multi-Account Pool Bi-directional Reconciliation
- Hệ thống hỗ trợ song song Single-Account (`zaloClient`) và Multi-Account Pool (`accountManager`).
- Trong hàm `accountManager.getAllProfiles()`, hệ thống BẮT BUỘC tự động đối soát với `zaloClient`: nếu tài khoản trong CSDL trùng UID hoặc là tài khoản mặc định và `zaloClient.isLoggedIn === true`, BẮT BUỘC liên kết instance vào pool và trả về `status: 'online'`, `isLoggedIn: true`.
- Khi chạy kiểm thử Unit / Integration, BẮT BUỘC cấu hình `sessionsDir` sang `data/test_sessions_isolation/` để bảo vệ an toàn tuyệt đối các tệp session người dùng thật.
