import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: app.get(ConfigService).get('FRONTEND_URL', 'http://localhost:3000'),
    credentials: true,
  });

  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3001);

  console.log('NestJS running on port 3001');
}

void bootstrap();
