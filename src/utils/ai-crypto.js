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
