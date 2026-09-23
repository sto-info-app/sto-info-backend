import { BadRequestException, NotFoundException } from '@nestjs/common';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Response } from 'express';

import { FileAssetEntity } from 'src/file-assets/entities/file-asset.entity';
import { FileAssetState } from 'src/file-assets/enums/file-asset-state.enum';

import { FLEET_FEATURE_FLAGS } from '../constants/fleet-feature.constants';
import { StoFleetEntity } from '../entities/sto-fleet.entity';
import { FleetFeatureService } from '../fleet-feature.service';
import { StoFleetService } from '../services/sto-fleet.service';
import { RosterImportPreviewDto } from './dto/roster-import-preview.dto';
import { RosterImportSourceEntity } from './entities/roster-import-source.entity';
import { RosterSourceHeaderShape } from './enums/roster-source-header-shape.enum';
import { RosterImportsController } from './roster-imports.controller';
import { RosterImportIngressService } from './services/roster-import-ingress.service';
import { RosterImportPreviewService } from './services/roster-import-preview.service';

const COMMUNITY_ID = '00000000-0000-4000-8000-000000000000';
const FLEET_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ASSET_ID = '33333333-3333-4333-8333-333333333333';
const RETAIN_UNTIL = new Date('2027-03-18T00:00:00.000Z');
const UPLOADED_AT = new Date('2026-09-19T00:00:00.000Z');
const EXPORTED_AT = new Date('2024-01-01T12:00:00.000Z');

/** What an upload has to say beyond the file itself. */
const BODY = { timezone: 'Europe/London' };

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
  exportTimezone: 'Europe/London',
  exportLocalStamp: '2024-01-01T12:00:00',
  exportedAt: EXPORTED_AT,
  exportedAtAmbiguous: false,
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

/**
 * Builds the Fleet the route resolves, on a platform of the given kind.
 *
 * @param providesRosterExport - Whether the game exports rosters there.
 * @param platformName - What the platform is called.
 * @returns The Fleet, with its platform loaded.
 */
function fleetOn(
  providesRosterExport: boolean,
  platformName = 'Windows',
): StoFleetEntity {
  return {
    id: FLEET_ID,
    platform: { name: platformName, providesRosterExport },
  } as StoFleetEntity;
}

/** What the preview service answers with, when nothing is wrong. */
const PREVIEW = {
  canImport: true,
  timezone: 'Europe/London',
  readableRowCount: 93,
} as RosterImportPreviewDto;

