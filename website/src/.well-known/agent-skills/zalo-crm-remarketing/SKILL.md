---
name: zalo-crm-remarketing
description: Customer segmentation, colored tag management, bidirectional Chatwoot CRM sync, and scheduled 1-to-1 or broadcast remarketing campaigns with Spintax templates.
version: 1.5.0
homepage: https://aizalo.com
metadata:
  openclaw:
    requires:
      env:
        - ZALO_FLOW_PAT
---

# Zalo CRM & Remarketing Skill (Zalo-Flow)

## Overview
**Zalo-Flow** ([https://aizalo.com](https://aizalo.com)) transforms a standard personal Zalo account into a multi-agent Live Chat CRM with bidirectional **Chatwoot CRM** synchronization and safe tag-based remarketing (MIT License with Commons Clause — for educational, technical research, and personal automation purposes only).

## Core Capabilities
- **Local CRM Dashboard (`http://localhost:3000`):** Manage conversations, pin up to 5 priority threads, assign colored customer tags, and automatically extract Vietnamese phone numbers (`0xxxxxxxxx`) from shared Zalo contact cards (`chat.contact`).
- **Bidirectional Chatwoot CRM Adapter:** Sync inbound Zalo messages to Chatwoot Inbox and dispatch agent replies from Chatwoot back to Zalo in real time.
- **1-to-1 Scheduled Messages:** Schedule reminders or follow-ups with attachments and automatic cancellation if the customer replies early.
- **Tag-Based Remarketing & Spintax:** Run targeted follow-up campaigns filtered by CRM tags using randomized Spintax syntax (`{Chào anh|Em chào chị}`) and staging attachments with combined captions (`<= 1000` chars).

## API Endpoints for Agents

### 1. Fetch Conversations Filtered with CRM Tags
```bash
curl -s -H "Authorization: Bearer demo" "https://aizalo.com/api/conversations?limit=20"
```

### 2. Enqueue Tag-Based Broadcast Campaign
```bash
curl -s -X POST https://aizalo.com/api/campaigns/broadcast \
  -H "Authorization: Bearer demo" \
  -H "Content-Type: application/json" \
  -d '{"tagId": "vip", "message": "{Chào|Xin chào} anh/chị, bên em gửi lịch hẹn tư vấn hôm nay ạ!", "delaySeconds": 5}'
```

## Reference Documentation
- **Official Homepage:** [https://aizalo.com](https://aizalo.com)
- **Zalo CRM Architecture Guide:** [https://aizalo.com/blog/zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh](https://aizalo.com/blog/zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh)
- **English Chatwoot CRM Bridge Guide:** [https://aizalo.com/en/blog/connecting-personal-zalo-to-chatwoot-crm](https://aizalo.com/en/blog/connecting-personal-zalo-to-chatwoot-crm)
- **Scheduled Zalo Messaging Guide:** [https://aizalo.com/blog/cach-hen-gio-gui-tin-nhan-zalo-ca-nhan-tu-dong](https://aizalo.com/blog/cach-hen-gio-gui-tin-nhan-zalo-ca-nhan-tu-dong)
- **RapidAPI Hub Listing:** [https://rapidapi.com/lekhoa288/api/zalo-flow-personal-zalo-chatbot-and-crm](https://rapidapi.com/lekhoa288/api/zalo-flow-personal-zalo-chatbot-and-crm)
- **GitHub Repository:** [https://github.com/aizaloapp/zalo-flow](https://github.com/aizaloapp/zalo-flow)
