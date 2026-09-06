#!/usr/bin/env node
/**
 * Standalone Detached Updater for Zalo-Flow
 * Executes outside the main Express server process to eliminate Windows file locking,
 * avoid memory surges, and guarantee safe restart.
 */
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const logFile = path.join(rootDir, 'data', 'update.log');
const lockFile = path.join(rootDir, 'data', '.update-lock');

function log(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile, line, 'utf8');
  } catch {}
  console.log(msg);
}

// Ensure data directory exists
if (!fs.existsSync(path.join(rootDir, 'data'))) {
  fs.mkdirSync(path.join(rootDir, 'data'), { recursive: true });
}

log('🚀 [Standalone Updater] Started detached updater process...');

async function waitForPortClosed(port, host = '127.0.0.1', maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const isFree = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(400);
      socket.on('connect', () => {
        socket.destroy();
        resolve(false); // Port is still open
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(true); // Port closed or no response
      });
      socket.on('error', () => {
        resolve(true); // Connection refused = port is free
      });
      socket.connect(port, host);
    });

    if (isFree) {
      log(`✅ [Standalone Updater] Port ${port} is confirmed released.`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  log(`⚠️ [Standalone Updater] Port ${port} wait timeout, proceeding anyway...`);
  return false;
}

async function run() {
  const port = Number(process.env.PORT) || 3000;

  // 1. Wait for parent server process to completely exit and free port 3000
  log(`⏳ Waiting for previous server instance to close port ${port}...`);
  await waitForPortClosed(port);

  // 2. Read current package.json content hash
  let pkgBefore = '';
  try {
    pkgBefore = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
  } catch {}

  let hasStashed = false;

  try {
    // 3. Git Stash if any local unstaged changes exist
    log('📦 Checking working tree & stashing temporary changes...');
    try {
      const status = execSync('git status -s', { cwd: rootDir, encoding: 'utf8' });
      if (status && status.trim().length > 0) {
        execSync('git stash', { cwd: rootDir, encoding: 'utf8' });
        hasStashed = true;
        log('📦 Local changes stashed safely.');
      }
    } catch (stashErr) {
      log(`ℹ️ Git stash notice: ${stashErr.message}`);
    }

    // 4. Git Pull from upstream origin/main
    log('🔄 Pulling latest source code from GitHub (origin/main)...');
    execSync('git pull origin main', { cwd: rootDir, encoding: 'utf8', timeout: 60000 });
    log('✅ Successfully pulled latest changes from origin/main.');

    // 5. Restore stashed changes if any
    if (hasStashed) {
      try {
        execSync('git stash pop', { cwd: rootDir, encoding: 'utf8' });
        log('📦 Stashed changes reapplied.');
      } catch (popErr) {
        log(`⚠️ Notice on stash pop: ${popErr.message}`);
      }
    }

    // 6. Check if dependencies changed in package.json
    let pkgAfter = '';
    try {
      pkgAfter = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8');
    } catch {}

    if (pkgBefore && pkgAfter && pkgBefore !== pkgAfter) {
      log('📥 Dependencies changed. Running npm install --omit=dev...');
      execSync('npm install --omit=dev', { cwd: rootDir, encoding: 'utf8', timeout: 180000 });
      log('✅ npm install completed successfully.');
    } else {
      log('✨ No dependency changes detected. Skipping npm install.');
    }

    // 7. AST Pre-flight validation check on critical files
    log('🧪 Running AST Syntax Verification (node --check)...');
    execSync('node --check src/index.js', { cwd: rootDir, encoding: 'utf8' });
    execSync('node --check public/app.js', { cwd: rootDir, encoding: 'utf8' });
    log('✅ AST verification passed 100% with 0 syntax errors.');

    log('🎉 Update succeeded! Preparing to spawn fresh Zalo-Flow instance...');
  } catch (err) {
    log(`🚨 [UPDATE FAILED] Error occurred: ${err.message}`);

    // Rollback protocol
    log('🛡️ Initiating Rollback Protocol...');
    try {
      execSync('git reset --hard ORIG_HEAD', { cwd: rootDir, encoding: 'utf8' });
      log('✅ Git repository rolled back to ORIG_HEAD.');
    } catch (rbErr) {
      log(`⚠️ Rollback notice: ${rbErr.message}`);
    }
  } finally {
    // Remove update lock
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        log('🔓 Released update lock file.');
      }
    } catch {}

    // 8. Respawn Zalo-Flow server detached
    log('🚀 Spawning new Zalo-Flow server process...');
    try {
      const child = spawn(process.execPath, [path.join(rootDir, 'src', 'index.js')], {
        cwd: rootDir,
        detached: true,
        stdio: 'ignore',
        env: process.env
      });
      child.unref();
      log(`✅ New Zalo-Flow server process spawned with PID ${child.pid}. Standalone updater exiting.`);
    } catch (spawnErr) {
      log(`❌ Failed to spawn new server: ${spawnErr.message}`);
    }

    process.exit(0);
  }
}

run();
