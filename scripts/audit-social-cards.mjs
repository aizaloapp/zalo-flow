import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.join(rootDir, 'website', 'src');

console.log('================================================================================');
console.log('🔍 GLOBAL SOCIAL PREVIEW CARDS AUDIT (RULE 8 ENFORCEMENT GATE)');
console.log('================================================================================\n');

const stockDomains = [
  'images.unsplash.com',
  'unsplash.com',
  'pexels.com',
  'pixabay.com',
  'placeholder.com',
  'picsum.photos',
  'dummyimage.com',
  'via.placeholder.com'
];

const required4x4 = [
  'og:type',
  'og:title',
  'og:description',
  'og:url',
  'og:image',
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image'
];

// Helper to extract meta tag
function getMeta(content, prop) {
  const re1 = new RegExp(`<meta\\s+[^>]*?(?:property|name)=["']${prop}["'][^>]*?content=["']([^"']*?)["']`, 'i');
  const m1 = content.match(re1);
  if (m1) return m1[1];
  const re2 = new RegExp(`<meta\\s+[^>]*?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${prop}["']`, 'i');
  const m2 = content.match(re2);
  return m2 ? m2[1] : null;
}

// 1. Verify Fallback Brand Asset
console.log('🛡️  [1/5] Kiểm tra Tấm lưới an toàn thương hiệu (Project Brand Fallback)...');
const brandAssets = [
  path.join(srcDir, 'assets', 'og-image.jpg'),
  path.join(srcDir, 'assets', 'og-image.png'),
  path.join(srcDir, 'og-image.jpg'),
  path.join(srcDir, 'og-image.png')
];

let fallbackErrors = 0;
for (const p of brandAssets) {
  const rel = path.relative(rootDir, p).replace(/\\/g, '/');
  if (fs.existsSync(p)) {
    const stat = fs.statSync(p);
    console.log(`   ✔️  ${rel} (${(stat.size / 1024).toFixed(1)} KB)`);
  } else {
    console.error(`   ❌ THIẾU TỆP THƯƠNG HIỆU: ${rel}`);
    fallbackErrors++;
  }
}

// 2. Discover Public HTML files
console.log('\n📄 [2/5] Thu thập các trang web công khai...');
function getPublicHtmlFiles(dir) {
  let files = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      files = files.concat(getPublicHtmlFiles(full));
    } else if (item.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

const publicFiles = getPublicHtmlFiles(srcDir);
console.log(`   ✔️  Tìm thấy ${publicFiles.length} trang HTML công khai trong website/src.`);

// 3. Scan & Audit Each Page
console.log('\n🔍 [3/5] Kiểm định 5 Rào chắn Social Cards trên từng trang...');
let totalErrors = fallbackErrors;

for (const filePath of publicFiles) {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const pageErrors = [];

  // Rào chắn 1: Cấm ảnh Stock Placeholder
  for (const domain of stockDomains) {
    if (content.includes(domain)) {
      pageErrors.push(`Phát hiện URL ảnh stock cấm: "${domain}"`);
    }
  }

  // Rào chắn 4: Khóa cứng bộ thẻ chuẩn 4x4
  const metaMap = {};
  for (const tag of required4x4) {
    const val = getMeta(content, tag);
    metaMap[tag] = val;
    if (!val) {
      pageErrors.push(`Thiếu thẻ bắt buộc: <meta ... ${tag}>`);
    }
  }

  // Rào chắn 2 & 3: Nguyên tắc URL Tuyệt Đối & Tồn Tại Thực Tế
  const checkUrl = (tag, val) => {
    if (!val) return;
    if (!val.startsWith('https://') && !val.startsWith('http://')) {
      pageErrors.push(`Thẻ ${tag} dùng đường dẫn tương đối ("${val}"), bắt buộc phải là URL tuyệt đối có đầy đủ https://`);
      return;
    }
    if (val.startsWith('https://aizalo.com/')) {
      const sub = val.replace('https://aizalo.com/', '');
      const localFile = path.join(srcDir, sub);
      if (!fs.existsSync(localFile)) {
        pageErrors.push(`Thẻ ${tag} trỏ tới tệp không tồn tại (404): "${val}" -> ${localFile}`);
      }
    }
  };

  checkUrl('og:image', metaMap['og:image']);
  checkUrl('twitter:image', metaMap['twitter:image']);

  if (metaMap['og:url'] && !metaMap['og:url'].startsWith('https://')) {
    pageErrors.push(`Thẻ og:url phải bắt đầu bằng https:// (hiện tại: "${metaMap['og:url']}")`);
  }

  if (pageErrors.length > 0) {
    console.error(`\n❌ [LỖI] ${rel}:`);
    for (const err of pageErrors) {
      console.error(`      - ${err}`);
    }
    totalErrors += pageErrors.length;
  } else {
    console.log(`   ✔️  [PASS] ${rel}`);
  }
}

// 4. Check Template Skeleton
console.log('\n📝 [4/5] Kiểm định Template Mẫu Bài Viết Blog (.agents/.../post-skeleton.html)...');
const skeletonPath = path.join(rootDir, '.agents', 'skills', 'aizalo-blog', 'references', 'post-skeleton.html');
if (fs.existsSync(skeletonPath)) {
  const skelContent = fs.readFileSync(skeletonPath, 'utf8');
  let skelErrors = 0;
  for (const tag of required4x4) {
    if (!skelContent.includes(tag)) {
      console.error(`   ❌ Skeleton thiếu khai báo thẻ: ${tag}`);
      skelErrors++;
    }
  }
  if (skelContent.includes('{{SLUG}}.html')) {
    console.error(`   ❌ Skeleton vi phạm Clean URLs (còn chứa {{SLUG}}.html)`);
    skelErrors++;
  }
  if (skelErrors === 0) {
    console.log(`   ✔️  [PASS] post-skeleton.html tuân thủ 100% bộ thẻ 4x4 và Clean URLs.`);
  } else {
    totalErrors += skelErrors;
  }
}

// 5. Final Evaluation
console.log('\n================================================================================');
if (totalErrors === 0) {
  console.log('🎉 KẾT QUẢ: 100% CÁC TRANG ĐẠT CHUẨN RULE 8 (0 LỖI PHÁT HIỆN)!');
  console.log('================================================================================\n');
  process.exit(0);
} else {
  console.error(`💥 KẾT QUẢ THẤT BẠI: Phát hiện tổng cộng ${totalErrors} lỗi vi phạm Rule 8!`);
  console.log('================================================================================\n');
  process.exit(1);
}
