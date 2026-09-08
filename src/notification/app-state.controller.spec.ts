import { Test, TestingModule } from '@nestjs/testing';

import { jest } from '@jest/globals';

import { AppStateController } from './app-state.controller';
import { NotificationService } from './notification.service';

describe('AppStateController', () => {
  let controller: AppStateController;
  let service: jest.Mocked<NotificationService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppStateController],
      providers: [
        {
          provide: NotificationService,
          useValue: {
            getAppState: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AppStateController);
    service = module.get(NotificationService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates app state for an authenticated user', () => {
    controller.getAppState('user-1');
    expect(service.getAppState).toHaveBeenCalledWith('user-1');
  });

  it('delegates app state for an anonymous caller', () => {
    controller.getAppState(null);
    expect(service.getAppState).toHaveBeenCalledWith(null);
  });
});
