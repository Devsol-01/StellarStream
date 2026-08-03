/**
 * Geolocation Middleware
 * Extracts geographic context from requests for compliance and analytics
 */

import { Request, Response, NextFunction } from "express";
import { geolocationService, hashIP } from "../services/geolocation.service.js";
import { logger } from "../logger.js";

// Extended request with geolocation data
export interface GeoRequest extends Request {
  geo?: {
    countryCode: string;
    region: string | null;
    timezone: string;
    ipHash: string;
  };
}

/**
 * Extract client IP (respects X-Forwarded-For, X-Real-IP headers)
 */
function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  }
  const realIP = req.headers["x-real-ip"];
  if (typeof realIP === "string") return realIP;
  return req.socket.remoteAddress || "unknown";
}

/**
 * Geolocation middleware
 * Adds geo context to request object
 */
export async function geoMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ip = getClientIP(req);
    const ipHash = hashIP(ip);

    // Lookup geolocation
    const geo = await geolocationService.lookupIP(ip);

    if (geo) {
      (req as GeoRequest).geo = {
        countryCode: geo.countryCode,
        region: geo.region,
        timezone: geo.timezone || geolocationService.getTimezone(geo.countryCode),
        ipHash,
      };

      // Log analytics (async, fire-and-forget)
      geolocationService.logAnalytics({
        ip,
        countryCode: geo.countryCode,
        region: geo.region,
        city: geo.city,
        latitude: geo.latitude,
        longitude: geo.longitude,
        userAgent: req.headers["user-agent"],
        path: req.path,
        method: req.method,
        userId: (req as any).user?.address,
      }).catch(() => {});
    }

    next();
  } catch (err) {
    logger.error("[geoMiddleware] Error", { err });
    next();
  }
}

/**
 * Geographic restriction middleware
 * Blocks requests from restricted regions
 */
export async function geoRestrictionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const geoReq = req as GeoRequest;
  const userId = (req as any).user?.address;

  if (!geoReq.geo?.countryCode || !userId) {
    return next();
  }

  const check = await geolocationService.checkRestriction(
    userId,
    geoReq.geo.countryCode,
  );

  if (!check.allowed) {
    res.status(403).json({
      success: false,
      code: "GEO_RESTRICTED",
      error: check.reason,
    });
    return;
  }

  next();
}

/**
 * Timezone detection middleware
 * Adds user timezone to request context
 */
export function timezoneMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const geoReq = req as GeoRequest;
  if (geoReq.geo?.timezone) {
    (req as any).userTimezone = geoReq.geo.timezone;
  }
  next();
}