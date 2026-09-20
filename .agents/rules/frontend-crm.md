# 🎨 CHUẨN GIAO DIỆN FRONTEND, CRM & TRẢI NGHIỆM NGƯỜI DÙNG

> **Tài liệu vệ tinh:** Kích hoạt khi Agent can thiệp vào `public/**`, `public/app.js`, `public/styles.css`, `public/index.html`, `public/i18n.js`, hệ thống Modal, Drawer CRM, hoặc bộ dựng chat.

---

## 🏛️ 1. Bảng Ràng Buộc Kỹ Thuật (Constraint Table)

| Thành Phần | Điều Kiện Kích Hoạt | Hành Động BẮT BUỘC | Điều CẤM KỴ Tuyệt Đối (Invariant) |
| :--- | :--- | :--- | :--- |
| **Chat Bubble Rich Component** | Nhúng thẻ HTML phức tạp vào bong bóng chat | Thẻ con bên trong BẮT BUỘC có `white-space: normal !important;` và `line-height: 1.35;`. | TUYỆT ĐỐI KHÔNG để newline hoặc thụt dòng thừa làm vỡ layout của cha (`.bubble-content` vốn dùng `pre-wrap`). |
| **Avatar CDN Zalo** | Thẻ `<img>` hiển thị avatar `*.zadn.vn` | BẮT BUỘC có thuộc tính `referrerpolicy="no-referrer"`. | TUYỆT ĐỐI KHÔNG bỏ thuộc tính này vì sẽ bị Zalo trả lỗi HTTP 403 Forbidden. |
| **Avatar Fallback** | Thẻ ảnh avatar nhóm/chat | Bắt buộc có: `onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';"`. | Không để lộ icon ảnh vỡ khi CDN Zalo hết hạn hoặc lỗi. |
| **Multer Upload Handler** | Endpoint nhận tệp (Chat, Campaign, QuickMsg) | BẮT BUỘC bọc trong middleware an toàn `upload.any()(req, res, (err) => ...)` và luôn trả JSON `{ error: err.message }` status 400. | TUYỆT ĐỐI KHÔNG để lỗi rơi vào Express default handler trả về trang HTML 500. |
| **Frontend Upload Client** | Gửi form Multipart từ trình duyệt | Dùng `res.text() ➔ JSON.parse()` trong khối `try...catch` an toàn. Luôn đính kèm `x-admin-token` và custom header `X-ZaloFlow-Client: 1`. | CẤM gọi trực tiếp `res.json()` mà không try/catch (gây lỗi sập cú pháp `Unexpected token '<'`). |
| **Caret Insertion**| Chèn biến mẫu (`{name}`, `{time}`) | Dùng `selectionStart`/`selectionEnd`, `setSelectionRange`, và `dispatchEvent(new Event('input'))`. | TUYỆT ĐỐI KHÔNG dùng phép cộng dồn chuỗi thô `+=` làm nhảy con trỏ về cuối. |
| **Modal Hierarchy** | Thêm tính năng phụ trong modal phức tạp | Thiết kế dạng **In-Place Collapsible Drawer** hoặc **Slide-Down Tray** nằm gọn bên trong form. | TUYỆT ĐỐI KHÔNG mở Modal tầng 2, tầng 3 (Modal on Modal) đè lên nhau gây lỗi z-index và cuộn. |
| **Conversation Pinning** | Ghim hội thoại lên đầu | Khóa cứng tối đa 5 cuộc trò chuyện (`isPinned = 1`). Tin mới ghim dùng `convListEl.prepend()`, tin không ghim dùng `lastPinned.after()`. | Chặn thao tác ghim thứ 6 ở cả frontend và backend; không cho tin thường nhảy đè lên tin ghim. |
| **Dual-Theme Tokens**| Màu sắc giao diện Sáng / Tối | Dùng 100% CSS Variables ngữ nghĩa (`var(--bg-sidebar)`, `var(--text-main)`, `var(--border)`). | TUYỆT ĐỐI KHÔNG ghi cứng mã màu tối (`#0f172a`, `#1e293b`, `rgba(15, 23, 42, ...)`). |
| **Active Contrast**| Hội thoại đang chọn (`.conv-card.active`) | Nền xanh nhạt `#e0f2fe` ở theme Sáng BẮT BUỘC đi kèm chữ tương phản cao (`color: var(--primary); font-weight: 700;`). | Không dùng chữ mờ/trắng trên nền sáng gây khó đọc. |
| **Zero Form Reset i18n**| Đổi ngôn ngữ `VI` ⟷ `EN` | Đi qua `applyLanguageToDOM` cập nhật tại chỗ (`data-i18n`, `data-i18n-placeholder`). Đối soát 1:1 từ điển `DICTIONARY`. | TUYỆT ĐỐI KHÔNG reload trang hoặc render lại toàn bộ component làm mất dữ liệu đang gõ dở. |
| **Quality Gates AST**| Sau mỗi lần sửa `public/app.js` | BẮT BUỘC chạy `node --check public/app.js` và `npm test` bảo đảm 100% pass. | CẤM commit khi có hàm/biến trùng tên (`Identifier has already been declared`) hoặc thừa ngoặc. |
| **Event Stream Completeness** | Kết nối WebSocket / EventSource fallback (`fallbackToSSE`) | BẮT BUỘC đăng ký đầy đủ các sự kiện pool tài khoản: `accounts_updated`, `account_added`, `account_removed`, `active_account_switched`, `account_add_qr`. | TUYỆT ĐỐI KHÔNG bỏ sót các sự kiện cập nhật tài khoản làm giao diện bị đơ/lệch pha trạng thái online. |
| **Resilient Data Unwrapping** | Hàm Frontend gọi API nhận danh sách (như `/api/accounts`) | BẮT BUỘC bọc an toàn 3 tầng: `Array.isArray(res.data) ? res.data : (res.data.accounts || res.data.payload || [])`. | TUYỆT ĐỐI KHÔNG giả định cứng một tầng thuộc tính duy nhất làm gán mảng rỗng `[]` khi API nâng cấp. |

