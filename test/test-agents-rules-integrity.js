/**
 * Test Suite #58: AGENTS Rules Modular Integrity, Size Ceiling & Invariant Keywords Guard
 * 
 * Verifies:
 * 1. AGENTS.md complies with Context Sprawl Guard (< 12KB, <= 200 lines).
 * 2. All 4 satellite rule files in .agents/rules/ and website/AGENTS.md exist and are non-empty.
 * 3. All internal file links in AGENTS.md resolve to existing files (no dead links).
 * 4. 100% technical invariant keywords are strictly preserved across rules (Zero-Loss Guarantee).
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('58. Testing AGENTS.md Modular Integrity, Size Ceiling & Invariant Keywords Guard...');

// 1. Check root AGENTS.md size and line count
const agentsPath = path.join(rootDir, 'AGENTS.md');
assert.ok(fs.existsSync(agentsPath), 'Root AGENTS.md must exist');

const agentsContent = fs.readFileSync(agentsPath, 'utf8');
const agentsBytes = Buffer.byteLength(agentsContent, 'utf8');
const agentsLines = agentsContent.split('\n').length;

console.log(`   📊 AGENTS.md metrics: ${agentsBytes} bytes (${(agentsBytes / 1024).toFixed(2)} KB), ${agentsLines} lines`);
assert.ok(agentsBytes <= 12288, `AGENTS.md must be <= 12 KB (current: ${(agentsBytes / 1024).toFixed(2)} KB)`);
assert.ok(agentsLines <= 200, `AGENTS.md must be <= 200 lines (current: ${agentsLines} lines)`);

// 2. Check existence of all 4 satellite rule files + website rule file
const requiredRules = [
  path.join(rootDir, '.agents', 'rules', 'zalo-engine.md'),
  path.join(rootDir, '.agents', 'rules', 'storage-memory.md'),
  path.join(rootDir, '.agents', 'rules', 'frontend-crm.md'),
  path.join(rootDir, '.agents', 'rules', 'ai-vision.md'),
  path.join(rootDir, 'website', 'AGENTS.md')
];

for (const rulePath of requiredRules) {
  const relPath = path.relative(rootDir, rulePath);
  assert.ok(fs.existsSync(rulePath), `Required satellite rule file must exist: ${relPath}`);
  const content = fs.readFileSync(rulePath, 'utf8');
  assert.ok(content.length > 200, `Rule file must have substantial content: ${relPath}`);
}

// 3. Check for broken links in AGENTS.md
const linkRegex = /\[([^\]]+)\]\((file:\/\/\/[^)]+|\.\/[^)]+|\.agents\/[^)]+|website\/[^)]+)\)/g;
let match;
while ((match = linkRegex.exec(agentsContent)) !== null) {
  let target = match[2];
  if (target.startsWith('file:///')) {
    target = fileURLToPath(target.split('#')[0]);
  } else {
    target = path.resolve(rootDir, target.split('#')[0]);
  }
  assert.ok(fs.existsSync(target), `Link in AGENTS.md must point to an existing file: ${target}`);
}

// 4. Zero-Loss Technical Invariant Keyword Assertions
// Combine all rule content to ensure no vital constraints are dropped
const allRuleContents = requiredRules
  .map(f => fs.readFileSync(f, 'utf8'))
  .concat(agentsContent)
  .join('\n\n');

const criticalInvariants = [
  { keyword: "datetime('now')", desc: "Strict SQLite datetime literal with single quotes" },
  { keyword: "upload.any()", desc: "Multer safe error handling middleware" },
  { keyword: 'referrerpolicy="no-referrer"', desc: "Zalo CDN avatar 403 hotlink shield" },
  { keyword: "cleanForZalo", desc: "Mobile markdown cleaner for outbound bot messages" },
  { keyword: "getResolvedClient", desc: "Multi-account client dynamic resolution" },
  { keyword: "350MB", desc: "Node.js safe memory ceiling" },
  { keyword: "512MB", desc: "Docker container headroom limit" },
  { keyword: "PRAGMA wal_checkpoint", desc: "SQLite WAL truncation flush on exit" },
  { keyword: "X-ZaloFlow-Client: 1", desc: "CSRF preflight custom header shield" },
  { keyword: "AES-256-CBC", desc: "Session and AI key encryption standard" },
  { keyword: "cleanSwitchAccountData", desc: "Account switching whitelist protection method" },
  { keyword: "Air-Gapped IP", desc: "Security perimeter isolating SaaS IP and secrets" },
  { keyword: "Zero-Binary Git Tree", desc: "Contract preventing commits of large binaries" },
  { keyword: "Strict Explicit Approval", desc: "Absolute invariant requiring manual typed approval" }
];

for (const { keyword, desc } of criticalInvariants) {
  assert.ok(
    allRuleContents.includes(keyword),
    `CRITICAL INVARIANT MISSING: '${keyword}' (${desc}) was dropped during modularization!`
  );
}

console.log('   ✅ AGENTS.md Modular Integrity, Size Ceiling & Invariant Keywords Guard passed 100%!\n');
