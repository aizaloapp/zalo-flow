import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'website', 'src');

console.log('🚀 Bắt đầu script tự động vá thẻ Social Preview Cards (Rule 8)...');

// Helper to extract meta property/name
function getMeta(content, prop) {
  const re1 = new RegExp(`<meta\\s+[^>]*?(?:property|name)=["']${prop}["'][^>]*?content=["']([^"']*?)["']`, 'i');
  const m1 = content.match(re1);
  if (m1) return m1[1];
  const re2 = new RegExp(`<meta\\s+[^>]*?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${prop}["']`, 'i');
  const m2 = content.match(re2);
  return m2 ? m2[1] : null;
}

let modifiedCount = 0;

// 1. Fix Blog files in website/src/blog and website/src/en/blog
function fixBlogDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.html'));

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // Check if twitter:card already exists
    if (content.includes('name="twitter:card"') || content.includes("name='twitter:card'")) {
      console.log(`   ⏭️  [Đã có] ${path.relative(rootDir, fullPath)}`);
      continue;
    }

    const ogTitle = getMeta(content, 'og:title');
    const ogDesc = getMeta(content, 'og:description');
    const ogImg = getMeta(content, 'og:image');

    if (!ogTitle || !ogImg) {
      console.warn(`   ⚠️ Thiếu og:title hoặc og:image trong ${file}`);
      continue;
    }

    const twitterBlock = `
  <!-- Twitter Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDesc || ogTitle}">
  <meta name="twitter:image" content="${ogImg}">`;

    // Insert after og:image or og:locale or Open Graph block
    let replaced = false;
    const ogImageRegex = /(<meta\s+[^>]*?property=["']og:image["'][^>]*?>)/i;
    if (ogImageRegex.test(content)) {
      content = content.replace(ogImageRegex, `$1${twitterBlock}`);
      replaced = true;
    } else {
      // fallback insert before </head>
      content = content.replace('</head>', `${twitterBlock}\n</head>`);
      replaced = true;
    }

    if (replaced) {
      fs.writeFileSync(fullPath, content, 'utf8');
      console.log(`   ✅ [Đã vá Twitter 4 thẻ] ${path.relative(rootDir, fullPath)}`);
      modifiedCount++;
    }
  }
}

fixBlogDirectory(path.join(srcDir, 'blog'));
fixBlogDirectory(path.join(srcDir, 'en', 'blog'));

