import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { NestExpressApplication } from '@nestjs/platform-express';
import { connectionSourcePromise } from 'config/typeorm.datasource';
import { AppModule } from './app.module';
import { NonceMiddleware } from './auth/nonce.middleware';
import { ConfigCheckService } from './config-check/config-check.service';
import { getAppVersion } from './shared/utilities/version.utility';

async function bootstrap() {
  const configCheckService = new ConfigCheckService();
  configCheckService.validateInput(process.env); // Validate the environment variables

  // Define rate limiting rules
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // Rate limiting window set to 15 minutes
    max: 100, // Maximum number of requests per IP within the window
  });

  // Create NestJS application
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Use the nonce middleware first
  app.use(new NonceMiddleware().use);

  // Use environment vars
  const configService = app.get(ConfigService);

  // Initialize the DataSource
  const connectionSource = await connectionSourcePromise;
  await connectionSource.initialize();

  const appEnv = configService.get('NODE_ENV');
  const inProduction = appEnv === 'prod';
  const inDevelopment = appEnv === 'dev';
  const inLocal = appEnv === 'local';

  const localAllowedOrigins = ['http://localhost:4200'];
  const devAllowedOrigins = [
    'https://dev.startrekonline.info',
    'https://sto-info-frontend.onrender.com/',
  ];
  const prodAllowedOrigins = ['https://startrekonline.info'];

  let allowedOrigins;
  if (inLocal) {
    allowedOrigins = localAllowedOrigins;
  } else if (inDevelopment) {
    allowedOrigins = devAllowedOrigins;
  } else {
    allowedOrigins = prodAllowedOrigins;
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strips non-whitelisted properties (those without validation decorators in the DTO)
      forbidNonWhitelisted: true, // Throws an error when non-whitelisted properties are present
      transform: true, // Transforms the plain JavaScript request body object into an instance of the corresponding DTO class
      validationError: { target: false }, // Controls the detail level in validation error messages, if set to false it prevents leaking internal details to the client
    }),
  ); // Enable data validation with transform option

  if (inLocal) {
    // Local Dev CORS
    app.enableCors({
      origin: localAllowedOrigins,
      credentials: true,
      methods: 'GET,HEAD,OPTIONS,POST,PUT',
      allowedHeaders:
        'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    });
  } else if (inDevelopment) {
    // Development CORS
    app.enableCors({
      origin: devAllowedOrigins,
      credentials: true,
      methods: 'GET,HEAD,OPTIONS,POST,PUT',
      allowedHeaders:
        'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    });
  } else {
    // Production CORS
    app.enableCors({
      origin: prodAllowedOrigins,
      credentials: true,
      methods: 'GET,HEAD,OPTIONS,POST,PUT',
      allowedHeaders:
        'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    });
  }

  // Add HTTP headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Use the random nonce generated in the middleware
    const nonce: string = res.locals.nonce;

    // Access-Control
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS,POST,PUT');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    );

    // Caching headers
    res.header(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    ); // sets Cache-Control HTTP header to no-store to prevent caching of the response
    res.header('Pragma', 'no-cache'); // sets Pragma HTTP header to no-cache to prevent caching of the response
    res.header('Expires', '0'); // sets Expires HTTP header to 0 to prevent caching of the response
    res.header('Surrogate-Control', 'no-store'); // sets Surrogate-Control HTTP header to no-store to prevent caching of the response
    res.header('Vary', '*'); // sets Vary HTTP header to * to prevent caching of the response

    // Security headers
    res.header('X-Content-Type-Options', 'nosniff'); // sets X-Content-Type-Options HTTP header to nosniff to prevent MIME type sniffing
    res.header('X-Frame-Options', 'DENY'); // sets X-Frame-Options HTTP header to DENY to prevent clickjacking
    res.header('X-XSS-Protection', '1; mode=block'); // enables XSS protection
    res.header('Referrer-Policy', 'same-origin'); // sets the Referrer-Policy to same-origin to prevent leaking of the referrer to external sites

    // Use a more relaxed CSP for Swagger, otherwise use the strict one

    const isSwagger = req.originalUrl.startsWith('/swagger');
    if (isSwagger) {
      // Allow inline styles and external fonts for swagger
      let fontsProtocol = 'https';
      let connectSrcUrl =
        'https://sto-info-backend.onrender.com https://dev-api.startrekonline.info';
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

  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable Helmet's default CSP middleware (allows us to set our own CSP as above including the nonce)
    }),
  ); // Enable Helmet, a collection of 11 smaller middleware functions that set security-related HTTP headers
  app.use('/', apiLimiter); // Apply rate limiting to all routes

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
  await app.listen(parseInt(process.env.APP_PORT) || 3000);
}
bootstrap();
