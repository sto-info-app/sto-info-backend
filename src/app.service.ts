import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from './shared/secrets/secrets.service';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private secretsService: SecretsService) {}

  async getJwtSecret(): Promise<string> {
    try {
      const secretObject = await this.secretsService.getSecret('mySecret');
      return secretObject.jwtSecret;
    } catch (err) {
      this.logger.error('Failed to get JWT secret', err.stack);
      throw err;
    }
  }

  getHello(): string {
    return `Hello ${process.env.NODE_ENV || 'World'}!`;
  }
}
