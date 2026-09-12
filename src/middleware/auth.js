import { logger } from '../utils/logger.js';

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN;

let warned = false;

/**
 * Authentication middleware for /api/* routes
 * Checked against ADMIN_API_TOKEN in .env
 * If ADMIN_API_TOKEN is empty/unset, allows requests in dev mode with a one-time warning.
 */
export function requireAuth(req, res, next) {
  if (!ADMIN_TOKEN) {
    if (!warned) {
      logger.warn('⚠️ ADMIN_API_TOKEN is not configured in .env. API endpoints are running in unprotected dev mode.');
      warned = true;
    }
    return next();
  }

  const token = req.headers['x-admin-token'] || req.query.token || req.headers['authorization']?.replace('Bearer ', '');
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({
      error: 'Unauthorized — Thiếu hoặc sai ADMIN_API_TOKEN',
      status: 401
    });
  }

  next();
}

/**
 * CSRF & Drive-by Localhost Attack Shield
 * Protects state-changing endpoints (POST, PUT, DELETE, PATCH)
 * Excludes server-to-server webhooks and CLI commands (Scope Isolation).
 */
export function csrfShield(req, res, next) {
  // 1. Safe HTTP methods bypass
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // 2. Server-to-server webhooks & internal CLI tools bypass
  const path = req.path || '';
  const originalUrl = req.originalUrl || '';
  if (
    path.startsWith('/webhook') || 
    originalUrl.includes('/webhook') ||
    path === '/system/shutdown' || 
    originalUrl.includes('/system/shutdown') ||
    path === '/health' ||
    originalUrl === '/health'
  ) {
    return next();
  }

  // 3. Admin token bypass (for external automated scripts / integrations)
  const headers = req.headers || {};
  const adminToken = process.env.ADMIN_API_TOKEN;
  const clientToken = headers['x-admin-token'] || req.query?.token || headers['authorization']?.replace('Bearer ', '');
  if (adminToken && clientToken === adminToken) {
    return next();
  }

  // 4. Layer 1: Block browser cross-site requests via Fetch Metadata
  const secFetchSite = headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return res.status(403).json({
      error: 'Forbidden: Cross-Site request blocked by CSRF Shield',
      status: 403
    });
  }

  // 5. Layer 2: Require custom header (CORS Preflight Barrier)
  if (headers['x-zaloflow-client'] !== '1') {
    return res.status(403).json({
      error: 'Forbidden: Missing or invalid X-ZaloFlow-Client header',
      status: 403
    });
  }

  // 6. Layer 3: Origin validation (supports localhost, LAN IP, and Tunnel host)
  const origin = headers['origin'];
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const reqHost = headers['x-forwarded-host'] || headers['host'];
      const isLocal = originHost.startsWith('127.0.0.1') || originHost.startsWith('localhost') || originHost.startsWith('[::1]');
      if (!isLocal && originHost !== reqHost) {
        return res.status(403).json({
          error: 'Forbidden: Invalid request origin',
          status: 403
        });
      }
    } catch {
      return res.status(403).json({
        error: 'Forbidden: Malformed Origin header',
        status: 403
      });
    }
  }

  next();
}

