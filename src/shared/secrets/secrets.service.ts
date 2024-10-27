import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SecretsService {
  private secretsManager: SecretsManagerClient;
  private cache: { [key: string]: any } = {};
  private readonly logger = new Logger(SecretsService.name);

  constructor() {
    this.secretsManager = new SecretsManagerClient({
      region: process.env.AWS_REGION,
    });
  }

  async getSecret(secretName: string): Promise<any> {
    try {
      // Check the cache first
      if (this.cache[secretName]) {
        return this.cache[secretName];
      }

      // If it's not in the cache, retrieve it
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const data = await this.secretsManager.send(command);

      if ('SecretString' in data) {
        // Parse the secret from JSON into an object
        const secretObject = JSON.parse(data.SecretString);
        // Store the secret object in the cache
        this.cache[secretName] = secretObject;
        return secretObject;
      }
    } catch (err) {
      this.logger.error(`Failed to get secret ${secretName}`, err.stack);
      throw err;
    }
  }
}
