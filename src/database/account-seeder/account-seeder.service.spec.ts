import { Test, TestingModule } from '@nestjs/testing';
import { LauncherService } from 'src/sto/launcher/launcher.service';
import { PlatformLauncherService } from 'src/sto/platform-launcher/platform-launcher.service';
import { PlatformService } from 'src/sto/platform/platform.service';
import { AccountSeederService } from './account-seeder.service';

describe('AccountSeederService', () => {
  let service: AccountSeederService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountSeederService,
        {
          provide: PlatformService,
          useValue: {
            findOneByName: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: LauncherService,
          useValue: {
            findOneByName: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: PlatformLauncherService,
          useValue: {
            findOne: jest.fn(),
            addPlatformLauncherRelation: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AccountSeederService>(AccountSeederService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
