# CONTEXT.md — Zalo-Flow Domain Glossary & Architecture Concepts

> **Dự án:** Zalo-Flow (AIzalo Community Edition)  
> **Cập nhật:** 2026-09-01  
> **Mục tiêu:** Cầu nối Chatwoot CRM, quản lý hội thoại Zalo cá nhân, tin nhắn nhanh và chiến dịch Remarketing

---

## 1. Thuật Ngữ Nghiệp Vụ (Domain Glossary)

| Thuật ngữ | Định nghĩa & Ý nghĩa trong Zalo-Flow |
| :--- | :--- |
| **Zalo-Flow Core** | Tiến trình Node.js (Express + `zca-js`) đóng vai trò máy chủ điều phối Webhook và cầu nối trung gian giữa tài khoản Zalo cá nhân với Chatwoot CRM và Web Dashboard. |
| **`zca-js`** | Thư viện JavaScript mã nguồn mở mô phỏng giao thức Zalo Web (`chat.zalo.me`), cho phép đăng nhập và gửi/nhận tin nhắn không cần giao diện Chrome nặng. |
| **Adapter Pattern** | Mô hình kiến trúc phần mềm trong đó nền tảng tích hợp Chatwoot kế thừa từ `BaseAdapter` và cô lập lỗi an toàn. |
| **Self-Echo Shield** | Bộ đệm thời gian thực (30s TTL) lưu trữ nội dung tin nhắn bot vừa phát đi nhằm triệt tiêu hiện tượng bot nhận lại chính tin nhắn của mình và tự trả lời lặp vô tận. |
| **Token Bucket Rate Limiter** | Cơ chế hàng đợi thông minh kiểm soát tần suất gửi tin nhắn đi (Outbound), giãn cách ít nhất 3 giây/tin để bảo vệ tài khoản Zalo không bị hạn chế tính năng. |
| **Flood Detector** | Bộ lọc an toàn phát hiện các đợt bùng nổ tin nhắn đến (> 5 tin trong 3 giây) từ một người gửi và tự động mute tạm thời 60 giây để chống treo bot. |
| **Session Encryption** | Cơ chế bảo mật lưu trữ token/cookie Zalo trên ổ đĩa dưới dạng nhị phân mã hóa AES-256-CBC, sử dụng khóa bí mật `SESSION_SECRET`. |
| **Chatwoot 2-Way Sync** | Tính năng đồng bộ tin nhắn 2 chiều: Tin khách gửi trên Zalo tự xuất hiện trên Chatwoot Inbox, và tin nhân viên gõ trên Chatwoot UI tự động gửi về Zalo của khách. |
| **Remarketing Campaigns** | Hệ thống lập lịch và phát thông điệp chăm sóc khách hàng tự động theo thẻ phân loại, hỗ trợ Spintax cá nhân hóa và gửi kèm tệp đính kèm. |

---

## 2. Luồng Dữ Liệu 2 Chiều Cốt Lõi

```
[ Khách hàng Zalo ]
       │
       ▼ (1. Nhắn tin đến Zalo)
[ Zalo-Flow (zca-js Listener) ]
       │
       ├── (2. Qua Flood Shield & Self-Echo Shield)
       │
       └──► [ Chatwoot Inbound Sync ] ──► (Nhân viên thấy hội thoại trên Chatwoot)

[ Nhân viên trên Chatwoot / Admin trên Web UI ]
       │
       ▼ (3. Gửi tin nhắn Outbound)
[ Zalo-Flow Dispatcher ]
       │
       ▼ (4. Xếp hàng qua Rate Limiter giãn cách 3s)
[ Gửi tin nhắn qua Zalo Web API ]
       │
       ▼ (5. Khách nhận tin trên Zalo cá nhân)
[ Khách hàng Zalo ]
```
