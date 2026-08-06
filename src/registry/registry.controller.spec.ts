import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { RegistrySort } from './enums/registry-sort.enum';
import { RegistryController } from './registry.controller';
import { RegistryService } from './registry.service';

describe('RegistryController', () => {
  let controller: RegistryController;
  let service: jest.Mocked<RegistryService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegistryController],
      providers: [
        {
          provide: RegistryService,
          useValue: {
            findProfiles: jest.fn(),
            findProfileByUsername: jest.fn(),
            findAccount: jest.fn(),
            findCharacter: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<RegistryController>(RegistryController);
    service = module.get(RegistryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findProfiles', () => {
    it('should delegate the query to the service', () => {
      const query = { search: 'picard', sort: RegistrySort.RECENTLY_ACTIVE };

      controller.findProfiles(query);

      expect(service.findProfiles).toHaveBeenCalledWith(query);
    });
  });

  describe('findProfile', () => {
    it('should delegate the username to the service', () => {
      controller.findProfile('captain.picard');

      expect(service.findProfileByUsername).toHaveBeenCalledWith(
        'captain.picard',
      );
    });
  });

  describe('findAccount', () => {
    it('should delegate the username and account slug to the service', () => {
      controller.findAccount('captain.picard', 'SteveX~1234');

      expect(service.findAccount).toHaveBeenCalledWith(
        'captain.picard',
        'SteveX~1234',
      );
    });
  });

  describe('findCharacter', () => {
    it('should delegate all three slugs to the service', () => {
      controller.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex@SteveX~1234',
      );

      expect(service.findCharacter).toHaveBeenCalledWith(
        'captain.picard',
        'SteveX~1234',
        'Rex@SteveX~1234',
      );
    });
  });
});
