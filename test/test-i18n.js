import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('🧪 Testing i18n Dictionary Integrity & Engine Functions...');

// Mock window & localStorage
const localStorageStore = {};
global.localStorage = {
  getItem: (k) => localStorageStore[k] || null,
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; }
};
try {
  Object.defineProperty(global, 'navigator', {
    value: { language: 'vi-VN' },
    configurable: true,
    writable: true
  });
} catch (e) {}
global.document = {
  documentElement: {
    setAttribute: () => {},
    getAttribute: () => 'vi'
  },
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  readyState: 'complete'
};
global.window = global;
global.CustomEvent = class CustomEvent { constructor(name, detail) { this.name = name; this.detail = detail; } };
global.dispatchEvent = () => true;

// Evaluate public/i18n.js
const i18nCode = fs.readFileSync(path.join(rootDir, 'public', 'i18n.js'), 'utf8');
eval(i18nCode);

const { DICTIONARY, t, getLanguage, setLanguage, toggleLanguage, formatDate, getRelativeTime } = window.i18n;

// 1. Check DICTIONARY structures
assert(DICTIONARY.vi, 'DICTIONARY.vi must exist');
assert(DICTIONARY.en, 'DICTIONARY.en must exist');

function collectKeys(obj, prefix = '') {
  let keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys = keys.concat(collectKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const viKeys = new Set(collectKeys(DICTIONARY.vi));
const enKeys = new Set(collectKeys(DICTIONARY.en));

console.log(`   ✔️ Found ${viKeys.size} Vietnamese translation keys`);
console.log(`   ✔️ Found ${enKeys.size} English translation keys`);

// Check missing keys
const missingInEn = [...viKeys].filter(k => !enKeys.has(k));
const missingInVi = [...enKeys].filter(k => !viKeys.has(k));

if (missingInEn.length > 0) {
  console.error('❌ Keys missing in English dictionary:', missingInEn);
  process.exit(1);
}
if (missingInVi.length > 0) {
  console.error('❌ Keys missing in Vietnamese dictionary:', missingInVi);
  process.exit(1);
}
assert.strictEqual(viKeys.size, enKeys.size, 'VI and EN key counts must match 1:1');
console.log('   ✅ 1:1 Key Matching between VI and EN passed!');

// 2. Test Translation & Fallbacks
setLanguage('vi');
assert.strictEqual(t('common.save'), 'Lưu');
assert.strictEqual(t('header.connected'), 'Đã Kết Nối (Online)');

setLanguage('en');
assert.strictEqual(t('common.save'), 'Save');
assert.strictEqual(t('header.connected'), 'Connected (Online)');

// 3. Test Variable Interpolation
assert.strictEqual(
  t('toast.sync_completed', { count: 128 }),
  'Sync completed: 128 messages!'
);
setLanguage('vi');
assert.strictEqual(
  t('toast.sync_completed', { count: 128 }),
  'Đồng bộ hoàn tất: 128 tin nhắn!'
);

// 4. Test Missing Key Safe Fallback (No Exception)
const fallbackResult = t('non.existent.random.key', 'Default Fallback Text');
assert.strictEqual(fallbackResult, 'Default Fallback Text');
const fallbackKeyResult = t('non.existent.random.key');
assert.strictEqual(fallbackKeyResult, 'non.existent.random.key');
console.log('   ✅ Missing key safe fallback passed!');

// 5. Test Date and Relative Time Formatters
const date = new Date('2026-09-12T12:00:00Z');
setLanguage('en');
const enDate = formatDate(date);
assert(enDate.length > 0, 'Formatted EN date must not be empty');
const enRelTime = getRelativeTime(15);
assert.strictEqual(enRelTime, 'in 15m');

setLanguage('vi');
const viDate = formatDate(date);
assert(viDate.length > 0, 'Formatted VI date must not be empty');
const viRelTime = getRelativeTime(15);
assert.strictEqual(viRelTime, 'còn 15p');

console.log('   ✅ Date & Relative time internationalization passed!');
console.log('🎉 ALL i18n INTEGRITY TESTS PASSED 100%!');
