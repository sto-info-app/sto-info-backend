import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import {
  CHAT_MEMBER_HISTORY_HOURS,
  CHAT_TRANSCRIPT_HISTORY_DAYS,
  FLEET_CUSTOM_CHANNEL_LIMIT,
  PUBLISHED_CHAT_RETENTION_DAYS,
  PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
} from 'src/fleet/constants/fleet-policy.constants';

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
      CLOSED_ACCOUNT_RETENTION_DAYS: '180',
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

    it('should throw error for missing CLOSED_ACCOUNT_RETENTION_DAYS', () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as any).CLOSED_ACCOUNT_RETENTION_DAYS;

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'Validation error',
      );
    });

    it('should throw error when CLOSED_ACCOUNT_RETENTION_DAYS is less than AUDIT_DATA_NUKE_THRESHOLD_DAYS', () => {
      const invalidConfig = {
        ...validConfig,
        AUDIT_DATA_NUKE_THRESHOLD_DAYS: '90',
        CLOSED_ACCOUNT_RETENTION_DAYS: '30',
      };

      expect(() => service.validateInput(invalidConfig)).toThrow(
        'CLOSED_ACCOUNT_RETENTION_DAYS',
      );
    });

    it('should accept CLOSED_ACCOUNT_RETENTION_DAYS equal to AUDIT_DATA_NUKE_THRESHOLD_DAYS', () => {
      const config = {
        ...validConfig,
        AUDIT_DATA_NUKE_THRESHOLD_DAYS: '90',
        CLOSED_ACCOUNT_RETENTION_DAYS: '90',
      };

      const result = service.validateInput(config);
      expect(result.CLOSED_ACCOUNT_RETENTION_DAYS).toBe(90);
    });

    describe('Storytime configuration', () => {
      // Every Storytime variable is optional, so an environment that has never
      // heard of the feature must still start.
      it('should accept a configuration with no Storytime variables at all', () => {
        expect(() => service.validateInput({ ...validConfig })).not.toThrow();
      });

      it('should accept the Storytime capability flags', () => {
        const config = {
          ...validConfig,
          STORYTIME_PUBLIC_READ_ENABLED: 'true',
          STORYTIME_CREATION_ENABLED: 'false',
          STORYTIME_YOUTUBE_ENABLED: 'true',
          STORYTIME_SPOTLIGHT_ENABLED: 'false',
        };

        expect(() => service.validateInput(config)).not.toThrow();
      });

      // A typo here would otherwise leave a capability in a state nobody
      // intended, discovered only when a creator hit it.
      it('should reject a capability flag that is not a boolean', () => {
        const config = {
          ...validConfig,
          STORYTIME_CREATION_ENABLED: 'yes please',
        };

        expect(() => service.validateInput(config)).toThrow('Validation error');
      });

      it('should accept the Storytime limits', () => {
        const config = {
          ...validConfig,
          STORYTIME_MAX_STORIES_PER_USER: '50',
          STORYTIME_MAX_CHAPTERS_PER_STORY: '200',
          STORYTIME_MAX_CHARACTERS_PER_STORY: '100',
          STORYTIME_MAX_CONTENT_LENGTH: '100000',
        };

        const result = service.validateInput(config);
        expect(result.STORYTIME_MAX_STORIES_PER_USER).toBe(50);
        expect(result.STORYTIME_MAX_CONTENT_LENGTH).toBe(100000);
      });

      it('should reject a limit that is not a number', () => {
        const config = {
          ...validConfig,
          STORYTIME_MAX_STORIES_PER_USER: 'unlimited',
        };

        expect(() => service.validateInput(config)).toThrow('Validation error');
      });

      // The master switch is a runtime setting in app_setting, not an
      // environment variable, so it must not be validated as one here.
      it('should ignore STORYTIME_ENABLED as an environment variable', () => {
        const config = { ...validConfig, STORYTIME_ENABLED: 'not-a-boolean' };

        expect(() => service.validateInput(config)).not.toThrow();
      });
    });

    describe('Fleet retention configuration', () => {
      let warn: jest.SpiedFunction<typeof Logger.warn>;

      beforeEach(() => {
        warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      // An environment that has never heard of Fleet must still start, and the
      // published figures apply when nothing overrides them.
      it('should accept a configuration with no Fleet variables at all', () => {
        expect(() => service.validateInput({ ...validConfig })).not.toThrow();
        expect(warn).not.toHaveBeenCalled();
      });

      it('should accept the published figures', () => {
        const result = service.validateInput({
          ...validConfig,
          CHAT_RETENTION_DAYS: String(PUBLISHED_CHAT_RETENTION_DAYS),
          IMPORT_SOURCE_RETENTION_DAYS: String(
            PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
          ),
        });

        expect(result.CHAT_RETENTION_DAYS).toBe(PUBLISHED_CHAT_RETENTION_DAYS);
        expect(result.IMPORT_SOURCE_RETENTION_DAYS).toBe(
          PUBLISHED_IMPORT_SOURCE_RETENTION_DAYS,
        );
        expect(warn).not.toHaveBeenCalled();
      });

      // Tightening is always allowed: a deployment that keeps less than the
      // policy promises is more protective, not less.
      it('should accept a retention shorter than the published figure', () => {
        expect(() =>
          service.validateInput({ ...validConfig, CHAT_RETENTION_DAYS: '14' }),
        ).not.toThrow();
      });

      /**
       * The one refusal. A transcript covering seven days of history that is
       * only retained for three is an export that silently returns less than it
       * offers, which plan section 9 names directly.
       */
      it('should refuse a retention shorter than the transcript window', () => {
        expect(() =>
          service.validateInput({
            ...validConfig,
            CHAT_RETENTION_DAYS: String(CHAT_TRANSCRIPT_HISTORY_DAYS - 1),
          }),
        ).toThrow('Validation error');
      });

      it('should accept a retention equal to the transcript window', () => {
        expect(() =>
          service.validateInput({
            ...validConfig,
            CHAT_RETENTION_DAYS: String(CHAT_TRANSCRIPT_HISTORY_DAYS),
          }),
        ).not.toThrow();
      });

      /**
       * Warned about rather than refused. R22 makes the figure configurable, so
       * an environment is entitled to raise it — but it is published in the
       * privacy policy, and a deployment that quietly retains chat for longer
       * than the policy states is the undocumented increase plan section 9
       * warns about.
       */
      it('should warn when chat retention exceeds the published policy', () => {
        service.validateInput({ ...validConfig, CHAT_RETENTION_DAYS: '90' });

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('exceeds the published policy'),
          'ConfigCheckService',
        );
      });

      it('should warn when source retention exceeds the published policy', () => {
        service.validateInput({
          ...validConfig,
          IMPORT_SOURCE_RETENTION_DAYS: '365',
        });

        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('IMPORT_SOURCE_RETENTION_DAYS'),
          'ConfigCheckService',
        );
      });

      it('should refuse a source retention of zero days', () => {
        expect(() =>
          service.validateInput({
            ...validConfig,
            IMPORT_SOURCE_RETENTION_DAYS: '0',
          }),
        ).toThrow('Validation error');
      });

      it.each(['CHAT_RETENTION_DAYS', 'IMPORT_SOURCE_RETENTION_DAYS'])(
        'should reject a non-integer %s',
        key => {
          expect(() =>
            service.validateInput({ ...validConfig, [key]: 'forever' }),
          ).toThrow('Validation error');
        },
      );

      /**
       * The four-hour window, the seven-day transcript window and the three
       * custom channels are constants with nothing behind them. An environment
       * that sets these names is carried through untouched like any other
       * unrecognised variable and changes nothing — which is the point. The
       * companion assertion lives in `fleet-policy.constants.spec.ts`, where
       * the file is read to prove it names neither `process.env` nor
       * `ConfigService`.
       */
      it.each([
        'CHAT_MEMBER_HISTORY_HOURS',
        'CHAT_TRANSCRIPT_HISTORY_DAYS',
        'FLEET_CUSTOM_CHANNEL_LIMIT',
      ])('should leave %s fixed whatever the environment says', key => {
        const before = {
          CHAT_MEMBER_HISTORY_HOURS,
          CHAT_TRANSCRIPT_HISTORY_DAYS,
          FLEET_CUSTOM_CHANNEL_LIMIT,
        };

        expect(() =>
          service.validateInput({ ...validConfig, [key]: '99' }),
        ).not.toThrow();

        expect({
          CHAT_MEMBER_HISTORY_HOURS,
          CHAT_TRANSCRIPT_HISTORY_DAYS,
          FLEET_CUSTOM_CHANNEL_LIMIT,
        }).toEqual(before);
      });

      // The master switch is a runtime setting in app_setting, not an
      // environment variable, so it must not be validated as one here.
      it('should ignore FLEET_COMMUNITIES_ENABLED as an environment variable', () => {
        expect(() =>
          service.validateInput({
            ...validConfig,
            FLEET_COMMUNITIES_ENABLED: 'not-a-boolean',
          }),
        ).not.toThrow();
      });
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
