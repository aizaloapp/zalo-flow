# Quy Chuẩn Thiết Kế SVG Minh Họa aizalo.com (Design Tokens)

> **Mục tiêu:** Cung cấp thông số màu sắc, font và 3 khung XML wireframe cơ bản để sinh ảnh minh họa vector siêu nét, siêu nhẹ (< 5KB), không phụ thuộc vào API vẽ ảnh ngoài.

---

## 🎨 1. Bảng Màu & Typography Chuẩn
- **Nền chính (Dark Bg):** `#0b1329` (Top/Corner), `#0f172a` (Body/Cards), `#020617` (Deep Base)
- **Màu thương hiệu (Brand Cyan/Blue):** `#0084ff` (Zalo Blue), `#00d2ff` (Neon Cyan)
- **Màu trạng thái (Status Colors):**
  - Thành công / An toàn: `#10b981` (Emerald), `#34d399` (Mint)
  - Cảnh báo / Hẹn giờ: `#f59e0b` (Amber), `#fbbf24` (Gold)
  - Lỗi / Hủy / Cấm: `#ef4444` (Red), `#f87171` (Light Red)
- **Đường viền (Borders):** `#334155` (Slate-700), `#475569` (Slate-600)
- **Typography:** `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"`

---

## 📐 2. Ba Khung Kích Thước Tiêu Chuẩn

### A. Khung Hero Banner (`viewBox="0 0 1200 630"`)
Dùng làm ảnh bìa bài viết (`anh-bia-<slug>.svg`), đặt ngay dưới H1.
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#0b1329"/>
  <!-- Nội dung: Badge chủ đề, Tiêu đề chính 44px, Card UI minh họa Zalo-Flow -->
</svg>
```

### B. Khung Infographic So Sánh (`viewBox="0 0 1000 480"`)
Dùng so sánh 2 hoặc 3 phương pháp (`so-sanh-...svg`).
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 480" width="1000" height="480">
  <rect width="1000" height="480" rx="16" fill="#0b1329" stroke="#334155" stroke-width="1.5"/>
  <!-- 3 cột: width="280", height="320", rx="12", fill="#1e293b" -->
</svg>
```

### C. Khung Mockup Giao Diện / Quy Trình (`viewBox="0 0 1000 450-500"`)
Dùng minh họa giao diện phần mềm hoặc sơ đồ logic (`giao-dien-...svg` hoặc `co-che-...svg`).
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500" width="1000" height="500">
  <rect width="1000" height="500" rx="14" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
  <!-- Topbar 50px với 3 nút tròn đỏ/vàng/xanh, Sidebar 240px, Chat area 695px -->
</svg>
```
