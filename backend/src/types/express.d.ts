import type { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      authenticated?: boolean;
      /** Set when authenticated; used by rate limiter for keying (hash of API key). */
      authenticatedKeyId?: string;
    }
  }
}

export {};
