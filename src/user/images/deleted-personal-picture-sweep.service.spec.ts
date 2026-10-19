import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { FileAssetSubject } from 'src/file-assets/enums/file-asset-subject.enum';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';

import { UserProfileEntity } from '../entities/user-profile.entity';
import { UserEntity } from '../entities/user.entity';
import {
  DELETED_PERSONAL_PICTURE_SWEEP_LOCK,
  DeletedPersonalPicture,
  DeletedPersonalPictureSweepService,
} from './deleted-personal-picture-sweep.service';
import {
  PERSONAL_PICTURE_REASONS,
  PersonalPictureWithdrawalService,
} from './personal-picture-withdrawal.service';

/** Where each entity's table is, as the database metadata would say. */
const TABLES = new Map<unknown, { schema?: string; tableName: string }>([
  [UserEntity, { schema: 'sto_info_app', tableName: 'user' }],
  [UserProfileEntity, { schema: 'sto_info_app', tableName: 'user_profile' }],
  [AccountEntity, { schema: 'sto_info_app', tableName: 'account' }],
  [CharacterEntity, { schema: 'sto_info_app', tableName: 'character' }],
  [FileAssetEntity, { schema: 'sto_info_app', tableName: 'file_asset' }],
]);

const PROFILE: DeletedPersonalPicture = {
  subject: FileAssetSubject.USER_PROFILE,
  subjectId: 'user-1',
  imageId: 'profile-1',
  reason: PERSONAL_PICTURE_REASONS.ACCOUNT_CLOSED,
};

const PORTRAIT: DeletedPersonalPicture = {
  subject: FileAssetSubject.STO_CHARACTER,
  subjectId: 'character-1',
  imageId: 'portrait-1',
  reason: PERSONAL_PICTURE_REASONS.CHARACTER_DELETED,
};

describe('DeletedPersonalPictureSweepService', () => {
  let service: DeletedPersonalPictureSweepService;
  let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };
  let dataSource: {
    createQueryRunner: jest.Mock;
    getMetadata: jest.Mock;
    query: jest.Mock;
  };
  let pictures: { withdraw: jest.Mock };

  beforeEach(() => {
    runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string) =>
        Promise.resolve(
          sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
        ),
      ),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      createQueryRunner: jest.fn(() => runner),
      getMetadata: jest.fn((entity: unknown) => TABLES.get(entity)),
      query: jest.fn().mockResolvedValue([]),
    };
    pictures = { withdraw: jest.fn().mockResolvedValue(undefined) };
    service = new DeletedPersonalPictureSweepService(
      dataSource as unknown as DataSource,
      pictures as unknown as PersonalPictureWithdrawalService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findPictures', () => {
    it('looks for still-served pictures on closed accounts, deleted STO accounts and deleted Characters', async () => {
      await service.findPictures();

      const [sql, parameters] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];

      expect(sql).toContain('FROM "sto_info_app"."user_profile" p');
      expect(sql).toContain('FROM "sto_info_app"."character" c');
      expect(sql).toContain('LEFT JOIN "sto_info_app"."account" a');
      expect(sql).toContain('LEFT JOIN "sto_info_app"."user" u');
      expect(sql).toContain('JOIN "sto_info_app"."file_asset" f');
      expect(sql).toContain(
        '(p."deletedAt" IS NOT NULL OR u."deletedAt" IS NOT NULL)',
      );
      expect(sql).toContain(
        '(c."deletedAt" IS NOT NULL OR a."deletedAt" IS NOT NULL OR u."deletedAt" IS NOT NULL)',
      );
      expect(sql).toContain('f."state"::text = ANY($6::text[])');
      expect(parameters).toEqual([
        FileAssetSubject.USER_PROFILE,
        FileAssetSubject.STO_CHARACTER,
        PERSONAL_PICTURE_REASONS.ACCOUNT_CLOSED,
        PERSONAL_PICTURE_REASONS.STO_ACCOUNT_DELETED,
        PERSONAL_PICTURE_REASONS.CHARACTER_DELETED,
        [FileAssetState.AVAILABLE, FileAssetState.UNVERIFIED],
      ]);
    });

    // A Character of a closed account records the closure; one of a deleted
    // STO account, that deletion.
    it('puts a portrait down to the widest deletion that took it', async () => {
      await service.findPictures();

      const [sql] = dataSource.query.mock.calls[0] as [string];

      expect(sql).toMatch(
        /CASE WHEN u\."deletedAt" IS NOT NULL THEN \$3::text\s+WHEN a\."deletedAt" IS NOT NULL THEN \$4::text\s+ELSE \$5::text END/,
      );
    });
  });

  describe('sweep', () => {
    it('withdraws each picture with the reason found for it', async () => {
      dataSource.query.mockResolvedValue([PROFILE, PORTRAIT]);

      await expect(service.sweep()).resolves.toBe(2);

      expect(pictures.withdraw.mock.calls).toEqual([
        [PROFILE, PROFILE.reason],
        [PORTRAIT, PORTRAIT.reason],
      ]);
      expect(Logger.prototype.log).toHaveBeenCalledWith(
        '[sweep] Deleted profile pictures and portraits withdrawn - Withdrawn: 2, Failed: 0',
      );
    });

    it('logs a picture it cannot withdraw by its record', async () => {
      const failed = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      dataSource.query.mockResolvedValue([PORTRAIT]);
      pictures.withdraw.mockRejectedValueOnce(new Error('registry down'));

      await expect(service.sweep()).resolves.toBe(0);

      expect(failed).toHaveBeenCalledWith(
        '[sweep] Not withdrawn - Subject: STO_CHARACTER, SubjectId: character-1, ImageId: portrait-1',
        expect.stringContaining('registry down'),
      );
    });
  });

  it('sweeps under its own lock', async () => {
    await service.run();

    expect(runner.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
      [DELETED_PERSONAL_PICTURE_SWEEP_LOCK],
    );
  });

  it('logs a failed run under its own name', async () => {
    const failed = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    dataSource.query.mockRejectedValue(new Error('connection lost'));

    await expect(service.run()).resolves.toBeNull();

    expect(failed).toHaveBeenCalledWith(
      '[run] Deleted profile pictures and portraits not swept',
      expect.stringContaining('connection lost'),
    );
  });
});
