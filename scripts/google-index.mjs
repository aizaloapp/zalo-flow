#!/usr/bin/env node
/**
 * Google Indexing API Automation Script for aizalo.com
 * 
 * Features:
 * - Zero-dependency: Uses native Node.js (>=22.5.0) crypto and fetch
 * - Auto-discovers key file: google-indexing-key.json or service-account.json
 * - Command-line support:
 *     node scripts/google-index.mjs <url1> <url2> ...
 *     node scripts/google-index.mjs --all  (submits all URLs from sitemap.xml)
 *     node scripts/google-index.mjs --status <url> (checks Google Indexing API status)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Locate service account key
const possibleKeyPaths = [
  path.join(rootDir, 'google-indexing-key.json'),
  path.join(rootDir, 'service-account.json'),
  path.join(rootDir, 'service_account.json')
];

let keyPath = possibleKeyPaths.find(p => fs.existsSync(p));
if (!keyPath) {
  console.error('\x1b[31m❌ Lỗi: Không tìm thấy tệp chìa khóa google-indexing-key.json tại thư mục gốc.\x1b[0m');
  console.error('Vui lòng đảm bảo bạn đã đặt tệp google-indexing-key.json tại:', rootDir);
  process.exit(1);
}

const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
if (!keyData.client_email || !keyData.private_key) {
  console.error('\x1b[31m❌ Lỗi: Tệp chìa khóa không hợp lệ (thiếu client_email hoặc private_key).\x1b[0m');
  process.exit(1);
}

// 2. Base64URL helper
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// 3. Obtain Google OAuth2 Access Token via RS256 JWT
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };

  const claimSet = {
    iss: keyData.client_email,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signatureInput);
  const signature = signer.sign(keyData.private_key, 'base64url');

  const jwt = `${signatureInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Không thể lấy Google Access Token (${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// 4. Publish URL notification to Google Indexing API
async function publishUrl(accessToken, url, action = 'URL_UPDATED') {
  const endpoint = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      url,
      type: action
    })
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Google Indexing API Error (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
  }

  return body;
}

// 5. Get URL metadata/status from Google Indexing API
async function getUrlStatus(accessToken, url) {
  const endpoint = `https://indexing.googleapis.com/v3/urlNotifications/metadata?url=${encodeURIComponent(url)}`;
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Google Indexing API Error (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
  }

  return body;
}

// 6. Extract URLs from sitemap.xml
function getSitemapUrls() {
  const sitemapPath = path.join(rootDir, 'website', 'src', 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    throw new Error(`Không tìm thấy sitemap tại ${sitemapPath}`);
  }
  const content = fs.readFileSync(sitemapPath, 'utf8');
  const matches = [...content.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)];
  return matches.map(m => m[1]);
}

// Main CLI logic
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
\x1b[36m🤖 AIZALO GOOGLE INDEXING AUTOMATION CLI\x1b[0m
Sử dụng:
  node scripts/google-index.mjs <url>                   Bắn yêu cầu lập chỉ mục cho 1 hoặc nhiều URL
  node scripts/google-index.mjs --all                   Bắn toàn bộ URL có trong sitemap.xml
  node scripts/google-index.mjs --status <url>          Kiểm tra trạng thái thông báo lập chỉ mục của URL
    `);
    process.exit(0);
  }

  console.log('\x1b[34m🔑 Đang xác thực với Google Cloud bằng Service Account...\x1b[0m');
  console.log(`   Account: \x1b[33m${keyData.client_email}\x1b[0m`);
  
  let accessToken;
  try {
    accessToken = await getAccessToken();
    console.log('\x1b[32m✔️  Đã cấp quyền Google Access Token thành công!\x1b[0m\n');
  } catch (err) {
    console.error('\x1b[31m❌ Lỗi xác thực token:\x1b[0m', err.message);
    process.exit(1);
  }

  // Handle --status
  if (args[0] === '--status') {
    const targetUrl = args[1];
    if (!targetUrl) {
      console.error('\x1b[31m❌ Vui lòng cung cấp URL cần kiểm tra status.\x1b[0m');
      process.exit(1);
    }
    console.log(`🔍 Đang kiểm tra trạng thái của: \x1b[36m${targetUrl}\x1b[0m`);
    try {
      const status = await getUrlStatus(accessToken, targetUrl);
      console.log('\x1b[32m✔️ Trạng thái thông báo từ Google:\x1b[0m');
      console.log(JSON.stringify(status, null, 2));
    } catch (err) {
      console.error('\x1b[31m❌ Lỗi:\x1b[0m', err.message);
    }
    return;
  }

  // Handle URLs or --all
  let urlsToSubmit = [];
  if (args[0] === '--all') {
    urlsToSubmit = getSitemapUrls();
    console.log(`📋 Đã đọc ${urlsToSubmit.length} URLs từ website/src/sitemap.xml`);
  } else {
    urlsToSubmit = args.filter(a => a.startsWith('http://') || a.startsWith('https://'));
  }

  if (urlsToSubmit.length === 0) {
    console.error('\x1b[31m❌ Không có URL hợp lệ nào được cung cấp.\x1b[0m');
    process.exit(1);
  }

  console.log(`🚀 Đang gửi yêu cầu lập chỉ mục (${urlsToSubmit.length} URLs) tới Google Indexing API...\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < urlsToSubmit.length; i++) {
    const url = urlsToSubmit[i];
    process.stdout.write(`[${i + 1}/${urlsToSubmit.length}] ${url} ... `);
    try {
      const result = await publishUrl(accessToken, url, 'URL_UPDATED');
      const time = result.urlNotificationMetadata?.latestUpdate?.notifyTime || 'OK';
      console.log(`\x1b[32m✔️ THÀNH CÔNG (${time})\x1b[0m`);
      successCount++;
    } catch (err) {
      console.log(`\x1b[31m❌ THẤT BẠI: ${err.message}\x1b[0m`);
      failCount++;
    }
    // Giãn cách nhẹ 200ms giữa các request để tránh rate limit
    if (i < urlsToSubmit.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`\n==================================================`);
  console.log(`🎉 HOÀN TẤT: \x1b[32m${successCount} Thành công\x1b[0m | \x1b[31m${failCount} Thất bại\x1b[0m`);
  console.log(`==================================================`);
}

main().catch(err => {
  console.error('\x1b[31mFatal error:\x1b[0m', err);
  process.exit(1);
});
