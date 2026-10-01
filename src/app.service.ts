import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Returns a greeting message including the current environment name.
   *
   * @returns A greeting message string.
   */
  getHello(): string {
    return `Hello ${process.env.NODE_ENV || 'World'}!`;
  }

  /**
   * Reads the application version from the package.json file.
   *
   * @returns The semantic version string of the application.
   */
  getAppVersion(): string {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  }
}
