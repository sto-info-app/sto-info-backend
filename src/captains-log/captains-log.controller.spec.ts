import { BadRequestException } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { CaptainsLogAdminController } from './captains-log-admin.controller';
import { LogEntryType } from './captains-log.constants';
import { CaptainsLogController } from './captains-log.controller';
import { CaptainsLogService } from './captains-log.service';
import { PublicCaptainsLogController } from './public-captains-log.controller';

/** Each service method the controllers call, answering with its own name. */
const METHODS = [
  'list',
  'get',
  'create',
  'update',
  'remove',
  'setPicture',
  'clearPicture',
  'listPublic',
  'getForAdmin',
  'removeForAdmin',
] as const;

type Service = Record<
  (typeof METHODS)[number],
  jest.Mock<(...args: unknown[]) => Promise<unknown>>
>;

/** The picture a member uploads. */
const file = { originalname: 'bridge.jpg' } as Express.Multer.File;

describe('Captain’s Log controllers (sc-1450)', () => {
  let service: Service;
  let log: CaptainsLogService;

  beforeEach(() => {
    service = Object.fromEntries(
      METHODS.map(method => [
        method,
        jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue(method),
      ]),
    ) as Service;
    log = service as unknown as CaptainsLogService;
  });

  describe('CaptainsLogController', () => {
    let controller: CaptainsLogController;

    beforeEach(() => {
      controller = new CaptainsLogController(log);
    });

    it('hands the caller’s own reads and writes to the service', async () => {
      const created = { type: LogEntryType.CAPTAIN, body: 'Engage.' };
      const changed = { body: 'Make it so.' };

      await expect(
        controller.list('user-1', { type: LogEntryType.PERSONAL }),
      ).resolves.toBe('list');
      await expect(controller.get('user-1', 'entry-1')).resolves.toBe('get');
      await expect(controller.create('user-1', created)).resolves.toBe(
        'create',
      );
      await expect(
        controller.update('user-1', 'entry-1', changed),
      ).resolves.toBe('update');
      await expect(controller.remove('user-1', 'entry-1')).resolves.toBe(
        'remove',
      );
      await expect(controller.clearPicture('user-1', 'entry-1')).resolves.toBe(
        'clearPicture',
      );

      expect(service.list).toHaveBeenCalledWith('user-1', {
        type: LogEntryType.PERSONAL,
      });
      expect(service.get).toHaveBeenCalledWith('user-1', 'entry-1');
      expect(service.create).toHaveBeenCalledWith('user-1', created);
      expect(service.update).toHaveBeenCalledWith('user-1', 'entry-1', changed);
      expect(service.remove).toHaveBeenCalledWith('user-1', 'entry-1');
      expect(service.clearPicture).toHaveBeenCalledWith('user-1', 'entry-1');
    });

    it('sends a described picture to be scanned', async () => {
      await expect(
        controller.setPicture('user-1', 'entry-1', file, {
          altText: 'The bridge',
        }),
      ).resolves.toBe('setPicture');

      expect(service.setPicture).toHaveBeenCalledWith('user-1', 'entry-1', {
        altText: 'The bridge',
        file,
      });
    });

    it('refuses an upload with no picture in it', () => {
      expect(() =>
        controller.setPicture('user-1', 'entry-1', undefined, {
          altText: 'The bridge',
        }),
      ).toThrow(BadRequestException);
      expect(service.setPicture).not.toHaveBeenCalled();
    });
  });

  describe('PublicCaptainsLogController', () => {
    it('lists a profile’s Captain’s entries for whoever is reading', async () => {
      const controller = new PublicCaptainsLogController(log);

      await expect(
        controller.list('captain.picard', null, { page: 2 }),
      ).resolves.toBe('listPublic');
      expect(service.listPublic).toHaveBeenCalledWith('captain.picard', null, {
        page: 2,
      });
    });
  });

  describe('CaptainsLogAdminController', () => {
    it('reads and removes an entry for a site admin', async () => {
      const controller = new CaptainsLogAdminController(log);

      await expect(controller.get('entry-1')).resolves.toBe('getForAdmin');
      await expect(
        controller.remove('admin-1', 'entry-1', { reason: 'Spoilers' }),
      ).resolves.toBe('removeForAdmin');

      expect(service.getForAdmin).toHaveBeenCalledWith('entry-1');
      expect(service.removeForAdmin).toHaveBeenCalledWith(
        'admin-1',
        'entry-1',
        'Spoilers',
      );
    });
  });
});
