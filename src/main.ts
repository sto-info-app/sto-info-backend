import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set up Swagger
  const config = new DocumentBuilder()
    .setTitle('STO Info API')
    .setDescription('The STO Info API documentation')
    .setVersion('1.0')
    .addBearerAuth() // Enable JWT authentication in Swagger UI
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('swagger', app, document);

  await app.listen(parseInt(process.env.APP_PORT) || 3000);
}
bootstrap();
