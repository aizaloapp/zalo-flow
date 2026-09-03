import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-cbc';
const SESSIONS_DIR = path.resolve(process.cwd(), 'sessions');

// Ensure sessions directory exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function getKey(passphrase) {
  return crypto.createHash('sha256').update(String(passphrase || 'zalo-flow-default-secret-key-32')).digest();
}

/**
 * Save encrypted session to disk
 */
export function saveEncryptedSession(filename, sessionData, passphrase = process.env.SESSION_SECRET) {
  try {
    const key = getKey(passphrase);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    const jsonStr = typeof sessionData === 'string' ? sessionData : JSON.stringify(sessionData);
    let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const payload = JSON.stringify({
      iv: iv.toString('hex'),
      data: encrypted,
      updatedAt: new Date().toISOString()
    });

    const filePath = path.join(SESSIONS_DIR, `${filename}.enc`);
    fs.writeFileSync(filePath, payload, { mode: 0o600 });
    logger.info(`Session saved & encrypted: ${filePath}`);
    return true;
  } catch (err) {
    logger.error(`Failed to save encrypted session: ${err.message}`);
    return false;
  }
}

/**
 * Load and decrypt session from disk
 */
export function loadEncryptedSession(filename, passphrase = process.env.SESSION_SECRET) {
  try {
    const filePath = path.join(SESSIONS_DIR, `${filename}.enc`);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { iv, data } = JSON.parse(fileContent);
    
    const key = getKey(passphrase);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (err) {
    logger.warn(`Could not decrypt session '${filename}': ${err.message}. A new login QR might be needed.`);
    return null;
  }
}
