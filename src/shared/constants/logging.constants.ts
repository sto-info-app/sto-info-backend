/**
 * Logging constants for the application
 */

/**
 * Individual log level constants
 * Use these instead of magic strings to ensure consistency
 */
export const LOG_LEVEL_ERROR = 'error' as const;
export const LOG_LEVEL_WARN = 'warn' as const;
export const LOG_LEVEL_LOG = 'log' as const;
export const LOG_LEVEL_DEBUG = 'debug' as const;
export const LOG_LEVEL_VERBOSE = 'verbose' as const;

/**
 * Valid log levels for NestJS Logger
 */
export const VALID_LOG_LEVELS = [
  LOG_LEVEL_ERROR,
  LOG_LEVEL_WARN,
  LOG_LEVEL_LOG,
  LOG_LEVEL_DEBUG,
  LOG_LEVEL_VERBOSE,
] as const;

/**
 * Type for valid log levels
 */
export type LogLevel = (typeof VALID_LOG_LEVELS)[number];

/**
 * Default log level if not specified in environment
 */
export const DEFAULT_LOG_LEVEL: LogLevel = LOG_LEVEL_LOG;

/**
 * Log level configurations for different environments
 */
export const ENVIRONMENT_LOG_LEVELS: Record<string, LogLevel[]> = {
  local: [
    LOG_LEVEL_ERROR,
    LOG_LEVEL_WARN,
    LOG_LEVEL_LOG,
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_VERBOSE,
  ],
  dev: [LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_LOG, LOG_LEVEL_DEBUG],
  staging: [LOG_LEVEL_ERROR, LOG_LEVEL_WARN, LOG_LEVEL_LOG],
  prod: [LOG_LEVEL_ERROR, LOG_LEVEL_WARN],
};

/**
 * Default log levels array - uses staging configuration
 * This is a sensible default that works well for most environments
 */
export const DEFAULT_LOG_LEVELS: LogLevel[] = ENVIRONMENT_LOG_LEVELS.staging;

/**
 * Parse the LOG_LEVEL environment variable into an array of log levels
 *
 * @param logLevel - The LOG_LEVEL environment variable value
 * @returns Array of log levels to enable
 *
 * @remarks
 * Supports two formats:
 * 1. Single level (hierarchical): Enables specified level and all levels below it
 * 2. Comma-separated (explicit): Enables only the specified levels
 *
 * @example
 * Single level format:
 * ```typescript
 * parseLogLevel('debug')  // Returns: ['error', 'warn', 'log', 'debug']
 * parseLogLevel('warn')   // Returns: ['error', 'warn']
 * ```
 *
 * @example
 * Comma-separated format:
 * ```typescript
 * parseLogLevel('error,warn')      // Returns: ['error', 'warn']
 * parseLogLevel('error,log,debug') // Returns: ['error', 'log', 'debug']
 * ```
 *
 * @example
 * Invalid or missing input:
 * ```typescript
 * parseLogLevel('invalid')  // Returns: DEFAULT_LOG_LEVELS (staging config)
 * parseLogLevel()           // Returns: DEFAULT_LOG_LEVELS (staging config)
 * ```
 */
export function parseLogLevel(logLevel?: string): LogLevel[] {
  if (!logLevel) {
    return DEFAULT_LOG_LEVELS;
  }

  // Check if multiple levels are specified (comma-separated)
  if (logLevel.includes(',')) {
    const levels = logLevel
      .split(',')
      .map(level => level.trim())
      .filter(level =>
        VALID_LOG_LEVELS.includes(level as LogLevel),
      ) as LogLevel[];

    return levels.length > 0 ? levels : DEFAULT_LOG_LEVELS;
  }

  // Single level specified - use all levels up to and including the specified one
  const levelIndex = VALID_LOG_LEVELS.indexOf(logLevel as LogLevel);

  if (levelIndex >= 0) {
    return VALID_LOG_LEVELS.slice(0, levelIndex + 1) as LogLevel[];
  }

  // Invalid level specified - return default
  return DEFAULT_LOG_LEVELS;
}

/**
 * Get recommended log levels for a specific environment
 *
 * @param env - The NODE_ENV value (local, dev, staging, prod)
 * @param logLevel - Optional LOG_LEVEL environment variable override
 * @returns Array of log levels to enable
 *
 * @remarks
 * Falls back to environment-based defaults if LOG_LEVEL is not explicitly set.
 * If an unknown environment is provided, uses DEFAULT_LOG_LEVELS (staging config).
 *
 * @example
 * With explicit LOG_LEVEL:
 * ```typescript
 * getLogLevelsForEnvironment('prod', 'debug')
 * // Returns: ['error', 'warn', 'log', 'debug']
 * // Overrides production default
 * ```
 *
 * @example
 * Without LOG_LEVEL (uses environment defaults):
 * ```typescript
 * getLogLevelsForEnvironment('prod')
 * // Returns: ['error', 'warn']
 *
 * getLogLevelsForEnvironment('dev')
 * // Returns: ['error', 'warn', 'log', 'debug']
 * ```
 */
export function getLogLevelsForEnvironment(
  env: string = 'dev',
  logLevel?: string,
): LogLevel[] {
  // If LOG_LEVEL is explicitly set, use it
  if (logLevel) {
    return parseLogLevel(logLevel);
  }

  // Otherwise, use environment-based defaults
  return ENVIRONMENT_LOG_LEVELS[env] || DEFAULT_LOG_LEVELS;
}