describe('RosterImportsController', () => {
  let controller: RosterImportsController;
  let ingressService: { accept: jest.Mock };
  let previewService: { preview: jest.Mock };
  let featureService: { assertFlagEnabled: jest.Mock };
  // Typed rather than a bare jest.Mock: an untyped one infers `never` for
  // mockResolvedValueOnce and refuses every Fleet handed to it.
  let fleetService: {
    findByIdOrFail: jest.Mock<
      (communityId: string, fleetId: string) => Promise<StoFleetEntity>
    >;
  };
  let response: { status: jest.Mock };

  /**
   * The response an upload may set its status on.
   *
   * @returns The stub, typed as Express's.
   */
  const reply = (): Response => response as unknown as Response;

  beforeEach(() => {
    ingressService = {
      accept: jest.fn(() =>
        Promise.resolve({ record: RECORD, asset: ASSET, repeated: false }),
      ),
    };

    response = { status: jest.fn() };

    previewService = {
      preview: jest.fn(() => Promise.resolve(PREVIEW)),
    };

    featureService = {
      assertFlagEnabled: jest.fn(() => Promise.resolve()),
    };

    fleetService = {
      findByIdOrFail: jest.fn(() => Promise.resolve(fleetOn(true))),
    };

    controller = new RosterImportsController(
      ingressService as unknown as RosterImportIngressService,
      previewService as unknown as RosterImportPreviewService,
      featureService as unknown as FleetFeatureService,
      fleetService as unknown as StoFleetService,
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
        BODY,
        multerFile(Buffer.from('anything', 'utf8')),
        reply(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(featureService.assertFlagEnabled).toHaveBeenCalledWith(
      FLEET_FEATURE_FLAGS.IMPORTS_ENABLED,
    );
    expect(ingressService.accept).not.toHaveBeenCalled();
    expect(fleetService.findByIdOrFail).not.toHaveBeenCalled();
  });

  describe('a platform the game exports no roster on', () => {
    /*
     * Not a 404. A staged rollout is hidden because saying “not yet”
     * advertises what is coming; this is a published fact about the game,
     * and somebody who has spent ten minutes looking for the export menu
     * deserves to be told there is not one.
     */
    it('refuses with a 400 naming the platform', async () => {
      fleetService.findByIdOrFail.mockResolvedValueOnce(fleetOn(false, 'Xbox'));

      await expect(
        controller.upload(
          COMMUNITY_ID,
          FLEET_ID,
          USER_ID,
          BODY,
          multerFile(Buffer.from('roster bytes', 'utf8')),
          reply(),
        ),
      ).rejects.toThrow(/no fleet roster export on Xbox/);

      expect(ingressService.accept).not.toHaveBeenCalled();
    });

    /*
     * Nothing the game wrote on a console can be in the buffer, but
     * somebody's roster still might be — and a refusal is exactly the upload
     * one would otherwise be tempted to keep a copy of. ADR-0001.
     */
    it('disposes of the bytes it refuses', async () => {
      fleetService.findByIdOrFail.mockResolvedValueOnce(fleetOn(false));

      const file = multerFile(Buffer.from('roster bytes', 'utf8'));

      await expect(
        controller.upload(COMMUNITY_ID, FLEET_ID, USER_ID, BODY, file, reply()),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(file.buffer.equals(Buffer.alloc(file.buffer.length))).toBe(true);
    });

    /*
     * The platform is true of the Fleet whether or not anything was
     * attached, so asking for a file first and refusing the platform second
     * would be two answers to one question.
     */
    it('answers the platform before asking for a file', async () => {
      fleetService.findByIdOrFail.mockResolvedValueOnce(
        fleetOn(false, 'PlayStation'),
      );

      await expect(
        controller.upload(
          COMMUNITY_ID,
          FLEET_ID,
          USER_ID,
          BODY,
          undefined,
          reply(),
        ),
      ).rejects.toThrow(/no fleet roster export on PlayStation/);
    });

    it('reads the Fleet through the Community the route claims', async () => {
      await controller.upload(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
        BODY,
        multerFile(Buffer.from('roster bytes', 'utf8')),
        reply(),
      );

      expect(fleetService.findByIdOrFail).toHaveBeenCalledWith(
        COMMUNITY_ID,
        FLEET_ID,
      );
    });
  });

  it('refuses a request that carries no file', async () => {
    await expect(
      controller.upload(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
        BODY,
        undefined,
        reply(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(ingressService.accept).not.toHaveBeenCalled();
  });

  it('hands the ingress service the file and who is uploading it', async () => {
    const bytes = Buffer.from('roster bytes', 'utf8');

    await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      BODY,
      multerFile(bytes),
      reply(),
    );

    expect(ingressService.accept).toHaveBeenCalledWith({
      fleet: fleetOn(true),
      timezone: 'Europe/London',
      chosenExportedAt: null,
      uploadedByUserId: USER_ID,
      originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
      declaredContentType: 'text/csv',
      source: bytes,
    });
  });

  it('hands over the Fleet it resolved, not the identifier in the path', async () => {
    // The service compares the filename's Fleet label against the registered
    // exact name, which is on the entity and not on a UUID. Passing the
    // identifier would make it read the Fleet a second time, from a route
    // segment the guard has already checked once.
    await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      BODY,
      multerFile(Buffer.from('roster bytes', 'utf8')),
      reply(),
    );

    const [[handed]] = ingressService.accept.mock.calls as [
      [{ fleet: StoFleetEntity }],
    ];

    const resolved = await fleetService.findByIdOrFail.mock.results[0].value;

    expect(handed.fleet).toBe(resolved);
  });

  it('passes on the instant the uploader chose, as an instant', async () => {
    // Validated as ISO-8601 by the DTO and checked against the two the stamp
    // could have meant by the service. Neither the controller nor the DTO is
    // entitled to decide it is the right one.
    await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      { ...BODY, exportedAt: '2024-10-27T01:30:00.000Z' },
      multerFile(Buffer.from('roster bytes', 'utf8')),
      reply(),
    );

    expect(ingressService.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        chosenExportedAt: new Date('2024-10-27T01:30:00.000Z'),
      }),
    );
  });

  it('records a missing content type as unknown rather than inventing one', async () => {
    const file = multerFile(Buffer.from('roster bytes', 'utf8'));

    Reflect.deleteProperty(file, 'mimetype');

    await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      BODY,
      file,
      reply(),
    );

    expect(ingressService.accept).toHaveBeenCalledWith(
      expect.objectContaining({ declaredContentType: null }),
    );
  });

  it('answers a new import with the status the route declares', async () => {
    await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      BODY,
      multerFile(Buffer.from('roster bytes', 'utf8')),
      reply(),
    );

    expect(response.status).not.toHaveBeenCalled();
  });

  // Nothing was created, so 201 would be a false answer.
  it('answers a repeat of an earlier import with 200', async () => {
    ingressService.accept.mockImplementationOnce(() =>
      Promise.resolve({ record: RECORD, asset: ASSET, repeated: true }),
    );

    await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      BODY,
      multerFile(Buffer.from('roster bytes', 'utf8')),
      reply(),
    );

    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('drops the reference to the received bytes once they are dealt with', async () => {
    const file = multerFile(Buffer.from('roster bytes', 'utf8'));

    await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      BODY,
      file,
      reply(),
    );

    expect(file.buffer.length).toBe(0);
  });

  it('reports the file, the counts and where the bytes have got to', async () => {
    const result = await controller.upload(
      COMMUNITY_ID,
      FLEET_ID,
      USER_ID,
      BODY,
      multerFile(Buffer.from('roster bytes', 'utf8')),
      reply(),
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
      exportTimezone: 'Europe/London',
      exportLocalStamp: '2024-01-01T12:00:00',
      exportedAt: EXPORTED_AT,
      exportedAtAmbiguous: false,
      rowCount: 93,
      officerTailRowCount: 7,
      parserVersion: 1,
      state: FileAssetState.QUARANTINED,
      retainUntil: RETAIN_UNTIL,
      uploadedAt: UPLOADED_AT,
    });
  });

  describe('the preview', () => {
    const TIMEZONE = { timezone: 'Europe/London' };

    it('hands the file, the Fleet and the timezone to the preview', async () => {
      const file = multerFile(Buffer.from('roster bytes'));

      const answer = await controller.preview(
        COMMUNITY_ID,
        FLEET_ID,
        USER_ID,
        TIMEZONE,
        file,
      );

      expect(previewService.preview).toHaveBeenCalledWith({
        fleet: fleetOn(true),
        originalFilename: 'Fixture Basic Fleet_20240101-120000.Csv',
        timezone: 'Europe/London',
        source: expect.any(Buffer),
      });
      expect(answer).toBe(PREVIEW);
    });

    // Multer's own reference to the bytes is dropped as well, so nothing
    // downstream can hold a page where a roster used to be.
    it('lets go of the bytes once the preview has read them', async () => {
      const file = multerFile(Buffer.from('roster bytes'));

      await controller.preview(COMMUNITY_ID, FLEET_ID, USER_ID, TIMEZONE, file);

      expect(file.buffer).toHaveLength(0);
    });

    it('refuses before reading the file when imports are switched off', async () => {
      featureService.assertFlagEnabled.mockImplementationOnce(() => {
        throw new NotFoundException('Not found');
      });

      await expect(
        controller.preview(
          COMMUNITY_ID,
          FLEET_ID,
          USER_ID,
          TIMEZONE,
          multerFile(Buffer.from('roster bytes')),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(previewService.preview).not.toHaveBeenCalled();
    });

    // The same four refusals in the same order as the upload. Somebody told a
    // file is fine here and told their platform has no export a moment later
    // has been told nothing.
    it('refuses a platform the game writes no export on', async () => {
      fleetService.findByIdOrFail.mockResolvedValueOnce(
        fleetOn(false, 'PlayStation'),
      );

      const file = multerFile(Buffer.from('roster bytes'));

      await expect(
        controller.preview(COMMUNITY_ID, FLEET_ID, USER_ID, TIMEZONE, file),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(file.buffer.every(byte => byte === 0)).toBe(true);
      expect(previewService.preview).not.toHaveBeenCalled();
    });

    it('refuses a request with no file attached', async () => {
      await expect(
        controller.preview(
          COMMUNITY_ID,
          FLEET_ID,
          USER_ID,
          TIMEZONE,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
