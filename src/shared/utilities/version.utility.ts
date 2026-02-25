import { existsSync, readFileSync } from 'node:fs';
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
  const pathsToTry = [
    join(process.cwd(), 'package.json'),
    join(__dirname, '..', '..', '..', 'package.json'), // Relative to dist/src/shared/utilities/
    join(__dirname, '..', '..', 'package.json'), // Relative to src/shared/utilities/ (local dev)
  ];

  for (const packageJsonPath of pathsToTry) {
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    try {
      const packageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf-8'),
      ) as {
        version?: string;
      };
      if (packageJson?.version) {
        return packageJson.version;
      }
    } catch (error) {
      // If we found a file but it's invalid JSON, log a debug message.
      // We still continue to try other paths just in case.
      console.debug(
        `Found package.json at ${packageJsonPath} but failed to parse it.`,
        error,
      );
    }
  }

  throw new Error(
    `Unable to find or parse package.json in any of the expected locations: ${pathsToTry.join(', ')}`,
  );
}
