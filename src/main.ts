import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { NestExpressApplication } from '@nestjs/platform-express';
import { connectionSourcePromise } from 'config/typeorm.datasource';
import { AppModule } from './app.module';
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

  app.use(helmet()); // Enable Helmet, a collection of 11 smaller middleware functions that set security-related HTTP headers
  app.use('/', apiLimiter); // Apply rate limiting to all routes

  // Add HTTP headers
  app.use((req, res, next) => {
    res.header(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    );
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    res.header('Surrogate-Control', 'no-store');
    res.header('Vary', '*');
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Referrer-Policy', 'same-origin');
    res.header(
      'Content-Security-Policy',
      "default-src 'self' *.startrekonline.info; script-src 'self' 'unsafe-inline' 'unsafe-eval' *.startrekonline.info; style-src 'self' 'unsafe-inline' *.startrekonline.info; img-src 'self' data: *.startrekonline.info; font-src 'self' data: *.startrekonline.info; connect-src 'self' *.startrekonline.info; frame-src 'self' *.startrekonline.info; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self'; block-all-mixed-content;",
    );
    next();
  });

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
