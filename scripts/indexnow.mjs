#!/usr/bin/env node
/**
 * IndexNow Automation Script for aizalo.com (Bing, ChatGPT Search, Yandex, Naver)
 * 
 * Features:
 * - Zero-dependency: Uses native Node.js fetch
 * - Fast multi-engine distribution via api.indexnow.org
 * - Supports:
 *     node scripts/indexnow.mjs <url1> <url2> ...
 *     node scripts/indexnow.mjs --all  (submits all URLs from sitemap.xml)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const HOST = 'aizalo.com';
const KEY = 'a0e5b1274f8c49d89326d18a39b4f7e2';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

// Extract URLs from sitemap.xml
function getSitemapUrls() {
  const sitemapPath = path.join(rootDir, 'website', 'src', 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    throw new Error(`Không tìm thấy sitemap tại ${sitemapPath}`);
  }
  const content = fs.readFileSync(sitemapPath, 'utf8');
  const matches = [...content.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)];
  return matches.map(m => m[1]);
}

async function submitToIndexNow(urls) {
  console.log(`🚀 Đang gửi ${urls.length} URLs tới IndexNow API (${INDEXNOW_ENDPOINT})...`);
  console.log(`   Host: \x1b[36m${HOST}\x1b[0m`);
  console.log(`   Key Location: \x1b[33m${KEY_LOCATION}\x1b[0m\n`);

  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls
  };

  const endpoints = [
    { name: 'IndexNow Hub (Multi-Engine)', url: 'https://api.indexnow.org/indexnow' },
    { name: 'Microsoft Bing (ChatGPT Search & Copilot)', url: 'https://www.bing.com/indexnow' }
  ];

  for (const ep of endpoints) {
    process.stdout.write(`📡 Đang gửi tới ${ep.name}... `);
    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      if (res.status === 200) {
        console.log(`\x1b[32m✔️ 200 OK (Thành công - Đã lập chỉ mục tức thì)\x1b[0m`);
      } else if (res.status === 202) {
        console.log(`\x1b[33m✔️ 202 Accepted (Đã tiếp nhận vào hàng đợi xử lý)\x1b[0m`);
      } else {
        const text = await res.text();
        console.log(`\x1b[31m❌ ${res.status}: ${text}\x1b[0m`);
      }
    } catch (err) {
      console.log(`\x1b[31m❌ Lỗi mạng: ${err.message}\x1b[0m`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
\x1b[36m🤖 AIZALO INDEXNOW (BING & CHATGPT SEARCH) CLI\x1b[0m
Sử dụng:
  node scripts/indexnow.mjs <url>                      Bắn yêu cầu IndexNow cho 1 hoặc nhiều URL
  node scripts/indexnow.mjs --all                      Bắn toàn bộ URL có trong sitemap.xml
    `);
    process.exit(0);
  }

  let urls = [];
  if (args[0] === '--all') {
    urls = getSitemapUrls();
    console.log(`📋 Đã đọc ${urls.length} URLs từ website/src/sitemap.xml`);
  } else {
    urls = args.filter(a => a.startsWith('http://') || a.startsWith('https://'));
  }

  if (urls.length === 0) {
    console.error('\x1b[31m❌ Không có URL hợp lệ nào được cung cấp.\x1b[0m');
    process.exit(1);
  }

  await submitToIndexNow(urls);
}

main().catch(err => {
  console.error('\x1b[31mFatal error:\x1b[0m', err);
  process.exit(1);
});
