import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Scan all HTML files
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!['node_modules', '.git', 'dist', 'installer', 'sessions'].includes(item.name)) {
        results = results.concat(walk(full));
      }
    } else if (/\.(html|jsx|tsx|blade\.php)$/i.test(item.name)) {
      results.push(full);
    }
  }
  return results;
}

const allFiles = walk(rootDir);
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

const requiredTags = [
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

const websiteFiles = allFiles.filter(f => {
  const rel = path.relative(rootDir, f).replace(/\\/g, '/');
  return rel.startsWith('website/src/');
});

console.log(`=== CHI TIẾT TẤT CẢ TRANG TRONG website/src/ (${websiteFiles.length} trang) ===`);

for (const filePath of websiteFiles) {
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');

  const getMeta = (prop) => {
    const re1 = new RegExp(`<meta\\s+[^>]*?(?:property|name)=["']${prop}["'][^>]*?content=["']([^"']*?)["']`, 'i');
    const m1 = content.match(re1);
    if (m1) return m1[1];
    const re2 = new RegExp(`<meta\\s+[^>]*?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']${prop}["']`, 'i');
    const m2 = content.match(re2);
    return m2 ? m2[1] : null;
  };

  const metaData = {};
  const missing = [];
  for (const t of requiredTags) {
    metaData[t] = getMeta(t);
    if (!metaData[t]) missing.push(t);
  }

  // Check image exists locally
  let imageStatus = 'N/A';
  if (metaData['og:image']) {
    if (metaData['og:image'].startsWith('https://aizalo.com/')) {
      const sub = metaData['og:image'].replace('https://aizalo.com/', '');
      const localP = path.join(rootDir, 'website', 'src', sub);
      imageStatus = fs.existsSync(localP) ? 'OK (Local file exists)' : `404 MISSING (${localP})`;
    } else if (metaData['og:image'].startsWith('http')) {
      imageStatus = 'External URL: ' + metaData['og:image'];
    } else {
      imageStatus = 'Relative URL: ' + metaData['og:image'];
    }
  }

  // Stock check
  const stock = stockDomains.filter(d => content.includes(d));

  console.log(`\n📄 ${relPath}`);
  console.log(`   - og:type: ${metaData['og:type'] || 'MISSING'}`);
  console.log(`   - og:title: ${metaData['og:title'] ? metaData['og:title'].slice(0, 45) + '...' : 'MISSING'}`);
  console.log(`   - og:url: ${metaData['og:url'] || 'MISSING'}`);
  console.log(`   - og:image: ${metaData['og:image'] || 'MISSING'} [${imageStatus}]`);
  console.log(`   - twitter:card: ${metaData['twitter:card'] || 'MISSING'}`);
  console.log(`   - twitter:image: ${metaData['twitter:image'] || 'MISSING'}`);
  if (missing.length > 0) {
    console.log(`   ⚠️ Thiếu ${missing.length} thẻ: ${missing.join(', ')}`);
  }
  if (stock.length > 0) {
    console.log(`   🚨 Phát hiện link stock: ${stock.join(', ')}`);
  }
}
