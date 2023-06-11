import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ConfigCheckService } from './config-check/config-check.service';
import { getAppVersion } from './shared/utilities/version.utility';

async function bootstrap() {
  new ConfigCheckService(); // This will validate the environment variables

  // Define rate limiting rules
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // Rate limiting window set to 15 minutes
    max: 100, // Maximum number of requests per IP within the window
  });

  // Create NestJS application
  const app = await NestFactory.create(AppModule);

  // Use environment vars
  const configService = app.get(ConfigService);

  const appEnv = configService.get('NODE_ENV');
  const inProduction = appEnv === 'prod' ? true : false;

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strips non-whitelisted properties (those without validation decorators in the DTO)
      forbidNonWhitelisted: true, // Throws an error when non-whitelisted properties are present
      transform: true, // Transforms the plain JavaScript request body object into an instance of the corresponding DTO class
      validationError: { target: false }, // Controls the detail level in validation error messages, if set to false it prevents leaking internal details to the client
    }),
  ); // Enable data validation with transform option
  app.enableCors(); // Enable CORS (Cross-Origin Resource Sharing)
  app.use(helmet()); // Enable Helmet, a collection of 11 smaller middleware functions that set security-related HTTP headers
  app.use('/', apiLimiter); // Apply rate limiting to all routes
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
