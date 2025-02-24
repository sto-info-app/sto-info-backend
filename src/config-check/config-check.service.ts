import { Injectable } from '@nestjs/common';
import { plainToClass } from 'class-transformer';
import {
  IsBooleanString,
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUrl,
  ValidateIf,
  validateSync,
} from 'class-validator';

//NOTE: Define ALL environment variables in this class.
//NOTE: The app will throw an error when it starts up if missing/invalid.
class EnvironmentVariables {
  @IsNotEmpty()
  @IsString()
  NODE_ENV: string;

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
  SENDGRID_NOREPLY_SENDER: string;

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
  @IsNumber()
  MAX_IMAGE_SIZE_IN_BYTES: number;
}

@Injectable()
export class ConfigCheckService {
  constructor() {}

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

  get(key: string): string {
    return process.env[key];
  }
}