---

## 🛡️ 2. Quy Chuẩn Trực Quan & Bảo Vệ Trải Nghiệm (UX Invariants)

### 1. Zalo Desktop Chat Typography & Bubble Ergonomics
- Nội dung tin nhắn chat chuẩn hóa cỡ chữ `0.88rem` (tương đương 14px), khoảng cách dòng `line-height: 1.45`, bo góc `12px` và padding `9px 13px`.
- Không đặt `font-size >= 0.95rem` cho tin nhắn thông thường.

### 2. Group Sender Ergonomics & Color Hashing
- Tin nhắn đến trong nhóm chat BẮT BUỘC hiển thị Tên thành viên rõ nét phía trên và Avatar tròn 28px bên cạnh bong bóng chat.
- Màu tên thành viên và avatar chữ cái viết tắt BẮT BUỘC ánh xạ qua CSS Data Attribute `data-sender-color="0..9"` với 10 biến CSS ngữ nghĩa (`--sender-color-0` đến `--sender-color-9`).

### 3. Zalo OA Policy & Local Name Immunity Contract
- Zalo Cloud áp dụng mã lỗi `-224` (`The OA needs to upgrade OA Tier Package`) chặn API profile của gói Cơ bản 0đ.
- Hệ thống BẮT BUỘC cung cấp ô nhập Tên gợi nhớ trong CRM Drawer (`#crm-name-input`) lưu trực tiếp vào cột `name` của bảng `conversations`.
- Khi cuộc trò chuyện đã có tên người dùng tùy biến hoặc tên khác tiền tố `Khách OA`, hệ thống TUYỆT ĐỐI KHÔNG được ghi đè tên tạm bợ lên giao diện.

