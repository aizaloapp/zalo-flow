# 🤖 QUY CHUẨN AI HUB, VISION & MÔ HÌNH SUY LUẬN

> **Tài liệu vệ tinh:** Kích hoạt khi Agent can thiệp vào `src/utils/ai-*.js`, Multimodal Vision, Live Model Scanner, cấu hình Prompt hệ thống hoặc xử lý đồng bộ Desktop Daemon.

---

## 🏛️ 1. Bảng Ràng Buộc Kỹ Thuật (Constraint Table)

| Thành Phần | Điều Kiện Kích Hoạt | Hành Động BẮT BUỘC | Điều CẤM KỴ Tuyệt Đối (Invariant) |
| :--- | :--- | :--- | :--- |
| **Model Discovery** | Lấy danh sách mô hình AI | Duy trì **Live Model Scanner** (`POST /api/ai/scan-models`) kết nối API hãng để lấy danh sách thực tế. Hỗ trợ cả key Gemini mới `AQ...` và truyền thống `AIza...`. | TUYỆT ĐỐI KHÔNG ghi cứng danh sách model trong source code. |
| **Key Compatibility**| Chuyển đổi nhà cung cấp AI | Backend BẮT BUỘC khử Base URL cũ qua `resolveEffectiveBaseUrl` và thẩm định tương thích bằng `isKeyCompatible`. | TUYỆT ĐỐI KHÔNG gửi key Google Gemini sang endpoint OpenAI-compatible (OpenRouter, DeepSeek, Groq) và ngược lại (tránh lỗi 401). |
| **History Sequence** | Nạp ngữ cảnh chat cho AI | Lịch sử hội thoại nạp cho AI BẮT BUỘC sắp xếp theo thứ tự thời gian tăng dần (`ASC`). | TUYỆT ĐỐI KHÔNG gọi `.reverse()` làm đảo lộn dòng thời gian hội thoại. |
| **Reasoning Headroom**| Cấu hình mô hình suy luận | Cấu hình `max_tokens >= 2048` kèm fallback bóc tách nội dung suy luận `message.reasoning_content`. | Không đặt `max_tokens` quá thấp khiến LLM suy luận nửa chừng bị cắt cụt. |
| **Vision Override** | Khách gửi ảnh (`images > 0`) | Bảo toàn nguyên vẹn mảng `history` (luân phiên `user` ➔ `model`). Chèn **Chỉ thị đè (Override Directive)** trực tiếp vào tin hiện tại ép LLM quan sát dữ liệu ảnh. | TUYỆT ĐỐI KHÔNG lọc bỏ tin nhắn cũ trong history (gây lỗi HTTP 400 Bad Request). |
| **Vision Hallucination**| Ảnh gửi đến mờ, lóa, thiếu góc | System Prompt BẮT BUỘC yêu cầu bot lịch sự nhờ khách chụp lại cận cảnh rõ nét hơn. | TUYỆT ĐỐI KHÔNG đoán mò số tiền, số điện thoại, mã vận đơn hay thông tin pháp lý. |
| **Vision Stream Guard**| Tải ảnh về nạp vào AI | Hàm `_downloadAndEncodeImage` BẮT BUỘC cấu hình cả 2 tham số Axios: `maxContentLength` VÀ `maxBodyLength: 4MB`. | Ngắt kết nối ngay nếu luồng `chunked` vượt hạn mức, bảo đảm an toàn RAM < 100MB. |
| **Desktop Daemon Sync**| Ứng dụng Desktop đang chạy | Mọi sửa đổi mã nguồn tại thư mục dev BẮT BUỘC đồng bộ (`Copy-Item -Force`) sang `%LOCALAPPDATA%\Programs\ZaloFlow` trước khi restart. | Không restart daemon khi chưa sync file, tránh nạp code cũ gây hiểu lầm kết quả. |
| **Daemon Cwd Isolation**| Khởi chạy Desktop từ installed | Tham số thư mục làm việc (`Cwd`) BẮT BUỘC trỏ vào thư mục cài đặt (`Join-Path $env:LOCALAPPDATA 'Programs\ZaloFlow'`). | Không để Cwd trỏ về dev làm `dotenv` nạp sai file `.env`, sai lệch khóa `SESSION_SECRET`. |
