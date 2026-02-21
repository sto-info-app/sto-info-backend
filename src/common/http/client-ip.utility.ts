import type { Request } from 'express';

/**
 * Extracts the client IP address from an Express request
 *
 * Priority order:
 * 1. Cloudflare CF-Connecting-IP header (most authoritative)
 * 2. X-Forwarded-For header (first IP in list)
 * 3. Express req.ip (fallback, depends on trust proxy setting)
 *
 * @param req - Express request object
 * @returns The client's IP address, normalized to IPv4 format
 *
 * @example
 * ```typescript
 * const clientIp = getClientIp(req);
 * console.log(`Client IP: ${clientIp}`); // "192.168.1.1"
 * ```
 */
export function getClientIp(req: Request): string {
  // 1) Cloudflare: authoritative when present
  const cf = req.header('cf-connecting-ip');
  if (cf && cf.trim().length > 0) {
    return normaliseIp(cf);
  }

  // 2) Standard fallback: first X-Forwarded-For entry
  const xff = req.header('x-forwarded-for');
  if (xff && xff.trim().length > 0) {
    return normaliseIp(xff.split(',')[0].trim());
  }

  // 3) Express-derived IP (depends on trust proxy)
  return normaliseIp(req.ip ?? '');
}

/**
 * Normalises an IP address by converting IPv6-mapped IPv4 addresses to IPv4 format
 *
 * Converts addresses like "::ffff:192.168.1.1" to "192.168.1.1"
 *
 * @param ip - The IP address to normalise
 * @returns The normalised IP address
 *
 * @example
 * ```typescript
 * normaliseIp('::ffff:192.168.1.1'); // Returns: "192.168.1.1"
 * normaliseIp('192.168.1.1');        // Returns: "192.168.1.1"
 * ```
 */
function normaliseIp(ip: string): string {
  // Convert IPv6-mapped IPv4 like "::ffff:10.216.24.251" -> "10.216.24.251"
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
}
