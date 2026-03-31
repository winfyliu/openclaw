import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../utils.js';
import { loadJsonFile, saveJsonFile } from '../infra/json-file.js';

const ENCRYPTION_KEY_PATH = path.join(CONFIG_DIR, 'encryption-key.json');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

interface EncryptionKeyFile {
  version: number;
  key: string;
  createdAt: number;
}

/**
 * Generate a new encryption key
 */
function generateEncryptionKey(): Buffer {
  return crypto.randomBytes(32); // 256 bits
}

/**
 * Load or generate encryption key
 */
export function getEncryptionKey(): Buffer {
  try {
    const keyFile = loadJsonFile(ENCRYPTION_KEY_PATH) as EncryptionKeyFile;
    if (keyFile && keyFile.key) {
      return Buffer.from(keyFile.key, 'base64');
    }
  } catch {
    // Key file doesn't exist or is invalid
  }

  // Generate new key
  const key = generateEncryptionKey();
  const keyFile: EncryptionKeyFile = {
    version: 1,
    key: key.toString('base64'),
    createdAt: Date.now(),
  };

  // Ensure config directory exists
  fs.mkdirSync(path.dirname(ENCRYPTION_KEY_PATH), { recursive: true });
  
  // Save key file with secure permissions
  saveJsonFile(ENCRYPTION_KEY_PATH, keyFile);
  fs.chmodSync(ENCRYPTION_KEY_PATH, 0o600);

  return key;
}

/**
 * Encrypt a string
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt a string
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const [ivStr, tagStr, encryptedStr] = encryptedText.split(':');
  
  const iv = Buffer.from(ivStr, 'base64');
  const tag = Buffer.from(tagStr, 'base64');
  const encrypted = Buffer.from(encryptedStr, 'base64');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}

/**
 * Check if a string is encrypted
 */
export function isEncrypted(text: string): boolean {
  return text.includes(':') && text.split(':').length === 3;
}

/**
 * Encrypt sensitive fields in an object
 */
export function encryptSensitiveFields(obj: any, sensitiveFields: string[]): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const result = { ...obj };
  
  for (const field of sensitiveFields) {
    if (result[field] && typeof result[field] === 'string' && !isEncrypted(result[field])) {
      result[field] = encrypt(result[field]);
    }
  }
  
  return result;
}

/**
 * Decrypt sensitive fields in an object
 */
export function decryptSensitiveFields(obj: any, sensitiveFields: string[]): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  const result = { ...obj };
  
  for (const field of sensitiveFields) {
    if (result[field] && typeof result[field] === 'string' && isEncrypted(result[field])) {
      try {
        result[field] = decrypt(result[field]);
      } catch {
        // If decryption fails, leave as is
      }
    }
  }
  
  return result;
}
