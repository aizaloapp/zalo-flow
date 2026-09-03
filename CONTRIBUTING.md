# 🤝 Hướng Dẫn Đóng Góp Vào Dự Án Zalo-Flow (Contributing Guide)

Cảm ơn bạn đã quan tâm và muốn đóng góp vào **Zalo-Flow**! Dự án là một nỗ lực mã nguồn mở độc lập nhằm xây dựng hạ tầng kết nối Zalo phục vụ học tập và nghiên cứu kỹ thuật.

---

## 🏛️ Quy Tắc Cốt Lõi (Core Principles)

Mọi đóng góp (Pull Request) BẮT BUỘC tuân thủ các nguyên tắc sau:
1. **Phi thương mại & Tôn trọng quyền riêng tư:** Tuyệt đối không thêm mã thu thập dữ liệu (telemetry), telemetry tracking ngầm, hoặc chèn quảng cáo.
2. **Siêu nhẹ (< 100MB RAM Footprint):** Ưu tiên giải pháp tinh gọn, hạn chế tối đa việc cài đặt các dependency nặng nề không cần thiết.
3. **Tuân thủ Anti-Ban:** Mọi luồng gửi tin nhắn bắt buộc phải đi qua `RateLimiter` (giãn cách $\ge$ 3s/tin) và `SelfEchoShield`.
4. **Không làm rò rỉ Secrets:** Tuyệt đối không commit tệp `.env`, `.enc` hoặc token thật vào kho lưu trữ.

---

## 🛠️ Hướng Dẫn: Tự Viết Một Adapter Mới Trong 30 Dòng Code

Kiến trúc Zalo-Flow sử dụng **Adapter Pattern** kế thừa từ `src/adapters/base-adapter.js`. Để tích hợp với nền tảng mới (ví dụ: `n8n`, `Dify`, `Telegram`, `Discord`):

### Bước 1: Tạo tệp Adapter mới trong `src/adapters/my-platform-adapter.js`

```javascript
import { BaseAdapter } from './base-adapter.js';
import { logger } from '../utils/logger.js';
import axios from 'axios';

export class MyPlatformAdapter extends BaseAdapter {
  constructor() {
    super('my-platform');
  }

  // 1. Xử lý khi có tin nhắn từ Zalo gửi đến -> Bắn sang nền tảng của bạn
  async handleInbound({ message, rawEvent }) {
    if (!process.env.MY_PLATFORM_WEBHOOK_URL) return;

    try {
      await axios.post(process.env.MY_PLATFORM_WEBHOOK_URL, {
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        isGroup: message.isGroup,
        threadId: message.threadId,
        timestamp: message.timestamp
      });
    } catch (err) {
      logger.error(`[MyPlatformAdapter] Inbound error: ${err.message}`);
    }
  }

  // 2. Xử lý khi nền tảng của bạn gọi Webhook gửi tin nhắn ngược lại Zalo
  async handleOutbound(req, res, zaloClient) {
    const { threadId, message, isGroup } = req.body;
    if (!threadId || !message) {
      return res.status(400).json({ error: 'Missing threadId or message' });
    }

    try {
      await zaloClient.sendMessage(threadId, message, Boolean(isGroup));
      return res.json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

export const myPlatformAdapter = new MyPlatformAdapter();
```

### Bước 2: Đăng ký Adapter trong `src/index.js`
1. Import adapter vào `src/index.js`.
2. Gọi `myPlatformAdapter.handleInbound(ctx)` bên trong listener `zaloClient.onMessage`.
3. Đăng ký endpoint Express route cho Outbound:
   ```javascript
   app.post('/api/webhook/my-platform', (req, res) => myPlatformAdapter.handleOutbound(req, res, zaloClient));
   ```

---

## 🧪 Quy Trình Gửi Pull Request (PR Workflow)

1. **Fork** repository và tạo nhánh mới từ `main`:
   ```bash
   git checkout -b feature/ten-tinh-nang-moi
   ```
2. **Kiểm tra cú pháp JavaScript & chạy toàn bộ Unit Tests:**
   ```bash
   npm test
   node --check public/app.js
   node --check src/index.js
   ```
   *Yêu cầu:* Toàn bộ 20 bài test phải đạt **100% PASS** và dung lượng RAM < 100MB.
3. **Commit code** với thông điệp rõ ràng theo chuẩn Conventional Commits (ví dụ: `feat(adapter): add generic n8n webhook bridge`).
4. Mở **Pull Request** trên GitHub kèm mô tả chi tiết tính năng đã thay đổi và bằng chứng chạy test thành công.

---

## 💬 Hỗ Trợ & Thảo Luận

Mọi câu hỏi và trao đổi kỹ thuật xin vui lòng đăng trên:
👉 **[GitHub Discussions](https://github.com/aizaloapp/zalo-flow/discussions)**
