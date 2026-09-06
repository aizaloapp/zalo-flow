import express from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { execSync, spawn } from 'child_process';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { localStore } from '../utils/local-store.js';
import { defaultRateLimiter } from '../utils/rate-limiter.js';

export const updaterRouter = express.Router();

const rootDir = process.cwd();
const lockFile = path.join(rootDir, 'data', '.update-lock');
const dbFile = path.join(rootDir, 'data', 'zaloflow.db');
const dbBackupFile = path.join(rootDir, 'data', 'zaloflow.db.bak');

// In-memory cache for GitHub releases to prevent rate limiting (60 req/hr)
let versionCache = {
  latestVersion: null,
  releaseNotes: '',
  htmlUrl: '',
  publishedAt: null,
  etag: null,
  lastChecked: 0
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Compare two semver strings (e.g. "1.1.0" vs "1.0.0")
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal
 */
function compareSemver(v1, v2) {
  const clean1 = (v1 || '').replace(/^v/, '').trim();
  const clean2 = (v2 || '').replace(/^v/, '').trim();
  const parts1 = clean1.split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = clean2.split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Fetch latest release from GitHub API with ETag conditional request
 */
function fetchGitHubRelease(cachedEtag = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/aizaloapp/zalo-flow/releases/latest',
      method: 'GET',
      headers: {
        'User-Agent': 'Zalo-Flow-Updater/1.0',
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 10000
    };

    if (cachedEtag) {
      options.headers['If-None-Match'] = cachedEtag;
    }

    const req = https.request(options, (res) => {
      let data = '';

      if (res.statusCode === 304) {
        // Not modified, use cached version without hitting rate limit
        return resolve({ notModified: true });
      }

      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            const etag = res.headers['etag'] || null;
            resolve({
              notModified: false,
              success: true,
              etag,
              tagName: json.tag_name || '',
              name: json.name || '',
              body: json.body || '',
              htmlUrl: json.html_url || '',
              publishedAt: json.published_at || null
            });
          } catch {
            resolve({ success: false, error: 'JSON parse error' });
          }
        } else {
          resolve({ success: false, statusCode: res.statusCode, error: `GitHub API returned ${res.statusCode}` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'GitHub API request timed out' });
    });

    req.end();
  });
}

/**
 * GET /api/system/version
 * Checks current version vs latest GitHub Release with ETag Caching
 */
updaterRouter.get('/system/version', async (req, res) => {
  const force = req.query.force === 'true';

  // 1. Current local package version
  let currentVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    currentVersion = pkg.version || '1.0.0';
  } catch {}

  // 2. Git repo info
  const isGitRepo = fs.existsSync(path.join(rootDir, '.git'));
  let currentCommit = '';
  let currentBranch = 'main';

  if (isGitRepo) {
    try {
      currentCommit = execSync('git rev-parse --short HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
      currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
    } catch {}
  }

  // 3. GitHub release check with In-Memory / ETag cache
  const now = Date.now();
  const shouldCheck = force || !versionCache.lastChecked || (now - versionCache.lastChecked > CACHE_TTL_MS);

  if (shouldCheck) {
    const ghRes = await fetchGitHubRelease(versionCache.etag);

    if (ghRes && !ghRes.notModified && ghRes.success) {
      const cleanVer = (ghRes.tagName || '').replace(/^v/, '').trim();
      versionCache = {
        latestVersion: cleanVer || currentVersion,
        releaseNotes: ghRes.body || '',
        htmlUrl: ghRes.htmlUrl || 'https://github.com/aizaloapp/zalo-flow/releases',
        publishedAt: ghRes.publishedAt,
        etag: ghRes.etag,
        lastChecked: now
      };
    } else if (ghRes && ghRes.notModified) {
      versionCache.lastChecked = now;
    }
  }

  const isPackaged = process.env.ZALOFLOW_PACKAGED === '1';
  const latestVersion = versionCache.latestVersion || currentVersion;
  const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

  // Check if update lock is active
  const isUpdating = fs.existsSync(lockFile);

  res.json({
    currentVersion,
    latestVersion,
    hasUpdate,
    isPackaged,
    releaseNotes: versionCache.releaseNotes,
    htmlUrl: versionCache.htmlUrl,
    publishedAt: versionCache.publishedAt,
    isGitRepo,
    currentCommit,
    currentBranch,
    isUpdating,
    lastChecked: versionCache.lastChecked ? new Date(versionCache.lastChecked).toISOString() : null
  });
});

/**
 * POST /api/system/update
 * Pre-flight safety check -> Drain RateLimiter -> Flush SQLite WAL -> Backup DB -> Spawn Standalone Updater -> Exit
 */
