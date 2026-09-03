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
