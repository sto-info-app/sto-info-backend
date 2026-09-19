import { BadRequestException, NotFoundException } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { FleetFeatureService } from '../fleet-feature.service';
import { RosterImportSourceEntity } from './entities/roster-import-source.entity';
import { RosterSourceHeaderShape } from './enums/roster-source-header-shape.enum';
import { RosterImportsController } from './roster-imports.controller';
import { RosterImportIngressService } from './services/roster-import-ingress.service';

const COMMUNITY_ID = '00000000-0000-4000-8000-000000000000';
const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const RETAIN_UNTIL = new Date('2027-03-18T00:00:00.000Z');
const UPLOADED_AT = new Date('2026-09-19T00:00:00.000Z');

const RECORD = {
  id: 'record-1',
  assetId: ASSET_ID,
  fleetId: FLEET_ID,
  originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
  sourceSha256: 'a'.repeat(64),
  sanitisedSha256: 'b'.repeat(64),
  sourceByteSize: '4096',
  sanitisedByteSize: '2048',
  sourceHeaderShape: RosterSourceHeaderShape.OFFICER,
  rowCount: 93,
  officerTailRowCount: 7,
  parserVersion: 1,
  uploadedAt: UPLOADED_AT,
} as RosterImportSourceEntity;

const ASSET = {
  id: ASSET_ID,
  state: FileAssetState.QUARANTINED,
  retainUntil: RETAIN_UNTIL,
} as FileAssetEntity;

/**
 * Builds a Multer file with the given bytes.
 *
 * @param bytes - What the browser sent.
 * @returns The file as Multer would present it.
 */
function multerFile(bytes: Buffer): Express.Multer.File {
  return {
    originalname: 'Fixture Basic Fleet_20240101-120000.Csv',
    mimetype: 'text/csv',
    buffer: bytes,
  } as Express.Multer.File;
}

describe('RosterImportsController', () => {
  let controller: RosterImportsController;
  let ingressService: { accept: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };

  beforeEach(() => {
    ingressService = {
      accept: jest.fn(() => Promise.resolve({ record: RECORD, asset: ASSET })),
    };

    featureService = {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };

    controller = new RosterImportsController(
      ingressService as unknown as RosterImportIngressService,
      featureService as unknown as FleetFeatureService,
    );
  });

  it('refuses before reading the file when imports are switched off', async () => {
    featureService.assertFlagEnabled.mockImplementationOnce(() => {
      throw new NotFoundException('Not found');
    });

    await expect(
      controller.upload(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
        multerFile(Buffer.from('anything', 'utf8')),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
    expect(ingressService.accept).not.toHaveBeenCalled();
  });

  it('refuses a request that carries no file', async () => {
    await expect(
      controller.upload(COMMUNITY_ID, FLEET_ID, USER_ID, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(ingressService.accept).not.toHaveBeenCalled();
  });

  it('hands the ingress service the file and who is uploading it', async () => {
    const bytes = Buffer.from('roster bytes', 'utf8');

    await controller.upload(COMMUNITY_ID, FLEET_ID, USER_ID, multerFile(bytes));

    expect(ingressService.accept).toHaveBeenCalledWith({
      fleetId: FLEET_ID,
      uploadedByUserId: USER_ID,
      originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
      declaredContentType: 'text/csv',
      source: bytes,
    });
  });

  it('records a missing content type as unknown rather than inventing one', async () => {
    const file = multerFile(Buffer.from('roster bytes', 'utf8'));

    Reflect.deleteProperty(file, 'mimetype');

    await controller.upload(COMMUNITY_ID, FLEET_ID, USER_ID, file);

    expect(ingressService.accept).toHaveBeenCalledWith(
      expect.objectContaining({ declaredContentType: null }),
    );
  });

  it('drops the reference to the received bytes once they are dealt with', async () => {
    const file = multerFile(Buffer.from('roster bytes', 'utf8'));

    await controller.upload(COMMUNITY_ID, FLEET_ID, USER_ID, file);

    expect(file.buffer.length).toBe(0);
  });

  it('reports the file, the counts and where the bytes have got to', async () => {
    const result = await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      multerFile(Buffer.from('roster bytes', 'utf8')),
    );

    expect(result).toEqual({
      id: 'record-1',
      assetId: ASSET_ID,
      fleetId: FLEET_ID,
      originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
      sourceSha256: 'a'.repeat(64),
      sanitisedSha256: 'b'.repeat(64),
      sourceByteSize: 4096,
      sanitisedByteSize: 2048,
      sourceHeaderShape: RosterSourceHeaderShape.OFFICER,
      rowCount: 93,
      officerTailRowCount: 7,
      parserVersion: 1,
      state: FileAssetState.QUARANTINED,
      retainUntil: RETAIN_UNTIL,
      uploadedAt: UPLOADED_AT,
    });
  });
});
