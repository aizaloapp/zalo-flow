import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

function getKey(passphrase = process.env.SESSION_SECRET) {
  return crypto.createHash('sha256').update(String(passphrase || 'zalo-flow-default-secret-key-32')).digest();
}

/**
 * Encrypt sensitive plain text using AES-256-CBC
 * @param {string} plainText 
 * @param {string} passphrase 
 * @returns {string} iv:encryptedHex
 */
export function encryptSecret(plainText, passphrase = process.env.SESSION_SECRET) {
  if (!plainText || typeof plainText !== 'string') return '';
  try {
    const key = getKey(passphrase);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plainText.trim(), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch {
    return '';
  }
}

/**
 * Decrypt cipher text back to plain text
 * @param {string} cipherText - formatted as ivHex:dataHex
 * @param {string} passphrase 
 * @returns {string} plain text or empty string on failure
 */
export function decryptSecret(cipherText, passphrase = process.env.SESSION_SECRET) {
  if (!cipherText || typeof cipherText !== 'string' || !cipherText.includes(':')) return '';
  try {
    const [ivHex, encrypted] = cipherText.split(':');
    if (!ivHex || !encrypted) return '';
    const key = getKey(passphrase);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return '';
  }
}

/**
 * Mask API Key for safe frontend rendering (e.g. AIzaSy...9aBc)
 * @param {string} key 
 * @returns {string}
 */
export function maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '********';
  return `${trimmed.substring(0, 6)}...****...${trimmed.substring(trimmed.length - 4)}`;
}

/**
 * Phân giải Base URL an toàn: Tránh trường hợp default URL của provider cũ (như DeepSeek) bị áp vào provider mới
 * @param {string} customUrl 
 * @param {string} provider 
 * @returns {string}
 */
export function resolveEffectiveBaseUrl(customUrl, provider) {
  const trimmed = (customUrl || '').trim();
  if (!trimmed) return '';
  const standardUrls = {
    deepseek: 'api.deepseek.com',
    zai: 'api.z.ai',
    groq: 'api.groq.com',
    openrouter: 'openrouter.ai',
    ollama: 'localhost:11434'
  };
  for (const [p, domain] of Object.entries(standardUrls)) {
    if (trimmed.includes(domain) && provider !== p) {
      // URL thuộc về provider khác -> Bỏ qua để adapter tự dùng default URL của target provider!
      return '';
    }
  }
  return trimmed;
}
