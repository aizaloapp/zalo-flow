import assert from 'assert';
import crypto from 'crypto';
import { AsyncMutex, oaTokenManager } from '../src/utils/oa-token-manager.js';
import { localStore } from '../src/utils/local-store.js';
import { decryptSecret } from '../src/utils/ai-crypto.js';

console.log('🧪 Testing OA Token Manager & AsyncMutex Guard...');

async function testAsyncMutexConcurrency() {
  const mutex = new AsyncMutex();
  let counter = 0;
  let concurrentExecutions = 0;
  let maxConcurrent = 0;

  const tasks = Array.from({ length: 10 }, async (_, i) => {
    return await mutex.runExclusive(async () => {
      concurrentExecutions++;
      if (concurrentExecutions > maxConcurrent) {
        maxConcurrent = concurrentExecutions;
      }
      // Simulate async I/O delay
      await new Promise(r => setTimeout(r, 20));
      counter++;
      concurrentExecutions--;
      return counter;
    });
  });

  const results = await Promise.all(tasks);
  assert.strictEqual(counter, 10, 'All 10 tasks must complete');
  assert.strictEqual(maxConcurrent, 1, 'Mutex MUST ensure max concurrent executions is strictly 1');
  assert.deepStrictEqual(results, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'Tasks must execute in serialized FIFO order');
  console.log('   ✅ AsyncMutex serialized 10 concurrent executions perfectly!');
}

function testWebhookSignatureVerification() {
  const appId = 'app_oa_12345';
  const secretKey = 'my_super_secret_oa_key';
  const rawBody = JSON.stringify({ event_name: 'user_send_text', sender: { id: 'user_1' } });
  const timestamp = String(Date.now());

  const dataToHash = `${appId}${rawBody}${timestamp}${secretKey}`;
  const validSignature = crypto.createHash('sha256').update(dataToHash, 'utf8').digest('hex');

  // Test with valid signature
  const isValid = oaTokenManager.verifyWebhookSignature({
    signature: validSignature,
    rawBody,
    timestamp,
    appId,
    secretKey
  });
  assert.strictEqual(isValid, true, 'Valid signature must return true');

  // Test with tampered rawBody
  const isInvalidBody = oaTokenManager.verifyWebhookSignature({
    signature: validSignature,
    rawBody: rawBody + 'tampered',
    timestamp,
    appId,
    secretKey
  });
  assert.strictEqual(isInvalidBody, false, 'Tampered body must return false');

  // Test with invalid secret
  const isInvalidSecret = oaTokenManager.verifyWebhookSignature({
    signature: validSignature,
    rawBody,
    timestamp,
    appId,
    secretKey: 'wrong_secret'
  });
  assert.strictEqual(isInvalidSecret, false, 'Invalid secret must return false');

  console.log('   ✅ Webhook SHA256 MAC signature verification passed!');
}

function testCredentialsStorageZeroLeak() {
  oaTokenManager.setCredentials({
    oaId: 'oa_test_999',
    name: 'Test Business OA',
    appId: 'app_test_123',
    secretKey: 'raw_secret_key_to_encrypt',
    accessToken: 'raw_access_token_to_encrypt',
    refreshToken: 'raw_refresh_token_to_encrypt',
    expiresIn: 3600
  });

  const rawSettings = localStore.getOaSettings();
  assert.strictEqual(rawSettings.oaId, 'oa_test_999');

  // Verify Zero-Plaintext: SQLite MUST contain encrypted ciphertext
  assert.notStrictEqual(rawSettings.secretKeyEncrypted, 'raw_secret_key_to_encrypt');
  assert.strictEqual(rawSettings.secretKeyEncrypted.includes(':'), true, 'Encrypted secret must have iv:data format');
  assert.strictEqual(decryptSecret(rawSettings.secretKeyEncrypted), 'raw_secret_key_to_encrypt');
  assert.strictEqual(decryptSecret(rawSettings.accessTokenEncrypted), 'raw_access_token_to_encrypt');
  assert.strictEqual(decryptSecret(rawSettings.refreshTokenEncrypted), 'raw_refresh_token_to_encrypt');

  // Clean up
  localStore.deleteOaSettings();
  console.log('   ✅ OA Credentials AES-256-CBC Zero-Plaintext storage passed!');
}

async function runAll() {
  await testAsyncMutexConcurrency();
  testWebhookSignatureVerification();
  testCredentialsStorageZeroLeak();
  console.log('🎉 All OA Token Manager & AsyncMutex tests passed 100%!');
}

runAll().catch(err => {
  console.error(err);
  process.exit(1);
});
