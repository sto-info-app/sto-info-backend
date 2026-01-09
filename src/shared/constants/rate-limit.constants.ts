/**
 * Rate limiting configuration constants
 * Centralised configuration for all rate limiting rules across the application
 */

/**
 * Rate limit configurations for different operation types
 */
export const RATE_LIMIT_CONFIGS = {
  /**
   * Read-only operations (GET, HEAD requests)
   * Most generous limits for lightweight read operations
   */
  READ: {
    windowMins: 15,
    max: 1500, // ~100 requests per minute
    skipSuccessfulRequests: true, // Only count failed requests
  },

  /**
   * Write operations (POST, PUT, PATCH, DELETE)
   * Moderate limits for data modification
   */
  WRITE: {
    windowMins: 15,
    max: 200, // ~13 requests per minute
    skipSuccessfulRequests: false, // Count all write attempts
  },

  /**
   * Authentication endpoints
   * Strictest limits to prevent brute force attacks
   */
  AUTH: {
    windowMins: 15,
    max: 20, // ~1.3 requests per minute
    skipSuccessfulRequests: false, // Count all auth attempts
  },

  /**
   * Expensive operations (searches, file uploads)
   * Strict limits for resource-intensive operations
   */
  EXPENSIVE: {
    windowMins: 15,
    max: 50, // ~3 requests per minute
    skipSuccessfulRequests: false, // Count all expensive operations
  },
} as const;

/**
 * Authentication endpoint paths that require strict rate limiting
 */
export const AUTH_RATE_LIMITED_ROUTES = [
  '/auth/login',
  '/auth/refresh',
  '/auth/register',
  '/auth/verify-email',
  '/auth/resend-verification-email',
  '/auth/request-password-reset',
  '/auth/reset-password',
] as const;

/**
 * Expensive operation endpoint patterns that require strict rate limiting
 * These are resource-intensive operations like complex searches or file uploads
 */
export const EXPENSIVE_RATE_LIMITED_ROUTES = [
  '/character/search',
  '/character/*/upload',
  '/account/search',
] as const;

/**
 * Paths that should be excluded from rate limiting
 */
export const RATE_LIMIT_EXCLUDED_PATHS = ['/health/'] as const;
