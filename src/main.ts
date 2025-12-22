import { config } from 'dotenv';
config({ path: 'config/environments/.env' });

import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { connectionSourcePromise } from 'config/typeorm.datasource';
import { NextFunction, Request, Response } from 'express';
import rateLimit, {
  RateLimitRequestHandler,
  ipKeyGenerator,
} from 'express-rate-limit';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { NonceMiddleware } from './auth/nonce.middleware';
import { ConfigCheckService } from './config-check/config-check.service';
import { getAppVersion } from './shared/utilities/version.utility';

function createRateLimiter(options: {
  windowMins: number;
  max: number;
  useCfConnectingIp?: boolean;
}): RateLimitRequestHandler {
  const { windowMins, max, useCfConnectingIp = false } = options;

  const errorMessage = `Too many requests`;
  const fullErrorMessage = `${errorMessage}, please try again after ${windowMins} minutes`;

  return rateLimit({
    windowMs: windowMins * 60 * 1000,
    max,
    message: fullErrorMessage,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({
        status: 429,
        error: errorMessage,
        message: fullErrorMessage,
      });
    },
    skipSuccessfulRequests: false,
    keyGenerator: (req: Request, _res: Response) => {
      if (useCfConnectingIp) {
        const cfIpHeader = req.headers['cf-connecting-ip'];
        if (typeof cfIpHeader === 'string' && cfIpHeader.trim().length > 0) {
          return cfIpHeader.trim();
        }
      }

      return ipKeyGenerator(req.ip);
    },
  });
}

async function bootstrap() {
  const configCheckService = new ConfigCheckService();
  configCheckService.validateInput(process.env); // Validate the environment variables

  // Define global rate limiting rules (baseline protection)
  const globalApiLimiter = createRateLimiter({
    windowMins: 5,
    max: 50,
  });

  // Stricter rate limiting for authentication-related routes
  const strictAuthLimiter = createRateLimiter({
    windowMins: 15,
    max: 10,
    useCfConnectingIp: true,
  });

  // Create NestJS application
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Use environment vars
  const configService = app.get(ConfigService);

  // Use the nonce middleware
  app.use(new NonceMiddleware().use);

  // Initialize the DataSource
  const connectionSource = await connectionSourcePromise;
  await connectionSource.initialize();

  const appEnv = configService.get('NODE_ENV') ?? 'dev';
  const inProduction = appEnv === 'prod';
  const inDevelopment = appEnv === 'dev';
  const inLocal = appEnv === 'local';

  const devAllowedOrigins = [
    'http://localhost:4200',
    'https://dev.startrekonline.info',
  ];
  const prodAllowedOrigins = ['https://startrekonline.info'];

  let allowedOrigins = devAllowedOrigins;
  if (inProduction) {
    allowedOrigins = prodAllowedOrigins;
  }

  const allowedMethods = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';
  const allowedHeaders =
    'Origin, X-Requested-With, Content-Type, Accept, Authorization';

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strips non-whitelisted properties (those without validation decorators in the DTO)
      forbidNonWhitelisted: true, // Throws an error when non-whitelisted properties are present
      transform: true, // Transforms the plain JavaScript request body object into an instance of the corresponding DTO class
      validationError: { target: false }, // Controls the detail level in validation error messages, if set to false it prevents leaking internal details to the client
    }),
  ); // Enable data validation with transform option

  // Add HTTP headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Use the random nonce generated in the middleware
    const nonce: string = res.locals.nonce;

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      return res.status(403).send('Access Forbidden');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }

    // Access-Control headers
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: allowedMethods,
      allowedHeaders: allowedHeaders,
    });

    // Caching headers
    res.header(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    ); // sets Cache-Control HTTP header to no-store to prevent caching of the response
    res.header('Pragma', 'no-cache'); // sets Pragma HTTP header to no-cache to prevent caching of the response
    res.header('Expires', '0'); // sets Expires HTTP header to 0 to prevent caching of the response
    res.header('Surrogate-Control', 'no-store'); // sets Surrogate-Control HTTP header to no-store to prevent caching of the response
    res.header('Vary', '*'); // sets Vary HTTP header to * to prevent caching of the response

    // Use a more relaxed CSP for Swagger, otherwise use the strict one
    const isSwagger = req.originalUrl.startsWith('/swagger');
    if (isSwagger && (inDevelopment || inLocal)) {
      // Allow inline styles and external fonts for swagger
      let fontsProtocol = 'https';
      let connectSrcUrl = 'https://dev-api.startrekonline.info';
      if (inLocal) {
        fontsProtocol = 'http';
        connectSrcUrl = 'http://localhost:3000';
      }

      res.header(
        'Content-Security-Policy',
        `default-src 'none'; ` +
          `frame-ancestors 'none'; ` +
          `style-src 'self' 'unsafe-inline' ${fontsProtocol}://fonts.googleapis.com; ` +
          `font-src 'self' ${fontsProtocol}://fonts.gstatic.com; ` +
          `img-src 'self' data: blob:; ` +
          `script-src 'self' 'unsafe-inline'; ` +
          `connect-src 'self' ${connectSrcUrl};`,
      );
    } else {
      // Sets the Content-Security-Policy to prevent various types of attacks
      res.header(
        'Content-Security-Policy',
        `default-src 'none'; ` +
          `frame-ancestors 'none'; ` +
          `style-src 'self'; ` +
          `img-src 'self'; ` +
          `script-src 'self' 'nonce-${nonce}';`,
      );
    }

    next();
  });

  // Enable Helmet, a collection of 11 smaller middleware functions that set security-related HTTP headers
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable Helmet's default CSP middleware (allows us to set our own CSP as above including the nonce)
      frameguard: { action: 'deny' }, // Sets X-Frame-Options HTTP header to DENY to prevent clickjacking
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // Sets the Referrer-Policy to strict-origin-when-cross-origin to prevent leaking of the referrer to external sites
    }),
  );

  // Apply global baseline rate limiting to all routes
  app.use('/', globalApiLimiter);

  // Apply stricter rate limits for sensitive authentication endpoints
  app.use(
    [
      '/auth/login',
      '/auth/refresh',
      '/auth/register',
      '/auth/verify-email',
      '/auth/resend-verification-email',
      '/auth/request-password-reset',
      '/auth/reset-password',
    ],
    strictAuthLimiter,
  );

  if (!inLocal) {
    app.set('trust proxy', 1); // Trust only the first proxy (Cloudflare used as a proxy) - needed for rate limiting
  }

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector))); // Enable class serializer interceptor for managing response data

  if (!inProduction) {
    // Set up Swagger for API documentation
    const config = new DocumentBuilder()
      .setTitle('STO Info API')
      .setDescription('The STO Info API documentation')
      .setVersion(getAppVersion())
      .addBearerAuth() // Enable JWT authentication in Swagger UI
      .build();

    // Set up Swagger UI endpoint
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document);
  }

  // Start listening for requests on the specified port
  await app.listen(Number.parseInt(process.env.APP_PORT) || 3000);
}
bootstrap(); // NOSONAR - ignore Sonar warning S7785
