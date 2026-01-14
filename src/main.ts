import { config } from 'dotenv';
config({ path: 'config/environments/.env' });

import { HttpStatus, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { json, NextFunction, Request, Response, urlencoded } from 'express';
import rateLimit, {
  ipKeyGenerator,
  RateLimitRequestHandler,
} from 'express-rate-limit';
import helmet from 'helmet';
import Redis from 'ioredis';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { RedisStore } from 'rate-limit-redis';

import { AppModule } from './app.module';
import { NonceMiddleware } from './auth/nonce.middleware';
import { clientIpMiddleware } from './common/http/client-ip.middleware';
import { ConfigCheckService } from './config-check/config-check.service';
import { getLogLevelsForEnvironment } from './shared/constants/logging.constants';
import {
  AUTH_RATE_LIMITED_ROUTES,
  EXPENSIVE_RATE_LIMITED_ROUTES,
  RATE_LIMIT_CONFIGS,
  RATE_LIMIT_EXCLUDED_PATHS,
} from './shared/constants/rate-limit.constants';
import { SWAGGER_UI_DARK_THEME_CSS } from './shared/constants/swagger.constants';
import { getAppVersion } from './shared/utilities/version.utility';

function toMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatStartupMemory(message: string) {
  const mem = process.memoryUsage();

  return `[startup] ${message} | rss=${toMb(mem.rss)} heapUsed=${toMb(mem.heapUsed)} heapTotal=${toMb(mem.heapTotal)} external=${toMb(mem.external)} arrayBuffers=${toMb(mem.arrayBuffers)}`;
}

function createRateLimiter(
  options: {
    windowMins: number;
    max: number;
    skipSuccessfulRequests?: boolean;
  },
  redis: Redis,
  prefix: string,
): RateLimitRequestHandler {
  const { windowMins, max, skipSuccessfulRequests = false } = options;

  const errorMessage = `Too many requests`;
  const minuteLabel = windowMins === 1 ? 'minute' : 'minutes';
  const fullErrorMessage = `${errorMessage}, please try again after ${windowMins} ${minuteLabel}`;

  return rateLimit({
    windowMs: windowMins * 60 * 1000,
    max,
    message: fullErrorMessage,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request) => {
      // Skip rate limiting for OPTIONS requests (CORS preflight)
      return req.method === 'OPTIONS';
    },
    handler: (_req: Request, res: Response) => {
      const retryAfter = Math.ceil(windowMins * 60);
      res.setHeader('Retry-After', retryAfter.toString());

      res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        status: HttpStatus.TOO_MANY_REQUESTS,
        error: errorMessage,
        message: fullErrorMessage,
        retryAfter: retryAfter,
      });
    },
    skipSuccessfulRequests,
    skipFailedRequests: false,
    keyGenerator: (req: Request) => {
      return ipKeyGenerator(req.clientIp ?? req.ip ?? '');
    },
    store: new RedisStore({
      // @ts-expect-error - ioredis and rate-limit-redis type mismatch on call
      sendCommand: (...args: string[]) => redis.call(...args),
      prefix: `rl:${prefix}:`,
    }),
  });
}

