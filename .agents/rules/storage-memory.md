# 💾 QUẢN TRỊ BỘ NHỚ, SQLITE & WATCHDOG PROTOCOL

> **Tài liệu vệ tinh:** Kích hoạt khi Agent can thiệp vào `src/utils/local-store.js`, CSDL SQLite, Cron Job, xử lý bộ đệm buffer hoặc tối ưu hóa bộ nhớ RAM.

---

## 🏛️ 1. Bảng Ràng Buộc Kỹ Thuật (Constraint Table)

| Thành Phần | Điều Kiện Kích Hoạt | Hành Động BẮT BUỘC | Điều CẤM KỴ Tuyệt Đối (Invariant) |
| :--- | :--- | :--- | :--- |
| **Memory Watchdog** | Giám sát tài nguyên RAM | Hạn mức Node.js: **350MB** (cảnh báo tại **263MB**). Docker limit: **512MB**. | TUYỆT ĐỐI KHÔNG để RAM vượt quá hạn mức gây sập Docker container OOM Kill. |
| **Graceful Restart** | Khi chạm ngưỡng trần RAM | Tuần tự: (1) Bắn SSE báo Web UI; (2) Chờ `RateLimiter.drainAll()` xả hết queue (max 5s); (3) Gọi `PRAGMA wal_checkpoint(TRUNCATE)` qua `localStore.close()` rồi mới thoát. | CẤM thoát đột ngột (`process.exit(1)`) mà chưa flush WAL hoặc còn tin nhắn dở dang trong queue. |
| **Schema Drift** | Khởi tạo CSDL SQLite | BẮT BUỘC dùng `PRAGMA table_info` quét và bổ sung cột còn thiếu một cách lũy tích. | Không dùng câu lệnh tạo lại bảng kiểu destructive; luôn dùng cột `text` cho nội dung tin nhắn (`m.text \|\| m.content`). |
| **DateTime Literal** | Mọi câu truy vấn SQLite | Các hàm thời gian BẮT BUỘC dùng nháy đơn literal: `datetime('now')` hoặc `CURRENT_TIMESTAMP`. | TUYỆT ĐỐI KHÔNG dùng nháy kép `datetime("now")` vì SQLite sẽ hiểu nhầm thành cột dữ liệu. |
| **Anti-N+1 Query** | Truy vấn danh sách có gắn tags | BẮT BUỘC dùng **Two-Step Batch Fetching**: Bước 1 phân trang `LIMIT ? OFFSET ?`; Bước 2 dùng `WHERE ct.threadId IN (...)` gom bằng `Map`. | TUYỆT ĐỐI KHÔNG thực hiện N câu query con lặp lại trong vòng lặp `for/map`. |
| **High-Freq Batching**| Sự kiện `delivered_messages` | Gom nhóm trong bộ đệm `Map<threadId, Set<msgId>>` và xả định kỳ mỗi 3s (`flushDeliveredBuffer`). | Không ghi trực tiếp từng event vào SQLite gây nghẽn I/O đĩa cứng. |
| **History Unread** | Nạp tin nhắn cũ WebSocket | Bỏ qua việc tăng `unreadCount` (`!silent && !isHistory && isNew && !isSelf && !isBot`), không ghi đè `lastTime` lùi về quá khứ. | Không làm nhảy số tin chưa đọc khi đồng bộ lịch sử cũ. |
| **Canvas Compression**| Tải ảnh từ Client | HTML5 Canvas nén ảnh chuẩn Zalo HD 2560px/90% (<1.5MB) trước khi upload. | Không upload ảnh thô 20-50MB lên server làm nghẽn RAM. |
| **Temp File Cleanup** | Endpoint nhận file Multer | Giới hạn dung lượng 25MB, BẮT BUỘC dọn file tạm bằng `fs.unlinkSync` trong khối `finally`. | Không để sót file tạm mồ côi trong thư mục `temp/` làm đầy ổ đĩa. |

---

## 🛡️ 2. Quy Chuẩn Tài Khoản & Đối Soát Ground-Truth

### 1. Account Switching Whitelist Contract
Khi người dùng chuyển đổi nick Zalo hoặc làm mới phiên (`cleanSwitchAccountData`):
- Chỉ xóa các bảng: `conversations`, `messages`, `conversation_tags`.
- **Whitelist BẢO TỒN 100%:** `ai_settings`, `tags`, `quick_messages`, `campaigns`, `ai_profiles`, `second_brain_articles`, `oa_settings`.
- Hủy toàn bộ tin nhắn trạng thái `pending` trong `campaign_queue` và đặt `isEnabled = 0` cho các chiến dịch.

### 2. Campaign Test Dispatch Isolation (Delta = 0)
- Khi gửi thử nghiệm 1 tin nhắn chiến dịch (`POST /api/campaigns/test-send`):
  - BẮT BUỘC kiểm tra sự tồn tại của hội thoại trong CSDL bằng `localStore.getConversation(threadId)`. Nếu chưa từng nhắn tin, lập tức từ chối `400 Bad Request` chống khóa nick.
  - **Zero-Contamination Boundary:** Lệnh gửi thử nghiệm TUYỆT ĐỐI KHÔNG chèn bản ghi vào `campaign_queue`, KHÔNG ghi vào `campaign_logs`, và KHÔNG làm thay đổi bất kỳ chỉ số thống kê nào của chiến dịch thật.

### 3. Ground-Truth Group Reconciliation & Anti-Downgrade Contract
- **Ground-Truth từ Zalo API:** Trạng thái nhóm BẮT BUỘC lấy từ `this.api.getAllGroups()` (`this.groupUids`) làm chân lý. Tuyệt đối KHÔNG đếm số lượng `senderId` trong SQLite để gán nhóm.
- **Tự chữa lành Ground-Truth có phạm vi (Account-Scoped):** Hàm đối soát BẮT BUỘC nhận tham số `accountUid` và chỉ đối soát các hội thoại thuộc quyền sở hữu của UID đó (`WHERE accountUid = ?`). TUYỆT ĐỐI KHÔNG đối soát toàn cục làm hạ cờ nhóm (`isGroup = 0`) của nick khác.
- **Khóa cờ bất biến (Anti-Downgrade):** Trong luồng `upsertConversation` realtime, duy trì khóa `ON CONFLICT(id) DO UPDATE SET isGroup = CASE WHEN conversations.isGroup = 1 THEN 1 ELSE excluded.isGroup END`.