// 2. Fix guide.html
const guidePath = path.join(srcDir, 'guide.html');
if (fs.existsSync(guidePath)) {
  let content = fs.readFileSync(guidePath, 'utf8');
  if (!content.includes('property="og:type"')) {
    const socialBlock = `
  <!-- Open Graph / Facebook / Zalo Share -->
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://aizalo.com/guide">
  <meta property="og:site_name" content="AIzalo — Zalo-Flow">
  <meta property="og:title" content="Hướng Dẫn Cài Đặt & Sử Dụng AIzalo Flow Companion | AIzalo.com">
  <meta property="og:description" content="Hướng dẫn chi tiết cách cài đặt và sử dụng tiện ích mở rộng Chrome Extension AIzalo Flow: Chat Companion kết nối Zalo Web với Zalo-Flow để gõ tin nhắn mẫu và gợi ý AI.">
  <meta property="og:image" content="https://aizalo.com/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="vi_VN">

  <!-- Twitter Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Hướng Dẫn Cài Đặt & Sử Dụng AIzalo Flow Companion | AIzalo.com">
  <meta name="twitter:description" content="Hướng dẫn chi tiết cách cài đặt và sử dụng tiện ích mở rộng Chrome Extension AIzalo Flow: Chat Companion kết nối Zalo Web với Zalo-Flow để gõ tin nhắn mẫu và gợi ý AI.">
  <meta name="twitter:image" content="https://aizalo.com/assets/og-image.png">
`;
    content = content.replace(/(<link\s+rel=["']canonical["'][^>]*?>)/i, `$1${socialBlock}`);
    fs.writeFileSync(guidePath, content, 'utf8');
    console.log(`   ✅ [Đã vá bộ thẻ 4x4] website/src/guide.html`);
    modifiedCount++;
  }
}

// 3. Fix privacy-extension.html
const privacyPath = path.join(srcDir, 'privacy-extension.html');
if (fs.existsSync(privacyPath)) {
  let content = fs.readFileSync(privacyPath, 'utf8');
  // Also clean canonical url
  content = content.replace('href="https://aizalo.com/privacy-extension.html"', 'href="https://aizalo.com/privacy-extension"');
  if (!content.includes('property="og:type"')) {
    const socialBlock = `
  <!-- Open Graph / Facebook / Zalo Share -->
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://aizalo.com/privacy-extension">
  <meta property="og:site_name" content="AIzalo — Zalo-Flow">
  <meta property="og:title" content="Chính Sách Quyền Riêng Tư — AIzalo Flow Companion | AIzalo.com">
  <meta property="og:description" content="Chính sách quyền riêng tư và cam kết bảo vệ dữ liệu người dùng của tiện ích mở rộng AIzalo Flow: Chat Companion (Chrome Extension).">
  <meta property="og:image" content="https://aizalo.com/assets/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="vi_VN">

  <!-- Twitter Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Chính Sách Quyền Riêng Tư — AIzalo Flow Companion | AIzalo.com">
  <meta name="twitter:description" content="Chính sách quyền riêng tư và cam kết bảo vệ dữ liệu người dùng của tiện ích mở rộng AIzalo Flow: Chat Companion (Chrome Extension).">
  <meta name="twitter:image" content="https://aizalo.com/assets/og-image.png">
`;
    content = content.replace(/(<link\s+rel=["']canonical["'][^>]*?>)/i, `$1${socialBlock}`);
    fs.writeFileSync(privacyPath, content, 'utf8');
    console.log(`   ✅ [Đã vá bộ thẻ 4x4 & Clean URL] website/src/privacy-extension.html`);
    modifiedCount++;
  }
}

// 4. Fix 404.html
const f04Path = path.join(srcDir, '404.html');
if (fs.existsSync(f04Path)) {
  let content = fs.readFileSync(f04Path, 'utf8');
  if (!content.includes('property="og:type"')) {
    const socialBlock = `
  <!-- Open Graph / Facebook / Zalo Share -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://aizalo.com/404">
  <meta property="og:site_name" content="AIzalo — Zalo-Flow">
  <meta property="og:title" content="404 — Không Tìm Thấy Trang | AIzalo.com">
  <meta property="og:description" content="Trang bạn đang tìm kiếm không tồn tại hoặc đã được di chuyển trên AIzalo.com.">
  <meta property="og:image" content="https://aizalo.com/assets/og-image.png">

  <!-- Twitter Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="404 — Không Tìm Thấy Trang | AIzalo.com">
  <meta name="twitter:description" content="Trang bạn đang tìm kiếm không tồn tại hoặc đã được di chuyển trên AIzalo.com.">
  <meta name="twitter:image" content="https://aizalo.com/assets/og-image.png">
`;
    content = content.replace(/(<meta\s+name=["']robots["'][^>]*?>)/i, `$1${socialBlock}`);
    fs.writeFileSync(f04Path, content, 'utf8');
    console.log(`   ✅ [Đã vá bộ thẻ 4x4] website/src/404.html`);
    modifiedCount++;
  }
}

// 5. Fix post-skeleton.html
const skeletonPath = path.join(rootDir, '.agents', 'skills', 'aizalo-blog', 'references', 'post-skeleton.html');
if (fs.existsSync(skeletonPath)) {
  let content = fs.readFileSync(skeletonPath, 'utf8');
  // Clean canonical and og:url
  content = content.replace('href="https://aizalo.com/blog/{{SLUG}}.html"', 'href="https://aizalo.com/blog/{{SLUG}}"');
  content = content.replace('content="https://aizalo.com/blog/{{SLUG}}.html"', 'content="https://aizalo.com/blog/{{SLUG}}"');
  content = content.replace('"mainEntityOfPage": "https://aizalo.com/blog/{{SLUG}}.html"', '"mainEntityOfPage": "https://aizalo.com/blog/{{SLUG}}"');

  if (!content.includes('name="twitter:card"')) {
    const twitterBlock = `
  <!-- Twitter Meta Tags -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{{TITLE}}">
  <meta name="twitter:description" content="{{DESCRIPTION_SHORT}}">
  <meta name="twitter:image" content="https://aizalo.com/assets/blog/{{SLUG}}/anh-bia-{{SLUG}}.svg">
`;
    content = content.replace(/(<meta\s+property=["']og:image["'][^>]*?>)/i, `$1${twitterBlock}`);
    fs.writeFileSync(skeletonPath, content, 'utf8');
    console.log(`   ✅ [Đã vá post-skeleton.html]`);
    modifiedCount++;
  }
}

console.log(`\n🎉 Hoàn thành vá thẻ Social Cards! Tổng số tệp đã cập nhật: ${modifiedCount}`);
