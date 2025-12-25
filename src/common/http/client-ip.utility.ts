import type { Request } from 'express';

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
  return normaliseIp(req.ip);
}

function normaliseIp(ip: string): string {
  // Convert IPv6-mapped IPv4 like "::ffff:10.216.24.251" -> "10.216.24.251"
  return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
}
