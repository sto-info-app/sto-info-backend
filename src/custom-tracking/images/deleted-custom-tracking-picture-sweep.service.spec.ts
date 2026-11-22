import { Logger } from '@nestjs/common';

import { DataSource } from 'typeorm';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';
import { AccountEntity } from 'src/sto/account/entities/account.entity';
import { CharacterEntity } from 'src/sto/character/entities/character.entity';
import { UserEntity } from 'src/user/entities/user.entity';
import { PERSONAL_PICTURE_REASONS } from 'src/user/images/personal-picture-withdrawal.service';

import { CustomTrackingFieldEntity } from '../entities/custom-tracking-field.entity';
import { CustomTrackingImageValueEntity } from '../entities/custom-tracking-image-value.entity';
import { CustomTrackingValueEntity } from '../entities/custom-tracking-value.entity';
import {
  CUSTOM_TRACKING_FIELD_DELETED_REASON,
  CustomTrackingFieldPicture,
  CustomTrackingFieldPictureService,
} from './custom-tracking-field-picture.service';
import {
  DELETED_CUSTOM_TRACKING_PICTURE_SWEEP_LOCK,
  DeletedCustomTrackingPictureSweepService,
} from './deleted-custom-tracking-picture-sweep.service';

/** Where each entity's table is, as the database metadata would say. */
const TABLES = new Map<unknown, { schema?: string; tableName: string }>([
  [
    CustomTrackingImageValueEntity,
    { schema: 'sto_info_app', tableName: 'custom_tracking_image_value' },
  ],
  [
    CustomTrackingValueEntity,
    { schema: 'sto_info_app', tableName: 'custom_tracking_value' },
  ],
  [
    CustomTrackingFieldEntity,
    { schema: 'sto_info_app', tableName: 'custom_tracking_field' },
  ],
  [AccountEntity, { schema: 'sto_info_app', tableName: 'account' }],
  [CharacterEntity, { schema: 'sto_info_app', tableName: 'character' }],
  [UserEntity, { schema: 'sto_info_app', tableName: 'user' }],
  [FileAssetEntity, { schema: 'sto_info_app', tableName: 'file_asset' }],
]);

const PICTURE: CustomTrackingFieldPicture = {
  imageValueId: 'image-value-1',
  valueId: 'value-1',
  fieldId: 'field-1',
  targetId: 'account-1',
  imageId: 'image-1',
};

describe('DeletedCustomTrackingPictureSweepService', () => {
  let service: DeletedCustomTrackingPictureSweepService;
  let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };
  let dataSource: {
    createQueryRunner: jest.Mock;
    getMetadata: jest.Mock;
    query: jest.Mock;
  };
  let pictures: { release: jest.Mock };

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
    pictures = { release: jest.fn().mockResolvedValue(undefined) };
    service = new DeletedCustomTrackingPictureSweepService(
      dataSource as unknown as DataSource,
      pictures as unknown as CustomTrackingFieldPictureService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A Field deleted with its Tab or Section carries the same deletion, so
  // asking the Field is enough.
  it('looks for still-served pictures of deleted Fields, Accounts and Characters', async () => {
    await service.findPictures();

    const [sql, parameters] = dataSource.query.mock.calls[0] as [
      string,
      unknown[],
    ];

    expect(sql).toContain(
      'FROM "sto_info_app"."custom_tracking_image_value" iv',
    );
    expect(sql).toContain('JOIN "sto_info_app"."custom_tracking_value" v');
    expect(sql).toContain('JOIN "sto_info_app"."custom_tracking_field" f');
    expect(sql).toContain('JOIN "sto_info_app"."file_asset" a');
    expect(sql).toContain('f."deletedAt" IS NOT NULL');
    expect(sql).toContain('LEFT JOIN "sto_info_app"."account" acc');
    expect(sql).toContain('LEFT JOIN "sto_info_app"."character" ch');
    expect(sql).toContain('LEFT JOIN "sto_info_app"."account" ca');
    expect(sql).toContain('LEFT JOIN "sto_info_app"."user" u');
    expect(sql).toContain('OR acc."deletedAt" IS NOT NULL');
    expect(sql).toContain('OR ch."deletedAt" IS NOT NULL');
    expect(sql).toContain('OR ca."deletedAt" IS NOT NULL');
    expect(sql).toContain('COALESCE(v."accountId", v."characterId")');
    expect(parameters).toEqual([
      [FileAssetState.AVAILABLE, FileAssetState.UNVERIFIED],
      PERSONAL_PICTURE_REASONS.ACCOUNT_CLOSED,
      PERSONAL_PICTURE_REASONS.STO_ACCOUNT_DELETED,
      PERSONAL_PICTURE_REASONS.CHARACTER_DELETED,
      CUSTOM_TRACKING_FIELD_DELETED_REASON,
    ]);
  });

  // A closed account, then a deleted STO Account, then a deleted Character,
  // then a deleted Field.
  it('records the widest deletion that took the picture', async () => {
    await service.findPictures();

    const [sql] = dataSource.query.mock.calls[0] as [string];

    expect(sql).toMatch(
      /WHEN COALESCE\(acc\."deletedAt", ca\."deletedAt"\) IS NOT NULL\s+AND u\."deletedAt" IS NOT NULL THEN \$2::text\s+WHEN COALESCE\(acc\."deletedAt", ca\."deletedAt"\) IS NOT NULL THEN \$3::text\s+WHEN ch\."deletedAt" IS NOT NULL THEN \$4::text\s+ELSE \$5::text/,
    );
  });

  it('removes each picture answer and withdraws the picture', async () => {
    dataSource.query.mockResolvedValue([PICTURE]);

    await expect(service.sweep()).resolves.toBe(1);

    expect(pictures.release).toHaveBeenCalledWith(PICTURE);
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      '[sweep] Pictures of deleted Custom Tracking fields withdrawn - Withdrawn: 1, Failed: 0',
    );
  });

  it('logs a picture it cannot withdraw by its Field and record', async () => {
    const failed = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    dataSource.query.mockResolvedValue([PICTURE]);
    pictures.release.mockRejectedValueOnce(new Error('registry down'));

    await expect(service.sweep()).resolves.toBe(0);

    expect(failed).toHaveBeenCalledWith(
      '[sweep] Not withdrawn - FieldId: field-1, TargetId: account-1, ImageId: image-1',
      expect.stringContaining('registry down'),
    );
  });

  it('sweeps under its own lock', async () => {
    await service.run();

    expect(runner.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1::bigint) AS "locked"',
      [DELETED_CUSTOM_TRACKING_PICTURE_SWEEP_LOCK],
    );
  });
});
