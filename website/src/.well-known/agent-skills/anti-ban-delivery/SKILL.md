---
name: anti-ban-delivery
description: Three-layer anti-ban protection for personal Zalo automation including Token Bucket rate limiting, Self-Echo Shield, and Inbound Flood Detection.
---

# Anti-Ban Safe Message Delivery Skill (Zalo-Flow)

## Overview
This skill defines the immutable 3-layer safety architecture enforced by **Zalo-Flow** (`https://aizalo.com/`) to protect personal Zalo accounts from automated restriction.

## Three-Layer Defense Perimeter
1. **Token Bucket Rate Limiter (Outbound Pacing):**
   - Enforces a minimum interval of `>= 3 seconds` between consecutive outbound messages and caps throughput at `<= 20 messages/minute`.
2. **Self-Echo Shield (30-Second Reflection Buffer):**
   - Caches outbound message hashes for 30 seconds to prevent infinite reflection loops when the same account is open on multiple devices.
3. **Inbound Flood Detector (Circuit Breaker):**
   - Automatically mutes a thread for 60 seconds if a sender bursts more than 5 messages within 3 seconds, protecting both the Node.js event loop and LLM API quota.
4. **In-Thread Reply Policy:**
   - Strictly responds only to existing `threadId` conversations initiated by customers; cold spamming to unknown phone numbers is prohibited.

## Reference Documentation
- Anti-Ban Engineering Guide: https://aizalo.com/blog/cach-gui-tin-nhan-tu-dong-tren-zalo-khong-bi-khoa
- Multi-Account Isolation: https://aizalo.com/blog/cach-dang-nhap-nhieu-tai-khoan-zalo-tren-may-tinh