async function bootstrap() {
  const startupDiagnosticsEnabled =
    (process.env.STARTUP_DIAGNOSTICS ?? '').toLowerCase() === 'true';
  const startTime = performance.now();

  // Hybrid diagnostics logging:
  // - Prefer Nest Logger when 'log' level is enabled.
  // - Fall back to console when it isn't (so prod with strict levels still shows diagnostics).
  // Note: the effective logger override happens during NestFactory.create.
  const startupLogger = new Logger('Startup');

  if (startupDiagnosticsEnabled) {
    // At this point we don't yet know the configured log levels, so use console.
    console.log(formatStartupMemory('bootstrap:start'));
  }

  const configCheckService = new ConfigCheckService();
  configCheckService.validateInput(process.env); // Validate the environment variables

  // Initialize Redis store for rate limiting
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number.parseInt(process.env.REDIS_PORT) || 6379,
  });

  // Define rate limiters based on operation type
  const readLimiter = createRateLimiter(RATE_LIMIT_CONFIGS.READ, redis, 'read');
  const writeLimiter = createRateLimiter(
    RATE_LIMIT_CONFIGS.WRITE,
    redis,
    'write',
  );
  const authLimiter = createRateLimiter(RATE_LIMIT_CONFIGS.AUTH, redis, 'auth');
  const expensiveLimiter = createRateLimiter(
    RATE_LIMIT_CONFIGS.EXPENSIVE,
    redis,
    'expensive',
  );

  // Determine log levels based on environment
  const logLevels = getLogLevelsForEnvironment(
    process.env.NODE_ENV,
    process.env.LOG_LEVEL,
  );

  const shouldUseNestLoggerForStartup = logLevels.includes('log');
  const logStartup = (message: string) => {
    const line = formatStartupMemory(message);

    if (shouldUseNestLoggerForStartup) {
      startupLogger.log(line);
      return;
    }

    console.log(line);
  };

  // Create NestJS application with custom body parser limits and configured logger
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: logLevels,
  });

  if (startupDiagnosticsEnabled) {
    logStartup(
      `after NestFactory.create (+${(performance.now() - startTime).toFixed(0)}ms)`,
    );
  }

  // Use environment vars
  const configService = app.get(ConfigService);

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

  //NOTE(CRITICAL): Enable CORS FIRST, before any other middleware
  // This ensures preflight OPTIONS requests receive proper CORS headers
  // even if they're rejected by subsequent middleware
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: allowedMethods,
    allowedHeaders: allowedHeaders,
  });

  // Trust only the first proxy (Cloudflare used as a proxy) - needed for rate limiting
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);

  // Set trust proxy if not in local environment
  if (!inLocal) {
    app.set('trust proxy', trustProxyHops);
  }

  // Global request size limits
  const maxImageSize =
    configService.get<number>('MAX_IMAGE_SIZE_IN_BYTES') || 10485760;
  const maxTotalPayloadSize = maxImageSize + 102400; // image size + 100KB overhead

  // Set limits for standard body parsers (JSON & URL-encoded)
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ limit: '1mb', extended: true }));

  // Global Content-Length check to prevent early processing of oversized requests
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.headers['content-length'];
    if (
      contentLength &&
      Number.parseInt(contentLength, 10) > maxTotalPayloadSize
    ) {
      return res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: `Payload too large. Maximum allowed size is ${maxTotalPayloadSize} bytes.`,
        error: 'Payload Too Large',
      });
    }
    next();
  });

  // Use the client IP middleware
  app.use(clientIpMiddleware);

  // Use the nonce middleware
  app.use(new NonceMiddleware().use);

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

  // Apply strict rate limits to authentication endpoints (highest priority)
  app.use([...AUTH_RATE_LIMITED_ROUTES], authLimiter);

  // Apply strict rate limits to expensive operations (searches, uploads)
  app.use([...EXPENSIVE_RATE_LIMITED_ROUTES], expensiveLimiter);

  // Apply method-based rate limiting (general rules)
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip explicitly excluded paths
    if (RATE_LIMIT_EXCLUDED_PATHS.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Apply different limits based on HTTP method
    if (req.method === 'GET' || req.method === 'HEAD') {
      return readLimiter(req, res, next);
    } else {
      // POST, PUT, PATCH, DELETE (OPTIONS handled by skip function)
      return writeLimiter(req, res, next);
    }
  });

  // Applied via AppModule:
  // app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  if (!inProduction) {
    const require = createRequire(__filename);

    // swagger-ui-themes is CSS-only; resolve the CSS file directly
    const themeCssPath =
      require.resolve('swagger-ui-themes/themes/3.x/theme-monokai.css');
    const themeCss = readFileSync(themeCssPath, 'utf8');

    // Set up Swagger for API documentation
    const config = new DocumentBuilder()
      .setTitle('STO Info API')
      .setDescription('The STO Info API documentation')
      .setVersion(getAppVersion())
      .addBearerAuth() // Enable JWT authentication in Swagger UI
      .build();

    // Set up Swagger UI endpoint
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('swagger', app, document, {
      customCss: themeCss + SWAGGER_UI_DARK_THEME_CSS,
    });
  }

  // Force module initialization before listening so we can log a stable "post-init" baseline.
  // `app.listen()` calls init internally if needed, but calling it explicitly helps diagnostics.
  await app.init();

  if (startupDiagnosticsEnabled) {
    logStartup(
      `after app.init (+${(performance.now() - startTime).toFixed(0)}ms)`,
    );
  }

  // Start listening for requests on the specified port
  await app.listen(Number.parseInt(process.env.APP_PORT) || 3000);

  if (startupDiagnosticsEnabled) {
    logStartup(`listening (+${(performance.now() - startTime).toFixed(0)}ms)`);
  }
}
bootstrap(); // NOSONAR - ignore Sonar warning S7785