### 4. Zero-Residue OA Clean Disconnect & Channel Isolation
Khi ngắt kết nối OA (`POST /api/oa/disconnect`) hoặc chuyển app sang `personal_only`:
- Tự động phát hiện và chấm dứt tiến trình tunnel nền (`cloudflared`).
- Ẩn nút trên thanh điều hướng (`#rail-btn-oa`) và nút lọc nhanh (`.quick-tab[data-quick-filter="oa"]`).
- Làm sạch triệt để các hội thoại và tin nhắn mẫu kênh OA (`channel = 'oa'` hoặc `id LIKE 'oa_%'`).

### 5. Optimistic Media Deduplication & Empty-Caption Immunity
- Khi gửi hình ảnh/tệp không có chữ (`text = ''`), tin nhắn tạm (`tempMsg`) BẮT BUỘC mang `text = ''` và `type = 'image'` (hoặc `file`).
- Bộ nhận diện SSE `new_message` khi xóa tin nhắn tạm BẮT BUỘC so khớp kết hợp: `temp.type === item.type`, `temp.mediaType === item.mediaType`, và thời gian chênh lệch `<= 5000ms`, triệt tiêu hoàn toàn hiện tượng nhân đôi bong bóng tin nhắn.

### 6. Obsidian Knowledge Graph Topology & Progressive Disclosure
- **Triệt tiêu nhiễu thẻ (#tags):** Đồ thị tri thức (Knowledge Graph Canvas) BẮT BUỘC lọc sạch các nốt thẻ phân loại (`!node.isTag && !node.id.startsWith('tag:')`), chỉ hiển thị các nốt bài viết thực thụ.
- **Tab-first:** Sơ đồ tích hợp trực tiếp dưới dạng Tab chuyên trách (`👁️ Đọc` | `📝 Sửa` | `🕸️ Sơ Đồ`), không dùng Pop-up Modal che khuất.
- **Non-Technical Progressive Disclosure:** Ẩn các trường kỹ thuật sâu (Model Ghi Đè, Slug CSDL) vào khay `⚙️ Nâng cao`. Bóc tách sạch khối YAML Frontmatter khỏi chế độ Đọc.
- **Collapsible Instruction Trays:** Khung dạy bot/tải tài liệu BẮT BUỘC thiết kế dưới dạng ngăn kéo gấp gọn (Accordion Drawer) chiếm <= 40px chiều cao mặc định.

### 7. Mobile Modal & Form Ergonomics (Bất Biến Giao Diện Di Động)
Khi tối ưu giao diện màn hình hẹp (`@media (max-width: 768px)`):
- **Full-Bleed Overlay Zero-Padding:** Lớp phủ `.modal-overlay` BẮT BUỘC có `padding: 0 !important;` trên mobile để modal-dialog tận dụng 100% màn hình, không để lộ viền thừa 2 bên.
- **iOS Safari Toolbar Safe-Area:** Chiều cao modal full-screen BẮT BUỘC khai báo: `height: 100vh; height: 100dvh; max-height: -webkit-fill-available;` triệt tiêu 100% lỗi thanh điều hướng Safari che nút chân trang.
- **Sticky Footer Keyboard Guard:** Chân trang modal (`.modal-footer`) BẮT BUỘC có `position: sticky; bottom: 0; z-index: 10;` kết hợp `overflow-y: auto` cho `.modal-body`. Khi bàn phím ảo xuất hiện, nút CTA chính không bao giờ bị đẩy trôi ra ngoài màn hình.
- **Separation of Concerns (Anti-Inline Style Grid):** TUYỆT ĐỐI KHÔNG dùng inline `style="display: grid; grid-template-columns: ..."` trên các form chính trong `index.html`. BẮT BUỘC định nghĩa class ngữ nghĩa riêng (ví dụ: `.ai-engine-grid`, `.ai-profile-meta-row`) để CSS responsive có thể chuyển đổi mượt sang 1 cột dạng thẻ (Stack-to-Column / Table-to-Cards).
- **Zero-Hardcoded Color in JS Templates:** Tuyệt đối không gán cứng mã màu sáng `#fff` hoặc `#f8fafc` trong các hàm render HTML của `app.js`. Bắt buộc dùng biến ngữ nghĩa `color: var(--text-main)`.
