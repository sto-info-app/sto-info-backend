import { Injectable, Logger } from '@nestjs/common';
import * as AWS from 'aws-sdk';

@Injectable()
export class SecretsService {
  private secretsManager: AWS.SecretsManager;
  private cache: { [key: string]: any } = {};
  private readonly logger = new Logger(SecretsService.name);

  constructor() {
    this.secretsManager = new AWS.SecretsManager({
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
      const data = await this.secretsManager
        .getSecretValue({ SecretId: secretName })
        .promise();

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
