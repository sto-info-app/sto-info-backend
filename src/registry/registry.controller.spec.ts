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

      controller.findProfiles(query, null);

      expect(service.findProfiles).toHaveBeenCalledWith(query, null);
    });

    it('should pass the authenticated caller through', () => {
      controller.findProfiles({}, 'viewer-1');

      expect(service.findProfiles).toHaveBeenCalledWith({}, 'viewer-1');
    });
  });

  describe('findProfile', () => {
    it('should delegate the username to the service', () => {
      controller.findProfile('captain.picard', null);

      expect(service.findProfileByUsername).toHaveBeenCalledWith(
        'captain.picard',
        null,
      );
    });

    it('should pass the authenticated caller through', () => {
      controller.findProfile('captain.picard', 'viewer-1');

      expect(service.findProfileByUsername).toHaveBeenCalledWith(
        'captain.picard',
        'viewer-1',
      );
    });
  });

  describe('findAccount', () => {
    it('should delegate the username and account slug to the service', () => {
      controller.findAccount('captain.picard', 'SteveX~1234', null);

      expect(service.findAccount).toHaveBeenCalledWith(
        'captain.picard',
        'SteveX~1234',
        null,
      );
    });

    it('should pass the authenticated caller through', () => {
      controller.findAccount('captain.picard', 'SteveX~1234', 'viewer-1');

      expect(service.findAccount).toHaveBeenCalledWith(
        'captain.picard',
        'SteveX~1234',
        'viewer-1',
      );
    });
  });

  describe('findCharacter', () => {
    it('should delegate all three slugs to the service', () => {
      controller.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex@SteveX~1234',
        null,
      );

      expect(service.findCharacter).toHaveBeenCalledWith(
        'captain.picard',
        'SteveX~1234',
        'Rex@SteveX~1234',
        null,
      );
    });

    it('should pass the authenticated caller through', () => {
      controller.findCharacter(
        'captain.picard',
        'SteveX~1234',
        'Rex@SteveX~1234',
        'viewer-1',
      );

      expect(service.findCharacter).toHaveBeenCalledWith(
        'captain.picard',
        'SteveX~1234',
        'Rex@SteveX~1234',
        'viewer-1',
      );
    });
  });
});
