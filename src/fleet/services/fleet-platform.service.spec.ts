import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PlatformEntity } from 'src/sto/platform/entities/platform.entity';

import { FleetPlatformService } from './fleet-platform.service';

describe('FleetPlatformService', () => {
  let service: FleetPlatformService;
  let platformRepository: { find: jest.Mock; findOne: jest.Mock };

  const windows = {
    id: 'e0000000-0000-4000-8000-000000000001',
    name: 'Windows',
  } as PlatformEntity;

  const playStation = {
    id: 'e0000000-0000-4000-8000-000000000002',
    name: 'PlayStation',
  } as PlatformEntity;

  /** What the repository will answer `findOne` with. */
  let stored: PlatformEntity | null;

  beforeEach(async () => {
    stored = windows;

    platformRepository = {
      find: jest.fn(() => Promise.resolve([windows, playStation])),
      findOne: jest.fn(() => Promise.resolve(stored)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FleetPlatformService,
        {
          provide: getRepositoryToken(PlatformEntity),
          useValue: platformRepository,
        },
      ],
    }).compile();

    service = module.get<FleetPlatformService>(FleetPlatformService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByIdOrFail', () => {
    it('reads the platform a request named', async () => {
      await expect(service.findByIdOrFail(windows.id)).resolves.toBe(windows);
    });

    /**
     * A platform is reference data the client chose from a list it was
     * given, so naming one that is not there is a malformed request rather
     * than a page that is missing.
     */
    it('refuses an identifier naming no platform as a bad request', async () => {
      stored = null;

      await expect(
        service.findByIdOrFail('e0000000-0000-4000-8000-00000000000f'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findBySegmentOrFail', () => {
    it('reads the platform a URL segment names', async () => {
      await expect(service.findBySegmentOrFail('windows')).resolves.toBe(
        windows,
      );
    });

    /**
     * Every address the site writes is lowercase, but a link somebody saved
     * years ago need not be, and a working link that stops working is a
     * worse outcome than a second spelling of one address.
     */
    it('resolves a capitalised segment somebody saved long ago', async () => {
      await expect(service.findBySegmentOrFail('PlayStation')).resolves.toBe(
        playStation,
      );
    });

    /**
     * There is deliberately no fallback. Serving a Fleet from the wrong
     * platform under a plausible address is worse than serving none, because
     * the reader has no way of knowing they were given the wrong one.
     */
    it('answers absent for a segment naming no platform', async () => {
      await expect(
        service.findBySegmentOrFail('dreamcast'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
