import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual, createHash } from 'crypto';

const API_KEY = process.env.API_KEY;

function getApiKeyFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xApiKey = req.headers['x-api-key'];
  if (typeof xApiKey === 'string') {
    return xApiKey.trim();
  }
  return null;
}

/**
 * Constant-time comparison of two strings.
 * If expected is empty (API_KEY not set), returns false.
 */
function secureCompare(actual: string, expected: string): boolean {
  if (!expected || expected.length === 0) return false;
  if (actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Sets req.authenticated based on API_KEY header.
 * Does not block unauthenticated requests; rate limiter uses this for tier selection.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.authenticated = false;
  if (!API_KEY) {
    next();
    return;
  }
  const provided = getApiKeyFromRequest(req);
  if (provided !== null && secureCompare(provided, API_KEY)) {
    req.authenticated = true;
    req.authenticatedKeyId = createHash('sha256')
      .update(provided)
      .digest('hex');
  }
  next();
}
