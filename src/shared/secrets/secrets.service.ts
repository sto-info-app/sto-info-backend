import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SecretsService {
  private readonly _secretsManager: SecretsManagerClient;
  private cache: { [key: string]: any } = {};
  private readonly _logger = new Logger(SecretsService.name);

  /**
   * Creates an instance of SecretsService and initialises the AWS Secrets Manager client.
   */
  constructor() {
    this._secretsManager = new SecretsManagerClient({
      region: process.env.AWS_REGION,
    });
  }

  /**
   * Retrieves a secret from AWS Secrets Manager by name.
   *
   * Results are cached locally for subsequent calls to improve performance.
   *
   * @param secretName - The name or ARN of the secret to retrieve.
   * @returns A promise that resolves to the parsed secret object, or undefined if not found.
   * @throws Will rethrow any error encountered during retrieval from AWS.
   */
  async getSecret(secretName: string): Promise<any> {
    try {
      // Check the cache first
      if (this.cache[secretName]) {
        return this.cache[secretName];
      }

      // If it's not in the cache, retrieve it
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const data = await this._secretsManager.send(command);

      if (!('SecretString' in data) || !data.SecretString) {
        return undefined;
      }

      // Parse the secret from JSON into an object
      const secretObject = JSON.parse(data.SecretString);
      // Store the secret object in the cache
      this.cache[secretName] = secretObject;
      return secretObject;
    } catch (err: unknown) {
      const stack = err instanceof Error ? err.stack : undefined;
      this._logger.error(`Failed to get secret ${secretName}`, stack);
      throw err;
    }
  }
}