updaterRouter.post('/system/update', requireAuth, async (req, res) => {
  // 0. Server-side Gate: Block in packaged desktop mode
  if (process.env.ZALOFLOW_PACKAGED === '1') {
    return res.status(403).json({
      error: 'Ứng dụng đang chạy ở phiên bản đóng gói Desktop (không sử dụng Git). Vui lòng tải bộ cài đặt mới từ GitHub Releases.'
    });
  }

  // 1. Check if git repository
  const isGitRepo = fs.existsSync(path.join(rootDir, '.git'));
  if (!isGitRepo) {
    return res.status(400).json({
      error: 'Hệ thống không phát hiện thư mục .git. Nếu bạn cài đặt từ tệp zip, vui lòng tải bản zip mới nhất từ GitHub hoặc clone qua git để sử dụng tính năng Cập nhật 1-Click.'
    });
  }

  // 2. Check update lock (Mutex guard)
  if (fs.existsSync(lockFile)) {
    try {
      const lockStats = fs.statSync(lockFile);
      const ageMs = Date.now() - lockStats.mtimeMs;
      if (ageMs < 3 * 60 * 1000) { // < 3 minutes
        return res.status(409).json({
          error: 'Đang có tiến trình cập nhật đang chạy. Vui lòng chờ 1-2 phút hoặc kiểm tra lại sau.'
        });
      }
      // Lock expired (> 3 mins), remove stale lock
      fs.unlinkSync(lockFile);
    } catch {}
  }

  // 3. Pre-flight Check: Remote URL
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: rootDir, encoding: 'utf8' }).trim();
    if (!remoteUrl.toLowerCase().includes('aizaloapp/zalo-flow')) {
      logger.warn(`[Updater] Remote URL '${remoteUrl}' differs from official repo.`);
    }
  } catch (err) {
    return res.status(400).json({ error: `Không thể đọc git remote origin: ${err.message}` });
  }

  // 4. Pre-flight Check: .gitignore protects sensitive data
  try {
    const gitignorePath = path.join(rootDir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      const requiredIgnores = ['.env', 'sessions', 'data'];
      for (const item of requiredIgnores) {
        if (!gitignore.includes(item)) {
          logger.warn(`[Updater Pre-flight] .gitignore might not exclude '${item}'.`);
        }
      }
    }
  } catch {}

  // 5. Create Mutex Lock
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, time: Date.now() }), 'utf8');
  } catch (lockErr) {
    return res.status(500).json({ error: `Không thể tạo tệp khóa cập nhật: ${lockErr.message}` });
  }

  logger.info('🛡️ [1-Click Update Initiated] Running Pre-Shutdown Data Protection Protocol...');

  // 6. Drain RateLimiter Queue (max 3 seconds)
  try {
    if (typeof defaultRateLimiter?.drainAll === 'function') {
      logger.info('[Updater] Draining outbound RateLimiter queue...');
      await defaultRateLimiter.drainAll(3000);
    }
  } catch (drainErr) {
    logger.warn(`[Updater] Notice during queue drain: ${drainErr.message}`);
  }

  // 7. Flush SQLite WAL and backup database safely
  try {
    logger.info('[Updater] Flushing SQLite WAL checkpoint (TRUNCATE) and creating database backup...');
    if (typeof localStore?.close === 'function') {
      localStore.close();
    }
    // Create copy backup
    if (fs.existsSync(dbFile)) {
      fs.copyFileSync(dbFile, dbBackupFile);
      logger.info(`✅ [Updater] Database backed up to ${dbBackupFile}`);
    }
  } catch (dbErr) {
    logger.warn(`[Updater] Warning during DB checkpoint/backup: ${dbErr.message}`);
  }

  // 8. Spawn Detached Standalone Updater Runner
  const updaterScript = path.join(rootDir, 'bin', 'standalone-updater.mjs');
  if (!fs.existsSync(updaterScript)) {
    // Release lock
    try { fs.unlinkSync(lockFile); } catch {}
    return res.status(500).json({ error: 'Không tìm thấy tệp bin/standalone-updater.mjs.' });
  }

  try {
    const child = spawn(process.execPath, [updaterScript], {
      cwd: rootDir,
      detached: true,
      stdio: 'ignore',
      env: process.env
    });
    child.unref();
    logger.info(`🚀 [Updater] Detached standalone updater spawned (PID ${child.pid}).`);
  } catch (spawnErr) {
    try { fs.unlinkSync(lockFile); } catch {}
    return res.status(500).json({ error: `Không thể khởi chạy updater độc lập: ${spawnErr.message}` });
  }

  // 9. Send success response before exiting process
  res.json({
    success: true,
    message: 'Tiến trình cập nhật đã được khởi chạy thành công. Máy chủ đang thực hiện kéo mã nguồn và nạp phiên bản mới. Vui lòng đợi trong giây lát...'
  });

  // 10. Exit current Node.js process gracefully after 800ms
  setTimeout(() => {
    logger.info('👋 [Updater] Server process exiting gracefully for standalone update execution...');
    process.exit(0);
  }, 800);
});
