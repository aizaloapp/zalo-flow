import assert from 'assert';
import http from 'http';
import express from 'express';
import { csrfShield, requireAuth } from '../src/middleware/auth.js';
import aiSettingsRoutes from '../src/routes/ai-settings.js';
import quickMsgRoutes from '../src/routes/quick-messages.js';
import { localStore } from '../src/utils/local-store.js';

console.log('🧪 Testing Chrome Extension API & Security Integration...');

const app = express();
app.use(express.json());

// CORS simulation
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (origin.startsWith('chrome-extension://') || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ZaloFlow-Client, X-Admin-Token, Authorization');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use('/api', csrfShield);
app.use('/api', quickMsgRoutes);
app.use('/api', aiSettingsRoutes);

const server = app.listen(0, async () => {
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Test OPTIONS Preflight from chrome-extension://
    const optRes = await fetch(`${baseUrl}/api/ai/suggest`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'chrome-extension://abcdefghijklmnop',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, X-ZaloFlow-Client'
      }
    });
    assert.strictEqual(optRes.status, 204, 'OPTIONS preflight should return 204');
    assert.strictEqual(optRes.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnop');
    console.log('   ✅ Extension CORS Preflight passed!');

    // 2. Test CSRF Shield accepts chrome-extension:// with X-ZaloFlow-Client: 1
    const postValidationRes = await fetch(`${baseUrl}/api/ai/suggest`, {
      method: 'POST',
      headers: {
        'Origin': 'chrome-extension://abcdefghijklmnop',
        'Sec-Fetch-Site': 'cross-site',
        'X-ZaloFlow-Client': '1',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    // Should pass CSRF and reach validation error 400 (lastMessage empty), NOT 403 Forbidden!
    assert.strictEqual(postValidationRes.status, 400, 'Should pass CSRF and fail validation with 400');
    const errBody = await postValidationRes.json();
    assert.match(errBody.error, /lastMessage/, 'Should mention lastMessage validation');
    console.log('   ✅ Extension CSRF Shield bypass with X-ZaloFlow-Client: 1 passed!');

    // 3. Test CSRF Shield blocks chrome-extension:// if missing X-ZaloFlow-Client header
    const blockedRes = await fetch(`${baseUrl}/api/ai/suggest`, {
      method: 'POST',
      headers: {
        'Origin': 'chrome-extension://abcdefghijklmnop',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ lastMessage: 'hello' })
    });
    assert.strictEqual(blockedRes.status, 403, 'Should block request missing X-ZaloFlow-Client');
    console.log('   ✅ Extension CSRF Shield blocks missing X-ZaloFlow-Client header passed!');

    // 4. Test GET /api/quick-messages from extension
    const qmRes = await fetch(`${baseUrl}/api/quick-messages`, {
      headers: {
        'Origin': 'chrome-extension://abcdefghijklmnop'
      }
    });
    assert.strictEqual(qmRes.status, 200, 'GET /api/quick-messages should return 200');
    const qmData = await qmRes.json();
    assert.strictEqual(qmData.status, 'success');
    assert.ok(Array.isArray(qmData.data), 'Quick messages should be an array');
    console.log(`   ✅ GET /api/quick-messages returned ${qmData.data.length} templates successfully!`);

    console.log('🎉 ALL EXTENSION BACKEND INTEGRATION TESTS PASSED!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
