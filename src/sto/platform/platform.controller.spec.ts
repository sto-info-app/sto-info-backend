import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformEntity } from './entities/platform.entity';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

describe('PlatformController', () => {
  let controller: PlatformController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformController],
      providers: [
        PlatformService,
        {
          provide: getRepositoryToken(PlatformEntity),
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<PlatformController>(PlatformController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
