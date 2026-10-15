---
name: zalo-crm-remarketing
description: Customer segmentation, colored tag management, bidirectional Chatwoot CRM sync, and scheduled 1-to-1 or broadcast remarketing campaigns with Spintax templates.
---

# Zalo CRM & Remarketing Skill (Zalo-Flow)

## Overview
This skill describes how **Zalo-Flow** (`https://aizalo.com/`) transforms a personal Zalo account into a multi-agent Live Chat CRM and safe remarketing engine.

## Core Capabilities
- **Local CRM Dashboard (`localhost:3000`):** Manage conversations, pin up to 5 priority threads, assign colored customer tags, and automatically extract Vietnamese phone numbers (`0xxxxxxxxx`) from shared Zalo contact cards (`chat.contact`).
- **Bidirectional Chatwoot CRM Adapter:** Sync inbound Zalo messages to Chatwoot Inbox and dispatch agent replies from Chatwoot back to Zalo in real time.
- **1-to-1 Scheduled Messages:** Schedule reminders or follow-ups with attachments and automatic cancellation if the customer replies early.
- **Tag-Based Remarketing & Spintax:** Run targeted follow-up campaigns filtered by CRM tags using randomized Spintax syntax (`{Chào anh|Em chào chị}`) and staging attachments with combined captions (`<= 1000` chars).

## Reference Documentation
- Zalo CRM Overview: https://aizalo.com/blog/zalo-crm-la-gi-giai-phap-quan-ly-tin-nhan-cskh
- English Chatwoot Guide: https://aizalo.com/en/blog/connecting-personal-zalo-to-chatwoot-crm
- Scheduled Messaging Guide: https://aizalo.com/blog/cach-hen-gio-gui-tin-nhan-zalo-ca-nhan-tu-dong
