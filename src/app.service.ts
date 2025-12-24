import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SecretsService } from './shared/secrets/secrets.service';

@Injectable()
export class AppService {
  private readonly _logger = new Logger(AppService.name);

  /**
   * Creates an instance of AppService.
   *
   * @param secretsService - Service used to retrieve application secrets.
   */
  constructor(private readonly _secretsService: SecretsService) {}

  /**
   * Retrieves the JWT secret from the secrets service.
   *
   * @returns A promise that resolves to the JWT secret string.
   * @throws Will rethrow any error encountered while fetching the secret.
   */
  async getJwtSecret(): Promise<string> {
    try {
      const secretObject = await this._secretsService.getSecret('mySecret');
      return secretObject.jwtSecret;
    } catch (err) {
      this._logger.error('Failed to get JWT secret', err.stack);
      throw err;
    }
  }

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
