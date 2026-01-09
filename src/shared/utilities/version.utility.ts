import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Retrieves the application version from package.json
 *
 * @returns The version string from package.json
 * @throws Error if package.json cannot be read or parsed
 *
 * @example
 * ```typescript
 * const version = getAppVersion();
 * console.log(`App version: ${version}`); // "App version: 1.2.3"
 * ```
 */
export function getAppVersion(): string {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  return packageJson.version;
}
