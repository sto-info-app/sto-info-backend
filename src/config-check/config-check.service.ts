import { Injectable } from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import {
  IsBooleanString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  ValidateIf,
  validateSync,
} from 'class-validator';

//NOTE: Define ALL environment variables in this class.
//NOTE: The app will throw an error when it starts up if missing/invalid.
class EnvironmentVariables {
  @IsNotEmpty()
  @IsIn(['local', 'dev', 'staging', 'prod'])
  NODE_ENV: string;

  @IsNotEmpty()
  @IsString()
  @Matches(
    /^(error|warn|log|debug|verbose)(,(error|warn|log|debug|verbose))*$/,
    {
      message:
        'LOG_LEVEL must be one of error,warn,log,debug,verbose (optionally comma-separated)',
    },
  )
  LOG_LEVEL: string;

  @IsNotEmpty()
  @IsNumber()
  APP_PORT: number;

  @IsNotEmpty()
  @ValidateIf(
    o =>
      !o.APP_FRONTEND_URL.startsWith('http://localhost') &&
      !o.APP_FRONTEND_URL.startsWith('https://localhost'),
  )
  @IsUrl()
  APP_FRONTEND_URL: string;

  @IsNotEmpty()
  @IsString()
  APP_TITLE: string;

  @IsNotEmpty()
  @IsNumber()
  AUTH_SALT_ROUNDS: number;

  @IsNotEmpty()
  @IsNumber()
  AUTH_TOKEN_EXPIRES_IN: number;

  @IsNotEmpty()
  @IsNumber()
  AUTH_REFRESH_TOKEN_EXPIRES_IN: number;

  @IsNotEmpty()
  @IsString()
  @IsIn(['postgres'])
  DB_TYPE: string;

  @IsNotEmpty()
  @IsString()
  DB_HOST: string;

  @IsNotEmpty()
  @IsNumber()
  DB_PORT: number;

  @IsNotEmpty()
  @IsString()
  DB_NAME: string;

  @IsNotEmpty()
  @IsString()
  DB_SCHEMA: string;

  @IsNotEmpty()
  @IsString()
  DB_USERNAME: string;

  @IsNotEmpty()
  @IsBooleanString()
  DB_SSL_REJECT_UNAUTHORIZED: string;

  @IsNotEmpty()
  @IsBooleanString()
  TYPEORM_SYNCHRONIZE: string;

  @IsNotEmpty()
  @IsBooleanString()
  TYPEORM_LOGGING: string;

  @IsNotEmpty()
  @IsString()
  TYPEORM_ENTITIES: string;

  @IsNotEmpty()
  @IsString()
  TYPEORM_MIGRATIONS: string;

  @IsNotEmpty()
  @IsEmail()
  EMAIL_NOREPLY_SENDER: string;

  @IsNotEmpty()
  @IsString()
  AWS_ACCESS_KEY_ID: string;

  @IsNotEmpty()
  @IsString()
  AWS_SECRET_ACCESS_KEY: string;

  @IsNotEmpty()
  @IsString()
  AWS_REGION: string;

  @IsNotEmpty()
  @IsString()
  AWS_SECRET_NAME: string;

  @IsNotEmpty()
  @IsString()
  AWS_SNS_TOPIC_ARN: string;

  @IsNotEmpty()
  @IsString()
  AWS_SES_CONFIGURATION_SET: string;

  @IsNotEmpty()
  @IsNumber()
  SES_AUDIT_RETENTION_DAYS: number;

  @IsNotEmpty()
  @IsNumber()
  SES_SUPPRESSION_RETENTION_DAYS: number;

  @IsOptional()
  @IsEmail()
  DATASEED_USER_EMAIL?: string;

  @IsOptional()
  @IsString()
  DATASEED_USER_USERNAME?: string;

  @IsOptional()
  @IsString()
  DATASEED_USER_FIRSTNAME?: string;

  @IsOptional()
  @IsString()
  DATASEED_USER_LASTNAME?: string;

  @IsOptional()
  @IsString()
  DATASEED_USER_PASSWORD?: string;

  @IsNotEmpty()
  @ValidateIf(o => !o.CLOUDFLARE_R2_ENDPOINT.startsWith('https://'))
  @IsUrl()
  CLOUDFLARE_R2_ENDPOINT: string;

  @IsNotEmpty()
  @IsString()
  CLOUDFLARE_R2_BUCKET_NAME: string;

  @IsNotEmpty()
  @ValidateIf(o => !o.CLOUDFLARE_CDN_ROOT_URL.startsWith('https://'))
  @IsUrl()
  CLOUDFLARE_CDN_ROOT_URL: string;

  @IsNotEmpty()
  @IsString()
  CLOUDFLARE_IMAGES_HASH: string;

  @IsNotEmpty()
  @IsNumber()
  MAX_IMAGE_SIZE_IN_BYTES: number;

  @IsNotEmpty()
  @IsNumber()
  AUDIT_DATA_NUKE_THRESHOLD_DAYS: number;

  @IsNotEmpty()
  @IsNumber()
  AUDIT_IP_NUKE_THRESHOLD_DAYS: number;

  @IsNotEmpty()
  @IsNumber()
  CONTACT_REQUEST_EMAIL_MASK_RETENTION_DAYS: number;

  @IsNotEmpty()
  @IsNumber()
  CONTACT_REQUEST_RECORD_RETENTION_DAYS: number;

  @IsOptional()
  @IsNumber()
  TRUST_PROXY_HOPS: number;

  @IsNotEmpty()
  @IsString()
  @Matches(/^rediss?:\/\/.+/, {
    message:
      'REDIS_URL must be a valid Redis connection string (redis:// or rediss://)',
  })
  REDIS_URL: string;
}

@Injectable()
export class ConfigCheckService {
  /**
   * Creates an instance of ConfigCheckService.
   */
  constructor() {}

  /**
   * Validates the supplied environment configuration.
   *
   * @param envConfig - The env config.
   * @returns The result of the operation.
   */
  validateInput(envConfig: Record<string, string>) {
    const config = plainToClass(EnvironmentVariables, envConfig, {
      enableImplicitConversion: true,
    });
    const errors = validateSync(config, { skipMissingProperties: false });

    if (errors.length > 0) {
      throw new Error(`Validation error: ${errors}`);
    }

    return config;
  }

  /**
   * Gets the value.
   *
   * @param key - The key.
   * @returns The result of the operation.
   */
  get(key: string): string | undefined {
    const value = process.env[key];
    return typeof value === 'string' ? value : undefined;
  }
}
