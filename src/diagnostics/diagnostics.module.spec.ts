import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Logger,
  Module,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import request from 'supertest';

import { OptionalJwtAuthGuard } from 'src/auth/optional-jwt-auth.guard';
import { AppStateController } from 'src/notification/app-state.controller';
import { NotificationService } from 'src/notification/notification.service';

import { DiagnosticsModule } from './diagnostics.module';
import { MemoryDiagnosticsService } from './memory-diagnostics.service';

@Module({ imports: [DiagnosticsModule] })
class OtherConsumerModule {}

@Controller('rejected')
class RejectedController {
  @Get()
  @UseGuards({ canActivate: () => false })
  get(): void {}
}

describe('DiagnosticsModule HTTP integration', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('shares one sampler, counts after guards, and clears its timer on application close', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    log.mockClear();
    const interval = jest.spyOn(global, 'setInterval');
    const clear = jest.spyOn(global, 'clearInterval');
    const module = await Test.createTestingModule({
      imports: [DiagnosticsModule, OtherConsumerModule],
      controllers: [AppStateController, RejectedController],
      providers: [
        {
          provide: NotificationService,
          useValue: { getAppState: () => ({ banners: [], unreadCount: 0 }) },
        },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ MEMORY_DIAGNOSTICS_ENABLED: 'true' }))
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (req.headers['x-test-auth']) req.user = { id: 'test' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
    expect(interval).toHaveBeenCalledTimes(1);
    await request(app.getHttpServer()).get('/app-state?poll=1').expect(200);
    await request(app.getHttpServer())
      .get('/app-state/')
      .set('x-test-auth', 'yes')
      .expect(200);
    await request(app.getHttpServer()).get('/rejected').expect(403);
    await request(app.getHttpServer()).get('/not-found').expect(404);
    module.get(MemoryDiagnosticsService).logMemory('interval');
    const samples = log.mock.calls
      .map(call => call[0])
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.startsWith('{'),
      )
      .map(value => JSON.parse(value));
    expect(samples).toHaveLength(2);
    expect(samples[1]).toMatchObject({
      requestsSinceLastSample: 2,
      authenticatedRequestsSinceLastSample: 1,
      appStateRequestsSinceLastSample: 2,
    });
    await app.close();
    expect(clear).toHaveBeenCalledWith(interval.mock.results[0].value);
  });
});
