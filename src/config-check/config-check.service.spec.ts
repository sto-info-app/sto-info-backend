import { Test, TestingModule } from '@nestjs/testing';
import { ConfigCheckService } from './config-check.service';

describe('ConfigCheckService', () => {
  let service: ConfigCheckService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfigCheckService],
    }).compile();

    service = module.get<ConfigCheckService>(ConfigCheckService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateInput', () => {
    const validConfig = {
      NODE_ENV: 'local',
      LOG_LEVEL: 'log',
      APP_PORT: '3000',
      APP_FRONTEND_URL: 'http://localhost:3000',
      APP_TITLE: 'Test App',
      AUTH_SALT_ROUNDS: '10',
      AUTH_TOKEN_EXPIRES_IN: '3600',
      AUTH_REFRESH_TOKEN_EXPIRES_IN: '86400',
      DB_TYPE: 'postgres',
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_NAME: 'testdb',
      DB_SCHEMA: 'public',
      DB_USERNAME: 'testuser',
      DB_SSL_REJECT_UNAUTHORIZED: 'false',
      TYPEORM_SYNCHRONIZE: 'false',
      TYPEORM_LOGGING: 'false',
      TYPEORM_ENTITIES: 'dist/**/*.entity.js',
      TYPEORM_MIGRATIONS: 'dist/database/migrations/*.js',
      EMAIL_NOREPLY_SENDER: 'noreply@test.com',
      AWS_ACCESS_KEY_ID: 'test-key-id',
      AWS_SECRET_ACCESS_KEY: 'test-secret',
      AWS_REGION: 'us-east-1',
      AWS_SECRET_NAME: 'test-secret',
      AWS_SNS_TOPIC_ARN:
        'arn:aws:sns:eu-west-2:123456789012:sto-info-ses-bounces',
      AWS_SES_CONFIGURATION_SET: 'sto-info-app',
      SES_AUDIT_RETENTION_DAYS: '90',
      SES_SUPPRESSION_RETENTION_DAYS: '2557',
      CLOUDFLARE_R2_ENDPOINT: 'https://endpoint.r2.cloudflarestorage.com',
      CLOUDFLARE_R2_BUCKET_NAME: 'test-bucket',
      CLOUDFLARE_CDN_ROOT_URL: 'https://cdn.test.com',
      CLOUDFLARE_IMAGES_HASH: 'test-hash',
      MAX_IMAGE_SIZE_IN_BYTES: '5242880',
      AUDIT_DATA_NUKE_THRESHOLD_DAYS: '90',
      AUDIT_IP_NUKE_THRESHOLD_DAYS: '30',
      CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS: '21',
      CONTACT_REQUEST_RECORD_RETENTION_DAYS: '90',
      REDIS_URL: 'redis://localhost:6379',
    };

    it('should validate correct configuration', () => {
      const result = service.validateInput(validConfig);
      expect(result).toBeDefined();
      expect(result.NODE_ENV).toBe('local');
      expect(result.APP_PORT).toBe(3000);
    });

    it('should throw error for missing required field', () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as any).NODE_ENV;

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'Validation error',
      );
    });

    it('should throw error for invalid port number', () => {
      const invalidConfig = { ...validConfig, APP_PORT: 'not-a-number' };

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'Validation error',
      );
    });

    it('should throw error for invalid email', () => {
      const invalidConfig = {
        ...validConfig,
        EMAIL_NOREPLY_SENDER: 'invalid-email',
      };

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'Validation error',
      );
    });

    it('should throw error for invalid boolean string', () => {
      const invalidConfig = {
        ...validConfig,
        TYPEORM_SYNCHRONIZE: 'invalid',
      };

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'Validation error',
      );
    });

    it('should accept localhost URLs without https for APP_FRONTEND_URL', () => {
      const config = {
        ...validConfig,
        APP_FRONTEND_URL: 'http://localhost:4200',
      };

      const result = service.validateInput(config);
      expect(result.APP_FRONTEND_URL).toBe('http://localhost:4200');
    });

    it('should accept https for production APP_FRONTEND_URL', () => {
      const config = {
        ...validConfig,
        APP_FRONTEND_URL: 'https://example.com',
      };

      const result = service.validateInput(config);
      expect(result.APP_FRONTEND_URL).toBe('https://example.com');
    });

    it('should accept https:// prefix for CLOUDFLARE_R2_ENDPOINT without validation', () => {
      const config = { ...validConfig };
      const result = service.validateInput(config);
      expect(result.CLOUDFLARE_R2_ENDPOINT).toContain('https://');
    });

    it('should accept https:// prefix for CLOUDFLARE_CDN_ROOT_URL without validation', () => {
      const config = { ...validConfig };
      const result = service.validateInput(config);
      expect(result.CLOUDFLARE_CDN_ROOT_URL).toContain('https://');
    });

    it('should handle optional TRUST_PROXY_HOPS', () => {
      const config = { ...validConfig, TRUST_PROXY_HOPS: '1' };
      const result = service.validateInput(config);
      expect(result.TRUST_PROXY_HOPS).toBe(1);
    });

    it('should work without optional TRUST_PROXY_HOPS', () => {
      const config = { ...validConfig };
      const result = service.validateInput(config);
      expect(result).toBeDefined();
    });

    it('should accept valid redis:// URL for REDIS_URL', () => {
      const config = { ...validConfig, REDIS_URL: 'redis://localhost:6379' };
      const result = service.validateInput(config);
      expect(result.REDIS_URL).toBe('redis://localhost:6379');
    });

    it('should accept valid rediss:// URL for REDIS_URL (secure Redis)', () => {
      const config = {
        ...validConfig,
        REDIS_URL: 'rediss://red-example:6380',
      };
      const result = service.validateInput(config);
      expect(result.REDIS_URL).toBe('rediss://red-example:6380');
    });

    it('should throw error for REDIS_URL without redis protocol', () => {
      const invalidConfig = {
        ...validConfig,
        REDIS_URL: 'http://localhost:6379',
      };

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'Validation error',
      );
    });

    it('should throw error for missing REDIS_URL', () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as any).REDIS_URL;

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'Validation error',
      );
    });
  });

  describe('get', () => {
    it('should return environment variable value', () => {
      process.env.TEST_VAR = 'test-value';
      const result = service.get('TEST_VAR');
      expect(result).toBe('test-value');
      delete process.env.TEST_VAR;
    });

    it('should return undefined for non-existent variable', () => {
      const result = service.get('NON_EXISTENT_VAR');
      expect(result).toBeUndefined();
    });
  });
});
